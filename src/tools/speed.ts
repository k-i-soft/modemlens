/**
 * Speed test from the browser, through whatever network the computer uses. Downloads and uploads
 * go to Cloudflare's speed test service, the name of the network they left through comes from
 * RIPEstat. Both are contacted only when the person starts the test.
 */

export const SPEED_HOST = 'https://speed.cloudflare.com';
export const ASN_HOST = 'https://stat.ripe.net';

export type SpeedSize = 'light' | 'full';

/** Transfers in bytes, smallest first. A step that takes longer than STEP_LIMIT_MS ends that direction. */
export const PLANS: Record<SpeedSize, { down: number[]; up: number[] }> = {
  light: { down: [100_000, 1_000_000, 5_000_000], up: [100_000, 1_000_000] },
  full: { down: [100_000, 1_000_000, 10_000_000, 25_000_000], up: [100_000, 1_000_000, 5_000_000] },
};
const STEP_LIMIT_MS = 8000;
const PINGS = 5;

/** Megabytes a plan can use at most, for the warning before it starts. */
export function planMegabytes(size: SpeedSize): number {
  const p = PLANS[size];
  return Math.ceil([...p.down, ...p.up].reduce((a, b) => a + b, 0) / 1_000_000);
}

export interface SpeedEnv {
  fetch: typeof fetch;
  now: () => number;
}

export interface Network {
  asn?: string;
  country?: string;
  /** The holder of the AS as RIPE knows it, for example "SWISSCOM Swisscom (Schweiz) AG". */
  holder?: string;
}

export interface SpeedResult {
  latencyMs?: number;
  jitterMs?: number;
  /** Megabits per second. */
  downMbps?: number;
  upMbps?: number;
  /** Bytes moved in each direction, for the data used. */
  bytesDown: number;
  bytesUp: number;
  network: Network;
  /** The test stopped early: the reason in plain words. */
  error?: string;
}

export type SpeedPhase = 'latency' | 'download' | 'upload' | 'network';
export type Progress = (phase: SpeedPhase, mbps?: number) => void;

const mbps = (bytes: number, ms: number): number => (bytes * 8) / (ms * 1000);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Reads a whole body and counts its bytes. */
async function drain(r: Response): Promise<number> {
  if (!r.body) return (await r.arrayBuffer()).byteLength;
  const reader = r.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return n;
    n += value.byteLength;
  }
}

/** Says why a request failed, in words a person can act on. */
export function failure(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'Stopped.';
  return 'The speed test server could not be reached. Is this computer online through the modem?';
}

/** Whether the network the test went out through looks like the modem's operator. Undefined when it cannot be said. */
export function matchesOperator(holder: string | undefined, operator: string | undefined): boolean | undefined {
  if (!holder || !operator) return undefined;
  const GENERIC = new Set(['mobile', 'telecom', 'telekom', 'communications', 'network', 'networks', 'wireless', 'the', 'and', 'gmbh', 'ltd', 'inc', 'sas', 'spa', 'plc', 'ag', 'sa', 'bv', 'nv', 'as']);
  const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
  const own = words(operator);
  if (own.length === 0) return undefined;
  const theirs = new Set(words(holder));
  return own.some((w) => theirs.has(w) || [...theirs].some((t) => t.startsWith(w) || w.startsWith(t)));
}

export async function lookupHolder(env: SpeedEnv, asn: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!/^\d{1,10}$/.test(asn)) return undefined;
  try {
    const r = await env.fetch(`${ASN_HOST}/data/as-overview/data.json?resource=AS${asn}`, { signal, cache: 'no-store' });
    if (!r.ok) return undefined;
    const body = (await r.json()) as { data?: { holder?: unknown } };
    return typeof body.data?.holder === 'string' ? body.data.holder.slice(0, 120) : undefined;
  } catch {
    return undefined;
  }
}

/** Runs latency, download and upload one after the other. Stops at the first failure and keeps what it has. */
export async function runSpeedTest(env: SpeedEnv, size: SpeedSize, progress: Progress = () => undefined, signal?: AbortSignal): Promise<SpeedResult> {
  const out: SpeedResult = { bytesDown: 0, bytesUp: 0, network: {} };
  const plan = PLANS[size];
  try {
    progress('latency');
    const rtts: number[] = [];
    for (let i = 0; i < PINGS; i++) {
      const t0 = env.now();
      const r = await env.fetch(`${SPEED_HOST}/__down?bytes=0`, { signal, cache: 'no-store' });
      await drain(r);
      rtts.push(env.now() - t0);
      if (i === 0) out.network = { asn: r.headers.get('cf-meta-asn') ?? undefined, country: r.headers.get('cf-meta-country') ?? undefined };
    }
    // The first request also opens the connection, so it does not count.
    const steady = rtts.length > 1 ? rtts.slice(1) : rtts;
    out.latencyMs = Math.round(median(steady));
    out.jitterMs = Math.round(steady.slice(1).reduce((a, x, i) => a + Math.abs(x - steady[i]), 0) / Math.max(1, steady.length - 1));

    progress('download');
    for (const bytes of plan.down) {
      const t0 = env.now();
      const r = await env.fetch(`${SPEED_HOST}/__down?bytes=${bytes}`, { signal, cache: 'no-store' });
      const got = await drain(r);
      const ms = env.now() - t0;
      out.bytesDown += got;
      // Small transfers say more about the latency than about the speed.
      if (bytes >= 1_000_000 || out.downMbps === undefined) out.downMbps = mbps(got, ms);
      progress('download', out.downMbps);
      if (ms > STEP_LIMIT_MS) break;
    }

    progress('upload');
    for (const bytes of plan.up) {
      const t0 = env.now();
      const r = await env.fetch(`${SPEED_HOST}/__up`, { method: 'POST', body: new Uint8Array(bytes), signal, cache: 'no-store' });
      await drain(r);
      const ms = env.now() - t0;
      out.bytesUp += bytes;
      if (bytes >= 1_000_000 || out.upMbps === undefined) out.upMbps = mbps(bytes, ms);
      progress('upload', out.upMbps);
      if (ms > STEP_LIMIT_MS) break;
    }
  } catch (e) {
    out.error = failure(e);
  }
  if (out.network.asn && !signal?.aborted) {
    progress('network');
    out.network.holder = await lookupHolder(env, out.network.asn, signal);
  }
  return out;
}

/** "12.3", "450 k" style: one decimal below 100 Mbit/s, none above, kbit/s below 1. */
export function formatMbps(v: number): { value: string; unit: string } {
  if (v < 1) return { value: String(Math.round(v * 1000)), unit: 'kbit/s' };
  return { value: v < 100 ? v.toFixed(1) : String(Math.round(v)), unit: 'Mbit/s' };
}
