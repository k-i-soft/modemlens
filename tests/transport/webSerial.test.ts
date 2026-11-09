import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectSerial, PortBusyError } from '../../src/transport/webSerial';
import { PickerCancelledError } from '../../src/transport/types';

const noop = () => Promise.resolve();
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A port with real web streams, so that the locking rules of `close` are the real ones. */
function makePort(info: { usbVendorId?: number; usbProductId?: number } = { usbVendorId: 0x2c7c, usbProductId: 0x6005 }) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({ start: (c) => { source = c; } });
  const written: string[] = [];
  const writable = new WritableStream<Uint8Array>({ write: (c) => { written.push(new TextDecoder().decode(c)); } });
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async (_: SerialOptions) => {
      port.readable = readable;
      port.writable = writable;
    }),
    close: vi.fn(async () => {
      if (readable.locked || writable.locked) throw new TypeError('streams are locked');
      port.readable = null;
      port.writable = null;
    }),
    setSignals: vi.fn(async (_: SerialOutputSignals) => {}),
    getInfo: () => info,
  };
  return {
    port,
    asPort: port as unknown as SerialPort,
    written,
    push: (text: string) => source.enqueue(new TextEncoder().encode(text)),
    fail: (e: Error) => {
      port.readable = null;
      source.error(e);
    },
  };
}

let serial: EventTarget & { requestPort: ReturnType<typeof vi.fn> };

beforeEach(() => {
  serial = Object.assign(new EventTarget(), { requestPort: vi.fn() });
  (navigator as any).serial = serial;
});
afterEach(() => {
  delete (navigator as any).serial;
});

function fireDisconnect(port: unknown): void {
  const e = new Event('disconnect');
  Object.defineProperty(e, 'target', { value: port });
  serial.dispatchEvent(e);
}

describe('connectSerial', () => {
  test('serial opens at 115200 and raises DTR', async () => {
    const { port, asPort } = makePort();
    serial.requestPort.mockResolvedValue(asPort);
    const t = await connectSerial({ beforeOpen: noop });
    expect(port.open.mock.calls[0][0].baudRate).toBe(115200);
    expect(port.setSignals).toHaveBeenCalledTimes(1);
    expect(port.setSignals).toHaveBeenCalledWith({ dataTerminalReady: true });
    expect(t.kind).toBe('serial');
    await t.close();
  });

  test('a given port skips the picker and uses the chosen speed', async () => {
    const { port, asPort } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort, baudRate: 9600 });
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(port.open.mock.calls[0][0].baudRate).toBe(9600);
    await t.close();
  });

  test('picks first, then runs beforeOpen, then opens', async () => {
    const { port, asPort } = makePort();
    const order: string[] = [];
    serial.requestPort.mockImplementation(async () => { order.push('pick'); return asPort; });
    port.open.mockImplementation(async () => {
      order.push('open');
      port.readable = new ReadableStream();
      port.writable = new WritableStream();
    });
    port.close.mockResolvedValue(undefined);
    const t = await connectSerial({ beforeOpen: async () => { order.push('beforeOpen'); } });
    expect(order).toEqual(['pick', 'beforeOpen', 'open']);
    await t.close();
  });

  test('asks for the port inside the user gesture, before any await', () => {
    serial.requestPort.mockReturnValue(new Promise(() => {}));
    void connectSerial({ beforeOpen: noop });
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
  });

  test('a cancelled picker rejects without calling beforeOpen', async () => {
    serial.requestPort.mockRejectedValue(new DOMException('No port selected', 'NotFoundError'));
    const beforeOpen = vi.fn(noop);
    await expect(connectSerial({ beforeOpen })).rejects.toBeInstanceOf(PickerCancelledError);
    expect(beforeOpen).not.toHaveBeenCalled();
  });

  test.each(['NetworkError', 'InvalidStateError'])('serial maps %s to PortBusyError', async (name) => {
    const { port, asPort } = makePort();
    port.open.mockRejectedValue(new DOMException('cannot open', name));
    const err = await connectSerial({ beforeOpen: noop, port: asPort }).catch((e) => e);
    expect(err).toBeInstanceOf(PortBusyError);
    expect(err.message).toContain('Another program');
  });

  test('other open errors pass through unchanged', async () => {
    const { port, asPort } = makePort();
    const failure = new TypeError('bad speed');
    port.open.mockRejectedValue(failure);
    await expect(connectSerial({ beforeOpen: noop, port: asPort })).rejects.toBe(failure);
  });

  describe('calls that never settle', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('an open that hangs rejects instead of blocking the buttons for good', async () => {
      const { port, asPort } = makePort();
      port.open.mockReturnValue(new Promise(() => {}));
      let settled: unknown;
      const result = connectSerial({ beforeOpen: noop, port: asPort }).catch((e) => { settled = e; });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(settled).toBeInstanceOf(Error);
      expect(settled).not.toBeInstanceOf(PortBusyError);
      expect((settled as Error).message).toContain('did not open');
    });

    test('an open that succeeds after the timeout does not leave the port open', async () => {
      const { port, asPort } = makePort();
      let finish!: () => void;
      port.open.mockReturnValue(new Promise<void>((r) => { finish = r; }));
      const result = connectSerial({ beforeOpen: noop, port: asPort }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(5000);
      await result;
      expect(port.close).not.toHaveBeenCalled();
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(port.close).toHaveBeenCalledTimes(1);
    });

    test('a DTR request that hangs does not stop the connection', async () => {
      const { port, asPort } = makePort();
      port.setSignals.mockReturnValue(new Promise(() => {}));
      const result = connectSerial({ beforeOpen: noop, port: asPort });
      await vi.advanceTimersByTimeAsync(2000);
      const t = await result;
      expect(t.kind).toBe('serial');
      await t.close();
    });
  });

  test('a failing DTR request is not fatal', async () => {
    const { port, asPort } = makePort();
    port.setSignals.mockRejectedValue(new DOMException('no', 'NetworkError'));
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    expect(t.kind).toBe('serial');
    await t.close();
  });

  test('reports the USB id in plain lowercase form', async () => {
    const { asPort } = makePort({ usbVendorId: 0x2c7c, usbProductId: 0x00ab });
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    expect(t.usbId).toBe('2c7c:00ab');
    await t.close();
  });

  test('no USB id for a port that has none', async () => {
    const { asPort } = makePort({});
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    expect(t.usbId).toBeUndefined();
    await t.close();
  });

  test('sends nothing on its own and passes writes through', async () => {
    const { asPort, written } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    await tick();
    expect(written).toEqual([]);
    await t.write(new TextEncoder().encode('AT\r'));
    expect(written).toEqual(['AT\r']);
    await t.close();
  });

  test('delivers incoming chunks', async () => {
    const { asPort, push } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    const got: string[] = [];
    t.onData((c) => got.push(new TextDecoder().decode(c)));
    push('OK\r\n');
    await tick();
    expect(got).toEqual(['OK\r\n']);
    await t.close();
  });

  test('serial emits disconnect on read failure', async () => {
    const { asPort, fail } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    fail(new DOMException('The device has been lost', 'NetworkError'));
    await tick();
    expect(lost).toEqual(['The device has been lost']);
  });

  test('a recoverable read error keeps the session', async () => {
    const m = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: m.asPort });
    const lost: string[] = [];
    const got: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    t.onData((c) => got.push(new TextDecoder().decode(c)));
    let next!: ReadableStreamDefaultController<Uint8Array>;
    const replacement = new ReadableStream<Uint8Array>({ start: (c) => { next = c; } });
    m.fail(new DOMException('overrun', 'BufferOverrunError'));
    m.port.readable = replacement;
    await tick();
    next.enqueue(new TextEncoder().encode('more'));
    await tick();
    expect(lost).toEqual([]);
    expect(got).toEqual(['more']);
    await next.close();
  });

  test('a loss before anyone listens still reaches the listener', async () => {
    const { asPort, fail } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    fail(new DOMException('gone', 'NetworkError'));
    await tick();
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await tick();
    expect(lost).toEqual(['gone']);
  });

  test('disconnect event for this port is a loss; another port is ignored', async () => {
    const { asPort } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    fireDisconnect({});
    expect(lost).toEqual([]);
    fireDisconnect(asPort);
    expect(lost).toHaveLength(1);
  });

  test('close is quiet, unlocks the streams and removes the listener', async () => {
    const { port, asPort } = makePort();
    const remove = vi.spyOn(serial, 'removeEventListener');
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    const lost: string[] = [];
    t.onDisconnect((r) => lost.push(r));
    await t.close();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('disconnect', expect.any(Function));
    fireDisconnect(asPort);
    await tick();
    expect(lost).toEqual([]);
  });

  test('close can run after a loss and twice', async () => {
    const { port, asPort, fail } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    fail(new DOMException('gone', 'NetworkError'));
    await tick();
    await t.close();
    await t.close();
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  test('a failing close does not reject', async () => {
    const { port, asPort } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    port.close.mockRejectedValue(new DOMException('no', 'InvalidStateError'));
    await expect(t.close()).resolves.toBeUndefined();
  });

  test('write after close rejects', async () => {
    const { asPort } = makePort();
    const t = await connectSerial({ beforeOpen: noop, port: asPort });
    await t.close();
    await expect(t.write(new Uint8Array([65]))).rejects.toThrow();
  });
});
