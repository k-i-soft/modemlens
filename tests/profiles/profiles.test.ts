import { expect, test } from 'vitest';
import { PROFILES, matchProfile } from '../../src/profiles';

test('matches by USB', () => expect(matchProfile({ usb: '2c7c:6005' })?.id).toBe('quectel-ec200a'));
test('USB match is case-insensitive', () => expect(matchProfile({ usb: '2C7C:0125' })?.id).toBe('quectel-ec25'));
test('matches by model', () => expect(matchProfile({ model: 'EC25EUFAR' })?.id).toBe('quectel-ec25'));
test.each([['EC200A', 'quectel-ec200a'], ['EG800', 'quectel-eg800'], ['EG800Q-EU', 'quectel-eg800']])('model %s', (m, id) =>
  expect(matchProfile({ model: m })?.id).toBe(id));
test('unknown', () => expect(matchProfile({ usb: 'dead:beef' })).toBeUndefined());
test('the remaining starter profiles are unverified', () =>
  expect(PROFILES.filter(p => p.id !== 'quectel-ec200a').every(p => p.verified === false)).toBe(true));

// same read-only invariant as the standard catalog, plus the Quectel read forms
test('every auto profile command is a read form', () => {
  const re = /^AT(\+\w+\?|\+\w+=\?|\+Q(CCID|SPN|NWINFO|CSQ|TEMP|GMR)|\+QENG="(servingcell|neighbourcell)"|\+QCFG="(usbnet|band|nat)")$/;
  for (const p of PROFILES)
    for (const e of p.commands.filter(e => e.phase === 'auto')) expect(e.command).toMatch(re);
});
test('the EC200A profile reads its host connection and NAT setting', () => {
  const rows = PROFILES.find(p => p.id === 'quectel-ec200a')!.commands;
  expect(rows.find(e => e.id === 'qnetdevctl')).toMatchObject({ command: 'AT+QNETDEVCTL?', phase: 'auto', parser: 'qnetdevctl' });
  expect(rows.find(e => e.id === 'qcfg-nat')).toMatchObject({ command: 'AT+QCFG="nat"', phase: 'auto', parser: 'qcfg' });
});
test('profile commands never denied or unique', () => {
  for (const p of PROFILES) {
    const ids = p.commands.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p.commands.some(e => /CPIN=|CPWD/.test(e.command))).toBe(false);
  }
});

test('profile deny lists and parsers', () => {
  for (const p of PROFILES.filter(p => p.id.startsWith('quectel-'))) {
    expect(p.denyCommands).toEqual(['+QPRTPARA', '+QNVW', '+QNVFW', '+QCOPS', '+QMGDA', '+QCMGS', '+QCMGR', '+QHUP', '+QIACT', '+QIDEACT']);
    const par = (id: string) => p.commands.find(e => e.id === id)?.parser;
    expect(par('qeng-serving')).toBe('qeng_serving'); expect(par('qcfg-band')).toBe('qcfg'); expect(par('qccid')).toBe('qccid');
    expect(par('qeng-neighbour')).toBe('qeng_neighbour'); expect(par('qpinc')).toBe('qpinc'); expect(par('qgmr')).toBe('qgmr');
  }
});
