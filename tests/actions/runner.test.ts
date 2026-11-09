import { afterEach, describe, expect, test, vi } from 'vitest';
import { AtEngine } from '../../src/at/engine';
import type { AtResponse, AtStatus } from '../../src/at/engine';
import { ACTIONS, SIM_READ, actionById, apnValue } from '../../src/actions/ec200a';
import { readCurrent, runAction } from '../../src/actions/runner';
import type { ActionSend } from '../../src/actions/types';
import { FakeTransport } from '../helpers/fakeTransport';

type Script = Record<string, Partial<AtResponse> | Array<Partial<AtResponse>>>;

/** Answers from a script. Repeated reads of one command go through a list, ending on its last entry. */
function scripted(script: Script): { send: ActionSend; sent: string[] } {
  const sent: string[] = [];
  const seen = new Map<string, number>();
  const send: ActionSend = async (command) => {
    sent.push(command);
    const n = seen.get(command) ?? 0;
    seen.set(command, n + 1);
    const entry = script[command];
    const r = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)] : entry;
    return { command, status: 'error' as AtStatus, lines: [], durationMs: 1, ...r };
  };
  return { send, sent };
}

const ok = (...lines: string[]): Partial<AtResponse> => ({ status: 'ok', lines });
const action = (id: string) => actionById(id)!;
const noWait = () => Promise.resolve();

describe('runAction', () => {
  test('a matching read-back is the only thing that confirms', async () => {
    const { send, sent } = scripted({ 'AT+CFUN=4': ok(), 'AT+CFUN?': ok('+CFUN: 4') });
    const o = await runAction(send, action('radio'), '4');
    expect(o.kind).toBe('confirmed');
    expect(o.message).toContain('Off');
    expect(o.answer).toEqual(['[ok]']);
    expect(sent).toEqual(['AT+CFUN=4', 'AT+CFUN?']);
  });

  test('a read-back mismatch is a failure', async () => {
    const { send } = scripted({ 'AT+QCFG="nat",1': ok(), 'AT+QCFG="nat"': ok('+QCFG: "nat",0') });
    const o = await runAction(send, action('nat'), '1');
    expect(o.kind).toBe('mismatch');
    expect(o.message).toContain('not confirmed');
    expect(o.message).toContain('Modem does NAT');
  });

  test('an unreadable read-back is not a success', async () => {
    const { send } = scripted({ 'AT+QCFG="nat",1': ok(), 'AT+QCFG="nat"': ok('garbage') });
    const o = await runAction(send, action('nat'), '1');
    expect(o.kind).toBe('mismatch');
    expect(o.message).toContain('could not be read back');
  });

  test('a read-back that times out is not a success', async () => {
    const { send } = scripted({ 'AT+CFUN=1': ok(), 'AT+CFUN?': { status: 'timeout' } });
    expect((await runAction(send, action('radio'), '1')).kind).toBe('mismatch');
  });

  test('a timeout on the write is not reported as success, and nothing is read back into a claim', async () => {
    const { send, sent } = scripted({ 'AT+CFUN=4': { status: 'timeout' }, 'AT+CFUN?': ok('+CFUN: 4') });
    const o = await runAction(send, action('radio'), '4');
    expect(o.kind).toBe('no-answer');
    expect(o.message).toContain('may or may not');
    expect(sent).toEqual(['AT+CFUN=4']);
  });

  test.each([
    ['error', undefined],
    ['cme_error', '3'],
    ['cms_error', '500'],
    ['no_carrier', undefined],
  ] as const)('%s is a refusal, with the modem\'s word for it', async (status, errorDetail) => {
    const { send, sent } = scripted({ 'AT+CFUN=4': { status, errorDetail } });
    const o = await runAction(send, action('radio'), '4');
    expect(o.kind).toBe('refused');
    if (errorDetail) expect(o.message).toContain(errorDetail);
    expect(sent).toEqual(['AT+CFUN=4']);
  });

  test('the literal answer is kept', async () => {
    const { send } = scripted({
      'AT+CFUN=4': { status: 'cme_error', errorDetail: 'operation not allowed', lines: ['+X: 1'] },
    });
    expect((await runAction(send, action('radio'), '4')).answer).toEqual(['+X: 1', '[cme_error operation not allowed]']);
  });

  test('an invalid value sends nothing', async () => {
    const { send, sent } = scripted({});
    const o = await runAction(send, action('apn'), apnValue('IP', 'a";+CFUN=0;"'));
    expect(o.kind).toBe('invalid');
    expect(o.command).toBeNull();
    expect(sent).toEqual([]);
  });

  test('the APN is confirmed by context 1, not by another context', async () => {
    const { send } = scripted({
      'AT+CGDCONT=1,"IP","new.apn"': ok(),
      'AT+CGDCONT?': ok('+CGDCONT: 1,"IP","old.apn"', '+CGDCONT: 2,"IP","new.apn"'),
    });
    expect((await runAction(send, action('apn'), apnValue('IP', 'new.apn'))).kind).toBe('mismatch');
  });

  test('a disconnect during an ordinary write is a lost connection, and is not a success', async () => {
    const { send } = scripted({ 'AT+CFUN=4': { status: 'disconnected' } });
    const o = await runAction(send, action('radio'), '4');
    expect(o.kind).toBe('lost');
    expect(o.message).toContain('not confirmed');
  });

  test('a disconnect during the read-back of an ordinary write is lost too', async () => {
    const { send } = scripted({ 'AT+CFUN=4': ok(), 'AT+CFUN?': { status: 'disconnected' } });
    expect((await runAction(send, action('radio'), '4')).kind).toBe('lost');
  });

  test.each(['usb-mode', 'nat'])('%s: the modem going away during the read-back is not a restart and not a confirmation', async (id) => {
    const a = action(id);
    const value = a.choices[0].value;
    const { send } = scripted({ [a.choices[0].command]: ok(), [a.read!.command]: { status: 'disconnected' } });
    const o = await runAction(send, a, value);
    expect(o.kind).toBe('lost');
    expect(o.message).toContain('not confirmed');
    expect(o.message).not.toContain('restarting');
  });

  test.each(['usb-mode', 'nat'])('%s: a write cut off by a disconnect is not a restart', async (id) => {
    const a = action(id);
    const { send } = scripted({ [a.choices[0].command]: { status: 'disconnected' } });
    const o = await runAction(send, a, a.choices[0].value);
    expect(o.kind).toBe('lost');
    expect(o.message).toContain('not confirmed');
  });

  test('a restart that is accepted reports restarting and reads nothing', async () => {
    const { send, sent } = scripted({ 'AT+CFUN=1,1': ok() });
    const o = await runAction(send, action('restart'), 'restart');
    expect(o.kind).toBe('restarting');
    expect(sent).toEqual(['AT+CFUN=1,1']);
  });

  test('a restart cut off mid-command is still a restart', async () => {
    const { send } = scripted({ 'AT+CFUN=1,1': { status: 'disconnected' } });
    expect((await runAction(send, action('restart'), 'restart')).kind).toBe('restarting');
  });

  test('a refused restart is a refusal, not a restart', async () => {
    const { send } = scripted({ 'AT+CFUN=1,1': { status: 'error' } });
    expect((await runAction(send, action('restart'), 'restart')).kind).toBe('refused');
  });

  test('a restart without an answer is not claimed', async () => {
    const { send } = scripted({ 'AT+CFUN=1,1': { status: 'timeout' } });
    expect((await runAction(send, action('restart'), 'restart')).kind).toBe('no-answer');
  });

  test('the data connection gets time to come up', async () => {
    const wait = vi.fn(noWait);
    const { send, sent } = scripted({
      'AT+QNETDEVCTL=1,1,1': ok('+QNETDEVSTATUS: 1'),
      'AT+QNETDEVCTL?': [ok('+QNETDEVCTL: 1,1,1,0'), ok('+QNETDEVCTL: 1,1,1,0'), ok('+QNETDEVCTL: 1,1,1,1')],
    });
    expect((await runAction(send, action('data'), 'on', wait)).kind).toBe('confirmed');
    expect(sent.filter((c) => c === 'AT+QNETDEVCTL?')).toHaveLength(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  test('a data connection that never comes up is a failure, after a bounded wait', async () => {
    const wait = vi.fn(noWait);
    const { send, sent } = scripted({ 'AT+QNETDEVCTL=1,1,1': ok(), 'AT+QNETDEVCTL?': ok('+QNETDEVCTL: 1,1,1,0') });
    expect((await runAction(send, action('data'), 'on', wait)).kind).toBe('mismatch');
    expect(sent.filter((c) => c === 'AT+QNETDEVCTL?')).toHaveLength(action('data').settle!.attempts);
  });

  test('settings without settle are read back once', async () => {
    const { send, sent } = scripted({ 'AT+CFUN=4': ok(), 'AT+CFUN?': ok('+CFUN: 1') });
    await runAction(send, action('radio'), '4');
    expect(sent.filter((c) => c === 'AT+CFUN?')).toHaveLength(1);
  });

  test('the slow writes have the long timeout', async () => {
    const timeouts: Array<number | undefined> = [];
    const send: ActionSend = async (command, opts) => {
      timeouts.push(opts?.timeoutMs);
      return { command, status: 'ok', lines: [], durationMs: 1 };
    };
    await runAction(send, action('radio'), '4');
    expect(timeouts[0]).toBe(15000);
  });
});

describe('runAction through the real engine', () => {
  let engine: AtEngine | undefined;
  afterEach(() => engine?.dispose());

  test('silence from the modem is not success', async () => {
    const t = new FakeTransport();
    engine = new AtEngine(t, { defaultTimeoutMs: 20, quietAfterTimeoutMs: 1 });
    const o = await runAction((c, opts) => engine!.send(c, opts ?? {}), action('nat'), '1');
    expect(o.kind).toBe('no-answer');
    expect(t.written).toEqual(['AT+QCFG="nat",1\r']);
  });

  test('a cable pulled during the write ends the action at once', async () => {
    const t = new FakeTransport();
    engine = new AtEngine(t, { defaultTimeoutMs: 1000 });
    const running = runAction((c, opts) => engine!.send(c, opts ?? {}), action('radio'), '4');
    t.disconnect('pulled');
    const o = await running;
    expect(o.kind).toBe('lost');
    expect(o.answer).toEqual(['[disconnected pulled]']);
  });
});

describe('readCurrent', () => {
  const READS = [SIM_READ.command, ...ACTIONS.flatMap((a) => (a.read ? [a.read.command] : []))];

  test('sends the read forms and nothing else', async () => {
    const { send, sent } = scripted({ 'AT+CPIN?': ok('+CPIN: READY') });
    await readCurrent(send);
    expect(sent).toEqual(READS);
  });

  test('an unreadable value stays null, the rest is still read', async () => {
    const { send } = scripted({ 'AT+CPIN?': ok('+CPIN: READY'), 'AT+CFUN?': ok('+CFUN: 4') });
    const r = await readCurrent(send);
    expect(r.sim).toBe('READY');
    expect(r.values.radio).toBe('4');
    expect(r.values.nat).toBeNull();
  });

  test('a lost connection stops the reading', async () => {
    const { send, sent } = scripted({ 'AT+CPIN?': ok('+CPIN: READY'), 'AT+CGDCONT?': { status: 'disconnected' } });
    const r = await readCurrent(send);
    expect(sent).toEqual(['AT+CPIN?', 'AT+CGDCONT?']);
    expect(r.values.radio).toBeUndefined();
  });
});
