/** SMS PDUs after 3GPP TS 23.040, and the GSM 7-bit alphabet of TS 23.038. */

const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXTENSION: Record<number, string> = { 0x0a: '\f', 0x14: '^', 0x28: '{', 0x29: '}', 0x2f: '\\', 0x3c: '[', 0x3d: '~', 0x3e: ']', 0x40: '|', 0x65: '€' };
const ESC = 0x1b;

const BASIC_CODE = new Map<string, number>([...BASIC].map((ch, i) => [ch, i]));
const EXTENSION_CODE = new Map<string, number>(Object.entries(EXTENSION).map(([k, v]) => [v, Number(k)]));

export function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function septetsOf(bytes: number[], count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const bit = i * 7;
    const byte = bit >> 3;
    const shift = bit & 7;
    const low = (bytes[byte] ?? 0) >> shift;
    const high = shift > 1 ? ((bytes[byte + 1] ?? 0) << (8 - shift)) : 0;
    out.push((low | high) & 0x7f);
  }
  return out;
}

function septetsToText(septets: number[]): string {
  let out = '';
  for (let i = 0; i < septets.length; i++) {
    const s = septets[i];
    if (s === ESC && i + 1 < septets.length) {
      out += EXTENSION[septets[++i]] ?? ' ';
      continue;
    }
    out += BASIC[s] ?? '?';
  }
  return out;
}

export function decodeGsm7Packed(hex: string, septets: number): string {
  return septetsToText(septetsOf(hexToBytes(hex), septets));
}

export function decodeUcs2Hex(hex: string): string {
  return decodeUcs2(hexToBytes(hex));
}

function decodeUcs2(bytes: number[]): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
}

/** The septets of `text` in GSM 7-bit, or null when a character is missing from the alphabet. */
export function toSeptets(text: string): number[] | null {
  const out: number[] = [];
  for (const ch of text) {
    const basic = BASIC_CODE.get(ch);
    if (basic !== undefined && basic !== ESC) { out.push(basic); continue; }
    const ext = EXTENSION_CODE.get(ch);
    if (ext === undefined) return null;
    out.push(ESC, ext);
  }
  return out;
}

/** Packs septets after `fillBits` zero bits, which align them behind a user data header. */
function pack(septets: number[], fillBits = 0): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = fillBits;
  for (const s of septets) {
    acc |= s << bits;
    bits += 7;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out.push(acc & 0xff);
  return out;
}

export type Alphabet = 'gsm7' | '8bit' | 'ucs2';

/** The alphabet a TP-DCS asks for. */
export function alphabetOf(dcs: number): Alphabet {
  const group = dcs & 0xf0;
  if ((dcs & 0xc0) === 0x00) {
    const a = (dcs >> 2) & 0x03;
    return a === 2 ? 'ucs2' : a === 1 ? '8bit' : 'gsm7';
  }
  if (group === 0xe0) return 'ucs2';
  if (group === 0xf0) return dcs & 0x04 ? '8bit' : 'gsm7';
  return 'gsm7';
}

function semiOctets(bytes: number[]): string {
  return bytes.map((b) => `${(b & 0x0f).toString(16)}${(b >> 4).toString(16)}`).join('');
}

function address(bytes: number[], at: number): { text: string; next: number } {
  const digits = bytes[at];
  const toa = bytes[at + 1];
  const len = Math.ceil(digits / 2);
  if (digits === undefined || at + 2 + len > bytes.length) throw new RangeError('address');
  const body = bytes.slice(at + 2, at + 2 + len);
  let text: string;
  if ((toa & 0x70) === 0x50) {
    text = septetsToText(septetsOf(body, Math.floor((digits * 4) / 7)));
  } else {
    text = semiOctets(body).replace(/[fF]/g, '').slice(0, digits).replace(/[^0-9]/g, (c) => ({ a: '*', b: '#' }[c.toLowerCase()] ?? ''));
    if ((toa & 0x70) === 0x10) text = `+${text}`;
  }
  return { text, next: at + 2 + len };
}

function timestamp(bytes: number[]): string {
  const d = semiOctets(bytes.slice(0, 6));
  const tzByte = bytes[6];
  const quarters = (tzByte & 0x07) * 10 + (tzByte >> 4);
  const sign = tzByte & 0x08 ? '-' : '+';
  const minutes = quarters * 15;
  const tz = `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  if (bytes.length < 7) throw new RangeError('timestamp');
  const century = Number(d.slice(0, 2)) >= 90 ? '19' : '20';
  return `${century}${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)} ${d.slice(6, 8)}:${d.slice(8, 10)}:${d.slice(10, 12)} ${tz}`;
}

export interface SmsPart {
  kind: 'received' | 'sent' | 'report';
  /** Sender of a received message, recipient of a stored sent one. */
  number: string;
  /** Only on received messages. */
  time?: string;
  text: string;
  /** Present on one part of a longer message. */
  concat?: { ref: number; total: number; seq: number };
}

function userData(bytes: number[], at: number, dcs: number, udhi: boolean): { text: string; concat?: SmsPart['concat'] } {
  const udl = bytes[at];
  if (udl === undefined) throw new RangeError('user data');
  const ud = bytes.slice(at + 1);
  const alphabet = alphabetOf(dcs);
  let headerBytes = 0;
  let concat: SmsPart['concat'];
  if (udhi && ud.length > 0) {
    const udhl = ud[0];
    headerBytes = udhl + 1;
    for (let i = 1; i < headerBytes; ) {
      const iei = ud[i];
      const len = ud[i + 1];
      if (iei === 0x00 && len === 3) concat = { ref: ud[i + 2], total: ud[i + 3], seq: ud[i + 4] };
      if (iei === 0x08 && len === 4) concat = { ref: (ud[i + 2] << 8) | ud[i + 3], total: ud[i + 4], seq: ud[i + 5] };
      i += 2 + len;
    }
  }
  if (alphabet === 'gsm7') {
    const skip = Math.ceil((headerBytes * 8) / 7);
    return { text: septetsToText(septetsOf(ud, udl).slice(skip)), concat };
  }
  const body = ud.slice(headerBytes, udl);
  if (alphabet === 'ucs2') return { text: decodeUcs2(body), concat };
  return { text: bytesToHex(body), concat };
}

/** Reads one stored PDU, as AT+CMGL in PDU mode lists it (with the SMSC in front). Null for anything else. */
export function decodePdu(hex: string): SmsPart | null {
  if (!/^(?:[0-9A-Fa-f]{2})+$/.test(hex)) return null;
  const b = hexToBytes(hex);
  if (b.length < 2 || 1 + b[0] >= b.length) return null;
  try {
    let at = 1 + b[0];
    const first = b[at++];
    const mti = first & 0x03;
    const udhi = (first & 0x40) !== 0;
    if (mti === 0) {
      const oa = address(b, at);
      at = oa.next;
      at++; // PID
      const dcs = b[at++];
      const time = timestamp(b.slice(at, at + 7));
      at += 7;
      return { kind: 'received', number: oa.text, time, ...userData(b, at, dcs, udhi) };
    }
    if (mti === 1) {
      at++; // MR
      const da = address(b, at);
      at = da.next;
      at++; // PID
      const dcs = b[at++];
      const vpf = (first >> 3) & 0x03;
      at += vpf === 2 ? 1 : vpf === 0 ? 0 : 7;
      return { kind: 'sent', number: da.text, ...userData(b, at, dcs, udhi) };
    }
    return { kind: 'report', number: '', text: 'Delivery report' };
  } catch {
    return null;
  }
}

export interface StoredSms {
  /** Storage indexes of all parts, in order. */
  indexes: number[];
  status: 'unread' | 'read' | 'unsent' | 'sent';
  kind: SmsPart['kind'];
  number: string;
  time?: string;
  text: string;
  /** Parts are missing from a longer message. */
  incomplete: boolean;
}

const STAT: Record<string, StoredSms['status']> = { '0': 'unread', '1': 'read', '2': 'unsent', '3': 'sent' };

/** Pairs the +CMGL header lines with their PDUs and joins the parts of longer messages. */
export function parseSmsList(lines: string[]): StoredSms[] {
  const parts: Array<{ index: number; status: StoredSms['status']; part: SmsPart }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\+CMGL:\s*(\d+)\s*,\s*(\d)/.exec(lines[i].trim());
    if (!m) continue;
    const part = decodePdu((lines[i + 1] ?? '').trim());
    if (part) parts.push({ index: Number(m[1]), status: STAT[m[2]] ?? 'read', part });
    i++;
  }
  const out: StoredSms[] = [];
  const groupsByKey = new Map<string, typeof parts>();
  for (const p of parts) {
    if (!p.part.concat) {
      out.push({ indexes: [p.index], status: p.status, kind: p.part.kind, number: p.part.number, time: p.part.time, text: p.part.text, incomplete: false });
      continue;
    }
    const key = `${p.part.kind}|${p.part.number}|${p.part.concat.ref}|${p.part.concat.total}`;
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), p]);
  }
  for (const group of groupsByKey.values()) {
    group.sort((a, b) => a.part.concat!.seq - b.part.concat!.seq);
    const first = group[0];
    const seqs = new Set(group.map((g) => g.part.concat!.seq));
    out.push({
      indexes: group.map((g) => g.index),
      status: group.some((g) => g.status === 'unread') ? 'unread' : first.status,
      kind: first.part.kind,
      number: first.part.number,
      time: first.part.time,
      text: group.map((g) => g.part.text).join(''),
      incomplete: seqs.size < first.part.concat!.total,
    });
  }
  return out.sort((a, b) => a.indexes[0] - b.indexes[0]);
}

export const NUMBER_PATTERN = /^\+?\d{3,15}$/;
export const MAX_PARTS = 6;

export interface SubmitPlan {
  alphabet: 'gsm7' | 'ucs2';
  parts: number;
  /** Characters left in the last part. */
  left: number;
}

/** How a text would be sent: alphabet and number of parts. */
export function planSubmit(text: string): SubmitPlan {
  const septets = toSeptets(text);
  if (septets) {
    if (septets.length <= 160) return { alphabet: 'gsm7', parts: 1, left: 160 - septets.length };
    const parts = splitSeptets(septets, 153).length;
    return { alphabet: 'gsm7', parts, left: parts * 153 - septets.length };
  }
  const units = [...text].reduce((n, ch) => n + (ch.length > 1 ? 2 : 1), 0);
  if (units <= 70) return { alphabet: 'ucs2', parts: 1, left: 70 - units };
  const parts = Math.ceil(units / 67);
  return { alphabet: 'ucs2', parts, left: parts * 67 - units };
}

/** Splits septets into parts without cutting an escape from the character it belongs to. */
function splitSeptets(septets: number[], size: number): number[][] {
  const out: number[][] = [];
  let i = 0;
  while (i < septets.length) {
    let end = Math.min(i + size, septets.length);
    if (end < septets.length && septets[end - 1] === ESC) end--;
    out.push(septets.slice(i, end));
    i = end;
  }
  return out;
}

function ucs2Units(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  return out;
}

function splitUnits(units: number[], size: number): number[][] {
  const out: number[][] = [];
  let i = 0;
  while (i < units.length) {
    let end = Math.min(i + size, units.length);
    // A surrogate pair stays together.
    if (end < units.length && units[end - 1] >= 0xd800 && units[end - 1] <= 0xdbff) end--;
    out.push(units.slice(i, end));
    i = end;
  }
  return out;
}

function encodeAddress(number: string): number[] {
  const international = number.startsWith('+');
  const digits = number.replace(/^\+/, '');
  const padded = digits.length % 2 ? `${digits}F` : digits;
  const body: number[] = [];
  for (let i = 0; i < padded.length; i += 2) body.push(parseInt(`${padded[i + 1]}${padded[i]}`, 16));
  return [digits.length, international ? 0x91 : 0x81, ...body];
}

export interface SubmitPdu {
  /** For AT+CMGS=<length>: the octets after the SMSC. */
  length: number;
  hex: string;
}

/**
 * The SMS-SUBMIT PDUs for a text, with the SMSC left to the SIM. Null for a number or a text
 * that cannot be sent: wrong digits, empty, or more than MAX_PARTS parts.
 */
export function encodeSubmit(number: string, text: string, ref: number): SubmitPdu[] | null {
  if (!NUMBER_PATTERN.test(number) || text.length === 0) return null;
  const plan = planSubmit(text);
  if (plan.parts > MAX_PARTS) return null;
  const da = encodeAddress(number);
  const multi = plan.parts > 1;
  const udh = (seq: number) => [0x05, 0x00, 0x03, ref & 0xff, plan.parts, seq];
  const pdus: number[][] = [];
  if (plan.alphabet === 'gsm7') {
    const septets = toSeptets(text)!;
    const chunks = multi ? splitSeptets(septets, 153) : [septets];
    chunks.forEach((chunk, i) => {
      const header = multi ? udh(i + 1) : [];
      // 6 header octets are 48 bits: one fill bit brings the text to a septet boundary.
      const ud = multi ? [...header, ...pack(chunk, 1)] : pack(chunk);
      const udl = multi ? 7 + chunk.length : chunk.length;
      pdus.push([multi ? 0x41 : 0x01, 0x00, ...da, 0x00, 0x00, udl, ...ud]);
    });
  } else {
    const units = ucs2Units(text);
    const chunks = multi ? splitUnits(units, 67) : [units];
    chunks.forEach((chunk, i) => {
      const body = chunk.flatMap((u) => [u >> 8, u & 0xff]);
      const ud = [...(multi ? udh(i + 1) : []), ...body];
      pdus.push([multi ? 0x41 : 0x01, 0x00, ...da, 0x00, 0x08, ud.length, ...ud]);
    });
  }
  return pdus.map((tpdu) => ({ length: tpdu.length, hex: `00${bytesToHex(tpdu)}` }));
}
