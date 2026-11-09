import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

vi.mock('../../src/ui/download', () => ({ downloadText: vi.fn() }));

import App from '../../src/App.vue';
import ConnectBar from '../../src/ui/ConnectBar.vue';
import DonateLink from '../../src/ui/DonateLink.vue';
import HelpNoModem from '../../src/ui/HelpNoModem.vue';
import ScanDetails from '../../src/ui/ScanDetails.vue';
import SummaryCard from '../../src/ui/SummaryCard.vue';
import TerminalPane from '../../src/ui/TerminalPane.vue';
import { FakeTransport } from '../helpers/fakeTransport';
import { AtEngine } from '../../src/at/engine';
import { PickerCancelledError } from '../../src/transport/types';
import type { Transport } from '../../src/transport/types';
import { NoAtChannelError } from '../../src/transport/webUsb';
import { classifyUsbDevice } from '../../src/profiles/known-devices';
import { createDemoTransport } from '../../src/ui/demo';
import type { DemoTransport } from '../../src/ui/demo';
import { downloadText } from '../../src/ui/download';
import { PROFILES } from '../../src/profiles';
import { Scanner } from '../../src/scan/scanner';
import * as scannerMod from '../../src/scan/scanner';
import type { ScanItem } from '../../src/scan/scanner';

const dl = vi.mocked(downloadText);
const wrappers: VueWrapper[] = [];
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  vi.restoreAllMocks();
  dl.mockClear();
  delete (navigator as any).serial;
  delete (navigator as any).usb;
});
beforeEach(() => {
  (navigator as any).serial = {};
  (navigator as any).usb = {};
});

async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
  }
}

let lastTransport: DemoTransport;
function connectors() {
  const make = () => {
    lastTransport = createDemoTransport({ delayMs: 0 });
    return Promise.resolve(lastTransport);
  };
  return { serial: make, usb: make };
}

function mountApp(extra: Record<string, unknown> = {}) {
  const w = mount(App, { props: { connectors: connectors(), donateUrl: null, ...extra }, attachTo: document.body });
  wrappers.push(w);
  return w;
}
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().includes(text));

async function scanned(extra: Record<string, unknown> = {}) {
  const w = mountApp(extra);
  await btn(w, 'Serial port')!.trigger('click');
  await until(() => w.text().includes('Automatic scan finished'));
  return w;
}

describe('ConnectBar', () => {
  test('unsupported browser shows message', () => {
    delete (navigator as any).serial;
    delete (navigator as any).usb;
    const w = mount(ConnectBar, { props: { connectors: connectors() } });
    expect(w.text()).toContain('Chrome or Edge');
    expect(w.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  test('two connect buttons', () => {
    const w = mount(ConnectBar, { props: { connectors: connectors() } });
    expect(btn(w, 'Serial port')).toBeTruthy();
    expect(btn(w, 'USB direct')).toBeTruthy();
    expect(w.text()).not.toContain('only in Chrome or Edge (Chromium');
  });

  test('connector gets the beforeOpen hook', async () => {
    const serial = vi.fn().mockResolvedValue(createDemoTransport({ delayMs: 0 }));
    const beforeOpen = vi.fn().mockResolvedValue(undefined);
    const w = mount(ConnectBar, { props: { connectors: { serial, usb: connectors().usb }, beforeOpen } });
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(serial).toHaveBeenCalledWith({ beforeOpen, baudRate: 115200 });
  });

  test('the speed selector goes to the serial connector', async () => {
    const serial = vi.fn().mockResolvedValue(createDemoTransport({ delayMs: 0 }));
    const w = mount(ConnectBar, { props: { connectors: { serial, usb: connectors().usb } } });
    await w.find('select').setValue('9600');
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(serial.mock.calls[0][0].baudRate).toBe(9600);
  });

  test('says how the modem appears in the browser picker', () => {
    const w = mount(ConnectBar, { props: { connectors: connectors() } });
    expect(w.text()).toContain('"Android"');
    expect(w.text()).toContain('no name');
  });

  test('a cancelled picker shows no error', async () => {
    const w = mount(ConnectBar, {
      props: { connectors: { serial: () => Promise.reject(new PickerCancelledError()), usb: connectors().usb } },
    });
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  test('offers previously permitted devices and passes them to the connector', async () => {
    const port = { getInfo: () => ({ usbVendorId: 0x2c7c, usbProductId: 0x6005 }) };
    const named = { productName: 'Android', vendorId: 0x2c7c, productId: 0x6005 };
    const unnamed = { productName: undefined, vendorId: 0x1234, productId: 0x00ab };
    (navigator as any).serial = { getPorts: vi.fn().mockResolvedValue([port]) };
    (navigator as any).usb = { getDevices: vi.fn().mockResolvedValue([named, unnamed]) };
    const serial = vi.fn().mockResolvedValue(createDemoTransport({ delayMs: 0 }));
    const usb = vi.fn().mockResolvedValue(createDemoTransport({ delayMs: 0 }));
    const w = mount(ConnectBar, { props: { connectors: { serial, usb } } });
    await flushPromises();
    await btn(w, 'Serial: 2c7c:6005')!.trigger('click');
    await flushPromises();
    expect(serial.mock.calls[0][0].port).toBe(port);
    await btn(w, 'USB: Android')!.trigger('click');
    await flushPromises();
    expect(usb.mock.calls[0][0].device).toBe(named);
    await btn(w, 'USB: 1234:00ab')!.trigger('click');
    await flushPromises();
    expect(usb.mock.calls[1][0].device).toBe(unnamed);
  });

  test('no extra buttons when nothing was permitted before', async () => {
    (navigator as any).serial = { getPorts: vi.fn().mockResolvedValue([]) };
    (navigator as any).usb = { getDevices: vi.fn().mockResolvedValue([]) };
    const w = mount(ConnectBar, { props: { connectors: connectors() } });
    await flushPromises();
    expect(w.findAll('button')).toHaveLength(2);
  });

  test('the list follows devices being plugged in, and stops listening on unmount', async () => {
    const usbApi = Object.assign(new EventTarget(), { getDevices: vi.fn().mockResolvedValue([]) });
    (navigator as any).usb = usbApi;
    (navigator as any).serial = {};
    const w = mount(ConnectBar, { props: { connectors: connectors() } });
    await flushPromises();
    usbApi.getDevices.mockResolvedValue([{ productName: 'Android', vendorId: 1, productId: 2 }]);
    usbApi.dispatchEvent(new Event('connect'));
    await flushPromises();
    expect(btn(w, 'USB: Android')).toBeTruthy();
    w.unmount();
    const calls = usbApi.getDevices.mock.calls.length;
    usbApi.dispatchEvent(new Event('connect'));
    await flushPromises();
    expect(usbApi.getDevices.mock.calls.length).toBe(calls);
  });

  test('shows which channel is being tried on an unknown modem', async () => {
    let probe!: (i: number) => void;
    const usb = vi.fn((opts: { onProbe?: (i: number) => void }) => {
      probe = opts.onProbe!;
      return new Promise<Transport>(() => {});
    });
    const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
    await btn(w, 'USB direct')!.trigger('click');
    probe(2);
    await flushPromises();
    expect(w.text()).toContain('trying its channels');
    expect(w.text()).toContain('interface 2');
  });

  test('a pending claim asks for a replug, on success and on failure', async () => {
    const transport = Object.assign(createDemoTransport({ delayMs: 0 }), { hadPendingClaim: true });
    const usb = vi.fn().mockResolvedValueOnce(transport).mockRejectedValueOnce(new NoAtChannelError('No AT channel found on this modem.', true));
    const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
    await btn(w, 'USB direct')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('replug the modem');
    await btn(w, 'USB direct')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('No AT channel found');
    expect(w.text()).toContain('replug the modem');
  });

  test('no replug note after a clean connection', async () => {
    const transport = Object.assign(createDemoTransport({ delayMs: 0 }), { hadPendingClaim: false });
    const usb = vi.fn().mockResolvedValue(transport);
    const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
    await btn(w, 'USB direct')!.trigger('click');
    await flushPromises();
    expect(w.text()).not.toContain('replug the modem');
  });

  describe('guidance for devices without an AT channel', () => {
    async function rejected(usbId: string, classes: number[]) {
      const err = new NoAtChannelError('This device has no AT channel.', false, classifyUsbDevice({ usb: usbId, interfaceClasses: classes }));
      const usb = vi.fn().mockRejectedValue(err);
      const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
      await btn(w, 'USB direct')!.trigger('click');
      await flushPromises();
      return w;
    }

    test('storage mode: eject, installer, usb_modeswitch, and no red alert', async () => {
      const w = await rejected('12d1:1f01', [8]);
      const t = w.text();
      expect(t).toContain('Huawei HiLink stick (storage mode)');
      expect(t).toContain('Eject');
      expect(t).toContain('installer');
      expect(t).toContain('usb_modeswitch');
      expect(w.find('[role="alert"]').exists()).toBe(false);
      expect(w.find('.warn').exists()).toBe(false);
    });

    test('transient: wait and connect again', async () => {
      const t = (await rejected('2ecc:3001', [8])).text();
      expect(t).toContain('Wait a few seconds and connect again');
      expect(t).not.toContain('usb_modeswitch');
    });

    test('network stick with a fixed address: a link and the planned bookmark tool', async () => {
      const w = await rejected('12d1:14db', [2, 10]);
      const a = w.find('a');
      expect(a.attributes('href')).toBe('http://192.168.8.1');
      expect(a.attributes('rel')).toBe('noopener');
      expect(w.text()).toContain('network adapter');
      expect(w.text()).toContain('bookmark tool');
    });

    test('network stick without a fixed address points to the gateway', async () => {
      const w = await rejected('0e8d:2004', [224, 10, 8]);
      expect(w.find('a').exists()).toBe(false);
      expect(w.text()).toContain('MediaTek MiFi stick');
      expect(w.text()).toContain('gateway');
    });

    test('guidance goes away on the next attempt', async () => {
      const transport = createDemoTransport({ delayMs: 0 });
      const err = new NoAtChannelError('x', false, classifyUsbDevice({ usb: '2ecc:3001', interfaceClasses: [8] }));
      const usb = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(transport);
      const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
      await btn(w, 'USB direct')!.trigger('click');
      await flushPromises();
      expect(w.text()).toContain('Wait a few seconds');
      await btn(w, 'USB direct')!.trigger('click');
      await flushPromises();
      expect(w.text()).not.toContain('Wait a few seconds');
    });
  });

  test('connector failure is displayed', async () => {
    const w = mount(ConnectBar, {
      props: { connectors: { serial: () => Promise.reject(new Error('not available yet')), usb: connectors().usb } },
    });
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('not available yet');
  });
});

describe('App', () => {
  test('demo scan runs, summary shows fake modem, no deep scan on its own', async () => {
    const w = await scanned();
    expect(w.text()).toContain('EC200A');
    expect(w.text()).toContain('Demo Mobile');
    expect(w.text()).not.toContain('QDEMOFAKE=?');
  });

  test('deep scan needs confirmation', async () => {
    const spy = vi.spyOn(Scanner.prototype, 'runDeep');
    const w = await scanned();
    await btn(w, 'Deep scan')!.trigger('click');
    const text = w.find('[aria-label="Deep scan warning"]').text();
    expect(text).toContain('unknown');
    expect(text).toContain('faulty firmware');
    expect(text).toContain('restart');
    expect(spy).not.toHaveBeenCalled();
    await btn(w, 'Start deep scan')!.trigger('click');
    await until(() => spy.mock.calls.length > 0 && w.text().includes('AT+QDEMOFAKE=?'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('network scan is a separate button', async () => {
    const spy = vi.spyOn(Scanner.prototype, 'runManual');
    const w = await scanned();
    expect(w.text()).toContain('can take minutes');
    await btn(w, 'Network scan')!.trigger('click');
    await until(() => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0][0].command).toBe('AT+COPS=?');
    await until(() => w.text().includes('Other Demo'));
  });

  test('details expose raw response', async () => {
    const w = await scanned();
    expect(w.text()).toContain('Raw response');
    expect(w.text()).toContain('+CSQ: 21,99');
  });

  test('disconnect shows reconnect and keeps results', async () => {
    const w = await scanned();
    lastTransport.disconnect('cable pulled');
    await flushPromises();
    expect(w.text()).toContain('Connection lost: cable pulled');
    expect(w.text()).toContain('+CSQ: 21,99');
    expect(btn(w, 'Reconnect')).toBeTruthy();
  });

  test('default export is redacted', async () => {
    const w = await scanned();
    await btn(w, 'Export JSON')!.trigger('click');
    expect(dl).toHaveBeenCalledTimes(1);
    const text = dl.mock.calls[0][1];
    expect(JSON.parse(text).redacted).toBe(true);
    expect(text).not.toContain('123456789012345');
    await btn(w, 'Export Markdown')!.trigger('click');
    expect(dl.mock.calls[1][1]).toContain('(redacted)');
    expect(dl.mock.calls[1][1]).not.toContain('123456789012345');
  });

  test('full export asks confirmation', async () => {
    const w = await scanned();
    await btn(w, 'Full export')!.trigger('click');
    expect(dl).not.toHaveBeenCalled();
    expect(w.find('[aria-label="Full export warning"]').text()).toContain('identifiers');
    await btn(w, 'Download full JSON')!.trigger('click');
    expect(dl).toHaveBeenCalledTimes(1);
    expect(dl.mock.calls[0][1]).toContain('123456789012345');
    expect(JSON.parse(dl.mock.calls[0][1]).redacted).toBeUndefined();
  });

  test('terminal traffic stays out of default and full export', async () => {
    const marker = 'AT+QZZTERMTEST?';
    const w = await scanned();
    await w.findAll('nav button')[1].trigger('click');
    await w.find('input[aria-label="AT command"]').setValue(marker);
    await w.find('form').trigger('submit');
    await until(() => {
      const log = w.find('.terminal .log').text();
      return log.includes(marker) && log.includes('[error]');
    });
    await w.findAll('nav button')[0].trigger('click');
    await btn(w, 'Export JSON')!.trigger('click');
    await btn(w, 'Full export')!.trigger('click');
    await btn(w, 'Download full JSON')!.trigger('click');
    expect(dl).toHaveBeenCalledTimes(2);
    for (const call of dl.mock.calls) expect(call[1]).not.toContain('QZZTERMTEST');
  });

  test('without injected connectors the real ones are used, and a cancelled picker stays calm', async () => {
    const requestPort = vi.fn().mockRejectedValue(new DOMException('No port selected', 'NotFoundError'));
    (navigator as any).serial = { requestPort };
    const w = mount(App, { attachTo: document.body });
    wrappers.push(w);
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(requestPort).toHaveBeenCalledTimes(1);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  test('passes the USB id of the transport to the scan', async () => {
    const make = () => Promise.resolve(Object.assign(createDemoTransport({ delayMs: 0 }), { usbId: '2c7c:6005' }));
    const w = await scanned({ connectors: { serial: make, usb: make } });
    expect(w.findComponent(SummaryCard).props('usb')).toBe('2c7c:6005');
  });

  test('a transport without a USB id leaves it out of the scan', async () => {
    const w = await scanned();
    expect(w.findComponent(SummaryCard).props('usb')).toBeUndefined();
  });

  test('help panel names the one interface for Zadig', () => {
    const w = mount(HelpNoModem);
    expect(w.text()).toContain('Mobile AT Interface');
    expect(w.text()).toContain('interface 3');
    expect(w.text()).toContain('Never pick the whole device');
    expect(w.text()).toContain('"Android"');
  });

  test('donate hidden by default config, shown with url', async () => {
    const w = mountApp({ donateUrl: 'https://example.org/donate' });
    expect(w.findAll('a.donate').length).toBeGreaterThan(0);
    const w2 = mountApp({ donateUrl: null });
    expect(w2.find('a.donate').exists()).toBe(false);
  });
});

describe('App session lifecycle', () => {
  type Tracked = DemoTransport & { writes: number; closed: boolean };
  /** Demo transports that count writes and take `closeMs` to close; these connectors ignore beforeOpen. */
  function tracked(closeMs: number) {
    const made: Tracked[] = [];
    const make = () => {
      const t = createDemoTransport({ delayMs: 0 }) as Tracked;
      const write = t.write.bind(t);
      const close = t.close.bind(t);
      t.writes = 0;
      t.closed = false;
      t.write = (d) => { t.writes++; return write(d); };
      t.close = async () => {
        await new Promise((r) => setTimeout(r, closeMs));
        t.closed = true;
        await close();
      };
      made.push(t);
      return Promise.resolve(t as Transport);
    };
    return { made, connectors: { serial: make, usb: make } };
  }

  const scanItems = (w: VueWrapper) => w.findComponent(ScanDetails).props('items') as ScanItem[];

  test('reconnecting during a slow close leaves exactly one session', async () => {
    const { made, connectors: c } = tracked(40);
    const w = mountApp({ connectors: c });
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    await btn(w, 'USB direct')!.trigger('click');
    await flushPromises();
    await until(() => made.length === 3 && made[1].closed && w.text().includes('Automatic scan finished'));
    expect(made[0].closed).toBe(true);
    expect(made[1].writes).toBe(0);
    expect(made[2].closed).toBe(false);
    expect(made[2].writes).toBeGreaterThan(10);
    expect(scanItems(w).length).toBe(made[2].writes);
  });

  test('a hanging close stops blocking after 2 seconds', async () => {
    vi.useFakeTimers();
    try {
      const first = new FakeTransport();
      first.reply(/.*/, ['\r\nERROR\r\n']);
      first.close = () => new Promise<void>(() => {});
      const second = new FakeTransport();
      second.reply(/.*/, ['\r\nERROR\r\n']);
      const queue: Transport[] = [first, second];
      const make = () => Promise.resolve(queue.shift()!);
      const w = mountApp({ connectors: { serial: make, usb: make } });
      await btn(w, 'Serial port')!.trigger('click');
      await vi.advanceTimersByTimeAsync(10);
      expect(w.text()).toContain('Automatic scan finished');
      await btn(w, 'Serial port')!.trigger('click');
      await vi.advanceTimersByTimeAsync(1999);
      expect(second.written).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(second.written.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('an item from a replaced scanner is ignored', async () => {
    const onItem = vi.spyOn(Scanner.prototype, 'onItem');
    const w = mountApp();
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    const oldListener = onItem.mock.calls[0][0];
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => onItem.mock.calls.length === 2 && w.text().includes('Automatic scan finished'));
    const before = scanItems(w).length;
    oldListener({ id: 'stale', command: 'AT+STALE', category: 'other', state: 'done' });
    await flushPromises();
    expect(scanItems(w).length).toBe(before);
    expect(scanItems(w).some((i) => i.id === 'stale')).toBe(false);
  });

  test('an exception in the scan cannot leave the phase stuck', async () => {
    vi.spyOn(Scanner.prototype, 'runAuto').mockRejectedValueOnce(new Error('boom'));
    const w = mountApp();
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Scan interrupted: boom'));
    expect(w.text()).not.toContain('Scanning (');
    expect(btn(w, 'Serial port')!.attributes('disabled')).toBeUndefined();
  });

  describe('connect order', () => {
    function ordered(open: (log: string[]) => Transport) {
      const log: string[] = [];
      let n = 0;
      const make = async ({ beforeOpen }: { beforeOpen: () => Promise<void> }) => {
        const id = ++n;
        log.push(`pick ${id}`);
        await beforeOpen();
        log.push(`open ${id}`);
        const t = open(log);
        const close = t.close.bind(t);
        t.close = async () => {
          log.push(`close ${id}`);
          await close();
        };
        return t;
      };
      return { log, connectors: { serial: make, usb: make } };
    }

    test('picks first, closes the old session, then opens', async () => {
      const { log, connectors: c } = ordered(() => createDemoTransport({ delayMs: 0 }));
      const w = mountApp({ connectors: c });
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => w.text().includes('Automatic scan finished'));
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => log.length >= 5 && w.text().includes('Automatic scan finished'));
      expect(log).toEqual(['pick 1', 'open 1', 'pick 2', 'close 1', 'open 2']);
    });

    test('a cancelled picker keeps the running session', async () => {
      let calls = 0;
      const make = async ({ beforeOpen }: { beforeOpen: () => Promise<void> }) => {
        if (++calls > 1) throw new Error('No port selected');
        await beforeOpen();
        return createDemoTransport({ delayMs: 0 });
      };
      const w = mountApp({ connectors: { serial: make, usb: make } });
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => w.text().includes('Automatic scan finished'));
      await btn(w, 'Serial port')!.trigger('click');
      await flushPromises();
      expect(w.text()).toContain('No port selected');
      expect(w.text()).toContain('Connected:');
    });

    test('a failed open reads as not connected and keeps the results', async () => {
      let calls = 0;
      const make = async ({ beforeOpen }: { beforeOpen: () => Promise<void> }) => {
        await beforeOpen();
        if (++calls > 1) throw new Error('Port busy');
        return createDemoTransport({ delayMs: 0 });
      };
      const w = mountApp({ connectors: { serial: make, usb: make } });
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => w.text().includes('Automatic scan finished'));
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => w.text().includes('Port busy'));
      expect(w.text()).not.toContain('Connected:');
      expect(w.text()).toContain('+CSQ: 21,99');
      expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
      await btn(w, 'Export JSON')!.trigger('click');
      expect(dl).toHaveBeenCalledTimes(1);
    });
  });

  test('a silent port stops early and says so', async () => {
    vi.useFakeTimers();
    try {
      const t = new FakeTransport();
      const make = () => Promise.resolve(t);
      const w = mountApp({ connectors: { serial: make, usb: make } });
      await btn(w, 'Serial port')!.trigger('click');
      await vi.advanceTimersByTimeAsync(10_300);
      expect(t.written).toEqual(['ATI\r', 'AT+GMI\r']);
      expect(w.text()).toContain('no response, wrong port?');
      expect(w.text()).not.toContain('Automatic scan finished');
      expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('only one scan can run on an engine', async () => {
    const deep = vi.spyOn(Scanner.prototype, 'runDeep');
    const manual = vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise(() => {}));
    const w = await scanned();
    await btn(w, 'Deep scan')!.trigger('click');
    expect(w.find('[aria-label="Deep scan warning"]').exists()).toBe(true);
    await btn(w, 'Network scan')!.trigger('click');
    await flushPromises();
    expect(manual).toHaveBeenCalledTimes(1);
    expect(w.find('[aria-label="Deep scan warning"]').exists()).toBe(false);
    const vm = w.vm as unknown as { startDeep(): Promise<void>; startNetworkScan(): Promise<void> };
    await vm.startDeep();
    await vm.startNetworkScan();
    expect(deep).not.toHaveBeenCalled();
    expect(manual).toHaveBeenCalledTimes(1);
  });

  test('a stopped scan says so and offers no deep scan', async () => {
    const make = () => {
      lastTransport = createDemoTransport({ delayMs: 2 });
      return Promise.resolve(lastTransport);
    };
    const w = mountApp({ connectors: { serial: make, usb: make } });
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('results so far') && !w.text().includes('0 results'));
    await btn(w, 'Stop')!.trigger('click');
    await until(() => !w.text().includes('Scanning ('));
    expect(w.text()).toContain('Scan stopped');
    expect(w.text()).not.toContain('Automatic scan finished');
    expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('command list');
  });

  test('the terminal cannot send while a scan runs, and says why', async () => {
    const send = vi.spyOn(AtEngine.prototype, 'send');
    vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise(() => {}));
    const w = await scanned();
    await btn(w, 'Network scan')!.trigger('click');
    await flushPromises();
    await w.findAll('nav button')[1].trigger('click');
    const before = send.mock.calls.length;
    expect(w.find('input[aria-label="AT command"]').attributes('disabled')).toBeDefined();
    expect(w.find('.terminal').text()).toContain('while a scan is running');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send.mock.calls.length).toBe(before);
  });

  test('terminal commands, and only those, may cancel a prompt', async () => {
    const send = vi.spyOn(AtEngine.prototype, 'send');
    const w = await scanned();
    expect(send.mock.calls.some((c) => c[1]?.cancelPromptOnTimeout)).toBe(false);
    await w.findAll('nav button')[1].trigger('click');
    await w.find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send.mock.calls.at(-1)).toEqual(['AT+CSQ', { timeoutMs: 15000, cancelPromptOnTimeout: true, body: undefined }]);
  });
});

describe('ScanDetails', () => {
  test('unsupported rows show the raw response, not a claim about the modem', () => {
    const item: ScanItem = {
      id: 'x', command: 'AT+X?', category: 'other', state: 'unsupported',
      response: { command: 'AT+X?', status: 'cme_error', lines: [], errorDetail: 'SIM not inserted', durationMs: 1 },
    };
    const w = mount(ScanDetails, { props: { items: [item] } });
    expect(w.text()).toContain('no answer / error');
    expect(w.text()).toContain('SIM not inserted');
    expect(w.text().toLowerCase()).not.toContain('not supported');
  });

  test('modem text is rendered as text, never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const item: ScanItem = {
      id: 'x', command: 'ATI', category: 'identity', state: 'done',
      response: { command: 'ATI', status: 'ok', lines: [evil], durationMs: 1 },
    };
    const w = mount(ScanDetails, { props: { items: [item] } });
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain(evil);
  });
});

describe('SummaryCard', () => {
  test('unverified badge for unverified profile', () => {
    const p = PROFILES.find((x) => !x.verified)!;
    const w = mount(SummaryCard, { props: { summary: {}, profile: p } });
    expect(w.text()).toContain('unverified');
  });
});

describe('TerminalPane', () => {
  test('a disabled terminal shows the reason and sends nothing', async () => {
    const send = vi.fn();
    const w = mount(TerminalPane, { props: { send, disabled: true, disabledReason: 'Busy right now.' } });
    expect(w.text()).toContain('Busy right now.');
    await w.find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
  });

  test('terminal warns on write command', async () => {
    const send = vi.fn().mockResolvedValue({ command: 'AT+CFUN=0', status: 'ok', lines: [], durationMs: 1 });
    const w = mount(TerminalPane, { props: { send } });
    await w.find('input[aria-label="AT command"]').setValue('AT+CFUN=0');
    await w.find('form').trigger('submit');
    expect(send).not.toHaveBeenCalled();
    expect(w.text()).toContain('does not look like a read-only query');
    expect(w.find('button[type=submit]').text()).toBe('Send anyway');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('AT+CFUN=0', undefined);
  });

  test('read command goes out at once, body is passed along', async () => {
    const send = vi.fn().mockResolvedValue({ command: 'AT+CSQ', status: 'ok', lines: ['+CSQ: 1,1'], durationMs: 1 });
    const w = mount(TerminalPane, { props: { send } });
    await w.find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await w.find('input[aria-label="Body for the prompt"]').setValue('hello');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('AT+CSQ', 'hello');
    expect(w.text()).toContain('+CSQ: 1,1');
  });
});

describe('DonateLink', () => {
  test('donate hidden when URL null', () => {
    expect(mount(DonateLink, { props: { url: null } }).find('a').exists()).toBe(false);
  });
  test('donate links out and has no embed', () => {
    const w = mount(DonateLink, { props: { url: 'https://example.org/d' } });
    const a = w.find('a');
    expect(a.attributes('target')).toBe('_blank');
    expect(a.attributes('rel')).toContain('noopener');
    expect(w.find('iframe').exists()).toBe(false);
    expect(w.find('script').exists()).toBe(false);
  });
});

describe('HelpNoModem', () => {
  test('help covers all steps', () => {
    const t = mount(HelpNoModem).text();
    expect(t).toContain('USB 2');
    expect(t).toContain('WinUSB');
    expect(t).toContain('driver');
    expect(t).toContain('Zadig');
    expect(t).toContain('roll back');
    expect(t).toContain('administrator');
  });
  test('help has an entry for a modem that shows up as a disk', () => {
    const t = mount(HelpNoModem).text();
    expect(t).toContain('My modem shows up as a disk');
    expect(t).toContain('usb_modeswitch');
  });
});
