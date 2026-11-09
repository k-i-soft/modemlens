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

  test('network scan and terminal do not leak terminal traffic into export', async () => {
    const w = await scanned();
    await w.findAll('nav button')[1].trigger('click');
    await w.find('input[aria-label="AT command"]').setValue('AT+CSQ');
    await w.find('form').trigger('submit');
    await until(() => w.text().includes('[ok]'));
    await w.findAll('nav button')[0].trigger('click');
    await btn(w, 'Full export')!.trigger('click');
    await btn(w, 'Download full JSON')!.trigger('click');
    const report = JSON.parse(dl.mock.calls[0][1]);
    expect(report.items.filter((i: ScanItem) => i.command === 'AT+CSQ')).toHaveLength(1);
  });

  test('without connectors the connect button shows a clear error', async () => {
    const w = mount(App, { attachTo: document.body });
    wrappers.push(w);
    await btn(w, 'Serial port')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('not available yet');
  });

  test('donate hidden by default config, shown with url', async () => {
    const w = mountApp({ donateUrl: 'https://example.org/donate' });
    expect(w.findAll('a.donate').length).toBeGreaterThan(0);
    const w2 = mountApp({ donateUrl: null });
    expect(w2.find('a.donate').exists()).toBe(false);
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
});
