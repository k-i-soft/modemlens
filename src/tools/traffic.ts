import type { AtResponse } from '../at/engine';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

/**
 * The modem's own count of mobile data, from Quectel's AT+QGDCNT: bytes sent and received since
 * the counter was last reset. Read once a second, the differences are the speed right now. On an
 * EC200A the counter moves every second and followed a 1 MB download to within its overhead.
 */

export const COUNTER_READ = 'AT+QGDCNT?';
export const COUNTER_RESET = 'AT+QGDCNT=0';

export interface Counter {
  sent: number;
  received: number;
}

export interface Sample extends Counter {
  /** Milliseconds, from any clock that only moves forward. */
  at: number;
}

export interface Rate {
  at: number;
  downMbps: number;
  upMbps: number;
}

export function parseCounter(r: AtResponse): Counter | null {
  if (r.status !== 'ok') return null;
  for (const line of r.lines) {
    const m = /^\+QGDCNT:\s*(\d+)\s*,\s*(\d+)/i.exec(line);
    if (m) return { sent: Number(m[1]), received: Number(m[2]) };
  }
  return null;
}

export async function readCounter(io: ToolIo): Promise<Counter | null> {
  return parseCounter(await io.send(COUNTER_READ));
}

/** The speed between each two readings. A counter that went back, after a reset, gives no speed for that step. */
export function rates(samples: Sample[]): Rate[] {
  const out: Rate[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const ms = b.at - a.at;
    const down = b.received - a.received;
    const up = b.sent - a.sent;
    if (ms <= 0 || down < 0 || up < 0) continue;
    out.push({ at: b.at, downMbps: (down * 8) / (ms * 1000), upMbps: (up * 8) / (ms * 1000) });
  }
  return out;
}

/** Decimal units, as operators bill them: "345 kB", "5.9 MB", "4.87 GB". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const [v, unit] = n < 1e6 ? [n / 1e3, 'kB'] : n < 1e9 ? [n / 1e6, 'MB'] : [n / 1e9, 'GB'];
  const digits = unit === 'GB' ? 2 : v < 10 ? 1 : 0;
  return `${v.toFixed(digits)} ${unit}`;
}

/**
 * Whether a browser speed test went through the modem, from how much the modem counted meanwhile.
 * Undefined when the test was too small or the numbers are in between.
 */
export function routedThroughModem(testBytes: number, countedBytes: number): boolean | undefined {
  if (testBytes < 1_000_000) return undefined;
  if (countedBytes >= testBytes * 0.8) return true;
  if (countedBytes < testBytes * 0.3) return false;
  return undefined;
}

export interface ResetOutcome extends ToolOutcome {
  counter?: Counter;
}

export async function resetCounter(io: ToolIo): Promise<ResetOutcome> {
  const r = await io.send(COUNTER_RESET);
  if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: COUNTER_RESET, answer: literal(r) };
  const back = await io.send(COUNTER_READ);
  const counter = parseCounter(back) ?? undefined;
  const answer = [...literal(r), ...literal(back)];
  if (!counter) return { tone: 'warn', message: 'The modem accepted the reset, but the counter could not be read back.', shown: COUNTER_RESET, answer };
  // A few kilobytes may already have moved between the two commands.
  if (counter.sent + counter.received > 100_000) {
    return { tone: 'warn', message: `The modem accepted the reset, but its counter still shows ${formatBytes(counter.received)} received.`, shown: COUNTER_RESET, answer, counter };
  }
  return { tone: 'ok', message: 'The counter starts again from zero.', shown: COUNTER_RESET, answer, counter };
}

/** The read the tool and the speed test share, for the profiles that have it. */
export function counterDialect(profileId: string | undefined): 'quectel' | undefined {
  return profileId?.startsWith('quectel-') ? 'quectel' : undefined;
}
