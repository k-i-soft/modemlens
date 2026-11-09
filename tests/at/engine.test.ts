import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AtEngine } from '../../src/at/engine';
import { FakeTransport } from '../helpers/fakeTransport';

let t: FakeTransport;
let engine: AtEngine;

beforeEach(() => {
  vi.useFakeTimers();
  t = new FakeTransport();
  engine = new AtEngine(t);
});

afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('AtEngine', () => {
  test('resolves ok across chunked input', async () => {
    t.reply('AT+CSQ', ['+CS', 'Q: 20,99\r\n\r\nO', 'K\r\n']);
    const r = await engine.send('AT+CSQ');
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['+CSQ: 20,99']);
    expect(t.written).toEqual(['AT+CSQ\r']);
  });

  test('drops command echo', async () => {
    t.reply('AT+CSQ', ['AT+CSQ\r\r\n+CSQ: 1,1\r\n\r\nOK\r\n']);
    const r = await engine.send('AT+CSQ');
    expect(r.lines).toEqual(['+CSQ: 1,1']);
  });

  test('maps +CME ERROR', async () => {
    t.reply('AT+CPIN?', ['\r\n+CME ERROR: 10\r\n']);
    const r = await engine.send('AT+CPIN?');
    expect(r.status).toBe('cme_error');
    expect(r.errorDetail).toBe('10');
  });

  test('maps +CMS ERROR', async () => {
    t.reply('AT+CMGL', ['\r\n+CMS ERROR: 500\r\n']);
    const r = await engine.send('AT+CMGL');
    expect(r.status).toBe('cms_error');
    expect(r.errorDetail).toBe('500');
  });

  test('maps plain ERROR', async () => {
    t.reply('AT+FOO', ['\r\nERROR\r\n']);
    const r = await engine.send('AT+FOO');
    expect(r.status).toBe('error');
  });

  test('maps NO CARRIER', async () => {
    t.reply('ATD1', ['\r\nNO CARRIER\r\n']);
    const r = await engine.send('ATD1');
    expect(r.status).toBe('no_carrier');
  });

  test('serialises concurrent sends', async () => {
    const a = engine.send('AT+A');
    const b = engine.send('AT+B');
    await flush();
    expect(t.written).toEqual(['AT+A\r']);
    t.emit('\r\nOK\r\n');
    const ra = await a;
    expect(ra.status).toBe('ok');
    await flush();
    expect(t.written).toEqual(['AT+A\r', 'AT+B\r']);
    t.emit('\r\nOK\r\n');
    expect((await b).status).toBe('ok');
  });

  test('routes URC when idle', async () => {
    const urcs: string[] = [];
    engine.onUrc((l) => urcs.push(l));
    t.emit('\r\n+CREG: 1\r\n');
    expect(urcs).toEqual(['+CREG: 1']);
  });

  test('separates URC during command', async () => {
    const urcs: string[] = [];
    engine.onUrc((l) => urcs.push(l));
    t.reply('AT+CSQ', ['\r\n+CREG: 1\r\n+CSQ: 20,99\r\n\r\nOK\r\n']);
    const r = await engine.send('AT+CSQ');
    expect(r.lines).toEqual(['+CSQ: 20,99']);
    expect(urcs).toEqual(['+CREG: 1']);
  });

  test('keeps own prefix during command', async () => {
    const urcs: string[] = [];
    engine.onUrc((l) => urcs.push(l));
    t.reply('AT+CREG?', ['\r\n+CREG: 0,1\r\n\r\nOK\r\n']);
    const r = await engine.send('AT+CREG?');
    expect(r.lines).toEqual(['+CREG: 0,1']);
    expect(urcs).toEqual([]);
  });

  test('times out', async () => {
    const p = engine.send('AT+SLOW', { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.status).toBe('timeout');
    expect(r.durationMs).toBe(1000);
  });

  test('uses 5000 ms default timeout', async () => {
    const p = engine.send('AT+SLOW');
    await vi.advanceTimersByTimeAsync(4999);
    let done = false;
    void p.then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).durationMs).toBe(5000);
  });

  test('late reply after timeout is not attributed to next command', async () => {
    const a = engine.send('AT+A', { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await a).status).toBe('timeout');

    t.emit('\r\n+A: late\r\nOK\r\n');
    t.reply('AT+B', ['\r\n+B: mine\r\n\r\nOK\r\n']);
    const b = engine.send('AT+B');
    await vi.advanceTimersByTimeAsync(1000);
    const r = await b;
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['+B: mine']);
  });

  test('non-text bytes do not throw', async () => {
    const p = engine.send('AT+X');
    await flush();
    t.emitBytes([0xff, 0x00, 0x41, 0x0d, 0x0a, 0x4f, 0x4b, 0x0d, 0x0a]);
    const r = await p;
    expect(r.status).toBe('ok');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain('A');
  });

  test('disconnect resolves in-flight', async () => {
    const reasons: string[] = [];
    engine.onDisconnect((r) => reasons.push(r));
    const p = engine.send('AT+X');
    const q = engine.send('AT+Y');
    await flush();
    t.disconnect('unplugged');
    expect((await p).status).toBe('disconnected');
    expect((await q).status).toBe('disconnected');
    expect(reasons).toEqual(['unplugged']);
    expect((await engine.send('AT+Z')).status).toBe('disconnected');
  });

  test('prompted body', async () => {
    t.reply('AT+CMGS=5', ['\r\n> ']);
    t.reply(/^hello\x1a$/, ['\r\n+CMGS: 1\r\n\r\nOK\r\n']);
    const r = await engine.send('AT+CMGS=5', { body: 'hello' });
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['+CMGS: 1']);
    expect(t.written).toEqual(['AT+CMGS=5\r', 'hello\x1a']);
  });

  test('never writes on its own', async () => {
    t.emit('\r\nRDY\r\n');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.written).toEqual([]);
  });
});
