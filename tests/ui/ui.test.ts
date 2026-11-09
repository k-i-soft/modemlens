import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

vi.mock('../../src/ui/download', () => ({ downloadText: vi.fn() }));

import App from '../../src/App.vue';
import ConnectBar from '../../src/ui/ConnectBar.vue';
import DonateLink from '../../src/ui/DonateLink.vue';
import HelpNoModem from '../../src/ui/HelpNoModem.vue';
import ScanDetails from '../../src/ui/ScanDetails.vue';
import IdentityHero from '../../src/ui/IdentityHero.vue';
import Overview from '../../src/ui/Overview.vue';
import TerminalPane from '../../src/ui/TerminalPane.vue';
import { FakeTransport } from '../helpers/fakeTransport';
import { AtEngine } from '../../src/at/engine';
import { PickerCancelledError } from '../../src/transport/types';
import type { Transport } from '../../src/transport/types';
import { NoAtChannelError } from '../../src/transport/webUsb';
import { classifyUsbDevice } from '../../src/profiles/known-devices';
import Diagnostics from '../../src/ui/Diagnostics.vue';
import BarMeter from '../../src/ui/BarMeter.vue';
import { LIVE_COMMAND } from '../../src/ui/liveSignal';
import { MASK } from '../../src/ui/dashboard';
import { createDemoTransport, demoNoAtError } from '../../src/ui/demo';
import type { DemoTransport } from '../../src/ui/demo';
import { downloadText } from '../../src/ui/download';
import { PROFILES } from '../../src/profiles';
import { Scanner } from '../../src/scan/scanner';
import * as scannerMod from '../../src/scan/scanner';
import type { ScanItem } from '../../src/scan/scanner';
import WebModemPanel from '../../src/ui/WebModemPanel.vue';
import ImportCapture from '../../src/ui/ImportCapture.vue';
import { demoHiLinkError, demoWebCapture } from '../../src/ui/demo';
import { buildBookmarklet } from '../../src/web/bookmarklets';
import { WEB_DIALECTS } from '../../src/web/dialects';
import { MAX_CAPTURE_BYTES } from '../../src/web/importReport';
import { hilinkCapture, IDENTIFIERS } from '../web/fixtures';

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

    test('network stick with a fixed address: a link and the bookmark', async () => {
      const w = await rejected('12d1:14db', [2, 10]);
      const a = w.find('a');
      expect(a.attributes('href')).toBe('http://192.168.8.1');
      expect(a.attributes('rel')).toBe('noopener');
      expect(w.text()).toContain('network adapter');
      expect(w.text()).toContain('Drag this to your bookmarks bar');
    });

    test('network stick without a fixed address points to the gateway', async () => {
      const w = await rejected('0e8d:2004', [224, 10, 8]);
      expect(w.find('a:not(.bookmarklet)').exists()).toBe(false);
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
    expect(text).toContain('built-in list');
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
    await w.findAll('nav button')[2].trigger('click');
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
    expect(w.findComponent(IdentityHero).props('identity').usb).toBe('2c7c:6005');
  });

  test('a transport without a USB id leaves it out of the scan', async () => {
    const w = await scanned();
    expect(w.findComponent(IdentityHero).props('identity').usb).toBeUndefined();
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

  test('a hanging close stops blocking after 4.5 seconds, past the worst USB close of 4', async () => {
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
      await vi.advanceTimersByTimeAsync(4499);
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
    await until(() => /[1-9]\d* of \d+ done/.test(w.text()));
    await btn(w, 'Stop')!.trigger('click');
    await until(() => !w.text().includes('Scanning ('));
    expect(w.text()).toContain('Scan stopped');
    expect(w.text()).not.toContain('Automatic scan finished');
    expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('automatic scan did not finish');
  });

  test('the terminal cannot send while a scan runs, and says why', async () => {
    const send = vi.spyOn(AtEngine.prototype, 'send');
    vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise(() => {}));
    const w = await scanned();
    await btn(w, 'Network scan')!.trigger('click');
    await flushPromises();
    await w.findAll('nav button')[2].trigger('click');
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
    await w.findAll('nav button')[2].trigger('click');
    await w.find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(send.mock.calls.at(-1)).toEqual(['AT+CSQ', { timeoutMs: 15000, cancelPromptOnTimeout: true, body: undefined }]);
  });
});

describe('the instrument panel', () => {
  test('the start screen has the name, a sentence and the two large choices, and no tabs yet', () => {
    const w = mountApp();
    expect(w.find('h1').text()).toBe('ModemLens');
    expect(w.text()).toContain('whether it is on the network');
    expect(btn(w, 'USB direct')).toBeTruthy();
    expect(btn(w, 'Serial port')).toBeTruthy();
    expect(w.find('nav').exists()).toBe(false);
    expect(w.findComponent(HelpNoModem).exists()).toBe(true);
  });

  test('shows the modem, its network state and its signal at a glance', async () => {
    const w = await scanned();
    expect(w.find('.model').text()).toBe('EC200A');
    expect(w.text()).toContain('On the network');
    expect(w.findComponent(BarMeter).findAll('rect.on')).toHaveLength(4);
    expect(w.find('.verdict').text()).toContain('Good');
  });

  test('the scales are meters with real values', async () => {
    const w = await scanned();
    const rsrp = w.find('[role="meter"][aria-label="RSRP"]');
    expect(rsrp.attributes()).toMatchObject({ 'aria-valuemin': '-130', 'aria-valuemax': '-60', 'aria-valuenow': '-85', 'aria-valuetext': '-85 dBm, good' });
    expect(w.findAll('[role="meter"]').map((m) => m.attributes('aria-label'))).toEqual(['RSRP', 'RSRQ', 'SINR', 'RSSI']);
  });

  test('every rating on screen has its word', async () => {
    const w = await scanned();
    for (const scale of w.findAll('.scale')) expect(scale.text()).toMatch(/Excellent|Good|Fair|Poor/);
    for (const row of w.findAll('.panel[aria-label="Neighbour cells"] li')) expect(row.text()).toMatch(/Excellent|Good|Fair|Poor/);
  });

  test('the demo exercises bands, neighbours, attempts and contexts', async () => {
    const w = await scanned();
    expect(w.findAll('.bands li').map((b) => b.text().replace('?', ''))).toEqual(['B1', 'B3active', 'B7', 'B8', 'B20', 'B28']);
    expect(w.findAll('.panel[aria-label="Neighbour cells"] li')).toHaveLength(4);
    expect(w.find('[aria-label="PIN: 2 attempts left"]').findAll('i.on')).toHaveLength(2);
    expect(w.find('[aria-label="PUK: 10 attempts left"]').findAll('i.on')).toHaveLength(10);
    expect(w.findAll('.panel[aria-label="Data connections"] li')).toHaveLength(2);
    expect(w.find('.panel[aria-label="Device"] [role="img"]').attributes('aria-label')).toBe('Temperature 38 degrees Celsius');
  });

  test('operators appear only after a network scan, the current one flagged', async () => {
    const w = await scanned();
    expect(w.find('.panel[aria-label="Operators"]').exists()).toBe(false);
    await btn(w, 'Network scan')!.trigger('click');
    await until(() => w.text().includes('Barred Demo'));
    const current = w.find('.panel[aria-label="Operators"] li.current');
    expect(current.text()).toContain('Demo Mobile');
    expect(current.text()).toContain('Current');
  });

  test('a modem that says little leaves no holes and no undefined', async () => {
    const t = new FakeTransport();
    t.reply(/.*/, ['\r\nERROR\r\n']);
    const make = () => Promise.resolve(t);
    const w = await scanned({ connectors: { serial: make, usb: make } });
    expect(w.text()).not.toContain('undefined');
    expect(w.text()).toContain('Unknown model');
    expect(w.text()).toContain('No reading');
    // The failed SIM query is itself a finding, so that panel stays and says so.
    expect(w.findAll('.overview .panel').map((p) => p.attributes('aria-label'))).toEqual(['SIM']);
    expect(w.find('.bands').exists()).toBe(false);
  });

  test('while scanning it says how far it is and which command runs', async () => {
    const make = () => Promise.resolve(createDemoTransport({ delayMs: 5 }));
    const w = mountApp({ connectors: { serial: make, usb: make } });
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => /[1-9]\d* of \d+ done/.test(w.text()));
    expect(w.find('.progress code').text()).toMatch(/^AT/);
    expect(w.find('[role="progressbar"]').attributes('aria-valuemax')).toMatch(/^\d+$/);
  });

  test('a scan that is stopped during its last command does not claim to be finished', async () => {
    vi.spyOn(Scanner.prototype, 'runAuto').mockImplementation(function (this: Scanner, signal?: AbortSignal) {
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve(this.report)));
    });
    const w = mountApp();
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => btn(w, 'Stop') !== undefined);
    await btn(w, 'Stop')!.trigger('click');
    await until(() => w.text().includes('Scan stopped'));
    expect(w.text()).not.toContain('Automatic scan finished');
    expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
  });

  test('each kind of scan reports its own end', async () => {
    const w = await scanned();
    await btn(w, 'Network scan')!.trigger('click');
    await until(() => w.text().includes('Network scan finished'));
    expect(w.text()).not.toContain('Automatic scan finished');
  });

  test('losing the connection withdraws the deep scan question', async () => {
    const w = await scanned();
    await btn(w, 'Deep scan')!.trigger('click');
    lastTransport.disconnect('cable pulled');
    await flushPromises();
    expect(w.find('[aria-label="Deep scan warning"]').exists()).toBe(false);
  });

  test('"Start deep scan" is disabled when a deep scan is not possible', () => {
    const w = mount(Diagnostics, {
      props: { items: [], canDeep: false, canNetworkScan: false, autoIncomplete: false, confirmDeep: true, hideIdentifiers: false },
    });
    expect(btn(w, 'Start deep scan')!.attributes('disabled')).toBeDefined();
  });

  test('the export menu opens, and closes on Escape', async () => {
    const w = await scanned();
    const menu = w.find('.export .menu');
    expect((menu.element as HTMLElement).style.display).toBe('none');
    await w.findAll('button').find((b) => b.text() === 'Export')!.trigger('click');
    expect((menu.element as HTMLElement).style.display).toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect((menu.element as HTMLElement).style.display).toBe('none');
  });

  test('no template sets a style attribute: the production CSP has no unsafe-inline', async () => {
    const files = import.meta.glob('../../src/**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(10);
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/\sstyle="/);
      expect(source, name).not.toContain('v-html');
    }
  });

  describe('hide identifiers', () => {
    const toggle = (w: VueWrapper) => w.findAll('input[role="switch"]').find((i) => i.element.closest('label')!.textContent!.includes('Hide identifiers'))!;
    const SECRETS = ['123456789012345', '001010123456789', '98000000000000000099', '10.0.0.2', 'DEC0DE', 'FACE'];

    test('is off by default and shows the values', async () => {
      const w = await scanned();
      expect((toggle(w).element as HTMLInputElement).checked).toBe(false);
      for (const s of SECRETS) expect(w.text()).toContain(s);
    });

    test('masks identifiers everywhere on the page, raw responses included', async () => {
      const w = await scanned();
      await toggle(w).setValue(true);
      for (const s of SECRETS) expect(w.text()).not.toContain(s);
      expect(w.text()).toContain(MASK);
      expect(w.text()).toContain('EC200A');
    });

    test('the terminal output is withheld and comes back', async () => {
      const w = await scanned();
      await w.find('input[aria-label="AT command"]').setValue('AT+CGSN');
      await w.find('form').trigger('submit');
      await until(() => w.find('.terminal .log').text().includes('123456789012345'));
      await toggle(w).setValue(true);
      expect(w.find('.terminal .log').text()).not.toContain('123456789012345');
      await toggle(w).setValue(false);
      expect(w.find('.terminal .log').text()).toContain('123456789012345');

      // A typed argument can be a phone number or a PIN: inputs, warning and log hide it too.
      const number = '+41000000000';
      const command = w.find('input[aria-label="AT command"]');
      const body = w.find('input[aria-label="Body for the prompt"]');
      await toggle(w).setValue(true);
      expect(command.classes()).toContain('masked');
      expect(body.classes()).toContain('masked');
      await command.setValue(`AT+CMGS="${number}"`);
      await w.find('form').trigger('submit');
      const alert = w.find('.terminal [role="alert"]');
      expect(alert.text()).toContain('AT+CMGS does not look like');
      expect(alert.text()).not.toContain(number);
      await w.find('form').trigger('submit');
      await until(() => w.find('.terminal .log').text().includes('AT+CMGS'));
      expect(w.findAll('.terminal .log code').at(-1)!.text()).toBe('> AT+CMGS');
      expect(w.text()).not.toContain(number);
      await toggle(w).setValue(false);
      expect(command.classes()).not.toContain('masked');
      expect(body.classes()).not.toContain('masked');
      expect(w.find('.terminal .log').text()).toContain(number);
    });

    test.each(['ATD+41000000000;', 'atd+41000000000;', 'AtDt+41000000000'])('dialling with %s shows only ATD while hidden', async (typed) => {
      const w = await scanned();
      await toggle(w).setValue(true);
      await w.find('input[aria-label="AT command"]').setValue(typed);
      await w.find('form').trigger('submit');
      const alert = w.find('.terminal [role="alert"]');
      expect(alert.text()).toContain('ATD does not look like');
      expect(alert.text()).not.toContain('41000000000');
      await w.find('form').trigger('submit');
      await until(() => w.find('.terminal .log code').exists());
      expect(w.find('.terminal .log code').text()).toBe('> ATD');
      expect(w.text()).not.toContain('41000000000');
      await toggle(w).setValue(false);
      expect(w.find('.terminal .log code').text()).toBe(`> ${typed}`);
    });

    test('a query keeps only its name while hidden', async () => {
      const w = await scanned();
      await toggle(w).setValue(true);
      await w.find('input[aria-label="AT command"]').setValue('AT+CSQ?');
      await w.find('form').trigger('submit');
      await until(() => w.find('.terminal .log code').exists());
      expect(w.find('.terminal .log code').text()).toBe('> AT+CSQ');
    });

    test('exports do not depend on it', async () => {
      const w = await scanned();
      await toggle(w).setValue(true);
      await btn(w, 'Full export')!.trigger('click');
      await btn(w, 'Download full JSON')!.trigger('click');
      expect(dl.mock.calls[0][1]).toContain('123456789012345');
    });
  });

  describe('live signal', () => {
    const liveSwitch = (w: VueWrapper) => w.find('.live input[role="switch"]');
    const polls = (spy: { mock: { calls: unknown[][] } }, from: number) => spy.mock.calls.slice(from).filter((c) => c[0] === LIVE_COMMAND).length;

    test('is off by default and nothing polls', async () => {
      const send = vi.spyOn(AtEngine.prototype, 'send');
      const w = await scanned();
      const before = send.mock.calls.length;
      await new Promise((r) => setTimeout(r, 30));
      expect(send.mock.calls.length).toBe(before);
      expect((liveSwitch(w).element as HTMLInputElement).checked).toBe(false);
      expect(w.find('.plot').exists()).toBe(false);
    });

    test('starts from the toggle, draws, and never enters a report', async () => {
      const send = vi.spyOn(AtEngine.prototype, 'send');
      const w = await scanned();
      const before = send.mock.calls.length;
      const items = (w.findComponent(ScanDetails).props('items') as ScanItem[]).length;
      await liveSwitch(w).setValue(true);
      await until(() => w.find('.plot .dot').exists());
      expect(polls(send, before)).toBe(1);
      expect((w.findComponent(ScanDetails).props('items') as ScanItem[]).length).toBe(items);
      await btn(w, 'Full export')!.trigger('click');
      await btn(w, 'Download full JSON')!.trigger('click');
      expect(JSON.parse(dl.mock.calls[0][1]).items.filter((i: ScanItem) => i.command === LIVE_COMMAND)).toHaveLength(1);
    });

    test('pauses during a scan and resumes after it', async () => {
      const send = vi.spyOn(AtEngine.prototype, 'send');
      let finishScan!: () => void;
      const w = await scanned();
      vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise((r) => (finishScan = () => r({} as ScanItem))));
      await liveSwitch(w).setValue(true);
      await until(() => w.find('.plot .dot').exists());
      await btn(w, 'Network scan')!.trigger('click');
      await flushPromises();
      expect(w.find('.live').text()).toContain('Paused while a scan or an action runs');
      const during = send.mock.calls.length;
      finishScan();
      await until(() => polls(send, during) === 1);
      expect(w.find('.live').text()).not.toContain('Paused');
    });

    test('with Live off, a running scan is not mistaken for a missing modem', async () => {
      const w = await scanned();
      vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise(() => {}));
      await btn(w, 'Network scan')!.trigger('click');
      await flushPromises();
      expect(w.find('.live').text()).toContain('Paused while a scan or an action runs');
      expect(w.find('.live').text()).not.toContain('Needs a connected modem');
      expect(liveSwitch(w).attributes('disabled')).toBeDefined();
    });

    test('stops on disconnect and cannot be started again without a modem', async () => {
      const w = await scanned();
      await liveSwitch(w).setValue(true);
      await until(() => w.find('.plot .dot').exists());
      lastTransport.disconnect('cable pulled');
      await flushPromises();
      expect((liveSwitch(w).element as HTMLInputElement).checked).toBe(false);
      expect(liveSwitch(w).attributes('disabled')).toBeDefined();
      expect(w.find('.live').text()).toContain('Needs a connected modem');
    });

    test('stops when a new session replaces the old one', async () => {
      const w = await scanned();
      await liveSwitch(w).setValue(true);
      await until(() => w.find('.plot .dot').exists());
      await btn(w, 'Serial port')!.trigger('click');
      await until(() => w.text().includes('Automatic scan finished'));
      expect((liveSwitch(w).element as HTMLInputElement).checked).toBe(false);
    });
  });
});

describe('a device without an AT channel', () => {
  const device = {
    usb: '1782:4056',
    productName: 'Some Stick',
    interfaces: [
      { number: 0, class: 0xe0, subclass: 0x01 },
      { number: 1, class: 0x0a, subclass: 0x00 },
      { number: 2, class: 0xff, subclass: 0x00 },
      { number: 3, class: 0x08, subclass: 0x06 },
      { number: 4, class: 0x02, subclass: 0x06 },
    ],
  };
  async function rejecting(err: Error) {
    const usb = vi.fn().mockRejectedValue(err);
    const w = mount(ConnectBar, { props: { connectors: { serial: connectors().serial, usb } } });
    await btn(w, 'USB direct')!.trigger('click');
    await flushPromises();
    return w;
  }
  const classified = (d = device) => new NoAtChannelError('This device has no AT channel.', false, classifyUsbDevice({ usb: d.usb, interfaceClasses: d.interfaces.map((i) => i.class) }), d);

  afterEach(() => {
    delete (navigator as any).platform;
  });

  test('shows what can be seen, calmly', async () => {
    const w = await rejecting(classified());
    expect(w.find('.seen').text()).toContain('What I can see');
    expect(w.find('h2').text()).toBe('Unisoc-based stick');
    expect(w.text()).toContain('1782:4056');
    expect(w.text()).toContain('Some Stick');
    expect(w.findAll('.diagram strong').map((s) => s.text())).toEqual(['Network RNDIS', 'Network data', 'Vendor', 'Storage', 'Network CDC']);
    expect(w.findAll('.diagram code').map((s) => s.text())[0]).toBe('e0/01');
    expect(w.text()).toContain('Why there is no more data');
    expect(w.text()).toContain('What to do');
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  const rndisOnly = { usb: '1782:4056', interfaces: [{ number: 0, class: 0xe0, subclass: 0x01 }, { number: 1, class: 0x0a, subclass: 0 }] };

  test('says plainly when macOS is the limit', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const w = await rejecting(classified(rndisOnly as typeof device));
    expect(w.text()).toContain('limit of macOS');
    expect(w.text()).toContain('no RNDIS driver');
  });

  test('does not blame macOS on another system, or for a stick with CDC networking', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    expect((await rejecting(classified(rndisOnly as typeof device))).text()).not.toContain('macOS');
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    expect((await rejecting(classified())).text()).not.toContain('macOS');
  });

  const mac = () => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  const cdcOnly = { usb: '12d1:14db', interfaces: [{ number: 0, class: 0x02, subclass: 0x06 }, { number: 1, class: 0x0a, subclass: 0 }] };

  test('a CDC stick on a Mac has no operating-system limit and keeps its link', async () => {
    mac();
    const w = await rejecting(classified(cdcOnly as typeof device));
    expect(w.text()).not.toContain('macOS');
    expect(w.find('.seen a').attributes('href')).toBe('http://192.168.8.1');
  });

  test('when macOS is the limit, the web page is not offered as a link', async () => {
    mac();
    const rndis = { ...rndisOnly, usb: '12d1:14db' };
    const w = await rejecting(classified(rndis as typeof device));
    expect(w.text()).toContain('limit of macOS');
    expect(w.find('.seen a:not(.bookmarklet)').exists()).toBe(false);
  });

  test.each([
    ['no classification', undefined],
    ['at', { kind: 'at', usb: '2c7c:6005' }],
    ['unknown', { kind: 'unknown', usb: '2c7c:6005' }],
  ] as const)('a probing failure (%s) never blames macOS and says what to do', async (_name, classification) => {
    mac();
    const failed = { usb: '2c7c:6005', interfaces: [{ number: 0, class: 0xe0, subclass: 0x01 }, { number: 3, class: 0xff, subclass: 0 }] };
    const w = await rejecting(new NoAtChannelError('Could not use the AT interface.', false, classification, failed));
    const card = w.find('.seen').text();
    expect(card).not.toContain('macOS');
    expect(card).toContain('Could not use the AT interface.');
    expect(card).toContain('What to do');
    expect(card).toContain('plug it back in');
    expect(card).toContain('other connection type');
    expect(card).toContain('another computer');
  });

  test('a failed probe also shows the card, with the reason', async () => {
    const w = await rejecting(new NoAtChannelError('No AT channel found on this modem.', false, undefined, device));
    expect(w.find('.seen').text()).toContain('No AT channel found');
    expect(w.findAll('.diagram li')).toHaveLength(5);
    expect(w.text()).not.toContain('undefined');
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  test('the demo has one, for trying it out', async () => {
    const w = await rejecting(demoNoAtError());
    expect(w.find('.seen').text()).toContain('Demo stick (fake)');
  });

  test('help covers a disk that appears while the modem is missing from the list', () => {
    const t = mount(HelpNoModem).text();
    expect(t).toContain('A disk appears and the modem is not in the list');
    expect(t).toContain('On a Mac');
  });
});

describe('ScanDetails', () => {
  test('hides sensitive fields and all raw text when asked to', () => {
    const item: ScanItem = {
      id: 'cgsn', command: 'AT+CGSN', category: 'identity', state: 'done', parser: 'cgsn',
      response: { command: 'AT+CGSN', status: 'ok', lines: ['123456789012345'], durationMs: 1 },
    };
    const w = mount(ScanDetails, { props: { items: [item], hideIdentifiers: true } });
    expect(w.text()).not.toContain('123456789012345');
    expect(w.text()).toContain(MASK);
    expect(w.find('pre').text()).toContain('Hidden');
  });

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

describe('IdentityHero', () => {
  const hero = (identity: object) => mount(IdentityHero, { props: { identity, chips: [], scanning: false } });

  test('unverified badge for unverified profile', () => {
    const p = PROFILES.find((x) => !x.verified)!;
    const w = hero({ profileId: p.id, profileLabel: p.label, verified: false });
    expect(w.text()).toContain('Unverified profile');
    expect(w.text()).toContain(p.id);
  });
  test('without a profile it says only generic commands ran', () => {
    expect(hero({}).text()).toContain('Generic commands only');
  });
  test('a missing model is said plainly', () => {
    expect(hero({}).text()).toContain('Unknown model');
    expect(hero({}).text()).not.toContain('undefined');
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

describe('importing a web capture', () => {
  const fileInput = (w: VueWrapper) => w.find('input[type="file"]');

  async function choose(w: VueWrapper, file: File, input = fileInput(w)): Promise<void> {
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await until(() => w.text().includes('Nothing was imported') || w.text().includes('Imported capture'));
  }
  const captureFile = (text = hilinkCapture()) => new File([text], 'capture.json', { type: 'application/json' });

  async function imported() {
    const w = mountApp();
    await choose(w, captureFile());
    return w;
  }
  const tabBtn = (w: VueWrapper, name: string) => w.findAll('.tabs button').find((b) => b.text() === name)!;

  test('the landing screen offers it under a clear label', () => {
    const w = mountApp();
    expect(w.find('label.import').text()).toContain('Import a modem capture');
    expect(fileInput(w).attributes('accept')).toContain('.json');
  });

  test('the Overview shows the imported modem', async () => {
    const w = await imported();
    const t = w.text();
    expect(t).toContain('Imported capture');
    expect(t).toContain('DEMO-STICK-1');
    expect(t).toContain('Huawei');
    expect(t).toContain('Demo Mobile');
    expect(t).toContain('On the network');
    expect(t).toContain('1850');
    expect(t).toContain('Verified profile');
  });

  test('hide identifiers works on it', async () => {
    const w = await imported();
    expect(w.text()).toContain('98000000000000000099');
    await w.find('[role="switch"]').trigger('click');
    for (const v of ['98000000000000000099', '001010123456789', '7654321', '192.0.2.10']) expect(w.text()).not.toContain(v);
  });

  test('diagnostics works, and deep and network scans say why they are off', async () => {
    const w = await imported();
    await tabBtn(w, 'Diagnostics').trigger('click');
    expect(w.text()).toContain('GET /api/device/signal');
    expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
    expect(btn(w, 'Network scan')!.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Deep scan and Network scan need a connected modem');
  });

  test('terminal and live signal say why they are off', async () => {
    const w = await imported();
    expect(w.text()).toContain('Live signal needs a connected modem');
    expect(w.find('.live input, .live button').attributes('disabled')).toBeDefined();
    await tabBtn(w, 'Terminal').trigger('click');
    expect(w.findComponent(TerminalPane).text()).toContain('imported from a file');
    expect(w.findComponent(TerminalPane).find('input').attributes('disabled')).toBeDefined();
  });

  test('the shared export goes through the redaction', async () => {
    const w = await imported();
    await btn(w, 'Export')!.trigger('click');
    await btn(w, 'Export JSON')!.trigger('click');
    const [name, text] = dl.mock.calls[0];
    expect(name).toBe('modemlens-report.json');
    expect(text).not.toContain('<response');
    for (const secret of IDENTIFIERS) expect(text, secret).not.toContain(secret);
  });

  test('the full export keeps the raw bodies, after the confirmation', async () => {
    const w = await imported();
    await btn(w, 'Export')!.trigger('click');
    await btn(w, 'Full export')!.trigger('click');
    expect(dl).not.toHaveBeenCalled();
    await btn(w, 'Download full JSON')!.trigger('click');
    expect(dl.mock.calls[0][1]).toContain('FAKESERIAL000001');
  });

  test('an invalid file shows a calm error and stays on the landing screen', async () => {
    const w = mountApp();
    await choose(w, captureFile('not a capture <script>alert(1)</script>'));
    const alert = w.find('.import-error');
    expect(alert.text()).toContain('Nothing was imported');
    expect(alert.text()).not.toContain('script');
    expect(w.find('.topbar').exists()).toBe(false);
  });

  test('a file over the limit is not even read', async () => {
    const w = mountApp();
    const file = captureFile();
    Object.defineProperty(file, 'size', { value: MAX_CAPTURE_BYTES + 1 });
    const read = vi.spyOn(file, 'text');
    await choose(w, file);
    expect(read).not.toHaveBeenCalled();
    expect(w.text()).toContain('too large');
  });

  test('markup from a capture stays text on the page', async () => {
    const body = '<response><DeviceName>&lt;img src=x onerror=alert(1)&gt;</DeviceName></response>';
    const w = mountApp();
    await choose(w, captureFile(hilinkCapture({ responses: [{ id: 'information', status: 200, body }] })));
    expect(w.text()).toContain('<img src=x onerror=alert(1)>');
    expect(w.find('.model img').exists()).toBe(false);
  });

  test('a real connection replaces the imported report and brings the tools back', async () => {
    const w = await imported();
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    expect(w.text()).not.toContain('Imported capture');
    expect(w.text()).not.toContain('DEMO-STICK-1');
    expect(w.text()).not.toContain('Live signal needs a connected modem');
    expect(btn(w, 'Network scan')!.attributes('disabled')).toBeUndefined();
  });

  test('importing during a session ends it and clears the old results', async () => {
    const w = await scanned();
    expect(w.text()).toContain('EC200A');
    const terminal = () => w.findComponent(TerminalPane);
    await terminal().find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await terminal().find('form').trigger('submit');
    await until(() => terminal().text().includes('+CSQ: 21,99'));
    await choose(w, captureFile(), w.findComponent(HelpNoModem).find('input[type="file"]'));
    await until(() => w.text().includes('DEMO-STICK-1'));
    expect(w.text()).toContain('Imported capture');
    expect(w.findComponent(Overview).text()).not.toContain('EC200A');
    expect(terminal().text()).not.toContain('+CSQ: 21,99');
    expect(terminal().text()).not.toContain('AT+CSQ');
  });

  test('the import in the guidance card replaces the card', async () => {
    const reject = () => Promise.reject(demoHiLinkError());
    const w = mountApp({ connectors: { serial: reject, usb: reject } });
    await btn(w, 'USB direct')!.trigger('click');
    await until(() => w.find('.seen').exists());
    await choose(w, captureFile(), w.find('.seen input[type="file"]'));
    expect(w.find('.seen').exists()).toBe(false);
    expect(w.text()).toContain('DEMO-STICK-1');
  });

  test('an import from elsewhere on the page also replaces the card', async () => {
    const w = mountApp({ demo: true, demoWeb: true, connectors: undefined, demoDelayMs: 0 });
    await btn(w, 'USB direct')!.trigger('click');
    await until(() => w.find('.seen').exists());
    await btn(w, 'Load the demo capture')!.trigger('click');
    await until(() => w.text().includes('Imported capture'));
    expect(w.find('.seen').exists()).toBe(false);
  });

  test('the demo capture goes through the same import, with fake values', async () => {
    const w = mountApp({ demo: true, demoWeb: true });
    await btn(w, 'Load the demo capture')!.trigger('click');
    await until(() => w.text().includes('Imported capture'));
    expect(w.text()).toContain('DEMO');
    expect(w.text()).toContain('Demo mode');
    expect(JSON.parse(demoWebCapture()).format).toBe('modemlens-web-capture');
    await btn(w, 'Export')!.trigger('click');
    await btn(w, 'Export JSON')!.trigger('click');
    expect(dl.mock.calls[0][1]).not.toContain('123456789012345');
  });

  test('the web demo shows the guidance card of a HiLink stick', async () => {
    const w = mountApp({ demo: true, demoWeb: true, connectors: undefined, demoDelayMs: 0 });
    await btn(w, 'USB direct')!.trigger('click');
    await until(() => w.find('.seen').exists());
    expect(w.find('.seen').text()).toContain('Huawei HiLink stick');
    expect(w.find('.seen').text()).toContain('Drag this to your bookmarks bar');
    expect(w.find('.seen').text()).not.toContain('ZTE');
  });
});

describe('WebModemPanel', () => {
  test('offers a link that cannot run on our own page', async () => {
    const w = mount(WebModemPanel, { props: { dialect: 'hilink' }, attachTo: document.body });
    wrappers.push(w);
    const a = w.find('a.bookmarklet');
    expect(a.text()).toBe('ModemLens capture');
    expect(w.find('.offer').text()).toContain('Drag this to your bookmarks bar');
    expect(a.attributes('href')).toBe(buildBookmarklet(WEB_DIALECTS[0]));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  test('copy puts the bookmarklet on the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const w = mount(WebModemPanel, { props: { dialect: 'hilink' } });
    await btn(w, 'Copy')!.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(buildBookmarklet(WEB_DIALECTS[0]));
    expect(w.text()).toContain('Copied');
    delete (navigator as any).clipboard;
  });

  test('a blocked clipboard is explained', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    const w = mount(WebModemPanel, { props: { dialect: 'hilink' } });
    await btn(w, 'Copy')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('copy its address');
    delete (navigator as any).clipboard;
  });

  test('without a known dialect both are offered and the ZTE one is marked unverified', () => {
    const w = mount(WebModemPanel);
    expect(w.findAll('a.bookmarklet')).toHaveLength(2);
    const zte = w.findAll('.offer').find((o) => o.text().includes('ZTE'))!;
    expect(zte.text()).toContain('Unverified');
    const hilink = w.findAll('.offer').find((o) => o.text().includes('HiLink'))!;
    expect(hilink.text()).not.toContain('Unverified');
  });

  test('it has one line of steps and the import', () => {
    const w = mount(WebModemPanel, { props: { dialect: 'hilink' } });
    expect(w.find('.steps').text()).toContain('own web page');
    expect(w.findComponent(ImportCapture).exists()).toBe(true);
  });

  test('the help panel offers the bookmarklet', () => {
    const w = mount(HelpNoModem);
    expect(w.text()).toContain('Drag this to your bookmarks bar');
    expect(w.findAll('a.bookmarklet').length).toBeGreaterThan(0);
  });
});
