export interface Transport {
  readonly kind: 'serial' | 'usb' | 'fake';
  readonly label: string;
  write(data: Uint8Array): Promise<void>;
  onData(cb: (chunk: Uint8Array) => void): void;
  onDisconnect(cb: (reason: string) => void): void;
  close(): Promise<void>;
}
