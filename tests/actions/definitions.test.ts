import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { AtResponse } from '../../src/at/engine';
import { ASR_ACTIONS, ASR_PROFILE_ID } from '../../src/actions/asr';
import { actionsFor } from '../../src/actions/profiles';
import { ACTIONS, SIM_READ, actionById, apnProblem, apnValue, buildWrite, isVerified, valueLabel } from '../../src/actions/ec200a';

const action = (id: string) => actionById(id)!;
const ok = (...lines: string[]): AtResponse => ({ command: 'x', status: 'ok', lines, durationMs: 1 });

describe('write commands', () => {
  test.each([
    ['data', 'on', 'AT+QNETDEVCTL=1,1,1'],
    ['data', 'off', 'AT+QNETDEVCTL=0,1,1'],
    ['radio', '4', 'AT+CFUN=4'],
    ['radio', '1', 'AT+CFUN=1'],
    ['usb-mode', '1', 'AT+QCFG="usbnet",1'],
    ['usb-mode', '3', 'AT+QCFG="usbnet",3'],
    ['nat', '0', 'AT+QCFG="nat",0'],
    ['nat', '1', 'AT+QCFG="nat",1'],
    ['network-mode', '0', 'AT+QCFG="nwscanmode",0'],
    ['network-mode', '1', 'AT+QCFG="nwscanmode",1'],
    ['network-mode', '2', 'AT+QCFG="nwscanmode",2'],
    ['network-mode', '3', 'AT+QCFG="nwscanmode",3'],
    ['roaming', '1', 'AT+QCFG="roamservice",1,1'],
    ['roaming', '2', 'AT+QCFG="roamservice",2,1'],
    ['restart', 'restart', 'AT+CFUN=1,1'],
    ['apn', apnValue('IP', 'internet'), 'AT+CGDCONT=1,"IP","internet"'],
    ['apn', apnValue('IPV4V6', 'a.b-c'), 'AT+CGDCONT=1,"IPV4V6","a.b-c"'],
    ['apn', apnValue('IPV6', 'x'), 'AT+CGDCONT=1,"IPV6","x"'],
  ])('%s %s writes %s', (id, value, command) => {
    expect(buildWrite(action(id), value)).toBe(command);
  });

  test.each([
    ['usb-mode', '0'], ['usb-mode', '5'], ['nat', '2'], ['radio', '0'], ['network-mode', '4'],
    ['roaming', '0'], ['data', '1'], ['restart', 'other'], ['radio', '1;+CFUN=0'],
  ])('%s has no write for %s', (id, value) => {
    expect(buildWrite(action(id), value)).toBeNull();
  });
});

describe('APN validation', () => {
  test.each(['internet', 'a', 'web.provider.example', 'A-1.b', 'x'.repeat(63)])('%s is accepted', (apn) => {
    expect(apnProblem(apn)).toBeUndefined();
  });

  test.each([
    ['empty', ''],
    ['too long', 'x'.repeat(64)],
    ['double quote', 'a"b'],
    ['single quote', "a'b"],
    ['closing quote and new command', 'a";+CFUN=0;"'],
    ['carriage return', 'a\rAT+CFUN=0'],
    ['newline', 'a\n'],
    ['nul', 'a\0'],
    ['tab', 'a\tb'],
    ['escape', 'a\x1b'],
    ['ctrl+z', 'a\x1a'],
    ['space', 'a b'],
    ['comma', 'a,b'],
    ['semicolon', 'a;b'],
    ['slash', 'a/b'],
    ['underscore', 'a_b'],
    ['non-ascii', 'äpn'],
  ])('%s is rejected, and no command is built', (_, apn) => {
    expect(apnProblem(apn)).toBeDefined();
    expect(buildWrite(action('apn'), apnValue('IP', apn))).toBeNull();
  });

  test.each(['PPP', 'IP"', '', 'ip'])('address type %j is not allowed', (type) => {
    expect(buildWrite(action('apn'), apnValue(type, 'internet'))).toBeNull();
  });
});

describe('read parsers', () => {
  test('there is nothing to read for a restart', () => expect(action('restart').read).toBeUndefined());

  test('read commands are exactly the read forms', () => {
    expect(ACTIONS.flatMap((a) => (a.read ? [a.read.command] : []))).toEqual([
      'AT+CGDCONT?', 'AT+QNETDEVCTL?', 'AT+CFUN?',
      'AT+QCFG="usbnet"', 'AT+QCFG="nat"', 'AT+QCFG="nwscanmode"', 'AT+QCFG="roamservice"',
    ]);
    expect(SIM_READ.command).toBe('AT+CPIN?');
  });

  test.each([
    ['data', ['+QNETDEVCTL: 0,0,0,0'], 'off'],
    ['data', ['+QNETDEVCTL: 1,1,1,1'], 'on'],
    ['data', ['+qnetdevctl:1, 1, 1, 0'], 'off'],
    ['data', ['+QNETDEVCTL: 1,1,1,2'], null],
    ['data', ['+QNETDEVCTL: 1,1'], null],
    ['radio', ['+CFUN: 4'], '4'],
    ['radio', ['+CFUN: 1,0'], '1'],
    ['usb-mode', ['+QCFG: "usbnet",1'], '1'],
    ['usb-mode', ['+QCFG:"USBNET", 3'], '3'],
    ['usb-mode', ['+QCFG: "nat",1'], null],
    ['nat', ['+QCFG: "nat",0'], '0'],
    ['network-mode', ['+QCFG: "nwscanmode",3'], '3'],
    ['roaming', ['+QCFG: "roamservice",2,1'], '2'],
    ['apn', ['+CGDCONT: 1,"IP","internet","10.0.0.2",0,0', '+CGDCONT: 2,"IP","other"'], apnValue('IP', 'internet')],
    ['apn', ['+CGDCONT: 2,"IP","other"', '+CGDCONT: 1,"ipv4v6","x"'], apnValue('IPV4V6', 'x')],
    ['apn', ['+CGDCONT: 1,"IP",""'], apnValue('IP', '')],
    ['apn', ['+CGDCONT: 2,"IP","other"'], null],
    ['radio', ['nonsense'], null],
    ['radio', ['+CFUN: 1', '+CFUN: 4'], '4'],
    ['usb-mode', ['+QCFG: "usbnet",3', '+QCFG: "usbnet",1'], '1'],
  ])('%s: %j reads as %j', (id, lines, value) => {
    expect(action(id).read!.parse(ok(...lines))).toBe(value);
  });

  test('an answer without OK is not understood, whatever it says', () => {
    const r: AtResponse = { command: 'x', status: 'timeout', lines: ['+CFUN: 1'], durationMs: 1 };
    expect(action('radio').read!.parse(r)).toBeNull();
    expect(SIM_READ.parse({ ...r, lines: ['+CPIN: READY'] })).toBeNull();
  });

  test('the SIM state is read', () => {
    expect(SIM_READ.parse(ok('+CPIN: READY'))).toBe('READY');
    expect(SIM_READ.parse(ok('+CPIN: SIM PIN'))).toBe('SIM PIN');
    expect(SIM_READ.parse(ok('+CPIN: NOT READY', '+CPIN: READY'))).toBe('READY');
  });
});

describe('what the definitions promise', () => {
  test('only USB mode and NAT need a restart', () => {
    expect(ACTIONS.filter((a) => a.needsRestart).map((a) => a.id).sort()).toEqual(['nat', 'usb-mode']);
  });

  test.each([
    ['apn', apnValue('IP', 'x'), true], ['data', 'on', true], ['data', 'off', false], ['radio', '4', true], ['radio', '1', true],
    ['usb-mode', '1', true], ['nat', '1', true], ['restart', 'restart', true], ['network-mode', '3', false], ['roaming', '2', false],
  ])('%s %s verified: %s', (id, value, verified) => {
    expect(isVerified(action(id), value)).toBe(verified);
  });

  test('values read as labels, an unreadable one as "unknown"', () => {
    expect(valueLabel(action('nat'), '0')).toBe('Modem does NAT');
    expect(valueLabel(action('usb-mode'), '5')).toBe('Value 5');
    expect(valueLabel(action('nat'), null)).toBe('unknown');
    expect(valueLabel(action('apn'), apnValue('IP', 'x'))).toBe('x (IP)');
    expect(valueLabel(action('apn'), apnValue('IP', ''))).toBe('No APN (IP)');
  });

  test('warnings say what the owner asked for', () => {
    const nat1 = action('nat').choices.find((c) => c.value === '1')!;
    expect(nat1.strongWarning).toBe(true);
    expect(nat1.warning).toContain('carrier address directly');
    expect(nat1.warning).toContain('protection is gone');
    expect(nat1.warning).toContain('firewall');
    expect(nat1.warning).toContain('reconnect repeatedly');
    expect(action('radio').choices.find((c) => c.value === '4')!.warning).toContain('leaves the network');
    expect(action('restart').warning).toContain('drops');
  });
});

describe('actions per profile', () => {
  test('the EC200A keeps its set', () => expect(actionsFor('quectel-ec200a')).toBe(ACTIONS));
  test('the ASR stick has its own', () => expect(actionsFor(ASR_PROFILE_ID)).toBe(ASR_ACTIONS));
  test.each(['quectel-ec25', 'quectel-eg800', 'nothing', undefined])('%s has none', (id) => {
    expect(actionsFor(id)).toEqual([]);
  });
});

describe('ASR definitions', () => {
  const asr = (id: string) => ASR_ACTIONS.find((a) => a.id === id)!;
  const reply = (...lines: string[]): AtResponse => ok(...lines);

  test('only what this model has', () => {
    expect(ASR_ACTIONS.map((a) => a.id)).toEqual(['apn', 'data-context', 'radio', 'restart']);
  });

  test.each([
    ['apn', apnValue('IP', 'internet'), 'AT+CGDCONT=1,"IP","internet"'],
    ['apn', apnValue('IPV4V6', 'internet'), 'AT+CGDCONT=1,"IPV4V6","internet"'],
    ['apn', apnValue('IPV6', 'internet'), 'AT+CGDCONT=1,"IPV6","internet"'],
    ['data-context', 'on', 'AT+CGACT=1,1'],
    ['data-context', 'off', 'AT+CGACT=0,1'],
    ['radio', '4', 'AT+CFUN=4'],
    ['radio', '1', 'AT+CFUN=1'],
    ['restart', 'restart', 'AT+CFUN=1,1'],
  ])('%s %s writes %s', (id, value, command) => {
    expect(buildWrite(asr(id), value)).toBe(command);
  });

  test('the APN is validated as on the EC200A', () => {
    expect(buildWrite(asr('apn'), apnValue('IP', 'a";+CFUN=0;"'))).toBeNull();
    expect(buildWrite(asr('apn'), apnValue('PPP', 'internet'))).toBeNull();
  });

  test('no command of the EC200A alone can be built', () => {
    const own = ASR_ACTIONS.flatMap((a) => a.choices.map((c) => c.command));
    for (const c of own) expect(c).not.toMatch(/QCFG|QNETDEVCTL/);
    const ec200aOnly = ACTIONS.flatMap((a) => a.choices).filter((c) => !own.includes(c.command));
    expect(ec200aOnly.length).toBeGreaterThan(5);
    for (const a of ASR_ACTIONS.filter((x) => x.kind !== 'apn')) {
      for (const c of ec200aOnly.filter((x) => !a.choices.some((y) => y.value === x.value))) {
        expect(buildWrite(a, c.value), `${a.id} ${c.command}`).toBeNull();
      }
      for (const c of a.choices) expect(ec200aOnly.map((x) => x.command)).not.toContain(buildWrite(a, c.value));
    }
  });

  test('every value takes the second confirmation', () => {
    expect(isVerified(asr('apn'), apnValue('IP', 'internet'))).toBe(false);
    for (const a of ASR_ACTIONS) for (const c of a.choices) expect(isVerified(a, c.value), `${a.id} ${c.value}`).toBe(false);
  });

  test('switching data off warns that it may come back', () => {
    expect(asr('data-context').choices.find((c) => c.value === 'off')!.warning).toContain('may turn data back on');
  });

  test('radio and restart have the long timeout', () => {
    expect(asr('radio').timeoutMs).toBe(15000);
    expect(asr('restart').timeoutMs).toBe(15000);
  });

  test.each([
    ['apn', ['+CGDCONT: 1,"IP","internet.MNC002.MCC228.GPRS","0.0.0.0",0,0,,,,'], apnValue('IP', 'internet.MNC002.MCC228.GPRS')],
    ['data-context', ['+CGACT: 1,1'], 'on'],
    ['data-context', ['+CGACT: 1,0'], 'off'],
    ['data-context', ['+CGACT: 2,1'], null],
    ['data-context', ['+CGACT: 1,1', '+CGACT: 2,0'], 'on'],
    ['radio', ['+CFUN: 1'], '1'],
  ])('%s: %j reads as %j', (id, lines, value) => {
    expect(asr(id).read!.parse(reply(...lines))).toBe(value);
  });
});

describe('never exposed', () => {
  const FORBIDDEN = ['band', 'usbid', 'usbmanufacturer', 'usbnetmac', 'imeilock', 'fota', 'poweroffdefault'];
  const dir = 'src/actions';
  const sources = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8'));
  const texts = [
    ...[...ACTIONS, ...ASR_ACTIONS].flatMap((a) => [a.label, a.summary, a.warning, a.read?.command ?? '', ...a.choices.flatMap((c) => [c.label, c.command, c.warning ?? ''])]),
    ...sources,
  ].map((t) => t.toLowerCase());

  test.each(FORBIDDEN)('%s appears nowhere in the definitions or their source', (word) => {
    expect(sources.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).not.toContain(word);
  });
});
