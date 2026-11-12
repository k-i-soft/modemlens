import { describe, expect, test } from 'vitest';
import {
  attemptWarning, buildPinCommand, counterRead, inputProblem, maskCommand, maskLines, operationsFor, readPinStatus, runPin,
} from '../../src/tools/pin';
import type { PinStatus } from '../../src/tools/pin';
import { fakeIo } from './fakeIo';

const status = (s: Partial<PinStatus>): PinStatus => ({ state: 'READY', lockOn: true, pinLeft: 3, pukLeft: 10, ...s });

describe('commands', () => {
  test.each([
    ['unlock', { code: '1234' }, 'AT+CPIN="1234"'],
    ['puk', { code: '12345678', newPin: '4321' }, 'AT+CPIN="12345678","4321"'],
    ['change', { code: '1234', newPin: '87654321' }, 'AT+CPWD="SC","1234","87654321"'],
    ['lock-on', { code: '1234' }, 'AT+CLCK="SC",1,"1234"'],
    ['lock-off', { code: '1234' }, 'AT+CLCK="SC",0,"1234"'],
  ] as const)('%s', (op, input, command) => {
    expect(buildPinCommand(op, input)).toBe(command);
  });

  test.each([
    ['unlock', { code: '123' }],
    ['unlock', { code: '123456789' }],
    ['unlock', { code: '12a4' }],
    ['unlock', { code: '1234"' }],
    ['unlock', { code: '1234\r' }],
    ['puk', { code: '1234567', newPin: '1234' }],
    ['puk', { code: '12345678', newPin: '12' }],
    ['change', { code: '1234', newPin: '' }],
    ['lock-off', { code: '1234;+CFUN=0' }],
  ] as const)('%s %j cannot be built', (op, input) => {
    expect(buildPinCommand(op, input)).toBeNull();
  });

  test('the new PIN has to be typed twice', () => {
    expect(inputProblem('change', { code: '1234', newPin: '5678' }, '5679')).toContain('differ');
    expect(inputProblem('change', { code: '1234', newPin: '5678' }, '5678')).toBeUndefined();
  });
});

describe('masking', () => {
  test('a command shows no code', () => {
    expect(maskCommand('AT+CPWD="SC","1234","87654321"')).toBe('AT+CPWD="SC","****","****"');
    expect(maskCommand('AT+CLCK="SC",0,"1234"')).toBe('AT+CLCK="SC",0,"****"');
  });

  test('an answer that repeats a code shows none', () => {
    expect(maskLines(['echo AT+CPIN="1234"', '[ok]'], ['1234', ''])).toEqual(['echo AT+CPIN="****"', '[ok]']);
  });

  test('a refused unlock reports no code anywhere', async () => {
    const { io } = fakeIo({ 'AT+CPIN="1234"': { status: 'cme_error', errorDetail: 'incorrect password', lines: ['AT+CPIN="1234"'] } });
    const out = await runPin(io, 'unlock', { code: '1234' });
    expect(out.tone).toBe('bad');
    expect(JSON.stringify(out)).not.toContain('1234');
    expect(out.message).toContain('incorrect password');
  });
});

describe('what can be done', () => {
  test.each([
    [{ state: 'SIM PIN', lockOn: null }, ['unlock']],
    [{ state: 'SIM PUK', lockOn: null }, ['puk']],
    [{ state: 'READY', lockOn: true }, ['change', 'lock-off']],
    [{ state: 'READY', lockOn: false }, ['lock-on']],
    [{ state: 'READY', lockOn: null }, []],
    [{ state: 'PH-NET PIN', lockOn: null }, []],
    [{ state: null, lockOn: null }, []],
  ])('%j', (s, ops) => {
    expect(operationsFor(status(s))).toEqual(ops);
  });

  test('the last attempt is said loudly, an unknown count too', () => {
    expect(attemptWarning('unlock', status({ pinLeft: 1 }))).toMatchObject({ strong: true });
    expect(attemptWarning('unlock', status({ pinLeft: 1 })).text).toContain('last PIN attempt');
    expect(attemptWarning('puk', status({ pukLeft: 1 })).text).toContain('blocked for good');
    expect(attemptWarning('unlock', status({ pinLeft: null }))).toMatchObject({ strong: true });
    expect(attemptWarning('change', status({ pinLeft: 3 }))).toEqual({ text: '3 PIN attempts are left. A wrong PIN uses one up.', strong: false });
  });
});

describe('reading the state', () => {
  test('Quectel: state, lock and counters', async () => {
    const { io, commands } = fakeIo({
      'AT+CPIN?': { lines: ['+CPIN: READY'] },
      'AT+CLCK="SC",2': { lines: ['+CLCK: 1'] },
      'AT+QPINC="SC"': { lines: ['+QPINC: "SC",3,10'] },
    });
    expect(await readPinStatus(io, 'quectel-ec200a')).toEqual({ state: 'READY', lockOn: true, pinLeft: 3, pukLeft: 10 });
    expect(commands()).toEqual(['AT+CPIN?', 'AT+CLCK="SC",2', 'AT+QPINC="SC"']);
  });

  test('a locked SIM is not asked about its lock', async () => {
    const { io, commands } = fakeIo({ 'AT+CPIN?': { lines: ['+CPIN: SIM PIN'] }, 'AT+SPIC': { lines: ['+SPIC: 2,10,3,10'] } });
    expect(await readPinStatus(io, 'simcom-sim7000')).toEqual({ state: 'SIM PIN', lockOn: null, pinLeft: 2, pukLeft: 10 });
    expect(commands()).toEqual(['AT+CPIN?', 'AT+SPIC']);
  });

  test('Huawei counts PUK first', () => {
    const r = counterRead('huawei-k3715')!;
    expect(r.parse({ command: 'x', status: 'ok', lines: ['^CPIN: READY,,10,3,10,3'], durationMs: 1 })).toEqual({ pin: 3, puk: 10 });
  });

  test('other modems have no counter', () => expect(counterRead('asr-1286-4e3c')).toBeUndefined());

  test('an unlock is sent once, never again', async () => {
    const { io, commands } = fakeIo({ 'AT+CPIN="1234"': { status: 'timeout' } });
    await runPin(io, 'unlock', { code: '1234' });
    expect(commands()).toEqual(['AT+CPIN="1234"']);
  });
});
