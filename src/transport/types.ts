export interface Transport {
  readonly kind: 'serial' | 'usb' | 'fake';
  readonly label: string;
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
export type Connector = (opts: ConnectorOptions) => Promise<Transport>;

export interface Connectors {
  serial: Connector;
  usb: Connector;
}
