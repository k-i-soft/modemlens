import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import App from '../../src/App.vue';
import { createDemoTransport } from '../../src/ui/demo';
import type { DemoTransport } from '../../src/ui/demo';

const wrappers: VueWrapper[] = [];
let transport: DemoTransport;

const COPY = [
  'What ModemLens is for',
  'Know what you have', 'Model, firmware, SIM state, enabled LTE bands and USB mode, read from the modem itself.',
  'See why a connection is weak', 'Signal quality with plain ratings, the serving cell and its neighbours, and a live signal graph.',
  'Change settings on purpose', 'APN, USB mode, NAT and more on supported modems. Each change asks first and is read back afterwards.',
  'Share a report safely', 'The default export masks IMEI, IMSI, phone numbers and addresses, so you can attach it to a support ticket.',
  'How it works',
  'Plug in your modem and click USB direct.', "Pick it in your browser's device list.", 'ModemLens reads it, without changing anything.',
  'Which modems work',
  "Modems with an AT channel work directly. Tested on the Quectel EC200A and an ASR-based stick, and unknown modems get a best effort scan. Web-based sticks such as Huawei HiLink can be read with a small bookmark. A stick that first appears as a USB disk needs one switch into network mode, which a browser cannot do, so on macOS and Linux a small helper script does it. On Windows, USB direct needs a WinUSB driver on the modem's AT interface.",
  'Your data stays with you',
  'ModemLens runs entirely in your browser. What it reads from your modem is not sent anywhere. Only the speed test, when you start it, exchanges test data with Cloudflare and asks RIPE which network it went through; both see your IP address. Page downloads appear in the server logs, as on any website, and K-I-Soft evaluates those logs for visitor statistics.',
  'Open source', 'ModemLens is free and MIT licensed.',
  'Built by K-I-Soft',
  'K-I-Soft is a small Swiss software company near Bern. We build and run customer portals for Swiss SMEs, hosted in Zurich, and we built ModemLens because we needed it ourselves.',
];

const LANDING_LINKS: Array<[string, string]> = [
  ['Source code on GitHub', 'https://github.com/k-i-soft/modemlens'],
  ['small helper script', 'https://github.com/k-i-soft/modemlens/blob/main/scripts/huawei-hilink-switch.js'],
  ['Visit k-i-soft.ch', 'https://www.k-i-soft.ch/en/'],
  ['Have a project in mind? Talk to us.', 'https://www.k-i-soft.ch/en/kontakt/'],
];
const FOOTER_LINKS: Array<[string, string]> = [
  ['By K-I-Soft', 'https://www.k-i-soft.ch/en/'],
  ['Imprint', 'https://www.k-i-soft.ch/en/impressum/'],
  ['Privacy', 'https://www.k-i-soft.ch/en/datenschutz/'],
];

function app(extra: Record<string, unknown> = {}): VueWrapper {
  const make = () => {
    transport = createDemoTransport({ delayMs: 0 });
    return Promise.resolve(transport);
  };
  const w = mount(App, { props: { connectors: { serial: make, usb: make }, donateUrl: null, ...extra }, attachTo: document.body });
  wrappers.push(w);
  return w;
}

const link = (w: VueWrapper, text: string) => w.findAll('a').find((a) => a.text() === text);
const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().includes(text))!;
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

async function connect(w: VueWrapper): Promise<void> {
  await button(w, 'Serial port').trigger('click');
  for (let i = 0; i < 600 && !w.text().includes('Automatic scan finished'); i++) {
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
  }
  expect(w.text()).toContain('Automatic scan finished');
}

beforeEach(() => {
  (navigator as any).serial = {};
  (navigator as any).usb = {};
});
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  delete (navigator as any).serial;
  delete (navigator as any).usb;
});

describe('landing content', () => {
  test.each(COPY)('shows before connecting: %s', (text) => {
    expect(collapse(app().find('.landing-content').text())).toContain(text);
  });

  test('comes after the connect buttons', () => {
    const w = app();
    const buttonEl = button(w, 'USB direct').element;
    const content = w.find('.landing-content').element;
    expect(buttonEl.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('each use has its own drawn icon', () => {
    const icons = app().findAll('.uses svg');
    expect(icons).toHaveLength(4);
    expect(new Set(icons.map((i) => i.html())).size).toBe(4);
  });

  test('stays in the no-modem state of a failed connection', async () => {
    const fail = () => Promise.reject(new Error('nothing there'));
    const w = app({ connectors: { serial: fail, usb: fail } });
    await button(w, 'Serial port').trigger('click');
    await flushPromises();
    expect(w.find('.landing-content').exists()).toBe(true);
  });

  test('is gone once a modem is connected, along with the demo link', async () => {
    const w = app();
    await connect(w);
    expect(w.find('.landing-content').exists()).toBe(false);
    expect(link(w, 'Try the demo')).toBeUndefined();
    for (const [text] of LANDING_LINKS) expect(link(w, text)).toBeUndefined();
    expect(w.text()).not.toContain('Built by K-I-Soft');
  });

  test('does not come back when the connection is lost', async () => {
    const w = app();
    await connect(w);
    transport.disconnect('pulled');
    await flushPromises();
    expect(w.find('.landing-content').exists()).toBe(false);
  });

  test.each(LANDING_LINKS)('%s goes to %s, in a new tab, without an opener', (text, href) => {
    const a = link(app(), text)!;
    expect(a.attributes('href')).toBe(href);
    expect(a.attributes('target')).toBe('_blank');
    expect(a.attributes('rel')).toBe('noopener');
  });

  test('every external link on the page has target and rel', () => {
    const external = app().findAll('a').filter((a) => /^https?:/.test(a.attributes('href') ?? ''));
    expect(external.length).toBeGreaterThanOrEqual(LANDING_LINKS.length + FOOTER_LINKS.length);
    for (const a of external) {
      expect(a.attributes('target'), a.text()).toBe('_blank');
      expect(a.attributes('rel'), a.text()).toBe('noopener');
    }
  });

  test('offers the demo beside the connect buttons', () => {
    const w = app();
    const a = link(w, 'Try the demo')!;
    expect(a.attributes('href')).toBe('?demo=1');
    expect(a.attributes('target')).toBeUndefined();
    expect(w.find('.start').element.contains(a.element)).toBe(true);
  });

  test('a demo does not offer itself', () => {
    expect(link(app({ demo: true }), 'Try the demo')).toBeUndefined();
  });

  test('loads nothing from another host and keeps to the content security policy', () => {
    const source = readFileSync('src/ui/LandingContent.vue', 'utf8');
    expect(source).not.toMatch(/<img|<script\s+src|<link\s|\sstyle="|:style=|v-html|url\(/);
  });

  test('no dashes as punctuation in the copy', () => {
    for (const text of COPY) expect(text).not.toMatch(/\s[-–—]\s|–|—/);
  });
});

describe('footer', () => {
  test.each(FOOTER_LINKS)('%s goes to %s before connecting', (text, href) => {
    const a = link(app(), text)!;
    expect(a.element.closest('footer')).not.toBeNull();
    expect(a.attributes('href')).toBe(href);
    expect(a.attributes('target')).toBe('_blank');
    expect(a.attributes('rel')).toBe('noopener');
  });

  test('stays when a modem is connected, and nothing else from the landing does', async () => {
    const w = app();
    await connect(w);
    for (const [text, href] of FOOTER_LINKS) expect(link(w, text)!.attributes('href')).toBe(href);
  });
});
