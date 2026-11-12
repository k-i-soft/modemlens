import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

export const PING_TARGETS = ['8.8.8.8', '1.1.1.1'];
const COUNT = 4;
const PER_PING_S = 4;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** At least two labels, and the last one starts with a letter, so that 256.1.1.1 is no host name. */
const HOSTNAME = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function hostProblem(host: string): string | undefined {
  return IPV4.test(host) || HOSTNAME.test(host) ? undefined : 'An IPv4 address or a host name such as example.com.';
}

export type PingDialect = 'quectel' | 'simcom';

export function pingDialect(profileId: string | undefined): PingDialect | undefined {
  if (profileId?.startsWith('quectel-')) return 'quectel';
  if (profileId?.startsWith('simcom-')) return 'simcom';
  return undefined;
}

export const PING_TEST: Record<PingDialect, string> = { quectel: 'AT+QPING=?', simcom: 'AT+SNPING4=?' };

export function buildPing(dialect: PingDialect, host: string): string | null {
  if (hostProblem(host) !== undefined) return null;
  return dialect === 'quectel' ? `AT+QPING=1,"${host}",${PER_PING_S},${COUNT}` : `AT+SNPING4="${host}",${COUNT},16,${PER_PING_S * 1000}`;
}

export interface PingResult extends ToolOutcome {
  /** Round trip in ms per answered ping. */
  times: number[];
  sent: number;
  received: number;
}

/** Quectel TCP/IP result codes that a ping can end with. */
const QUECTEL_ERRORS: Record<string, string> = {
  '561': 'The modem could not open its data connection. Is mobile data active?',
  '565': 'The host name could not be resolved.',
  '569': 'No answer in time.',
  '570': 'The data connection broke down.',
  '572': 'The modem does not allow this now.',
  '573': 'No APN is set up.',
};

function summary(times: number[], sent: number): string {
  if (times.length === 0) return `No answer to ${sent} pings.`;
  const lost = sent - times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  return `${times.length} of ${sent} answered${lost ? `, ${lost} lost` : ''}. Round trip ${min} to ${max} ms, ${avg} ms on average.`;
}

/** +QPING: 0,"8.8.8.8",32,45,255 per ping, then +QPING: 0,4,4,0,45,48,46, or a single error code. */
export function quectelDone(lines: string[]): boolean {
  return lines.some((l) => /^\+QPING:\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(l) || /^\+QPING:\s*\d+\s*$/.test(l));
}

export function parseQuectel(lines: string[]): { times: number[]; sent: number; error?: string } {
  const times: number[] = [];
  let sent = COUNT;
  let error: string | undefined;
  for (const l of lines) {
    const each = /^\+QPING:\s*(\d+)\s*,\s*"[^"]*"\s*,\s*\d+\s*,\s*(\d+)/.exec(l);
    if (each) {
      if (each[1] === '0') times.push(Number(each[2]));
      continue;
    }
    const fin = /^\+QPING:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(l);
    if (fin) {
      if (fin[1] !== '0') error = fin[1];
      sent = Number(fin[2]);
      continue;
    }
    const only = /^\+QPING:\s*(\d+)\s*$/.exec(l);
    if (only && only[1] !== '0') error = only[1];
  }
  return { times, sent, error };
}

/** +SNPING4: <n>,<ip>,<ms> per ping. A time beyond the timeout means no answer. */
export function parseSimcom(lines: string[]): number[] {
  const out: number[] = [];
  for (const l of lines) {
    const m = /^\+SNPING4:\s*\d+\s*,\s*[^,]*,\s*(\d+)/.exec(l.trim());
    if (m && Number(m[1]) < PER_PING_S * 1000) out.push(Number(m[1]));
  }
  return out;
}

export async function runPing(io: ToolIo, dialect: PingDialect, host: string): Promise<PingResult> {
  const command = buildPing(dialect, host);
  if (command === null) return { tone: 'bad', message: 'Not a valid host. Nothing was sent.', answer: [], times: [], sent: 0, received: 0 };
  if (dialect === 'simcom') {
    const r = await io.send(command, { timeoutMs: COUNT * PER_PING_S * 1000 + 10000 });
    if (r.status !== 'ok') {
      return { tone: 'bad', message: `${refusal(r)} The ping needs Modem data switched on under Settings.`, shown: command, answer: literal(r), times: [], sent: 0, received: 0 };
    }
    const times = parseSimcom(r.lines);
    return { tone: times.length ? 'ok' : 'bad', message: summary(times, COUNT), shown: command, answer: literal(r), times, sent: COUNT, received: times.length };
  }
  const listener = io.listen((l) => l.startsWith('+QPING:'));
  try {
    const r = await io.send(command, { timeoutMs: 15000 });
    if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: command, answer: literal(r), times: [], sent: 0, received: 0 };
    const finished = await listener.wait(quectelDone, COUNT * PER_PING_S * 1000 + 15000);
    const p = parseQuectel(listener.lines);
    const answer = [...literal(r), ...listener.lines];
    if (p.error) {
      return { tone: 'bad', message: QUECTEL_ERRORS[p.error] ?? `The modem ended the ping with code ${p.error}.`, shown: command, answer, times: p.times, sent: p.sent, received: p.times.length };
    }
    const note = finished ? '' : ' The modem did not finish the ping in time.';
    return { tone: p.times.length ? 'ok' : 'bad', message: summary(p.times, p.sent) + note, shown: command, answer, times: p.times, sent: p.sent, received: p.times.length };
  } finally {
    listener.stop();
  }
}
