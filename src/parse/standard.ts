import type { AtResponse } from '../at/engine';

export type Sensitivity = 'none' | 'imei' | 'serial' | 'imsi' | 'iccid' | 'msisdn' | 'ip' | 'smsc' | 'location' | 'credential';

export interface Field {
  key: string;
  label: string;
  value: string;
  sensitive: Sensitivity;
}

export type Parser = (r: AtResponse) => Field[];

export function field(key: string, label: string, value: string, sensitive: Sensitivity = 'none'): Field {
  return { key, label, value, sensitive };
}

/** Splits an AT argument list on commas, honouring double quotes. Quotes are removed. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Finds `+NAME: args` lines (case-insensitive) and returns the argument text of each. */
export function prefixed(lines: string[], name: string): string[] {
  const re = new RegExp(`^\\+${name}:\\s*(.*)$`, 'i');
  const out: string[] = [];
  for (const l of lines) {
    const m = re.exec(l.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

const SENSITIVE_NAME = /(user|passw|pwd|secret|token|auth)/i;

/** Credential-looking names are always marked as credentials. */
export function credentialIfNamed(name: string): Sensitivity {
  return SENSITIVE_NAME.test(name) ? 'credential' : 'none';
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isInt(s: string | undefined): s is string {
  return s !== undefined && /^-?\d+$/.test(s);
}

/** Plain, unprefixed text lines (no "+XXX:" prefix, not empty). */
function bareLines(lines: string[]): string[] {
  return lines.map(l => l.trim()).filter(l => l !== '');
}

// ---------- identity ----------

function identityFromCommand(command: string): 'manufacturer' | 'model' | 'firmware' | 'ati' | undefined {
  const c = command.trim().toUpperCase();
  if (c === 'ATI' || c === 'ATI0') return 'ati';
  if (/^AT\+C?GMI/.test(c)) return 'manufacturer';
  if (/^AT\+C?GMM/.test(c)) return 'model';
  if (/^AT\+C?GMR/.test(c)) return 'firmware';
  return undefined;
}

const IDENTITY_LABELS = { manufacturer: 'Manufacturer', model: 'Model', firmware: 'Firmware' } as const;

const identity: Parser = (r) => {
  const kind = identityFromCommand(r.command);
  if (!kind) return [];
  const lines = bareLines(r.lines);
  if (kind !== 'ati') {
    const text = lines.map(l => l.replace(/^\+[A-Z]+:\s*/i, '').replace(/^Revision:\s*/i, '')).join(' ').trim();
    return text ? [field(kind, IDENTITY_LABELS[kind], text)] : [];
  }
  const out: Field[] = [];
  const rest: string[] = [];
  for (const l of lines) {
    const rev = /^Revision:\s*(.+)$/i.exec(l);
    const imei = /^IMEI:\s*(.+)$/i.exec(l);
    if (rev) out.push(field('firmware', IDENTITY_LABELS.firmware, rev[1].trim()));
    else if (imei) out.push(field('imei', 'IMEI', imei[1].trim(), 'imei'));
    else rest.push(l);
  }
  // First plain line is the manufacturer, the second the model.
  if (rest[0]) out.unshift(field('manufacturer', IDENTITY_LABELS.manufacturer, rest[0]));
  if (rest[1]) out.splice(rest[0] ? 1 : 0, 0, field('model', IDENTITY_LABELS.model, rest[1]));
  return out;
};

const cgsn: Parser = (r) => {
  const line = bareLines(r.lines).map(l => l.replace(/^\+[A-Z]+:\s*/i, '').replace(/"/g, ''))[0];
  if (!line) return [];
  // Anything that is not a plain 15 digit IMEI could be a serial number; stay strict.
  return [field('imei', 'IMEI', line, /^\d{15}$/.test(line) ? 'imei' : 'serial')];
};

// ---------- SIM ----------

const cimi: Parser = (r) => {
  const line = bareLines(r.lines)[0];
  if (!line || !/^\d{6,15}$/.test(line)) return [];
  return [field('imsi', 'IMSI', line, 'imsi')];
};

const cpin: Parser = (r) => {
  const a = prefixed(r.lines, 'CPIN')[0];
  return a ? [field('state', 'SIM state', a.trim())] : [];
};

const clck: Parser = (r) => {
  const a = prefixed(r.lines, 'CLCK')[0];
  const fac = /^AT\+CLCK="?([A-Za-z0-9]{2})"?/i.exec(r.command.trim())?.[1]?.toUpperCase();
  if (a === undefined || !fac) return [];
  const v = splitArgs(a)[0];
  const value = v === '1' ? 'enabled' : v === '0' ? 'disabled' : v;
  return value ? [field(`lock_${fac.toLowerCase()}`, `Lock ${fac}`, value)] : [];
};

/** Decodes nibble-swapped BCD (EF-ICCID) into digits, dropping trailing F padding. */
export function decodeIccid(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length % 2 !== 0) return undefined;
  let digits = '';
  for (let i = 0; i < hex.length; i += 2) digits += hex[i + 1] + hex[i];
  digits = digits.toUpperCase().replace(/F+$/, '');
  return /^\d+$/.test(digits) ? digits : undefined;
}

const crsmIccid: Parser = (r) => {
  const a = prefixed(r.lines, 'CRSM')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  if (args[0] !== '144') return [];
  const iccid = args[2] ? decodeIccid(args[2]) : undefined;
  return iccid ? [field('iccid', 'ICCID', iccid, 'iccid')] : [];
};

// ---------- network ----------

const RAT_COPS: Record<string, string> = {
  '0': 'GSM', '1': 'GSM compact', '2': 'UTRAN', '3': 'GSM EGPRS', '4': 'UTRAN HSDPA', '5': 'UTRAN HSUPA',
  '6': 'UTRAN HSPA', '7': 'E-UTRAN', '8': 'EC-GSM-IoT', '9': 'E-UTRAN NB-IoT', '10': 'E-UTRA connected to 5GCN',
  '11': 'NR connected to 5GCN', '12': 'NG-RAN', '13': 'E-UTRA-NR dual connectivity',
};

const cops: Parser = (r) => {
  const a = prefixed(r.lines, 'COPS')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const out: Field[] = [];
  const mode: Record<string, string> = { '0': 'automatic', '1': 'manual', '2': 'deregistered', '3': 'format only', '4': 'manual/automatic' };
  if (isInt(args[0])) out.push(field('mode', 'Selection mode', mode[args[0]] ?? args[0]));
  if (args[2]) out.push(field('operator', 'Operator', args[2]));
  if (isInt(args[3])) out.push(field('rat', 'Access technology', RAT_COPS[args[3]] ?? args[3]));
  return out;
};

const REG_STAT: Record<string, string> = {
  '0': 'not registered', '1': 'registered, home', '2': 'searching', '3': 'denied', '4': 'unknown', '5': 'registered, roaming',
  '6': 'registered, SMS only (home)', '7': 'registered, SMS only (roaming)', '8': 'emergency only',
  '9': 'registered, CSFB not preferred (home)', '10': 'registered, CSFB not preferred (roaming)',
};

const creg: Parser = (r) => {
  for (const l of r.lines) {
    const m = /^\+(C5GREG|CEREG|CGREG|CREG):\s*(.*)$/i.exec(l.trim());
    if (!m) continue;
    const name = m[1].toUpperCase();
    const args = splitArgs(m[2]);
    // Read form is "<n>,<stat>[,<area>,<cell>,<act>]"; a lone value is a bare <stat>.
    const hasN = args.length >= 2;
    const rest = hasN ? args.slice(1) : args;
    if (!isInt(rest[0])) continue;
    const out: Field[] = [field('status', 'Registration', REG_STAT[rest[0]] ?? 'unknown')];
    const area = rest[1];
    const cell = rest[2];
    const act = rest[3];
    const areaName = name === 'CEREG' || name === 'C5GREG' ? 'tac' : 'lac';
    if (area) out.push(field(areaName, areaName === 'tac' ? 'TAC' : 'LAC', area, 'location'));
    if (cell) out.push(field('cell_id', 'Cell ID', cell, 'location'));
    if (isInt(act)) out.push(field('act', 'Access technology', RAT_COPS[act] ?? act));
    return out;
  }
  return [];
};

// ---------- signal ----------

const csq: Parser = (r) => {
  const a = prefixed(r.lines, 'CSQ')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const out: Field[] = [];
  if (isInt(args[0])) {
    const n = Number(args[0]);
    out.push(field('rssi_dbm', 'RSSI (dBm)', n >= 0 && n <= 31 ? String(-113 + 2 * n) : 'unknown'));
  }
  if (isInt(args[1])) {
    const n = Number(args[1]);
    out.push(field('ber', 'Bit error rate', n >= 0 && n <= 7 ? String(n) : 'unknown'));
  }
  return out;
};

const cesq: Parser = (r) => {
  const a = prefixed(r.lines, 'CESQ')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const out: Field[] = [];
  const num = (i: number): number | undefined => (isInt(args[i]) ? Number(args[i]) : undefined);
  // 3GPP TS 27.007 lower-bound mappings:
  //   rsrp_dbm = -141 + n   (n in 0..97, 255 = unknown)
  //   rsrq_db  = -20 + n/2  (n in 0..34, 255 = unknown)
  // The other three follow the same scheme (rxlev -111+n, rscp -121+n, ecno -24.5+n/2).
  const add = (i: number, key: string, label: string, max: number, conv: (n: number) => number): void => {
    const n = num(i);
    if (n === undefined) return;
    out.push(field(key, label, n >= 0 && n <= max ? String(conv(n)) : 'unknown'));
  };
  add(0, 'rxlev_dbm', 'RxLev (dBm)', 63, n => -111 + n);
  add(1, 'ber', 'Bit error rate', 7, n => n);
  add(2, 'rscp_dbm', 'RSCP (dBm)', 96, n => -121 + n);
  add(3, 'ecno_db', 'Ec/No (dB)', 49, n => -24.5 + n / 2);
  add(4, 'rsrq_db', 'RSRQ (dB)', 34, n => -20 + n / 2);
  add(5, 'rsrp_dbm', 'RSRP (dBm)', 97, n => -141 + n);
  return out;
};

// ---------- data ----------

const cgdcont: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'CGDCONT')) {
    const args = splitArgs(a);
    const cid = args[0];
    if (!isInt(cid)) continue;
    if (args[1]) out.push(field(`ctx${cid}_type`, `Context ${cid} type`, args[1]));
    if (args[2]) out.push(field(`ctx${cid}_apn`, `Context ${cid} APN`, args[2]));
    if (args[3]) out.push(field(`ctx${cid}_addr`, `Context ${cid} address`, args[3], 'ip'));
  }
  return out;
};

const cgact: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'CGACT')) {
    const args = splitArgs(a);
    if (!isInt(args[0]) || !isInt(args[1])) continue;
    out.push(field(`ctx${args[0]}_active`, `Context ${args[0]} active`, args[1] === '1' ? 'active' : 'inactive'));
  }
  return out;
};

const cgpaddr: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'CGPADDR')) {
    const args = splitArgs(a);
    const cid = args[0];
    if (!isInt(cid)) continue;
    args.slice(1).filter(x => x !== '').forEach((addr, i) =>
      out.push(field(`ctx${cid}_addr${i === 0 ? '' : i + 1}`, `Context ${cid} address`, addr, 'ip')));
  }
  return out;
};

export const STANDARD_PARSERS: Record<string, Parser> = {
  identity, cgsn, cimi, cpin, clck, cops, creg, csq, cesq, cgdcont, cgact, cgpaddr, crsm_iccid: crsmIccid,
};
