import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AtEngine } from '../../src/at/engine';
import { CLAC_COMMAND, STANDARD_CATALOG } from '../../src/catalog/standard';
import { PROFILES } from '../../src/profiles';
import { Scanner } from '../../src/scan/scanner';
import { FakeTransport } from '../helpers/fakeTransport';

let t: FakeTransport;
let engine: AtEngine;

beforeEach(() => {
  t = new FakeTransport();
  engine = new AtEngine(t, { defaultTimeoutMs: 30, quietAfterTimeoutMs: 5 });
});
afterEach(() => engine.dispose());

const OK = ['\r\nOK\r\n'];
const ERR = ['\r\nERROR\r\n'];
const sent = () => t.written.map((w) => w.replace(/\r$/, ''));
/** Catch-all: everything not scripted answers ERROR. Call last. */
const defaultError = () => t.reply(/.*/, ERR);
const clac = (...names: string[]) =>
  t.reply(CLAC_COMMAND, [`\r\n${names.map((n) => `AT${n}`).join('\r\n')}\r\n\r\nOK\r\n`]);

describe('Scanner', () => {
  test('auto sends only catalogued commands', async () => {
    t.reply('AT+CPIN?', ['\r\n+CPIN: READY\r\n\r\nOK\r\n']);
    t.reply('ATI', ['\r\nQuectel\r\nEC200A\r\n\r\nOK\r\n']);
    clac('+QXYZ');
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    const profile = s.report.profile!;
    const allowed = new Set([
      ...STANDARD_CATALOG.filter((e) => e.phase === 'auto').map((e) => e.command),
      ...profile.commands.map((e) => e.command),
      CLAC_COMMAND,
    ]);
    expect(sent().length).toBeGreaterThan(10);
    for (const w of sent()) expect(allowed.has(w), w).toBe(true);
    expect(sent()).not.toContain('AT+COPS=?');
  });

  test('auto sends no state-changing command', async () => {
    t.reply('AT+CPIN?', ['\r\n+CPIN: READY\r\n\r\nOK\r\n']);
    t.reply('ATI', ['\r\nEC200A\r\n\r\nOK\r\n']);
    defaultError();
    await new Scanner(engine, {}).runAuto();
    for (const w of sent()) expect(w).not.toMatch(/ATE\d|CMEE=|CPIN=|CFUN=|ATZ|AT&F/);
  });

  test('auto does not run discovery', async () => {
    clac('+QXYZ');
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    expect(s.report.commandList).toEqual(['+QXYZ']);
    expect(sent().some((w) => w.includes('QXYZ'))).toBe(false);
  });

  test('deep sends only ?/=? of allowed extended', async () => {
    clac('+QXYZ', 'Z', '+QPOWD', '+CREG');
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    const before = t.written.length;
    await s.runDeep();
    expect(sent().slice(before)).toEqual(['AT+QXYZ=?', 'AT+QXYZ?']);
    const deep = s.report.items.filter((i) => i.category === 'discovery');
    expect(deep.map((i) => i.id)).toEqual(['deep:+QXYZ=?', 'deep:+QXYZ?']);
  });

  test('deep requires CLAC list', async () => {
    defaultError();
    const s = new Scanner(engine, {});
    await s.runDeep();
    expect(t.written).toEqual([]);
  });

  test('profile detected from identity', async () => {
    t.reply('ATI', ['\r\nQuectel\r\nEC200A\r\nRevision: X\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    expect(s.report.profile?.id).toBe('quectel-ec200a');
    expect(sent()).toContain('AT+QSPN'.replace('QSPN', 'QNWINFO'));
  });

  test('profile from usb id is kept', async () => {
    t.reply('ATI', ['\r\nEC25\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, { usb: '2c7c:6005' });
    await s.runAuto();
    expect(s.report.profile?.id).toBe('quectel-ec200a');
  });

  test('profile deny respected in deep and auto', async () => {
    const base = PROFILES.find((p) => p.id === 'quectel-ec200a')!;
    const profile = {
      ...base,
      commands: [...base.commands, { id: 'x', command: 'AT+QFOO?', category: 'other' as const, phase: 'auto' as const }],
      denyCommands: [...base.denyCommands, '+QFOO', '+QBAR'],
    };
    clac('+QBAR', '+QBAZ');
    defaultError();
    const s = new Scanner(engine, { profile });
    await s.runAuto();
    expect(sent()).not.toContain('AT+QFOO?');
    await s.runDeep();
    expect(sent().some((w) => w.includes('QBAR'))).toBe(false);
    expect(sent()).toContain('AT+QBAZ=?');
  });

  test('abort stops and keeps partial', async () => {
    defaultError();
    const ac = new AbortController();
    const s = new Scanner(engine, {});
    let n = 0;
    s.onItem(() => { if (++n === 3) ac.abort(); });
    await s.runAuto(ac.signal);
    expect(s.report.items).toHaveLength(3);
    expect(s.report.interrupted).toBe('aborted');
    expect(t.written).toHaveLength(3);
  });

  test('disconnect keeps partial', async () => {
    defaultError();
    const s = new Scanner(engine, {});
    s.onItem(() => { if (s.report.items.length === 2) t.disconnect('usb unplugged'); });
    await s.runAuto();
    expect(s.report.items).toHaveLength(2);
    expect(s.report.interrupted).toBe('usb unplugged');
  });

  test('sim pin skips needsSim items and sends no pin', async () => {
    t.reply('AT+CPIN?', ['\r\n+CPIN: SIM PIN\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    const cimi = s.report.items.find((i) => i.command === 'AT+CIMI')!;
    expect(cimi.state).toBe('skipped');
    expect(sent()).not.toContain('AT+CIMI');
    expect(sent().some((w) => /CPIN=/.test(w))).toBe(false);
  });

  test('cpin runs before every needsSim row', async () => {
    t.reply('AT+CPIN?', ['\r\n+CPIN: READY\r\n\r\nOK\r\n']);
    t.reply('AT+CIMI', ['\r\n123456789012345\r\n\r\nOK\r\n']);
    defaultError();
    await new Scanner(engine, {}).runAuto();
    expect(sent().indexOf('AT+CPIN?')).toBeLessThan(sent().indexOf('AT+CIMI'));
    expect(sent().indexOf('AT+CIMI')).toBeGreaterThan(-1);
  });

  test('no sim continues', async () => {
    t.reply('AT+CPIN?', ['\r\n+CME ERROR: 10\r\n']);
    t.reply('AT+CSQ', ['\r\n+CSQ: 20,99\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    expect(s.report.interrupted).toBeUndefined();
    expect(s.report.items.find((i) => i.command === 'AT+CIMI')!.state).toBe('skipped');
    expect(s.report.items.find((i) => i.command === 'AT+CSQ')!.state).toBe('done');
    expect(sent()).toContain(CLAC_COMMAND);
  });

  test('error marks unsupported, timeout marks failed, scan goes on', async () => {
    t.reply('AT+CESQ', []);
    t.reply('AT+CSQ', ['\r\n+CSQ: 20,99\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    const st = (c: string) => s.report.items.find((i) => i.command === c)!.state;
    expect(st('ATI')).toBe('unsupported');
    expect(st('AT+CSQ')).toBe('done');
    expect(st('AT+CESQ')).toBe('failed');
    expect(sent()).toContain(CLAC_COMMAND);
  });

  test('manual runs only requested entry', async () => {
    t.reply('AT+COPS=?', ['\r\n+COPS: (1,"X","X","22801")\r\n\r\nOK\r\n']);
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    expect(sent()).not.toContain('AT+COPS=?');
    const entry = STANDARD_CATALOG.find((e) => e.phase === 'manual')!;
    const item = await s.runManual(entry);
    expect(item.state).toBe('done');
    expect(sent().filter((w) => w === 'AT+COPS=?')).toHaveLength(1);
  });

  describe('silent port', () => {
    const NO_RESPONSE = 'no response, wrong port?';

    test('stops after two consecutive identity timeouts', async () => {
      const s = new Scanner(engine, {});
      await s.runAuto();
      expect(s.report.interrupted).toBe(NO_RESPONSE);
      expect(s.report.items.map((i) => i.state)).toEqual(['failed', 'failed']);
      expect(sent()).toEqual(['ATI', 'AT+GMI']);
    });

    test('a single identity timeout does not stop the scan', async () => {
      // Only ATI stays silent, so no two timeouts are consecutive.
      t.reply('ATI', []);
      defaultError();
      const s = new Scanner(engine, {});
      await s.runAuto();
      expect(s.report.interrupted).toBeUndefined();
      expect(sent()).toContain(CLAC_COMMAND);
    });

    test('an answer resets the count', async () => {
      t.reply('ATI', []);
      t.reply('AT+GMM', []);
      t.reply('AT+CGMI', []);
      defaultError();
      const s = new Scanner(engine, {});
      await s.runAuto();
      expect(s.report.interrupted).toBeUndefined();
      expect(sent()).toContain(CLAC_COMMAND);
    });

    test('timeouts after the identity phase do not stop the scan', async () => {
      t.reply('AT+CSQ', []);
      t.reply('AT+CESQ', []);
      defaultError();
      const s = new Scanner(engine, {});
      await s.runAuto();
      expect(s.report.interrupted).toBeUndefined();
      expect(sent()).toContain(CLAC_COMMAND);
    });
  });

  test('a stalled write ends the scan, even without an abort', async () => {
    const hung = new FakeTransport();
    const stalled: string[] = [];
    hung.write = (d) => {
      stalled.push(String.fromCharCode(...d));
      return new Promise<void>(() => {});
    };
    const e = new AtEngine(hung, { defaultTimeoutMs: 10, quietAfterTimeoutMs: 1 });
    const s = new Scanner(e, {});
    await s.runAuto();
    expect(s.report.interrupted).toBe('write stalled');
    expect(stalled).toEqual(['ATI\r']);
    e.dispose();
  });

  test('a modem answering > everywhere never triggers an engine write', async () => {
    const e = new AtEngine(t, { defaultTimeoutMs: 2, quietAfterTimeoutMs: 1 });
    const send = vi.spyOn(e, 'send');
    t.reply('ATI', ['\r\nEC25\r\n\r\nOK\r\n']);
    t.reply('AT+GMI', ['\r\nOK\r\n']);
    t.reply('AT+GMM', ['\r\nOK\r\n']);
    t.reply('AT+GMR', ['\r\nOK\r\n']);
    t.reply('AT+CGMI', ['\r\nOK\r\n']);
    t.reply('AT+CGMM', ['\r\nOK\r\n']);
    t.reply('AT+CGMR', ['\r\nOK\r\n']);
    t.reply('AT+CGSN', ['\r\nOK\r\n']);
    t.reply('AT+GSN', ['\r\nOK\r\n']);
    clac('+QXYZ');
    t.reply(/.*/, ['\r\n> ']);
    const s = new Scanner(e, {});
    await s.runAuto();
    await s.runDeep();
    expect(sent()).toContain('AT+QXYZ=?');
    expect(t.written.every((w) => w.endsWith('\r') && !w.includes('\x1b'))).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.written.some((w) => w.includes('\x1b'))).toBe(false);
    await s.runManual({ id: 'm', command: 'AT+QXYZ?', category: 'other', phase: 'manual', timeoutMs: 2 });
    expect(t.written.some((w) => w.includes('\x1b'))).toBe(false);
    for (const call of send.mock.calls) expect(call[1]).not.toHaveProperty('cancelPromptOnTimeout');
    e.dispose();
  });

  test('a new deep scan clears the mark of a stopped one', async () => {
    clac('+QXYZ');
    defaultError();
    const s = new Scanner(engine, {});
    await s.runAuto();
    const ac = new AbortController();
    ac.abort();
    await s.runDeep(ac.signal);
    expect(s.report.interrupted).toBe('aborted');
    await s.runDeep();
    expect(s.report.interrupted).toBeUndefined();
  });
});
