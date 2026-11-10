import type { UsbDeviceDescription } from '../transport/types';
import type { DeviceKind } from '../profiles/known-devices';

type UsbInterface = UsbDeviceDescription['interfaces'][number];

const CDC_COMMUNICATIONS = 0x02;
const CDC_DATA = 0x0a;
const MASS_STORAGE = 0x08;
const WIRELESS_CONTROLLER = 0xe0;
const MISCELLANEOUS = 0xef;
const VENDOR_SPECIFIC = 0xff;
const SUBCLASS_ACM = 0x02;
const SUBCLASS_MISC_RNDIS = 0x04;

function isRndis(i: UsbInterface): boolean {
  return i.class === WIRELESS_CONTROLLER || (i.class === MISCELLANEOUS && i.subclass === SUBCLASS_MISC_RNDIS);
}

/** A name a person can read for one USB interface. */
export function interfaceLabel(i: UsbInterface): string {
  if (isRndis(i)) return 'Network RNDIS';
  if (i.class === CDC_COMMUNICATIONS) return i.subclass === SUBCLASS_ACM ? 'Serial CDC' : 'Network CDC';
  if (i.class === CDC_DATA) return 'Network data';
  if (i.class === VENDOR_SPECIFIC) return 'Vendor';
  if (i.class === MASS_STORAGE) return 'Storage';
  return `Class ${i.class.toString(16).padStart(2, '0')}`;
}

/** The hexadecimal class and subclass, as a USB tool would print them. */
export function interfaceCode(i: UsbInterface): string {
  return [i.class, i.subclass].map((n) => n.toString(16).padStart(2, '0')).join('/');
}

/**
 * Says so when what stops the device is the computer's operating system, not the device. Only a network
 * stick with an RNDIS layout on a Mac qualifies: a CDC stick does come up as a network adapter there.
 */
export function operatingSystemLimit(
  device: UsbDeviceDescription | undefined,
  kind: DeviceKind | undefined,
  platform: string,
): string | undefined {
  if (!device || kind !== 'network-web' || !/mac/i.test(platform)) return undefined;
  const rndisOnly = device.interfaces.some(isRndis) && !device.interfaces.some((i) => i.class === CDC_COMMUNICATIONS && i.subclass !== SUBCLASS_ACM);
  if (!rndisOnly) return undefined;
  return 'This is a limit of macOS: it has no RNDIS driver, so on this Mac the stick does not become a network adapter over USB and its own web page cannot be reached that way. USB works on Windows and Linux.';
}
