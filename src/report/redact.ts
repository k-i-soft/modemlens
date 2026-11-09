import type { ItemState, ScanReport } from '../scan/scanner';
import { parseResponse } from '../parse';
import type { Field } from '../parse';

export interface Shape { length: number; lines: number; classes: string; }
export interface SharedItem {
  id: string;
  command: string;
  state: ItemState;
  fields?: Field[];
  lines?: string[];
  shape?: Shape;
}
export interface SharedReport {
  redacted: true;
  startedAt: string;
  usb?: string;
  profile?: string;
  items: SharedItem[];
  commandList: string[];
}

export const REDACTED = '[redacted]';
const MIN_LEARNED_LENGTH = 4;

export function shapeOf(lines: string[]): Shape {
  const text = lines.join('\n');
  const classes: string[] = [];
  if (/[A-Za-z]/.test(text)) classes.push('alpha');
  if (/\d/.test(text)) classes.push('digit');
  if (/\s/.test(text)) classes.push('space');
  if (/[^A-Za-z\d\s]/.test(text)) classes.push('punct');
  return { length: text.length, lines: lines.length, classes: classes.join(',') };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATTERNS: RegExp[] = [
  /\d(?:[ .-]?\d){13,19}/g,
  /\d{14,20}/g,
  /\+\d{7,15}/g,
  /(?<!\d)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/g,
];
const IPV6 = /(?<![0-9a-f])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}/gi;
// Only the exact shape of a valid time: an IPv6 address can be all digits and have no "::".
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function makeFilter(learned: Set<string>): (s: string) => string {
  // Longest first so that a value containing another one is replaced whole.
  const values = [...learned].sort((a, b) => b.length - a.length);
  const learnedRe = values.length > 0 ? new RegExp(values.map(escapeRe).join('|'), 'gi') : undefined;
  return (s) => {
    let out = learnedRe ? s.replace(learnedRe, REDACTED) : s;
    for (const p of PATTERNS) out = out.replace(p, REDACTED);
    return out.replace(IPV6, (m) => (CLOCK_TIME.test(m) ? m : REDACTED));
  };
}

function isCommandName(s: string, learned: Set<string>): boolean {
  if (!/^[+$^#!%*&]?[A-Za-z][A-Za-z0-9_]*$/.test(s)) return false;
  if (/\d{14,}/.test(s) || /\+\d{7,15}/.test(s)) return false;
  const low = s.toLowerCase();
  for (const v of learned) if (low.includes(v.toLowerCase())) return false;
  return true;
}

/**
 * Parsers whose non-sensitive answers may be exported as raw lines, with the
 * prefix a line needs. Anything else in the response (an injected +CMT, an NMEA
 * sentence) never reached the parser and is dropped.
 */
const RAW_LINE_PREFIX = new Map([
  ['csq', '+CSQ:'],
  ['cesq', '+CESQ:'],
  ['cpin', '+CPIN:'],
  ['clck', '+CLCK:'],
  ['cgact', '+CGACT:'],
  ['qcsq', '+QCSQ:'],
]);
// "serial" also matches as the start of a word: SerialNumber, SERIALNO.
const SERIAL_LABEL = /(^|[^a-z0-9])(serial|(?:s\/n|sn|fsn|esn|meid|imei)(?![a-z0-9]))/i;
const USB_ID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i;

/** The `+` prefix an identity command may answer with: AT+GMR says +GMR or +CGMR, ATI only adds +GCAP. */
function ownIdentityPrefix(command: string): RegExp | undefined {
  const c = command.trim().toUpperCase();
  if (/^ATI\d?$/.test(c)) return /^\+GCAP(?![A-Z0-9_])/;
  const name = /^AT\+C?(GM[IMR])/.exec(c)?.[1];
  return name ? new RegExp(`^\\+C?${name}(?![A-Z0-9_])`) : undefined;
}

/**
 * The identity parser keeps every line it is given, so a +CMT or an NMEA sentence
 * that arrived during the command would end up in a field that is not masked.
 */
function hasUnsolicitedLine(command: string, lines: string[]): boolean {
  const own = ownIdentityPrefix(command);
  return lines.some((raw) => {
    const l = raw.trim().toUpperCase();
    return l.startsWith('$') || (/^[+^%#*!]/.test(l) && !own?.test(l));
  });
}

/**
 * Default-deny: text only survives for items a known parser understood, and
 * only after masking. Everything else is reduced to its shape.
 */
export function redactReport(report: ScanReport): SharedReport {
  const parsed = report.items.map((item) =>
    item.response && item.parser ? parseResponse(item.parser, item.response) : null);

  const learned = new Set<string>();
  for (const fields of parsed) {
    for (const f of fields ?? []) {
      if (f.sensitive !== 'none' && f.value.trim().length >= MIN_LEARNED_LENGTH) learned.add(f.value.trim());
    }
  }
  const filter = makeFilter(learned);

  const items: SharedItem[] = report.items.map((item, i) => {
    let id = filter(item.id);
    let command = filter(item.command);
    if (item.id.startsWith('deep:') || item.category === 'discovery') {
      const name = /^AT([+$^#!%*&][A-Za-z0-9_]+)/i.exec(item.command.trim())?.[1];
      if (!name || !isCommandName(name, learned)) {
        id = 'deep:[redacted]';
        command = 'AT[redacted]';
      }
    }
    const out: SharedItem = { id, command, state: item.state };
    const r = item.response;
    if (!r) return out;
    const fields = parsed[i];
    const isCrsm = /CRSM/i.test(item.command) || /crsm/i.test(item.parser ?? '');
    const unsafeIdentity = item.parser === 'identity'
      && (r.lines.some((l) => SERIAL_LABEL.test(l)) || hasUnsolicitedLine(item.command, r.lines));
    if (!fields || isCrsm || unsafeIdentity) {
      out.shape = shapeOf(r.lines);
      return out;
    }
    out.fields = fields.map((f) => ({
      key: filter(f.key),
      label: filter(f.label),
      value: f.sensitive !== 'none' ? REDACTED : filter(f.value),
      sensitive: f.sensitive,
    }));
    const prefix = RAW_LINE_PREFIX.get(item.parser ?? '');
    if (prefix && fields.every((f) => f.sensitive === 'none')) {
      const own = r.lines.filter((l) => l.trim().toUpperCase().startsWith(prefix));
      if (own.length > 0) out.lines = own.map(filter);
    }
    return out;
  });

  const shared: SharedReport = {
    redacted: true,
    startedAt: report.startedAt,
    items,
    commandList: report.commandList.filter((c) => isCommandName(c, learned)),
  };
  if (report.usb !== undefined && USB_ID.test(report.usb)) shared.usb = report.usb;
  if (report.profile) shared.profile = report.profile.id;
  return shared;
}
