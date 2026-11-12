import { describe, expect, test } from 'vitest';
import { formatMbps, matchesOperator, planMegabytes, runSpeedTest, SPEED_HOST } from '../../src/tools/speed';
import type { SpeedEnv } from '../../src/tools/speed';
import { MODEM_SPEED_URL, parseFree, runModemSpeed } from '../../src/tools/modemSpeed';
import { fakeIo } from './fakeIo';

/** A network with a fixed speed and round trip, on a clock that only moves when it says so. */
function network(downMbps: number, upMbps: number, rttMs: number, holder = 'SWISSCOM Swisscom (Schweiz) AG') {
  let t = 0;
  const calls: string[] = [];
  const env: SpeedEnv = {
    now: () => t,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}${url.search}`);
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (url.host === 'stat.ripe.net') return new Response(JSON.stringify({ data: { holder } }));
      if (url.pathname === '/__up') {
        t += rttMs + ((init!.body as Uint8Array).byteLength * 8) / (upMbps * 1000);
        return new Response('');
      }
      const bytes = Number(url.searchParams.get('bytes'));
      t += rttMs + (bytes * 8) / (downMbps * 1000);
      return new Response(new Uint8Array(bytes), { headers: { 'cf-meta-asn': '3303', 'cf-meta-country': 'CH' } });
    }) as typeof fetch,
  };
  return { env, calls };
}

describe('browser speed test', () => {
  test('latency, download, upload and the network, in that order', async () => {
    const { env, calls } = network(40, 10, 30);
    const r = await runSpeedTest(env, 'light');
    expect(r.latencyMs).toBe(30);
    expect(r.jitterMs).toBe(0);
    // The largest transfer counts, so the round trip weighs little.
    expect(r.downMbps).toBeGreaterThan(38);
    expect(r.downMbps).toBeLessThan(40);
    expect(r.upMbps).toBeGreaterThan(9);
    expect(r.network).toEqual({ asn: '3303', country: 'CH', holder: 'SWISSCOM Swisscom (Schweiz) AG' });
    expect(r.bytesDown).toBe(6_100_000);
    expect(r.bytesUp).toBe(1_100_000);
    expect(calls.at(-1)).toBe('GET stat.ripe.net/data/as-overview/data.json?resource=AS3303');
    expect(calls.filter((c) => c.startsWith('GET speed.cloudflare.com/__down?bytes=0'))).toHaveLength(5);
    expect(calls.every((c) => c.includes('speed.cloudflare.com') || c.includes('stat.ripe.net'))).toBe(true);
  });

  test('a slow network ends a direction early instead of running for minutes', async () => {
    const { env } = network(0.5, 0.2, 200);
    const r = await runSpeedTest(env, 'full');
    // 1 MB at 0.5 Mbit/s takes 16 s: the 10 and 25 MB steps never run.
    expect(r.bytesDown).toBe(1_100_000);
    expect(r.downMbps).toBeCloseTo(0.49, 1);
  });

  test('a blocked or offline server keeps what was measured and says so', async () => {
    const env: SpeedEnv = { now: () => 0, fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch };
    const r = await runSpeedTest(env, 'light');
    expect(r.error).toContain('could not be reached');
    expect(r.downMbps).toBeUndefined();
  });

  test('a stop is a stop', async () => {
    const { env } = network(40, 10, 30);
    const c = new AbortController();
    c.abort();
    expect((await runSpeedTest(env, 'light', undefined, c.signal)).error).toBe('Stopped.');
  });

  test.each([
    ['SWISSCOM Swisscom (Schweiz) AG', 'Swisscom', true],
    ['SUNRISE Sunrise GmbH', 'Sunrise', true],
    ['SALT-AS Salt Mobile SA', 'Salt', true],
    ['INIT7 Init7 (Switzerland) Ltd.', 'Swisscom', false],
    ['DEMO-MOBILE Demo Mobile Ltd', 'Demo Mobile', true],
    ['T-MOBILE-AS T-Mobile USA', 'Mobile', undefined],
    [undefined, 'Swisscom', undefined],
  ] as const)('%s vs %s', (holder, op, expected) => {
    expect(matchesOperator(holder, op)).toBe(expected);
  });

  test('numbers', () => {
    expect(formatMbps(0.42)).toEqual({ value: '420', unit: 'kbit/s' });
    expect(formatMbps(23.456)).toEqual({ value: '23.5', unit: 'Mbit/s' });
    expect(formatMbps(187.6)).toEqual({ value: '188', unit: 'Mbit/s' });
    expect(planMegabytes('light')).toBe(8);
    expect(planMegabytes('full')).toBe(43);
    expect(SPEED_HOST).toBe('https://speed.cloudflare.com');
  });
});

describe('speed test inside the modem', () => {
  const clock = () => {
    let t = 0;
    return { now: () => (t += 1000) };
  };

  test('Quectel: URL after CONNECT, download into a file, the file is deleted', async () => {
    const url = `${MODEM_SPEED_URL}/__down?bytes=1000000`;
    const { io, sent } = fakeIo({
      'AT+QFLDS="UFS"': { lines: ['+QFLDS: 6291456,12582912'] },
      'AT+QHTTPCFG="contextid",1': {},
      'AT+QHTTPCFG="responseheader",0': {},
      [`AT+QHTTPURL=${url.length},30`]: {},
      'AT+QHTTPGET=60': { after: ['+QHTTPGET: 0,200,1000000'] },
      'AT+QHTTPREADFILE="UFS:mlspeed.bin",80': { after: ['+QHTTPREADFILE: 0'] },
      'AT+QFDEL="UFS:mlspeed.bin"': {},
    });
    const c = clock();
    const r = await runModemSpeed(io, 'quectel', 'light', c.now);
    expect(r.tone).toBe('ok');
    expect(r).toMatchObject({ bytes: 1_000_000, ms: 1000, downMbps: 8 });
    const urlSend = sent.find((s) => s.command.startsWith('AT+QHTTPURL='))!;
    expect(urlSend.opts).toMatchObject({ body: url, bodyAfterConnect: true });
    expect(sent.at(-1)!.command).toBe('AT+QFDEL="UFS:mlspeed.bin"');
  });

  test('Quectel: a small free space makes the download smaller, too little stops it', async () => {
    const base = { 'AT+QHTTPCFG="contextid",1': {}, 'AT+QHTTPCFG="responseheader",0': {} };
    const small = fakeIo({ ...base, 'AT+QFLDS="UFS"': { lines: ['+QFLDS: 500000,12582912'] } });
    await runModemSpeed(small.io, 'quectel', 'full');
    expect(small.commands().find((c) => c.startsWith('AT+QHTTPURL='))).toBe(`AT+QHTTPURL=${`${MODEM_SPEED_URL}/__down?bytes=300000`.length},30`);
    const none = fakeIo({ ...base, 'AT+QFLDS="UFS"': { lines: ['+QFLDS: 100000,12582912'] } });
    expect((await runModemSpeed(none.io, 'quectel', 'light')).message).toContain('too little free storage');
    expect(parseFree({ command: 'x', status: 'ok', lines: ['+QFLDS: 42,99'], durationMs: 1 })).toBe(42);
  });

  test('Quectel: an HTTP error is named and no file is left behind', async () => {
    const url = `${MODEM_SPEED_URL}/__down?bytes=1000000`;
    const { io, commands } = fakeIo({
      'AT+QFLDS="UFS"': { lines: ['+QFLDS: 6291456,12582912'] },
      'AT+QHTTPCFG="contextid",1': {},
      'AT+QHTTPCFG="responseheader",0': {},
      [`AT+QHTTPURL=${url.length},30`]: {},
      'AT+QHTTPGET=60': { after: ['+QHTTPGET: 717'] },
    });
    const r = await runModemSpeed(io, 'quectel', 'light');
    expect(r.message).toContain('could not reach the internet');
    expect(commands()).not.toContain('AT+QFDEL="UFS:mlspeed.bin"');
  });

  test('SIMCom: needs Modem data, then connects, requests and disconnects', async () => {
    const off = fakeIo({ 'AT+CNACT?': { lines: ['+CNACT: 0,"0.0.0.0"'] } });
    expect((await runModemSpeed(off.io, 'simcom', 'light')).message).toContain('Modem data');
    expect(off.commands()).toEqual(['AT+CNACT?']);

    const { io, commands } = fakeIo({
      'AT+CNACT?': { lines: ['+CNACT: 1,"10.0.0.2"'] },
      'AT+SHCONF="URL","http://speed.cloudflare.com"': {},
      'AT+SHCONF="BODYLEN",1024': {},
      'AT+SHCONF="HEADERLEN",350': {},
      'AT+SHCONN': {},
      'AT+SHREQ="/__down?bytes=100000",1': { after: ['+SHREQ: "GET",200,100000'] },
      'AT+SHDISC': {},
    });
    const c = clock();
    const r = await runModemSpeed(io, 'simcom', 'light', c.now);
    expect(r).toMatchObject({ tone: 'ok', bytes: 100_000, downMbps: 0.8 });
    expect(commands().at(-1)).toBe('AT+SHDISC');
  });
});
