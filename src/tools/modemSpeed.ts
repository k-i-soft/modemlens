import type { AtResponse } from '../at/engine';
import { capture } from '../actions/ec200a';
import type { SpeedSize } from './speed';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

/**
 * Download test inside the modem, with its own HTTP client: it works without the computer using the
 * modem as its network, and measures the modem's own data connection. Plain HTTP, because the modem
 * would need certificates for HTTPS. Download only.
 */

export const MODEM_SPEED_URL = 'http://speed.cloudflare.com';
const QUECTEL_FILE = 'UFS:mlspeed.bin';

export type ModemSpeedDialect = 'quectel' | 'simcom';

export function modemSpeedDialect(profileId: string | undefined): ModemSpeedDialect | undefined {
  if (profileId?.startsWith('quectel-')) return 'quectel';
  if (profileId?.startsWith('simcom-')) return 'simcom';
  return undefined;
}

export const MODEM_SPEED_TEST: Record<ModemSpeedDialect, string> = { quectel: 'AT+QHTTPURL=?', simcom: 'AT+SHREQ=?' };

/** Bytes per test. A SIMCom IoT module keeps the whole answer in a small buffer and is slow anyway. */
export const MODEM_SIZES: Record<ModemSpeedDialect, Record<SpeedSize, number>> = {
  quectel: { light: 1_000_000, full: 5_000_000 },
  simcom: { light: 100_000, full: 300_000 },
};

export interface ModemSpeedResult extends ToolOutcome {
  downMbps?: number;
  bytes: number;
  ms?: number;
}

const QUECTEL_HTTP_ERRORS: Record<string, string> = {
  '701': 'Unknown HTTP error.',
  '702': 'The HTTP request timed out.',
  '703': 'The modem is busy with another HTTP request.',
  '704': 'The modem could not read the URL.',
  '711': 'The URL is invalid.',
  '713': 'The server name could not be resolved.',
  '714': 'The connection to the server failed.',
  '717': 'The modem could not reach the internet. Is its data context active?',
};

function done(prefix: string) {
  return (lines: string[]) => lines.some((l) => l.startsWith(prefix));
}

function codeOf(lines: string[], prefix: string): string[] | null {
  const line = lines.find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).split(',').map((x) => x.trim().replace(/"/g, '')) : null;
}

/** Free bytes on the modem's own file system, or null when it does not say. */
export function parseFree(r: AtResponse): number | null {
  const v = capture(r, /^\+QFLDS:\s*(\d+)/i);
  return v === null ? null : Number(v);
}

const mbps = (bytes: number, ms: number): number => (bytes * 8) / (ms * 1000);

function bad(message: string, r?: AtResponse, extra: string[] = []): ModemSpeedResult {
  return { tone: 'bad', message, shown: r?.command, answer: [...(r ? literal(r) : []), ...extra], bytes: 0 };
}

async function quectel(io: ToolIo, wanted: number, now: () => number): Promise<ModemSpeedResult> {
  // The answer goes into a file on the modem: it may take at most part of the free space.
  const free = parseFree(await io.send('AT+QFLDS="UFS"'));
  const bytes = free === null ? Math.min(wanted, 1_000_000) : Math.min(wanted, Math.floor((free * 0.6) / 100_000) * 100_000);
  if (bytes < 100_000) return bad('The modem has too little free storage for the download.');

  for (const cfg of ['AT+QHTTPCFG="contextid",1', 'AT+QHTTPCFG="responseheader",0']) {
    const r = await io.send(cfg);
    if (r.status !== 'ok') return bad(refusal(r), r);
  }
  const url = `${MODEM_SPEED_URL}/__down?bytes=${bytes}`;
  const set = await io.send(`AT+QHTTPURL=${url.length},30`, { timeoutMs: 35000, body: url, bodyAfterConnect: true });
  if (set.status !== 'ok') return bad(refusal(set), set);

  const listener = io.listen((l) => l.startsWith('+QHTTPGET:') || l.startsWith('+QHTTPREADFILE:'));
  let fileWritten = false;
  try {
    const t0 = now();
    const get = await io.send('AT+QHTTPGET=60', { timeoutMs: 15000 });
    if (get.status !== 'ok') return bad(refusal(get), get);
    if (!(await listener.wait(done('+QHTTPGET:'), 65000))) return bad('The server did not answer within a minute.', get, listener.lines);
    const head = codeOf(listener.lines, '+QHTTPGET:')!;
    if (head[0] !== '0') return bad(QUECTEL_HTTP_ERRORS[head[0]] ?? `The modem ended the request with code ${head[0]}.`, get, listener.lines);
    if (head[1] !== '200') return bad(`The server answered with HTTP ${head[1] ?? '?'}.`, get, listener.lines);
    fileWritten = true;
    const read = await io.send(`AT+QHTTPREADFILE="${QUECTEL_FILE}",80`, { timeoutMs: 15000 });
    if (read.status !== 'ok') return bad(refusal(read), read, listener.lines);
    if (!(await listener.wait(done('+QHTTPREADFILE:'), 85000))) return bad('The download did not finish in time.', read, listener.lines);
    const ms = now() - t0;
    const fin = codeOf(listener.lines, '+QHTTPREADFILE:')!;
    if (fin[0] !== '0') return bad(QUECTEL_HTTP_ERRORS[fin[0]] ?? `The download ended with code ${fin[0]}.`, read, listener.lines);
    const got = Number(head[2]) > 0 ? Number(head[2]) : bytes;
    const v = mbps(got, ms);
    return { tone: 'ok', message: `${(got / 1_000_000).toFixed(1)} MB in ${(ms / 1000).toFixed(1)} s.`, shown: url, answer: listener.lines, downMbps: v, bytes: got, ms };
  } finally {
    listener.stop();
    if (fileWritten) await io.send(`AT+QFDEL="${QUECTEL_FILE}"`);
  }
}

async function simcom(io: ToolIo, bytes: number, now: () => number): Promise<ModemSpeedResult> {
  const act = capture(await io.send('AT+CNACT?'), /^\+CNACT:\s*(\d)/i);
  if (act !== '1') return bad('Switch "Modem data" on under Settings first: the modem needs its own data connection.');
  for (const cfg of [`AT+SHCONF="URL","${MODEM_SPEED_URL}"`, 'AT+SHCONF="BODYLEN",1024', 'AT+SHCONF="HEADERLEN",350']) {
    const r = await io.send(cfg);
    if (r.status !== 'ok') return bad(refusal(r), r);
  }
  const conn = await io.send('AT+SHCONN', { timeoutMs: 30000 });
  if (conn.status !== 'ok') return bad(`${refusal(conn)} The modem could not connect to the test server.`, conn);
  const listener = io.listen((l) => l.startsWith('+SHREQ:'));
  try {
    const t0 = now();
    const path = `/__down?bytes=${bytes}`;
    const req = await io.send(`AT+SHREQ="${path}",1`, { timeoutMs: 15000 });
    if (req.status !== 'ok') return bad(refusal(req), req);
    if (!(await listener.wait(done('+SHREQ:'), 120000))) return bad('The download did not finish within two minutes.', req, listener.lines);
    const ms = now() - t0;
    const fin = codeOf(listener.lines, '+SHREQ:')!;
    if (fin[1] !== '200') return bad(`The server answered with HTTP ${fin[1] ?? '?'}.`, req, listener.lines);
    const got = Number(fin[2]) > 0 ? Number(fin[2]) : bytes;
    return { tone: 'ok', message: `${Math.round(got / 1000)} kB in ${(ms / 1000).toFixed(1)} s.`, shown: `${MODEM_SPEED_URL}${path}`, answer: listener.lines, downMbps: mbps(got, ms), bytes: got, ms };
  } finally {
    listener.stop();
    await io.send('AT+SHDISC');
  }
}

export function runModemSpeed(io: ToolIo, dialect: ModemSpeedDialect, size: SpeedSize, now: () => number = () => performance.now()): Promise<ModemSpeedResult> {
  const bytes = MODEM_SIZES[dialect][size];
  return dialect === 'quectel' ? quectel(io, bytes, now) : simcom(io, bytes, now);
}
