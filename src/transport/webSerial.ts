import { PickerCancelledError } from './types';
import type { SerialConnectorOptions, Transport } from './types';
import { errorMessage, errorName, formatUsbId, TransportListeners } from './common';

export const DEFAULT_BAUD_RATE = 115200;
/** Errors after which the browser hands out a new readable stream on the same port. */
const RECOVERABLE_READ_ERRORS = new Set(['BufferOverrunError', 'BreakError', 'FramingError', 'ParityError']);

export class PortBusyError extends Error {
  constructor() {
    super('Another program is using the modem. Close that program and try again.');
    this.name = 'PortBusyError';
  }
}

async function pickPort(): Promise<SerialPort> {
  try {
    return await navigator.serial.requestPort();
  } catch (e) {
    if (errorName(e) === 'NotFoundError') throw new PickerCancelledError();
    throw e;
  }
}

class WebSerialTransport implements Transport {
  readonly kind = 'serial' as const;
  readonly label: string;
  private readonly events = new TransportListeners();
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readDone: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;

  constructor(
    private readonly port: SerialPort,
    baudRate: number,
    readonly usbId: string | undefined,
  ) {
    this.label = `Serial port${usbId ? ` ${usbId}` : ''}, ${baudRate} baud`;
    this.writer = port.writable!.getWriter();
  }

  start(): void {
    navigator.serial.addEventListener('disconnect', this.handleUnplug);
    this.readDone = this.readLoop();
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closing) throw new Error('The serial port is closed.');
    await this.writer.write(data);
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.events.onData(cb);
  }

  onDisconnect(cb: (reason: string) => void): void {
    this.events.onDisconnect(cb);
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private readonly handleUnplug = (e: Event): void => {
    if (e.target === this.port) this.lose('the modem was unplugged or restarted');
  };

  private lose(reason: string): void {
    if (this.closing) return;
    navigator.serial.removeEventListener('disconnect', this.handleUnplug);
    this.events.lost(reason);
  }

  private async readLoop(): Promise<void> {
    while (!this.closing && this.port.readable) {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            this.lose('the serial port was closed');
            return;
          }
          if (value?.length) this.events.data(value);
        }
      } catch (e) {
        if (!RECOVERABLE_READ_ERRORS.has(errorName(e))) {
          this.lose(errorMessage(e));
          return;
        }
      } finally {
        this.reader = null;
        reader.releaseLock();
      }
    }
    this.lose('the serial port was closed');
  }

  /** `port.close` refuses while a stream is locked, so both locks go first. Never rejects. */
  private async shutdown(): Promise<void> {
    navigator.serial.removeEventListener('disconnect', this.handleUnplug);
    const steps = [
      () => this.reader?.cancel(),
      () => this.readDone,
      () => this.writer.abort(),
      () => this.writer.releaseLock(),
      () => this.port.close(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch {
        /* already gone: a failed step must not stop the next one or the next connection */
      }
    }
  }
}

export function serialUsbId(port: SerialPort): string | undefined {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === undefined || usbProductId === undefined ? undefined : formatUsbId(usbVendorId, usbProductId);
}

export async function connectSerial(opts: SerialConnectorOptions): Promise<Transport> {
  const port = opts.port ?? (await pickPort());
  await opts.beforeOpen();
  const baudRate = opts.baudRate ?? DEFAULT_BAUD_RATE;
  try {
    await port.open({ baudRate });
  } catch (e) {
    if (errorName(e) === 'NetworkError' || errorName(e) === 'InvalidStateError') throw new PortBusyError();
    throw e;
  }
  try {
    await port.setSignals({ dataTerminalReady: true });
  } catch {
    /* not every port has the line, and a modem that needs it stays silent, which the scan reports */
  }
  const transport = new WebSerialTransport(port, baudRate, serialUsbId(port));
  transport.start();
  return transport;
}
