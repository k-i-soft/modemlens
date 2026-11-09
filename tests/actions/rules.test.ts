import { describe, expect, test } from 'vitest';
import { actionById, EC200A_PROFILE_ID } from '../../src/actions/ec200a';
import { availability, sessionBlock } from '../../src/actions/rules';
import type { ActionsState } from '../../src/actions/rules';

const WIN = 'Win32';
const MAC = 'MacIntel';
const ready: ActionsState = {
  connected: true, imported: false, profileId: EC200A_PROFILE_ID, scanning: false, busy: false,
  sim: 'READY', radio: '1', usbMode: '1',
};
const check = (id: string, over: Partial<ActionsState> = {}, platform = WIN, value?: string) =>
  availability(actionById(id)!, { ...ready, ...over }, platform, value);
const ALL = ['apn', 'data', 'radio', 'usb-mode', 'nat', 'network-mode', 'roaming', 'restart'];

describe('rule 1: only the EC200A on a live connection', () => {
  test.each(ALL)('%s is available in the ready state', (id) => {
    expect(check(id)).toEqual({ enabled: true, hidden: false });
  });
  test.each(ALL)('%s is off for another modem', (id) => {
    const a = check(id, { profileId: 'quectel-ec25' });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain('EC200A');
  });
  test.each(ALL)('%s is off without a connection', (id) => {
    expect(check(id, { connected: false }).enabled).toBe(false);
  });
  test.each(ALL)('%s is off on an imported report', (id) => {
    expect(check(id, { imported: true }).reason).toContain('imported');
  });
  test('an unknown modem is not assumed to be an EC200A', () => {
    expect(check('restart', { profileId: undefined }).enabled).toBe(false);
  });
  test('while the scan has not identified the modem, it says so', () => {
    expect(sessionBlock({ ...ready, profileId: undefined, scanning: true })).toContain('identify');
  });
  test('the imported reason wins over the missing connection', () => {
    expect(sessionBlock({ ...ready, imported: true, connected: false })).toContain('imported');
  });
});

describe('rule 2: SIM READY for APN and data', () => {
  test.each(['apn', 'data'])('%s needs READY', (id) => {
    const pin = check(id, { sim: 'SIM PIN' });
    expect(pin.enabled).toBe(false);
    expect(pin.reason).toContain('SIM PIN');
    const unknown = check(id, { sim: null });
    expect(unknown.enabled).toBe(false);
    expect(unknown.reason).toContain('could not be read');
  });
  test.each(['radio', 'usb-mode', 'nat', 'network-mode', 'roaming', 'restart'])('%s does not', (id) => {
    expect(check(id, { sim: 'SIM PIN' }).enabled).toBe(true);
    expect(check(id, { sim: null }).enabled).toBe(true);
  });
});

describe('rule 3: radio off', () => {
  test.each(['4', '0'])('the data toggle is disabled with CFUN %s and says why', (radio) => {
    const a = check('data', { radio });
    expect(a.enabled).toBe(false);
    expect(a.hidden).toBe(false);
    expect(a.reason).toContain('radio is off');
  });
  test('an unreadable radio state keeps it off', () => {
    expect(check('data', { radio: null }).enabled).toBe(false);
  });
  test('the APN is not affected', () => expect(check('apn', { radio: '4' }).enabled).toBe(true));
  test('the radio itself can always be switched', () => {
    expect(check('radio', { radio: '4' }).enabled).toBe(true);
    expect(check('radio', { radio: null }).enabled).toBe(true);
  });
});

describe('rule 4: NAT and data need a network USB mode', () => {
  test.each(['nat', 'data'])('%s is offered in mode 1 and 3', (id) => {
    expect(check(id, { usbMode: '1' }).enabled).toBe(true);
    expect(check(id, { usbMode: '3' }).enabled).toBe(true);
  });
  test.each(['nat', 'data'])('%s is not offered in another mode, and says why', (id) => {
    const a = check(id, { usbMode: '0' });
    expect(a).toMatchObject({ enabled: false, hidden: true });
    expect(a.reason).toContain('network USB mode');
  });
  test.each(['nat', 'data'])('%s stays off, visibly, when the mode is unknown', (id) => {
    expect(check(id, { usbMode: null })).toMatchObject({ enabled: false, hidden: false });
  });
  test('the USB mode itself can be changed from any mode', () => {
    expect(check('usb-mode', { usbMode: '0' }).enabled).toBe(true);
    expect(check('usb-mode', { usbMode: null }).enabled).toBe(true);
  });
});

describe('rule 5: RNDIS on a Mac', () => {
  test.each([MAC, 'macOS'])('mode 3 is hidden on %s, with the reason', (platform) => {
    const a = check('usb-mode', {}, platform, '3');
    expect(a).toMatchObject({ enabled: false, hidden: true });
    expect(a.reason).toContain('RNDIS');
  });
  test('mode 1 stays on a Mac', () => expect(check('usb-mode', {}, MAC, '1').enabled).toBe(true));
  test.each([WIN, 'Linux x86_64'])('mode 3 is offered on %s', (platform) => {
    expect(check('usb-mode', {}, platform, '3').enabled).toBe(true);
  });
  test('the action as a whole stays on a Mac', () => expect(check('usb-mode', {}, MAC).enabled).toBe(true));
});

describe('rule 6: one at a time', () => {
  test.each(ALL)('%s is off during a scan and says why', (id) => {
    const a = check(id, { scanning: true });
    expect(a.enabled).toBe(false);
    expect(a.reason).toContain('scan');
  });
  test.each(ALL)('%s is off during another action', (id) => {
    expect(check(id, { busy: true }).enabled).toBe(false);
  });
});
