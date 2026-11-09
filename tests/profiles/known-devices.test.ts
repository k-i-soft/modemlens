import { expect, test } from 'vitest';
import { classifyUsbDevice } from '../../src/profiles/known-devices';
import { matchProfile } from '../../src/profiles';

test('huawei storage mode', () => {
  const c = classifyUsbDevice({ usb: '12d1:1f01', interfaceClasses: [8] });
  expect(c.kind).toBe('storage');
  expect(c.label).toBe('Huawei HiLink stick (storage mode)');
});
test('huawei hilink', () => {
  const c = classifyUsbDevice({ usb: '12d1:14db', interfaceClasses: [2, 10] });
  expect(c.kind).toBe('network-web');
  expect(c.webDialect).toBe('hilink');
  expect(c.webAddress).toBe('192.168.8.1');
});
test('huawei hilink as rndis on windows', () => {
  const c = classifyUsbDevice({ usb: '12d1:14db', interfaceClasses: [224, 10] });
  expect(c.kind).toBe('network-web');
  expect(c.webDialect).toBe('hilink');
});
test('mediatek mifi has a dialect but no fixed address', () => {
  const c = classifyUsbDevice({ usb: '0e8d:2004', interfaceClasses: [224, 10, 8] });
  expect(c.kind).toBe('network-web');
  expect(c.webDialect).toBe('zte');
  expect(c.label).toBe('MediaTek MiFi stick');
  expect(c.webAddress).toBeUndefined();
});
test('unisoc stick is a network stick without a known address', () => {
  const c = classifyUsbDevice({ usb: '1782:4056', interfaceClasses: [224, 10] });
  expect(c).toEqual({ kind: 'network-web', usb: '1782:4056', label: 'Unisoc-based stick' });
});
test('transient', () => expect(classifyUsbDevice({ usb: '2ecc:3001', interfaceClasses: [8] }).kind).toBe('transient'));
test('asr stick is at', () => expect(classifyUsbDevice({ usb: '1286:4e3c', interfaceClasses: [255, 255, 255] }).kind).toBe('at'));
test('ec200a is at', () => expect(classifyUsbDevice({ usb: '2c7c:6005', interfaceClasses: [2, 10, 255, 255, 255] }).kind).toBe('at'));
test('the id is compared case-insensitively', () => expect(classifyUsbDevice({ usb: '12D1:1F01', interfaceClasses: [] }).kind).toBe('storage'));

test('unknown storage only', () => expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [8] }).kind).toBe('storage'));
test('unknown network only', () => {
  const c = classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [2, 10] });
  expect(c.kind).toBe('network-web');
  expect(c.webDialect).toBeUndefined();
});
test('unknown rndis only', () => expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [224, 10] }).kind).toBe('network-web'));
test('vendor interface means at candidate', () => expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [2, 10, 255] }).kind).toBe('at'));
test('an unknown device with CDC ACM is at, not network', () =>
  expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [2, 10], hasAcm: true }).kind).toBe('at'));
test('storage plus a vendor interface is still at', () => expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [8, 255] }).kind).toBe('at'));
test('no useful class is unknown', () => {
  expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [] }).kind).toBe('unknown');
  expect(classifyUsbDevice({ usb: 'dead:beef', interfaceClasses: [3] }).kind).toBe('unknown');
});

test('the asr profile is unverified and adds nothing to the standard catalog', () => {
  const p = matchProfile({ usb: '1286:4e3c' });
  expect(p?.verified).toBe(false);
  expect(p?.usb).toEqual({ atInterface: 3, avoidInterfaces: [] });
  expect(p?.commands).toEqual([]);
  expect(p?.denyCommands).toEqual([]);
});
