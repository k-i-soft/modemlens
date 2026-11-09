import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

vi.mock('../../src/ui/download', () => ({ downloadText: vi.fn() }));

import App from '../../src/App.vue';
import { AtEngine } from '../../src/at/engine';
import type { AtResponse, SendOptions } from '../../src/at/engine';
import { Scanner } from '../../src/scan/scanner';
import { createDemoSettings, createDemoTransport, demoWebCapture } from '../../src/ui/demo';
import type { DemoSettings, DemoTransport } from '../../src/ui/demo';
import { downloadText } from '../../src/ui/download';
import { REFRESH_INTERVAL_MS, URC_DEBOUNCE_MS } from '../../src/ui/statusRefresh';
import { importWebCapture } from '../../src/web/importReport';

const ORIGINAL_SEND = AtEngine.prototype.send;
const CYCLE_MARKER = 'AT+CGATT?';
const dl = vi.mocked(downloadText);
const wrappers: VueWrapper[] = [];

let lastTransport: DemoTransport;
let settings: DemoSettings;
let send: MockInstance<AtEngine['send']>;
const sent = (): string[] => send.mock.calls.map((c) => c[0] as string);
const count = (command: string): number => sent().filter((c) => c === command).length;

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().includes(text));
const status = (w: VueWrapper) => w.find('.network').text();

async function until(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (fn()) return;
    await tick(10);
    await flushPromises();
  }
  throw new Error('timeout waiting for condition');
}

async function scanned(): Promise<VueWrapper> {
  const make = () => {
    lastTransport = createDemoTransport({ delayMs: 0, settings });
    return Promise.resolve(lastTransport);
  };
  const w = mount(App, { props: { connectors: { serial: make, usb: make }, donateUrl: null }, attachTo: document.body });
  wrappers.push(w);
  await btn(w, 'Serial port')!.trigger('click');
  await until(() => w.text().includes('Automatic scan finished'));
  return w;
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

function hold(command: string): { release: () => void } {
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  send.mockImplementation(async function (this: AtEngine, c: string, opts?: SendOptions): Promise<AtResponse> {
    if (c === command) await gate;
    return ORIGINAL_SEND.call(this, c, opts);
  });
  return { release };
}

beforeEach(() => {
  vi.useFakeTimers();
  (navigator as any).serial = {};
  (navigator as any).usb = {};
  settings = createDemoSettings();
  send = vi.spyOn(AtEngine.prototype, 'send');
});
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  vi.restoreAllMocks();
  dl.mockClear();
  delete (document as any).visibilityState;
  delete (navigator as any).serial;
  delete (navigator as any).usb;
  vi.useRealTimers();
});

describe('Overview stays current', () => {
  test('switching the radio off in Actions shows on the Overview without a reload, and on again', async () => {
    const w = await scanned();
    expect(status(w)).toBe('On the network');
    await w.findAll('nav button')[3].trigger('click');
    await until(() => w.find('[data-action="radio"] .value').text() === 'On');
    const row = () => w.find('[data-action="radio"]');
    const click = async (text: string) => {
      await until(() => !row().findAll('button').find((b) => b.text().includes(text))!.element.disabled);
      await row().findAll('button').find((b) => b.text().includes(text))!.trigger('click');
    };
    await click('Off');
    await click('Confirm');
    // Well inside the interval: this is the cycle that follows a successful action.
    await tick(1000);
    await flushPromises();
    expect(status(w)).toBe('Radio off');
    expect(w.find('.network').attributes('data-tone')).toBe('neutral');
    expect(w.find('.signal').text()).toContain('Radio off');
    await click('On');
    await click('Confirm');
    await tick(1000);
    await flushPromises();
    expect(status(w)).toBe('On the network');
  });

  test('auto refresh is on after the scan, and says how old the reading is', async () => {
    const w = await scanned();
    expect(w.find('.auto-refresh input').element).toHaveProperty('checked', true);
    await tick(3000);
    expect(w.find('.auto-refresh').text()).toContain('Updated 3 s ago');
  });

  test('a change on the modem shows after a cycle, with no command from outside the list', async () => {
    const w = await scanned();
    const before = sent().length;
    settings.radio = '4';
    await tick(REFRESH_INTERVAL_MS);
    await flushPromises();
    expect(status(w)).toBe('Radio off');
    expect(new Set(sent().slice(before))).toEqual(new Set([
      'AT+CFUN?', 'AT+CPIN?', 'AT+CREG?', 'AT+CEREG?', 'AT+COPS?', 'AT+CESQ', 'AT+CSQ', 'AT+CGATT?', 'AT+CGACT?', 'AT+CGPADDR',
      'AT+QNWINFO', 'AT+QENG="servingcell"', 'AT+QCSQ', 'AT+QNETDEVCTL?',
    ]));
  });

  test('a running cycle is shown quietly', async () => {
    const w = await scanned();
    const held = hold('AT+CPIN?');
    await tick(REFRESH_INTERVAL_MS);
    await flushPromises();
    expect(w.find('.auto-refresh').text()).toContain('Refreshing');
    held.release();
    await until(() => !w.find('.auto-refresh').text().includes('Refreshing'));
  });

  test('neither exports nor Diagnostics change', async () => {
    const exported = async (w: VueWrapper): Promise<string[]> => {
      dl.mockClear();
      await btn(w, 'Export JSON')!.trigger('click');
      if (btn(w, 'Full export')) await btn(w, 'Full export')!.trigger('click');
      await btn(w, 'Download full JSON')!.trigger('click');
      return dl.mock.calls.map((c) => c[1]);
    };
    const w = await scanned();
    const before = await exported(w);
    await w.findAll('nav button')[1].trigger('click');
    const diagnostics = w.findComponent({ name: 'Diagnostics' }).props('items');
    const snapshot = JSON.stringify(diagnostics);
    await w.findAll('nav button')[0].trigger('click');

    settings.radio = '4';
    await tick(REFRESH_INTERVAL_MS);
    await flushPromises();
    expect(status(w)).toBe('Radio off');

    expect(JSON.stringify(w.findComponent({ name: 'Diagnostics' }).props('items'))).toBe(snapshot);
    const after = await exported(w);
    expect(after).toEqual(before);
    expect(after.join()).not.toContain('+CFUN: 4');
  });

  describe('pauses', () => {
    async function pausesWhile(w: VueWrapper, resume: () => void | Promise<void>): Promise<void> {
      const before = count(CYCLE_MARKER);
      await tick(REFRESH_INTERVAL_MS * 3);
      await flushPromises();
      expect(count(CYCLE_MARKER)).toBe(before);
      await resume();
      await tick(REFRESH_INTERVAL_MS);
      await flushPromises();
      expect(count(CYCLE_MARKER)).toBeGreaterThan(before);
      expect(w.exists()).toBe(true);
    }

    test('while the browser tab is hidden', async () => {
      const w = await scanned();
      setHidden(true);
      await pausesWhile(w, () => setHidden(false));
    });

    test('during a scan', async () => {
      let finish = (): void => {};
      vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise((r) => (finish = () => r({} as never))));
      const w = await scanned();
      await btn(w, 'Network scan')!.trigger('click');
      await flushPromises();
      await pausesWhile(w, finish);
    });

    test('while a terminal command is in flight', async () => {
      const h = hold('AT+QTERMTEST?');
      const w = await scanned();
      await w.findAll('nav button')[2].trigger('click');
      await w.find('input[aria-label="AT command"]').setValue('AT+QTERMTEST?');
      await w.find('form').trigger('submit');
      await flushPromises();
      await pausesWhile(w, h.release);
    });

    test('during an action', async () => {
      const h = hold('AT+QCFG="roamservice"');
      const w = await scanned();
      await w.findAll('nav button')[3].trigger('click');
      await flushPromises();
      await pausesWhile(w, h.release);
    });
  });

  describe('stops', () => {
    test('on a disconnect', async () => {
      const w = await scanned();
      lastTransport.disconnect('pulled');
      await flushPromises();
      const before = sent().length;
      await tick(REFRESH_INTERVAL_MS * 3);
      expect(sent().length).toBe(before);
      expect(w.find('.auto-refresh').exists()).toBe(false);
    });

    test('for an imported report', async () => {
      const w = await scanned();
      settings.radio = '4';
      await tick(REFRESH_INTERVAL_MS);
      await flushPromises();
      w.findComponent({ name: 'ConnectBar' }).vm.$emit('imported', importWebCapture(demoWebCapture()));
      await flushPromises();
      const before = sent().length;
      await tick(REFRESH_INTERVAL_MS * 3);
      expect(sent().length).toBe(before);
      expect(w.find('.auto-refresh').exists()).toBe(false);
      expect(w.text()).not.toContain('Radio off');
    });

    test('and a new scan starts from its own answers', async () => {
      settings.radio = '4';
      const w = await scanned();
      expect(status(w)).toBe('Radio off');
      settings.radio = '1';
      await tick(REFRESH_INTERVAL_MS);
      await flushPromises();
      expect(status(w)).toBe('On the network');
    });
  });

  test('an unsolicited line triggers one cycle, and its text goes nowhere', async () => {
    const urc = vi.spyOn(AtEngine.prototype, 'onUrc');
    const w = await scanned();
    const before = count(CYCLE_MARKER);
    urc.mock.calls[0][0]('+CMTI: "SECRET-URC-TEXT",7');
    urc.mock.calls[0][0]('+CMTI: "SECRET-URC-TEXT",8');
    await tick(URC_DEBOUNCE_MS);
    await flushPromises();
    expect(count(CYCLE_MARKER)).toBe(before + 1);
    expect(w.html()).not.toContain('SECRET-URC-TEXT');
    await btn(w, 'Export JSON')!.trigger('click');
    expect(dl.mock.calls.flat().join()).not.toContain('SECRET-URC-TEXT');
  });

  test('turning it off stops the cycles', async () => {
    const w = await scanned();
    await w.find('.auto-refresh input').setValue(false);
    const before = count(CYCLE_MARKER);
    await tick(REFRESH_INTERVAL_MS * 3);
    expect(count(CYCLE_MARKER)).toBe(before);
  });

  test('two cycles without an answer stop it and say so; Resume starts it again', async () => {
    const w = await scanned();
    send.mockImplementation(async (command: string) => ({ command, status: 'timeout', lines: [], durationMs: 5000 }));
    await tick(REFRESH_INTERVAL_MS);
    await flushPromises();
    expect(w.text()).not.toContain('Auto refresh paused');
    await tick(REFRESH_INTERVAL_MS);
    await flushPromises();
    expect(w.find('.auto-refresh').text()).toContain('Auto refresh paused: the modem stopped answering');
    const before = sent().length;
    await tick(REFRESH_INTERVAL_MS * 3);
    expect(sent().length).toBe(before);

    send.mockImplementation(async function (this: AtEngine, c: string, opts?: SendOptions) {
      return ORIGINAL_SEND.call(this, c, opts);
    });
    await btn(w, 'Resume')!.trigger('click');
    await until(() => !w.text().includes('Auto refresh paused'));
    expect(sent().length).toBeGreaterThan(before);
  });
});
