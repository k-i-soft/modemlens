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
  /(?<![0-9a-f])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}/gi,
];

function makeFilter(learned: Set<string>): (s: string) => string {
  // Longest first so that a value containing another one is replaced whole.
  const values = [...learned].sort((a, b) => b.length - a.length);
  const learnedRe = values.length > 0 ? new RegExp(values.map(escapeRe).join('|'), 'gi') : undefined;
  return (s) => {
    let out = learnedRe ? s.replace(learnedRe, REDACTED) : s;
    for (const p of PATTERNS) out = out.replace(p, REDACTED);
    return out;
  };
}

function isCommandName(s: string, learned: Set<string>): boolean {
  if (!/^[+$^#!%*&]?[A-Za-z][A-Za-z0-9_]*$/.test(s)) return false;
  if (/\d{14,}/.test(s) || /\+\d{7,15}/.test(s)) return false;
  const low = s.toLowerCase();
  for (const v of learned) if (low.includes(v.toLowerCase())) return false;
  return true;
}

/** Parsers that consume the whole response, so raw lines hold nothing they did not see. */
const FULL_COVERAGE_PARSERS = new Set(['csq', 'cesq', 'cpin', 'clck', 'cgact', 'qcsq']);
const SERIAL_LABEL = /(^|[^a-z0-9])(serial|s\/n|sn|fsn|esn|meid|imei)(?![a-z0-9])/i;
const USB_ID = /^[0-9a-f]{4}:[0-9a-f]{4}$/i;

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
    const serialLabelled = item.parser === 'identity' && r.lines.some((l) => SERIAL_LABEL.test(l));
    if (!fields || isCrsm || serialLabelled) {
      out.shape = shapeOf(r.lines);
      return out;
    }
    out.fields = fields.map((f) => ({
      key: filter(f.key),
      label: filter(f.label),
      value: f.sensitive !== 'none' ? REDACTED : filter(f.value),
      sensitive: f.sensitive,
    }));
    if (FULL_COVERAGE_PARSERS.has(item.parser ?? '') && fields.every((f) => f.sensitive === 'none')) out.lines = r.lines.map(filter);
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
