export type DeviceKind = 'at' | 'storage' | 'network-web' | 'transient' | 'unknown';

export interface DeviceClassification {
  kind: DeviceKind;
  /** Plain lowercase "vvvv:pppp". */
  usb: string;
  label?: string;
  /** How the device's own web interface speaks, when it has one. */
  webDialect?: 'hilink' | 'zte';
  /** Address of the device's web interface, when it is fixed. */
  webAddress?: string;
  /** Has its own Wi-Fi, so its web interface can be reached without a USB network driver. */
  webOverWifi?: boolean;
}

export interface ClassifierInput {
  usb: string;
  /** Interface classes of the active configuration, every alternate setting. */
  interfaceClasses: number[];
  /** A CDC ACM interface (class 0x02, subclass 0x02) is present: it can carry AT commands. */
  hasAcm?: boolean;
}

const CLASS_CDC_COMMUNICATIONS = 0x02;
const CLASS_CDC_DATA = 0x0a;
const CLASS_MASS_STORAGE = 0x08;
const CLASS_WIRELESS_CONTROLLER = 0xe0; // RNDIS
const CLASS_VENDOR_SPECIFIC = 0xff;
const NETWORK_CLASSES = [CLASS_CDC_COMMUNICATIONS, CLASS_WIRELESS_CONTROLLER, CLASS_CDC_DATA];

/**
 * Measured devices. An entry wins over the interface classes: the same Huawei stick shows RNDIS
 * classes on Windows and CDC classes on Linux.
 */
const KNOWN: Record<string, Omit<DeviceClassification, 'usb'>> = {
  '12d1:1f01': { kind: 'storage', label: 'Huawei HiLink stick (storage mode)' },
  '12d1:14db': { kind: 'network-web', label: 'Huawei HiLink stick', webDialect: 'hilink', webAddress: '192.168.8.1' },
  '0e8d:2004': { kind: 'network-web', label: 'MediaTek MiFi stick', webDialect: 'zte', webAddress: '192.168.0.1', webOverWifi: true },
  '1782:4056': { kind: 'network-web', label: 'Unisoc-based stick' },
  '2ecc:3001': { kind: 'transient', label: 'Stick that switches mode by itself' },
  '1286:4e3c': { kind: 'at', label: 'ASR stick' },
  '2c7c:6005': { kind: 'at', label: 'Quectel EC200A' },
};

/** Decides from the USB id and the interface classes whether the device has an AT channel. Claims nothing. */
export function classifyUsbDevice(input: ClassifierInput): DeviceClassification {
  const usb = input.usb.trim().toLowerCase();
  const known = KNOWN[usb];
  if (known) return { ...known, usb };

  const classes = input.interfaceClasses;
  if (input.hasAcm || classes.includes(CLASS_VENDOR_SPECIFIC)) return { kind: 'at', usb };
  if (classes.length > 0 && classes.every((c) => c === CLASS_MASS_STORAGE)) return { kind: 'storage', usb };
  if (classes.some((c) => NETWORK_CLASSES.includes(c))) return { kind: 'network-web', usb };
  return { kind: 'unknown', usb };
}
