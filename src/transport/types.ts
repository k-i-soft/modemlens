export interface Transport {
  readonly kind: 'serial' | 'usb' | 'fake';
  readonly label: string;
  /** USB id as plain lowercase "vvvv:pppp", when the device has one. */
  readonly usbId?: string;
  /**
   * True when an interface claim never finished while connecting. The browser keeps the device busy
   * until the modem is replugged, so the person has to do that before the next connection.
   */
  readonly hadPendingClaim?: boolean;
  write(data: Uint8Array): Promise<void>;
  onData(cb: (chunk: Uint8Array) => void): void;
  onDisconnect(cb: (reason: string) => void): void;
  close(): Promise<void>;
}

export interface ConnectorOptions {
  /** Ends the previous session, including closing its transport. Never rejects. */
  beforeOpen: () => Promise<void>;
}

/**
 * Connects to a device, in exactly this order:
 * 1. Ask the browser for the device. This must come first, inside the user gesture.
 * 2. `await opts.beforeOpen()`. A port that is still open cannot be opened again, and WebUSB
 *    shares the USBDevice object, so the old session has to be gone first.
 * 3. Open the device and return the transport.
 * If the user cancels the picker, reject without calling `beforeOpen`: the old session stays.
 */
export type Connector<Options extends ConnectorOptions = ConnectorOptions> = (opts: Options) => Promise<Transport>;

export type SerialConnectorOptions = ConnectorOptions & { baudRate?: number; port?: SerialPort };
/** `onProbe` reports each interface while the channels of an unknown modem are tried. */
export type UsbConnectorOptions = ConnectorOptions & { device?: USBDevice; onProbe?: (interfaceNumber: number) => void };

export interface Connectors {
  serial: Connector<SerialConnectorOptions>;
  usb: Connector<UsbConnectorOptions>;
}

/** The person closed the browser's device picker without choosing anything. Not an error to show. */
export class PickerCancelledError extends Error {
  constructor() {
    super('No device was selected.');
    this.name = 'PickerCancelledError';
  }
}
