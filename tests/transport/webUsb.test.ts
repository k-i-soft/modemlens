import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectUsb, findAtInterface, listCandidates, NoAtChannelError, usbId } from '../../src/transport/webUsb';
import { PickerCancelledError } from '../../src/transport/types';
import { PROFILES } from '../../src/profiles';

const noop = () => Promise.resolve();
const tick = () => new Promise((r) => setTimeout(r, 0));
const OK_REPLY = 'AT\r\r\nOK\r\n';
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (d: AllowSharedBufferSource) => new TextDecoder().decode(d);

interface FakeEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: string; packetSize: number }
interface FakeAlternate { alternateSetting: number; interfaceClass: number; interfaceSubclass?: number; endpoints: FakeEndpoint[] }
interface FakeInterface { interfaceNumber: number; alternates: FakeAlternate[] }

const bulk = (inEp: number, outEp: number, packetSize = 512): FakeEndpoint[] => [
  { endpointNumber: inEp, direction: 'in', type: 'bulk', packetSize },
  { endpointNumber: outEp, direction: 'out', type: 'bulk', packetSize },
];
const iface = (interfaceNumber: number, interfaceClass: number, endpoints: FakeEndpoint[]): FakeInterface => ({
  interfaceNumber,
  alternates: [{ alternateSetting: 0, interfaceClass, endpoints }],
});

/** The descriptor layout measured on a real EC200A. */
const ec200aInterfaces = (): FakeInterface[] => [
  iface(0, 0x02, [{ endpointNumber: 4, direction: 'in', type: 'interrupt', packetSize: 16 }]),
  {
    interfaceNumber: 1,
    alternates: [
      { alternateSetting: 0, interfaceClass: 0x0a, endpoints: [] },
      { alternateSetting: 1, interfaceClass: 0x0a, endpoints: bulk(3, 12) },
    ],
  },
  iface(2, 0xff, bulk(2, 11)),
  iface(3, 0xff, bulk(6, 15)),
  iface(4, 0xff, bulk(1, 10)),
];

type Claim = 'ok' | 'hang' | 'fail';

class FakeDevice {
  vendorId = 0x1234;
  productId = 0xabcd;
  productName: string | undefined = 'Test modem';
  opened = false;
  configuration: { interfaces: FakeInterface[] } | null = null;
  configurations: Array<{ configurationValue: number; interfaces: FakeInterface[] }>;
  calls: string[] = [];
  writes: Array<{ ep: number; data: string }> = [];
  controls: USBControlTransferParameters[] = [];
  readLengths: number[] = [];
  claims = new Map<number, Claim>();
  hungClaims = new Set<number>();
  answering = new Set<number>();
  closeError: Error | null = null;
  releaseError: Error | null = null;
  controlError: Error | null = null;
  hangTransferOut = false;
  hangClose = false;
  transferOutResult: USBTransferStatus = 'ok';
  pendingReads = new Map<number, Array<{ resolve: (r: unknown) => void; reject: (e: Error) => void }>>();
  inbox = new Map<number, string[]>();

  constructor(interfaces: FakeInterface[], opts: { configured?: boolean } = {}) {
    const config = { configurationValue: 1, interfaces };
    this.configurations = [config];
    if (opts.configured !== false) this.configuration = config;
  }

  private ifaceOfEndpoint(ep: number): FakeInterface | undefined {
    return this.configurations[0].interfaces.find((i) => i.alternates.some((a) => a.endpoints.some((e) => e.endpointNumber === ep)));
  }

  async open() { this.calls.push('open'); this.opened = true; }
  async close() {
    this.calls.push('close');
    if (this.hangClose) return new Promise<void>(() => {});
    if (this.closeError) throw this.closeError;
    this.opened = false;
    this.failReads(new DOMException('closed', 'AbortError'));
  }
  async selectConfiguration(v: number) {
    this.calls.push(`config:${v}`);
    this.configuration = this.configurations[0];
  }
  claimInterface(n: number): Promise<void> {
    this.calls.push(`claim:${n}`);
    const how = this.claims.get(n) ?? 'ok';
    if (how === 'hang') {
      // As in Chromium: while the first claim is pending, a second one is refused at once.
      if (this.hungClaims.has(n)) return Promise.reject(new DOMException('An operation that changes interface state is in progress.', 'InvalidStateError'));
      this.hungClaims.add(n);
      return new Promise(() => {});
    }
    if (how === 'fail') return Promise.reject(new DOMException('Unable to claim interface', 'NetworkError'));
    return Promise.resolve();
  }
  async releaseInterface(n: number) {
    this.calls.push(`release:${n}`);
    if (this.releaseError) throw this.releaseError;
    for (const alt of this.configurations[0].interfaces.find((i) => i.interfaceNumber === n)?.alternates ?? []) {
      for (const e of alt.endpoints) {
        if (e.direction === 'in') this.failReads(new DOMException('released', 'AbortError'), e.endpointNumber);
      }
    }
  }
  async selectAlternateInterface(n: number, alt: number) { this.calls.push(`alt:${n}:${alt}`); }
  async controlTransferOut(setup: USBControlTransferParameters) {
    this.calls.push('control');
    this.controls.push(setup);
    if (this.controlError) throw this.controlError;
    return { status: 'ok', bytesWritten: 0 };
  }
  transferOut(ep: number, data: BufferSource) {
    if (this.hangTransferOut) return new Promise(() => {});
    this.writes.push({ ep, data: text(data) });
    const owner = this.ifaceOfEndpoint(ep);
    if (owner && this.answering.has(owner.interfaceNumber)) {
      const inEp = owner.alternates.flatMap((a) => a.endpoints).find((e) => e.direction === 'in')!;
      this.feed(inEp.endpointNumber, OK_REPLY);
    }
    return Promise.resolve({ status: this.transferOutResult, bytesWritten: (data as Uint8Array).byteLength });
  }
  transferIn(ep: number, length: number) {
    this.readLengths.push(length);
    const queued = this.inbox.get(ep)?.shift();
    if (queued !== undefined) return Promise.resolve(this.okRead(queued));
    return new Promise((resolve, reject) => {
      const list = this.pendingReads.get(ep) ?? [];
      list.push({ resolve, reject });
      this.pendingReads.set(ep, list);
    });
  }
  private okRead(s: string) {
    const b = bytes(s);
    return { status: 'ok', data: new DataView(b.buffer, b.byteOffset, b.byteLength) };
  }
  /** Data arriving from the modem on an IN endpoint. */
  feed(ep: number, s: string) {
    const waiting = this.pendingReads.get(ep)?.shift();
    if (waiting) waiting.resolve(this.okRead(s));
    else this.inbox.set(ep, [...(this.inbox.get(ep) ?? []), s]);
  }
  failReads(e: Error, ep?: number) {
    for (const [key, list] of this.pendingReads) {
      if (ep !== undefined && key !== ep) continue;
      for (const r of list) r.reject(e);
      this.pendingReads.set(key, []);
    }
  }
  resolveRead(ep: number, result: unknown) {
    this.pendingReads.get(ep)?.shift()?.resolve(result);
  }
  pendingReadCount(ep: number) { return this.pendingReads.get(ep)?.length ?? 0; }
  claimCalls() { return this.calls.filter((c) => c.startsWith('claim:')); }
  get asDevice() { return this as unknown as USBDevice; }
}

function ec200a() {
  const d = new FakeDevice(ec200aInterfaces());
  d.vendorId = 0x2c7c;
  d.productId = 0x6005;
  d.productName = 'Android';
  return d;
}

/** Two vendor interfaces of a modem without a profile. */
function unknownModem(...answering: number[]) {
  const d = new FakeDevice([iface(0, 0xff, bulk(1, 1)), iface(1, 0xff, bulk(2, 2)), iface(2, 0xff, bulk(3, 3))]);
  for (const a of answering) d.answering.add(a);
  return d;
}

let usb: EventTarget & { requestDevice: ReturnType<typeof vi.fn> };

beforeEach(() => {
  usb = Object.assign(new EventTarget(), { requestDevice: vi.fn() });
  (navigator as any).usb = usb;
});
afterEach(() => {
  vi.useRealTimers();
  delete (navigator as any).usb;
});

function fireDisconnect(device: unknown): void {
  const e = new Event('disconnect');
  (e as any).device = device;
  usb.dispatchEvent(e);
}

describe('usbId', () => {
  test('is plain lowercase vvvv:pppp with leading zeros', () => {
    const d = new FakeDevice([]);
    d.vendorId = 0x2c7c;
    d.productId = 0x00ab;
    expect(usbId(d.asDevice)).toBe('2c7c:00ab');
  });
});

describe('listCandidates', () => {
  test('usb lists only bulk in+out interfaces', () => {
    const d = new FakeDevice([
      iface(0, 0x02, [{ endpointNumber: 1, direction: 'in', type: 'interrupt', packetSize: 16 }]),
      iface(1, 0xff, [{ endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }]),
      iface(2, 0xff, bulk(3, 4, 64)),
    ]);
    expect(listCandidates(d.asDevice).map((c) => c.interfaceNumber)).toEqual([2]);
    expect(listCandidates(d.asDevice)[0]).toMatchObject({ inEndpoint: 3, outEndpoint: 4, packetSize: 64 });
  });

  test('usb skips avoided interfaces', () => {
    expect(listCandidates(ec200a().asDevice, [2, 4]).map((c) => c.interfaceNumber)).toEqual([1, 3]);
  });

  test('picks the alternate setting that has the bulk pair', () => {
    expect(listCandidates(ec200a().asDevice).find((c) => c.interfaceNumber === 1)).toMatchObject({
      alternateSetting: 1,
      inEndpoint: 3,
      outEndpoint: 12,
    });
  });

  test('ignores an endpoint with a zero packet size', () => {
    const d = new FakeDevice([iface(0, 0xff, bulk(1, 1, 0))]);
    expect(listCandidates(d.asDevice)).toEqual([]);
  });
});

describe('findAtInterface', () => {
  test('usb probe stops at first OK and keeps that interface claimed', async () => {
    const d = unknownModem(1, 2);
    const probed: number[] = [];
    const hit = await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5, onProbe: (i) => probed.push(i) });
    expect(hit?.interfaceNumber).toBe(1);
    expect(probed).toEqual([0, 1]);
    expect(d.calls).toEqual(['claim:0', 'release:0', 'claim:1']);
  });

  test('usb probe sends only AT\\r', async () => {
    const d = unknownModem(2);
    await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(d.writes.length).toBe(3);
    expect(new Set(d.writes.map((w) => w.data))).toEqual(new Set(['AT\r']));
  });

  test('usb probe survives claim failure', async () => {
    const d = unknownModem(1);
    d.claims.set(0, 'fail');
    const hit = await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(hit?.interfaceNumber).toBe(1);
  });

  test('usb probe survives a claim that never resolves', async () => {
    vi.useFakeTimers();
    const d = unknownModem(1);
    d.claims.set(0, 'hang');
    const timedOut: number[] = [];
    const pending = findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5, onClaimTimeout: (i) => timedOut.push(i) });
    await vi.advanceTimersByTimeAsync(2999);
    expect(d.claimCalls()).toEqual(['claim:0']);
    await vi.advanceTimersByTimeAsync(1);
    const hit = await pending;
    expect(hit?.interfaceNumber).toBe(1);
    expect(timedOut).toEqual([0]);
  });

  test('usb probe returns null when silent', async () => {
    const d = unknownModem();
    expect(await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 })).toBeNull();
    expect(d.calls.filter((c) => c.startsWith('release:'))).toEqual(['release:0', 'release:1', 'release:2']);
  });

  test('an OK split over two reads still counts, a word containing OK does not', async () => {
    const d = new FakeDevice([iface(0, 0xff, bulk(1, 1)), iface(1, 0xff, bulk(2, 2))]);
    d.feed(1, 'BOOK\r\n');
    d.feed(2, '\r\nO');
    d.feed(2, 'K\r\n');
    const hit = await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(hit?.interfaceNumber).toBe(1);
  });

  test('leaves no read pending on the interface it returns', async () => {
    const d = unknownModem(0);
    await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(d.pendingReadCount(1)).toBe(0);
  });

  test('a release that fails does not stop the probe', async () => {
    const d = unknownModem(1);
    d.releaseError = new DOMException('busy', 'InvalidStateError');
    const hit = await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(hit?.interfaceNumber).toBe(1);
  });

  test('releases the interface when selecting its alternate setting fails', async () => {
    const d = new FakeDevice([
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, endpoints: [] }, { alternateSetting: 2, interfaceClass: 0xff, endpoints: bulk(1, 1) }] },
    ]);
    d.selectAlternateInterface = () => Promise.reject(new DOMException('claim pending', 'InvalidStateError'));
    expect(await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 })).toBeNull();
    expect(d.calls).toEqual(['claim:0', 'release:0']);
  });

  test('selects the alternate setting after claiming', async () => {
    const d = new FakeDevice([
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, endpoints: [] }, { alternateSetting: 2, interfaceClass: 0xff, endpoints: bulk(1, 1) }] },
    ]);
    d.answering.add(0);
    await findAtInterface(d.asDevice, listCandidates(d.asDevice), { timeoutMs: 5 });
    expect(d.calls).toEqual(['claim:0', 'alt:0:2']);
  });
});

describe('connectUsb', () => {
  test('picks with no filters first, then beforeOpen, then opens', async () => {
    const d = ec200a();
    const order: string[] = [];
    usb.requestDevice.mockImplementation(async (o: USBDeviceRequestOptions) => {
      expect(o).toEqual({ filters: [] });
      order.push('pick');
      return d.asDevice;
    });
    const realOpen = d.open.bind(d);
    d.open = async () => { order.push('open'); await realOpen(); };
    const t = await connectUsb({ beforeOpen: async () => { order.push('beforeOpen'); } });
    expect(order).toEqual(['pick', 'beforeOpen', 'open']);
    await t.close();
  });

  test('asks for the device inside the user gesture, before any await', () => {
    usb.requestDevice.mockReturnValue(new Promise(() => {}));
    void connectUsb({ beforeOpen: noop });
    expect(usb.requestDevice).toHaveBeenCalledTimes(1);
  });

  test('a given device skips the picker', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    expect(usb.requestDevice).not.toHaveBeenCalled();
    await t.close();
  });

  test('a cancelled picker rejects without calling beforeOpen', async () => {
    usb.requestDevice.mockRejectedValue(new DOMException('No device selected', 'NotFoundError'));
    const beforeOpen = vi.fn(noop);
    await expect(connectUsb({ beforeOpen })).rejects.toBeInstanceOf(PickerCancelledError);
    expect(beforeOpen).not.toHaveBeenCalled();
  });

  test('a device that has vanished is an error, not a cancelled picker', async () => {
    const d = ec200a();
    d.open = () => Promise.reject(new DOMException('gone', 'NotFoundError'));
    const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    expect(err).not.toBeInstanceOf(PickerCancelledError);
    expect(err.message).toBe('gone');
  });

  describe('devices without an AT channel', () => {
    const noClaims = (d: FakeDevice) => expect(d.calls.filter((c) => /^(claim|release|alt|control)/.test(c))).toEqual([]);
    const stick = (vendorId: number, productId: number, interfaces: FakeInterface[]) => {
      const d = new FakeDevice(interfaces);
      d.vendorId = vendorId;
      d.productId = productId;
      return d;
    };

    test('storage mode rejects with its classification and claims nothing', async () => {
      const d = stick(0x12d1, 0x1f01, [iface(0, 0x08, bulk(1, 2))]);
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err).toBeInstanceOf(NoAtChannelError);
      expect(err.classification).toMatchObject({ kind: 'storage', usb: '12d1:1f01' });
      expect(err.hadPendingClaim).toBe(false);
      noClaims(d);
      expect(d.calls).toContain('close');
      expect(d.opened).toBe(false);
    });

    test('the error describes the device', async () => {
      const d = stick(0x12d1, 0x1f01, [
        { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xe0, interfaceSubclass: 1, endpoints: [] }] },
        { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 0x08, interfaceSubclass: 6, endpoints: bulk(1, 2) }] },
      ]);
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err.device).toEqual({
        usb: '12d1:1f01',
        productName: 'Test modem',
        interfaces: [{ number: 0, class: 0xe0, subclass: 1 }, { number: 1, class: 0x08, subclass: 6 }],
      });
    });

    test('a device without a name has no productName', async () => {
      const d = stick(0x12d1, 0x1f01, [iface(0, 0x08, bulk(1, 2))]);
      d.productName = undefined;
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err.device).not.toHaveProperty('productName');
    });

    test('a failed probe also describes the device', async () => {
      const d = stick(0xdead, 0xbeef, [iface(0, 0xff, bulk(1, 2))]);
      d.claims.set(0, 'fail');
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err).toBeInstanceOf(NoAtChannelError);
      expect(err.classification).toBeUndefined();
      expect(err.device.usb).toBe('dead:beef');
      expect(err.device.interfaces).toHaveLength(1);
    });

    test('a network stick rejects with the address and claims nothing', async () => {
      const d = stick(0x12d1, 0x14db, [iface(0, 0xe0, []), iface(1, 0x0a, bulk(1, 2))]);
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err.classification).toMatchObject({ kind: 'network-web', webDialect: 'hilink', webAddress: '192.168.8.1' });
      noClaims(d);
      expect(d.opened).toBe(false);
    });

    test('beforeOpen still runs before the device is classified and opened', async () => {
      const d = stick(0x2ecc, 0x3001, [iface(0, 0x08, bulk(1, 2))]);
      const order: string[] = [];
      const realOpen = d.open.bind(d);
      d.open = async () => { order.push('open'); await realOpen(); };
      await connectUsb({ beforeOpen: async () => { order.push('beforeOpen'); }, device: d.asDevice }).catch(() => {});
      expect(order).toEqual(['beforeOpen', 'open']);
    });

    test('an unknown device with a CDC ACM interface is probed as an AT candidate', async () => {
      const d = stick(0x1234, 0xabcd, [
        { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x02, interfaceSubclass: 0x02, endpoints: [] }] },
        iface(1, 0x0a, bulk(1, 2)),
      ]);
      d.answering.add(1);
      const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
      expect(d.claimCalls()).toEqual(['claim:1']);
      await t.close();
    });

    test('an unknown device with only network classes and no ACM does not get probed', async () => {
      const d = stick(0x1234, 0xabcd, [iface(0, 0x02, []), iface(1, 0x0a, bulk(1, 2))]);
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(err.classification.kind).toBe('network-web');
      noClaims(d);
    });

    test('a device with an unrecognised layout is still probed', async () => {
      const d = stick(0x1234, 0xabcd, [iface(0, 0x03, bulk(1, 2))]);
      const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
      expect(d.claimCalls()).toEqual(['claim:0']);
      expect(err.classification).toBeUndefined();
    });
  });

  test('profile says the AT interface is 3', () => {
    expect(PROFILES.find((p) => p.id === 'quectel-ec200a')?.usb).toEqual({ atInterface: 3, avoidInterfaces: [2, 4] });
  });

  test('known profile claims only the AT interface', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    expect(d.claimCalls()).toEqual(['claim:3']);
    await t.close();
  });

  test('usb uses profile interface without probing', async () => {
    const d = ec200a();
    const onProbe = vi.fn();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice, onProbe });
    await tick();
    expect(d.writes).toEqual([]);
    expect(onProbe).not.toHaveBeenCalled();
    expect(t.usbId).toBe('2c7c:6005');
    expect(t.hadPendingClaim).toBe(false);
    await t.close();
  });

  test('a hanging claim on the known interface rejects and asks for a replug', async () => {
    vi.useFakeTimers();
    const d = ec200a();
    d.claims.set(3, 'hang');
    const result = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000 + 2000);
    const err = await result;
    expect(err).toBeInstanceOf(NoAtChannelError);
    expect(err.hadPendingClaim).toBe(true);
    expect(err.message).toContain('WinUSB');
    expect(d.claimCalls()).toEqual(['claim:3']);
  });

  test('a retry without replug on the known interface still asks for a replug', async () => {
    vi.useFakeTimers();
    const d = ec200a();
    d.claims.set(3, 'hang');
    d.closeError = new DOMException('claim pending', 'InvalidStateError');
    const first = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000 + 2000);
    expect((await first).hadPendingClaim).toBe(true);
    const second = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2000);
    const err = await second;
    expect(err).toBeInstanceOf(NoAtChannelError);
    expect(err.hadPendingClaim).toBe(true);
    expect(err.message).not.toContain('Another program');
    expect(d.calls.filter((c) => c === 'open')).toHaveLength(1);
  });

  test('a retry without replug while probing still asks for a replug', async () => {
    vi.useFakeTimers();
    const d = unknownModem();
    d.claims.set(0, 'hang');
    d.closeError = new DOMException('claim pending', 'InvalidStateError');
    const first = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20000);
    expect((await first).hadPendingClaim).toBe(true);
    const second = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20000);
    const err = await second;
    expect(err).toBeInstanceOf(NoAtChannelError);
    expect(err.hadPendingClaim).toBe(true);
    expect(d.claimCalls().filter((c) => c === 'claim:0')).toHaveLength(2);
  });

  test('a refused claim on the known interface does not ask for a replug', async () => {
    const d = ec200a();
    d.claims.set(3, 'fail');
    const err = await connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    expect(err).toBeInstanceOf(NoAtChannelError);
    expect(err.hadPendingClaim).toBe(false);
    expect(d.calls).toContain('close');
  });

  test('an open that never settles rejects instead of blocking the buttons for good', async () => {
    vi.useFakeTimers();
    const d = ec200a();
    d.open = () => new Promise(() => {});
    const result = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeInstanceOf(Error);
  });

  test('selects a configuration only when none is active', async () => {
    const active = ec200a();
    const t1 = await connectUsb({ beforeOpen: noop, device: active.asDevice });
    expect(active.calls.some((c) => c.startsWith('config:'))).toBe(false);
    await t1.close();

    const fresh = new FakeDevice(ec200aInterfaces(), { configured: false });
    fresh.vendorId = 0x2c7c;
    fresh.productId = 0x6005;
    const t2 = await connectUsb({ beforeOpen: noop, device: fresh.asDevice });
    expect(fresh.calls).toContain('config:1');
    await t2.close();
  });

  test('does not reopen a device that is still open', async () => {
    const d = ec200a();
    d.opened = true;
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    expect(d.calls).not.toContain('open');
    await t.close();
  });

  test('an unknown modem is probed and reports each interface', async () => {
    vi.useFakeTimers();
    const d = unknownModem(1);
    const probed: number[] = [];
    const pending = connectUsb({ beforeOpen: noop, device: d.asDevice, onProbe: (i) => probed.push(i) });
    await vi.advanceTimersByTimeAsync(2000);
    const t = await pending;
    expect(probed).toEqual([0, 1]);
    expect(t.label).toContain('interface 1');
    vi.useRealTimers();
    await t.close();
  });

  test('pending claim asks for replug before next connect', async () => {
    vi.useFakeTimers();
    const d = unknownModem(1);
    d.claims.set(0, 'hang');
    const pending = connectUsb({ beforeOpen: noop, device: d.asDevice });
    await vi.advanceTimersByTimeAsync(3000 + 2000);
    const t = await pending;
    expect(t.hadPendingClaim).toBe(true);
    vi.useRealTimers();
    await t.close();
  });

  test('nothing answers: closes and rejects, pointing at the help panel', async () => {
    vi.useFakeTimers();
    const d = unknownModem();
    d.claims.set(0, 'hang');
    const result = connectUsb({ beforeOpen: noop, device: d.asDevice }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20000);
    const err = await result;
    expect(err).toBeInstanceOf(NoAtChannelError);
    expect(err.hadPendingClaim).toBe(true);
    expect(err.message).toContain('No AT channel found');
    expect(err.message).toContain("Can't see your modem");
    expect(d.calls).toContain('close');
  });

  test('close failure does not reject', async () => {
    const d = ec200a();
    d.closeError = new DOMException('claim pending', 'InvalidStateError');
    d.releaseError = new DOMException('claim pending', 'InvalidStateError');
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    await expect(t.close()).resolves.toBeUndefined();
  });

  test('a close that never settles is given up on after its timeout', async () => {
    vi.useFakeTimers();
    const d = ec200a();
    d.hangClose = true;
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const done = t.close();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBeUndefined();
  });

  test('usb raises DTR via control transfer, once', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    expect(d.controls).toEqual([{ requestType: 'class', recipient: 'interface', request: 0x22, value: 1, index: 3 }]);
    await t.close();
  });

  test('DTR on a CDC data interface goes to the preceding communications interface', async () => {
    const acm: FakeInterface = {
      interfaceNumber: 0,
      alternates: [{ alternateSetting: 0, interfaceClass: 0x02, interfaceSubclass: 0x02, endpoints: [{ endpointNumber: 1, direction: 'in', type: 'interrupt', packetSize: 16 }] }],
    };
    const d = new FakeDevice([acm, iface(1, 0x0a, bulk(2, 2))]);
    d.answering.add(1);
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    expect(d.controls).toHaveLength(1);
    expect(d.controls[0].index).toBe(0);
    expect(d.claimCalls()).toEqual(['claim:1']);
    await t.close();
  });

  test('DTR failure is not fatal', async () => {
    const d = ec200a();
    d.controlError = new DOMException('claim pending', 'InvalidStateError');
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    await t.write(bytes('ATI\r'));
    expect(d.writes).toEqual([{ ep: 15, data: 'ATI\r' }]);
    await t.close();
  });

  test('usb writes split to packet size', async () => {
    const d = new FakeDevice([iface(0, 0xff, bulk(1, 1, 8))]);
    d.answering.add(0);
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    d.writes.length = 0;
    d.answering.clear();
    await t.write(bytes('0123456789ABCDEFXY'));
    expect(d.writes.map((w) => w.data)).toEqual(['01234567', '89ABCDEF', 'XY']);
    await t.close();
  });

  test('a write that stalls past its timeout rejects', async () => {
    vi.useFakeTimers();
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    d.hangTransferOut = true;
    const result = t.write(bytes('AT\r')).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeInstanceOf(Error);
  });

  test('a failed transfer status rejects the write', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    d.transferOutResult = 'stall';
    await expect(t.write(bytes('AT\r'))).rejects.toThrow('stall');
    await t.close();
  });

  test('reads ask for at least one packet and deliver the data', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const got: string[] = [];
    t.onData((c) => got.push(text(c)));
    await tick();
    expect(d.readLengths[0]).toBeGreaterThanOrEqual(512);
    expect(d.readLengths[0] % 512).toBe(0);
    d.feed(6, 'hello');
    await tick();
    expect(got).toEqual(['hello']);
    await t.close();
  });

  test('the read loop ends quietly on close', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await tick();
    await t.close();
    await tick();
    expect(lost).toEqual([]);
    expect(d.calls.slice(-2)).toEqual(['release:3', 'close']);
  });

  test('a real device loss during a read becomes onDisconnect', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await tick();
    d.failReads(new DOMException('The device was disconnected.', 'NotFoundError'));
    await tick();
    expect(lost).toEqual(['The device was disconnected']);
  });

  test('a stalled read ends the session instead of spinning', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await tick();
    d.resolveRead(6, { status: 'stall' });
    await tick();
    expect(lost).toHaveLength(1);
    expect(lost[0]).toContain('stall');
  });

  test('disconnect event for this device is a loss; another device is ignored', async () => {
    const d = ec200a();
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    fireDisconnect({});
    expect(lost).toEqual([]);
    fireDisconnect(d);
    expect(lost).toHaveLength(1);
    await t.close();
  });

  test('close removes the disconnect listener and is idempotent', async () => {
    const d = ec200a();
    const remove = vi.spyOn(usb, 'removeEventListener');
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await t.close();
    await t.close();
    expect(remove).toHaveBeenCalledWith('disconnect', expect.any(Function));
    fireDisconnect(d);
    expect(lost).toEqual([]);
    expect(d.calls.filter((c) => c === 'close')).toHaveLength(1);
  });

  test('the transport itself sends nothing besides the probe', async () => {
    const d = unknownModem(0);
    const t = await connectUsb({ beforeOpen: noop, device: d.asDevice });
    await tick();
    await t.close();
    expect(d.writes.map((w) => w.data)).toEqual(['AT\r']);
  });
});
