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
const ESC = '\x1b';

/** Fails or stalls chosen writes; every other write behaves like FakeTransport. */
class FlakyTransport extends FakeTransport {
  private calls = 0;
  constructor(private readonly how: (call: number) => 'ok' | 'hang' | 'reject') {
    super();
  }
  override write(data: Uint8Array): Promise<void> {
    const how = this.how(++this.calls);
    if (how === 'hang') return new Promise<void>(() => {});
    if (how === 'reject') return Promise.reject(new Error('device lost'));
    return super.write(data);
  }
}

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

  describe('an answer that arrives after its command timed out', () => {
    const learnEcho = async (): Promise<void> => {
      t.reply('AT+FIRST', ['AT+FIRST\r\r\nOK\r\n']);
      await engine.send('AT+FIRST');
    };
    const timeOut = async (): Promise<void> => {
      const slow = engine.send('AT+SLOW', { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await slow).status).toBe('timeout');
      await vi.advanceTimersByTimeAsync(400);
    };

    test('does not end the next command, and every later command keeps its own answer', async () => {
      await learnEcho();
      await timeOut();
      const next = engine.send('AT+NEXT');
      await flush();
      t.emit('\r\nERROR\r\n');
      await flush();
      t.emit('AT+NEXT\r\r\n+NEXT: mine\r\n\r\nOK\r\n');
      const r = await next;
      expect(r.status).toBe('ok');
      expect(r.lines).toEqual(['+NEXT: mine']);
      t.reply('AT+AFTER', ['AT+AFTER\r\r\n+AFTER: 2\r\n\r\nOK\r\n']);
      expect((await engine.send('AT+AFTER')).lines).toEqual(['+AFTER: 2']);
    });

    test('a modem without echo is answered as before', async () => {
      await timeOut();
      const next = engine.send('AT+NEXT');
      await flush();
      t.emit('\r\n+NEXT: 1\r\n\r\nOK\r\n');
      expect((await next).status).toBe('ok');
    });

    test('a modem whose echo was switched off is not held up', async () => {
      await learnEcho();
      t.reply('ATE0', ['ATE0\r\r\nOK\r\n']);
      await engine.send('ATE0');
      t.reply('AT+QUIET', ['\r\nOK\r\n']);
      await engine.send('AT+QUIET');
      await timeOut();
      const next = engine.send('AT+NEXT');
      await flush();
      t.emit('\r\n+NEXT: 1\r\n\r\nOK\r\n');
      expect((await next).status).toBe('ok');
    });

    test('a modem that stops echoing without saying so costs one timeout at most', async () => {
      await learnEcho();
      await timeOut();
      const next = engine.send('AT+NEXT', { timeoutMs: 1000 });
      await flush();
      t.emit('\r\nOK\r\n');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await next).status).toBe('timeout');
      await vi.advanceTimersByTimeAsync(400);
      const after = engine.send('AT+AFTER');
      await flush();
      t.emit('\r\nOK\r\n');
      expect((await after).status).toBe('ok');
    });
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

  test.each(['BUSY', 'NO ANSWER', 'NO DIALTONE'])('maps %s to error with detail', async (word) => {
    t.reply('ATD1', [`\r\n${word}\r\n`]);
    const r = await engine.send('ATD1');
    expect(r.status).toBe('error');
    expect(r.errorDetail).toBe(word);
  });

  describe('write failures', () => {
    test('a stalled write ends the session at the timeout instead of wedging the engine', async () => {
      const hung = new FlakyTransport(() => 'hang');
      const e = new AtEngine(hung);
      const reasons: string[] = [];
      e.onDisconnect((r) => reasons.push(r));
      const a = e.send('AT+A', { timeoutMs: 1000 });
      const b = e.send('AT+B');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await a).toMatchObject({ status: 'disconnected', errorDetail: 'write stalled' });
      expect((await b).status).toBe('disconnected');
      expect((await e.send('AT+C')).status).toBe('disconnected');
      expect(reasons).toEqual(['write stalled']);
      e.dispose();
    });

    test('a rejected write marks the transport as gone', async () => {
      const bad = new FlakyTransport(() => 'reject');
      const e = new AtEngine(bad);
      const reasons: string[] = [];
      e.onDisconnect((r) => reasons.push(r));
      const r = await e.send('AT+A');
      expect(r).toMatchObject({ status: 'disconnected', errorDetail: 'device lost' });
      expect(reasons).toEqual(['device lost']);
      expect((await e.send('AT+B')).status).toBe('disconnected');
      e.dispose();
    });

    test('a write that throws synchronously is a disconnect, not an exception', async () => {
      const bad = new FakeTransport();
      bad.write = () => {
        throw new Error('sync failure');
      };
      const e = new AtEngine(bad);
      expect(await e.send('AT+A')).toMatchObject({ status: 'disconnected', errorDetail: 'sync failure' });
      e.dispose();
    });

    test('a rejected body write marks the transport as gone', async () => {
      const bad = new FlakyTransport((n) => (n === 2 ? 'reject' : 'ok'));
      bad.reply('AT+CMGS=5', ['\r\n> ']);
      const e = new AtEngine(bad);
      const reasons: string[] = [];
      e.onDisconnect((r) => reasons.push(r));
      const r = await e.send('AT+CMGS=5', { body: 'hello' });
      expect(r).toMatchObject({ status: 'disconnected', errorDetail: 'device lost' });
      expect(reasons).toEqual(['device lost']);
      e.dispose();
    });

    test('a stalled body write ends the session at the timeout', async () => {
      const bad = new FlakyTransport((n) => (n === 2 ? 'hang' : 'ok'));
      bad.reply('AT+CMGS=5', ['\r\n> ']);
      const e = new AtEngine(bad);
      const p = e.send('AT+CMGS=5', { body: 'hello', timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toMatchObject({ status: 'disconnected', errorDetail: 'write stalled' });
      e.dispose();
    });
  });

  describe('quiet period', () => {
    const timeOutFirst = async () => {
      const a = engine.send('AT+A', { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect((await a).status).toBe('timeout');
    };

    test('data restarts the quiet timer', async () => {
      await timeOutFirst();
      void engine.send('AT+B');
      await vi.advanceTimersByTimeAsync(200);
      t.emit('+QIND: x\r\n');
      await vi.advanceTimersByTimeAsync(299);
      expect(t.written).toEqual(['AT+A\r']);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.written).toEqual(['AT+A\r', 'AT+B\r']);
    });

    test('a chatty modem cannot extend the quiet period past 2000 ms', async () => {
      await timeOutFirst();
      void engine.send('AT+B');
      for (let i = 0; i < 9; i++) {
        await vi.advanceTimersByTimeAsync(200);
        t.emit('+QIND: x\r\n');
      }
      await vi.advanceTimersByTimeAsync(199);
      expect(t.written).toEqual(['AT+A\r']);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.written).toEqual(['AT+A\r', 'AT+B\r']);
    });
  });

  test('an endless line is discarded at 64 KiB', async () => {
    const urcs: string[] = [];
    engine.onUrc((l) => urcs.push(l));
    t.emit('x'.repeat(64 * 1024 + 1));
    t.emit('+CREG: 1\r\n');
    expect(urcs).toEqual(['+CREG: 1']);
  });

  describe('cancelling an open > prompt', () => {
    const terminal = { timeoutMs: 1000, cancelPromptOnTimeout: true };

    test('a terminal command left at the prompt is cancelled on timeout', async () => {
      t.reply('AT+CMGS="1"', ['\r\n> ']);
      const r = await (async () => {
        const p = engine.send('AT+CMGS="1"', terminal);
        await vi.advanceTimersByTimeAsync(1000);
        return p;
      })();
      expect(r.status).toBe('timeout');
      expect(t.written).toEqual(['AT+CMGS="1"\r', ESC]);
    });

    test('nothing is cancelled unless the caller asked for it', async () => {
      t.reply('AT+CMGS="1"', ['\r\n> ']);
      const p = engine.send('AT+CMGS="1"', { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(5000);
      expect((await p).status).toBe('timeout');
      expect(t.written).toEqual(['AT+CMGS="1"\r']);
    });

    test('no cancel without a prompt', async () => {
      const p = engine.send('AT+SLOW', terminal);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await p).status).toBe('timeout');
      expect(t.written).toEqual(['AT+SLOW\r']);
    });

    test('no cancel once the body went out', async () => {
      t.reply('AT+CMGS=5', ['\r\n> ']);
      const p = engine.send('AT+CMGS=5', { ...terminal, body: 'hello' });
      await vi.advanceTimersByTimeAsync(5000);
      expect((await p).status).toBe('timeout');
      expect(t.written).toEqual(['AT+CMGS=5\r', 'hello\x1a']);
    });

    test('a response that completes normally is not cancelled', async () => {
      t.reply('AT+X', ['\r\n> \r\nOK\r\n']);
      expect((await engine.send('AT+X', terminal)).status).toBe('ok');
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.written).toEqual(['AT+X\r']);
    });
  });
});
