import { matchProfile } from '../profiles';
import { classifyUsbDevice } from '../profiles/known-devices';
import type { DeviceClassification } from '../profiles/known-devices';
import { PickerCancelledError } from './types';
import type { Transport, UsbConnectorOptions } from './types';
import { errorMessage, errorName, formatUsbId, TransportListeners } from './common';

const CLAIM_TIMEOUT_MS = 3000;
const USB_CALL_TIMEOUT_MS = 2000;
/** `open` is not known to hang, but a hang here would disable the connect buttons for good. */
const OPEN_TIMEOUT_MS = 5000;
const PROBE_REPLY_TIMEOUT_MS = 2000;
const READ_BUFFER_BYTES = 4096;
const CLASS_CDC_COMMUNICATIONS = 0x02;
const CLASS_CDC_DATA = 0x0a;
const SUBCLASS_CDC_ACM = 0x02;
const SET_CONTROL_LINE_STATE = 0x22;
const CONTROL_LINE_DTR = 1;
const PROBE_COMMAND = Uint8Array.of(0x41, 0x54, 0x0d); // "AT\r", the only bytes a transport sends itself
const OK_LINE = /(?:^|[\r\n])OK[\r\n]/;
const HELP_POINTER = 'See "Can\'t see your modem?" below.';

export interface UsbCandidate {
  interfaceNumber: number;
  alternateSetting: number;
  inEndpoint: number;
  outEndpoint: number;
  /** Packet size of the OUT endpoint, the largest single write. */
  packetSize: number;
  /** Packet size of the IN endpoint, the smallest read. */
  inPacketSize: number;
}

/** No AT channel could be opened. The message is meant for the person at the screen. */
export class NoAtChannelError extends Error {
  constructor(
    message: string,
    /** See `Transport.hadPendingClaim`. */
    readonly hadPendingClaim: boolean,
    /** Set when the device was recognised as one without an AT channel; nothing was claimed. */
    readonly classification?: DeviceClassification,
  ) {
    super(message);
    this.name = 'NoAtChannelError';
  }
}

class UsbTimeoutError extends Error {
  constructor(operation: string) {
    super(`USB ${operation} timed out`);
    this.name = 'UsbTimeoutError';
  }
}

function withTimeout<T>(call: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UsbTimeoutError(operation)), ms);
  });
  return Promise.race([call, expired]).finally(() => clearTimeout(timer));
}

/** For calls whose failure changes nothing, such as a close while a claim is pending. */
async function attempt(call: () => Promise<unknown>, operation: string): Promise<void> {
  try {
    await withTimeout(call(), USB_CALL_TIMEOUT_MS, operation);
  } catch {
    /* measured on Windows: InvalidStateError while another claim is pending */
  }
}

export function usbId(device: USBDevice): string {
  return formatUsbId(device.vendorId, device.productId);
}

function interfacesOf(device: USBDevice): USBInterface[] {
  return (device.configuration ?? device.configurations[0])?.interfaces ?? [];
}

function classifyOpened(device: USBDevice, id: string): DeviceClassification {
  const alternates = interfacesOf(device).flatMap((i) => i.alternates);
  return classifyUsbDevice({
    usb: id,
    interfaceClasses: [...new Set(alternates.map((a) => a.interfaceClass))],
    hasAcm: alternates.some((a) => a.interfaceClass === CLASS_CDC_COMMUNICATIONS && a.interfaceSubclass === SUBCLASS_CDC_ACM),
  });
}

function bulkEndpoint(alternate: USBAlternateInterface, direction: USBDirection): USBEndpoint | undefined {
  return alternate.endpoints.find((e) => e.type === 'bulk' && e.direction === direction && e.packetSize > 0);
}

/** One candidate per interface, using the first alternate setting that has a bulk pair. */
export function listCandidates(device: USBDevice, avoid: number[] = []): UsbCandidate[] {
  const candidates: UsbCandidate[] = [];
  for (const { interfaceNumber, alternates } of interfacesOf(device)) {
    if (avoid.includes(interfaceNumber)) continue;
    for (const alternate of alternates) {
      const inEndpoint = bulkEndpoint(alternate, 'in');
      const outEndpoint = bulkEndpoint(alternate, 'out');
      if (!inEndpoint || !outEndpoint) continue;
      candidates.push({
        interfaceNumber,
        alternateSetting: alternate.alternateSetting,
        inEndpoint: inEndpoint.endpointNumber,
        outEndpoint: outEndpoint.endpointNumber,
        packetSize: outEndpoint.packetSize,
        inPacketSize: inEndpoint.packetSize,
      });
      break;
    }
  }
  return candidates;
}

function readLength(c: UsbCandidate): number {
  return Math.ceil(READ_BUFFER_BYTES / c.inPacketSize) * c.inPacketSize;
}

function bytesOf(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * A timeout here means the browser still holds the claim as pending. So does `InvalidStateError` from
 * `claimInterface`: on a retry without replug, Chromium rejects at once while the first claim is pending.
 */
async function claim(device: USBDevice, c: UsbCandidate): Promise<void> {
  try {
    await withTimeout(device.claimInterface(c.interfaceNumber), CLAIM_TIMEOUT_MS, 'claimInterface');
  } catch (e) {
    throw errorName(e) === 'InvalidStateError' ? new UsbTimeoutError('claimInterface') : e;
  }
  if (c.alternateSetting === 0) return;
  try {
    await withTimeout(device.selectAlternateInterface(c.interfaceNumber, c.alternateSetting), USB_CALL_TIMEOUT_MS, 'selectAlternateInterface');
  } catch (e) {
    await attempt(() => device.releaseInterface(c.interfaceNumber), 'releaseInterface');
    throw e;
  }
}

/** Sends `AT\r` once. On `true` no read is left pending, so the caller can start its own. */
async function answersAt(device: USBDevice, c: UsbCandidate, timeoutMs: number): Promise<boolean> {
  let stopped = false;
  let finish!: (answered: boolean) => void;
  const answered = new Promise<boolean>((resolve) => (finish = resolve));
  const timer = setTimeout(() => finish(false), timeoutMs);
  const read = async (): Promise<void> => {
    let seen = '';
    while (!stopped) {
      const r = await device.transferIn(c.inEndpoint, readLength(c));
      if (stopped) return;
      if (r.status !== 'ok') return finish(false);
      if (r.data) seen = (seen + new TextDecoder('latin1').decode(bytesOf(r.data))).slice(-64);
      if (OK_LINE.test(seen)) {
        stopped = true;
        return finish(true);
      }
    }
  };
  read().catch(() => finish(false));
  try {
    const written = await withTimeout(device.transferOut(c.outEndpoint, PROBE_COMMAND), USB_CALL_TIMEOUT_MS, 'transferOut');
    if (written.status !== 'ok') finish(false);
  } catch {
    finish(false);
  }
  const result = await answered;
  stopped = true;
  clearTimeout(timer);
  return result;
}

/** Tries the candidates in order. The interface it returns stays claimed. */
export async function findAtInterface(
  device: USBDevice,
  candidates: UsbCandidate[],
  opts: { timeoutMs?: number; onProbe?: (i: number) => void; onClaimTimeout?: (i: number) => void } = {},
): Promise<UsbCandidate | null> {
  for (const c of candidates) {
    opts.onProbe?.(c.interfaceNumber);
    try {
      await claim(device, c);
    } catch (e) {
      if (e instanceof UsbTimeoutError) opts.onClaimTimeout?.(c.interfaceNumber);
      continue;
    }
    if (await answersAt(device, c, opts.timeoutMs ?? PROBE_REPLY_TIMEOUT_MS)) return c;
    await attempt(() => device.releaseInterface(c.interfaceNumber), 'releaseInterface');
  }
  return null;
}

/** CDC expects line-state requests on the communications interface, not on the data interface. */
function dtrInterface(device: USBDevice, c: UsbCandidate): number {
  const interfaces = interfacesOf(device);
  const chosen = interfaces.find((i) => i.interfaceNumber === c.interfaceNumber);
  const isCdcData = chosen?.alternates.find((a) => a.alternateSetting === c.alternateSetting)?.interfaceClass === CLASS_CDC_DATA;
  if (!isCdcData) return c.interfaceNumber;
  const communications = interfaces
    .filter((i) => i.interfaceNumber < c.interfaceNumber && i.alternates.some((a) => a.interfaceClass === CLASS_CDC_COMMUNICATIONS))
    .map((i) => i.interfaceNumber);
  return communications.length ? Math.max(...communications) : c.interfaceNumber;
}

async function raiseDtr(device: USBDevice, c: UsbCandidate): Promise<void> {
  const setup: USBControlTransferParameters = {
    requestType: 'class',
    recipient: 'interface',
    request: SET_CONTROL_LINE_STATE,
    value: CONTROL_LINE_DTR,
    index: dtrInterface(device, c),
  };
  await attempt(() => device.controlTransferOut(setup), 'controlTransferOut');
}

class WebUsbTransport implements Transport {
  readonly kind = 'usb' as const;
  private readonly events = new TransportListeners();
  private closing: Promise<void> | null = null;

  constructor(
    private readonly device: USBDevice,
    private readonly channel: UsbCandidate,
    readonly label: string,
    readonly usbId: string,
    readonly hadPendingClaim: boolean,
  ) {}

  start(): void {
    navigator.usb.addEventListener('disconnect', this.handleUnplug);
    void this.readLoop();
  }

  async write(data: Uint8Array): Promise<void> {
    const { outEndpoint, packetSize } = this.channel;
    for (let offset = 0; offset < data.length; offset += packetSize) {
      if (this.closing) throw new Error('The USB connection is closed.');
      const chunk = data.slice(offset, offset + packetSize);
      const r = await withTimeout(this.device.transferOut(outEndpoint, chunk), USB_CALL_TIMEOUT_MS, 'transferOut');
      if (r.status !== 'ok') throw new Error(`USB write failed: ${r.status}`);
    }
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

  private readonly handleUnplug = (e: USBConnectionEvent): void => {
    if (e.device === this.device) this.lose('the modem was unplugged or restarted');
  };

  private lose(reason: string): void {
    if (this.closing) return;
    navigator.usb.removeEventListener('disconnect', this.handleUnplug);
    this.events.lost(reason);
  }

  private async readLoop(): Promise<void> {
    const length = readLength(this.channel);
    while (!this.closing) {
      let r: USBInTransferResult;
      try {
        r = await this.device.transferIn(this.channel.inEndpoint, length);
      } catch (e) {
        this.lose(errorMessage(e));
        return;
      }
      if (this.closing) return;
      if (r.status !== 'ok') {
        this.lose(`USB read failed: ${r.status}`);
        return;
      }
      if (r.data?.byteLength) this.events.data(bytesOf(r.data));
    }
  }

  /** Never rejects. Measured on Windows: with a claim still pending, these calls fail. */
  private async shutdown(): Promise<void> {
    navigator.usb.removeEventListener('disconnect', this.handleUnplug);
    await attempt(() => this.device.releaseInterface(this.channel.interfaceNumber), 'releaseInterface');
    await attempt(() => this.device.close(), 'close');
  }
}

async function pickDevice(): Promise<USBDevice> {
  try {
    return await navigator.usb.requestDevice({ filters: [] });
  } catch (e) {
    if (errorName(e) === 'NotFoundError') throw new PickerCancelledError();
    throw e;
  }
}

async function ensureConfigured(device: USBDevice): Promise<void> {
  if (device.configuration) return;
  const first = device.configurations[0];
  if (!first) throw new Error('This USB device has no configuration.');
  await withTimeout(device.selectConfiguration(first.configurationValue), USB_CALL_TIMEOUT_MS, 'selectConfiguration');
}

/** Only that one interface is touched: claiming any other can leave a claim pending for good. */
async function claimKnownInterface(device: USBDevice, atInterface: number): Promise<UsbCandidate> {
  const c = listCandidates(device).find((x) => x.interfaceNumber === atInterface);
  if (!c) throw new NoAtChannelError(`This modem has no usable AT interface ${atInterface}. ${HELP_POINTER}`, false);
  try {
    await claim(device, c);
  } catch (e) {
    if (e instanceof UsbTimeoutError) {
      throw new NoAtChannelError(`The modem's AT interface (${atInterface}) does not respond. On Windows it needs the WinUSB driver. ${HELP_POINTER}`, true);
    }
    throw new NoAtChannelError(`Could not use the modem's AT interface (${atInterface}): ${errorMessage(e)}. Another program may be using it. ${HELP_POINTER}`, false);
  }
  return c;
}

async function chooseChannel(device: USBDevice, opts: UsbConnectorOptions, id: string): Promise<{ channel: UsbCandidate; pendingClaim: boolean }> {
  const usb = matchProfile({ usb: id })?.usb;
  if (usb?.atInterface !== undefined) return { channel: await claimKnownInterface(device, usb.atInterface), pendingClaim: false };
  let pendingClaim = false;
  const channel = await findAtInterface(device, listCandidates(device, usb?.avoidInterfaces), {
    onProbe: opts.onProbe,
    onClaimTimeout: () => (pendingClaim = true),
  });
  if (!channel) throw new NoAtChannelError(`No AT channel found on this modem. ${HELP_POINTER}`, pendingClaim);
  return { channel, pendingClaim };
}

export async function connectUsb(opts: UsbConnectorOptions): Promise<Transport> {
  const device = opts.device ?? (await pickDevice());
  await opts.beforeOpen();
  // After a close that failed the device is still open, and open() would fail while a claim is pending.
  if (!device.opened) await withTimeout(device.open(), OPEN_TIMEOUT_MS, 'open');
  try {
    await ensureConfigured(device);
    const id = usbId(device);
    const classification = classifyOpened(device, id);
    if (classification.kind !== 'at' && classification.kind !== 'unknown') {
      throw new NoAtChannelError('This device has no AT channel.', false, classification);
    }
    const { channel, pendingClaim } = await chooseChannel(device, opts, id);
    await raiseDtr(device, channel);
    const name = device.productName ? `${device.productName} ` : '';
    const transport = new WebUsbTransport(device, channel, `${name}(${id}), USB interface ${channel.interfaceNumber}`, id, pendingClaim);
    transport.start();
    return transport;
  } catch (e) {
    await attempt(() => device.close(), 'close');
    throw e;
  }
}
