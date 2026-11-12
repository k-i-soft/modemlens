import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

vi.mock('../../src/ui/download', () => ({ downloadText: vi.fn() }));

import App from '../../src/App.vue';
import { AtEngine } from '../../src/at/engine';
import { createDemoSettings, createDemoTransport } from '../../src/ui/demo';
import type { DemoSettings } from '../../src/ui/demo';

const wrappers: VueWrapper[] = [];
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  vi.restoreAllMocks();
  delete (navigator as any).serial;
  delete (navigator as any).usb;
});
beforeEach(() => {
  (navigator as any).serial = {};
  (navigator as any).usb = {};
});

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
  }
}

const btn = (w: VueWrapper | ReturnType<VueWrapper['find']>, text: string) => w.findAll('button').find((b) => b.text().includes(text));
const tool = (w: VueWrapper, id: string) => w.find(`[data-tool="${id}"]`);
const pastGuard = () => new Promise((r) => setTimeout(r, 650));

describe('Tools in the Actions tab', () => {
  let settings: DemoSettings;
  let send: MockInstance<AtEngine['send']>;
  const sent = (): string[] => send.mock.calls.map((c) => c[0] as string);

  beforeEach(() => {
    settings = createDemoSettings();
    send = vi.spyOn(AtEngine.prototype, 'send');
  });

  /** How many commands had been sent when the Actions tab was opened. */
  let atOpen = 0;

  async function opened(): Promise<VueWrapper> {
    const make = () => Promise.resolve(createDemoTransport({ delayMs: 0, settings }));
    const w = mount(App, { props: { connectors: { serial: make, usb: make }, donateUrl: null }, attachTo: document.body });
    wrappers.push(w);
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    atOpen = sent().length;
    await btn(w.find('nav.tabs'), 'Actions')!.trigger('click');
    await until(() => tool(w, 'pin').exists() && tool(w, 'pin').text().includes('Attempts left'));
    return w;
  }

  test('every tool the demo modem answers is shown, and only read and test forms were sent to find them', async () => {
    const w = await opened();
    expect(['pin', 'ping', 'ussd', 'operator', 'sms'].filter((t) => tool(w, t).exists())).toEqual(['pin', 'ping', 'ussd', 'operator', 'sms']);
    // The settings read their QCFG values in the bare form, which is a read too.
    for (const c of sent().slice(atOpen)) expect(c, c).toMatch(/(\?|=\?|="SC",2|="SC")$|^AT\+QCFG="[a-z]+"$/);
    expect(tool(w, 'pin').text()).toContain('PIN 3, PUK 10');
  });

  test('changing the PIN: masked in the confirmation, two clicks, nothing of the code on the page afterwards', async () => {
    const w = await opened();
    const pin = tool(w, 'pin');
    await btn(pin, 'Change PIN')!.trigger('click');
    const inputs = pin.findAll('input[type="password"]');
    expect(inputs).toHaveLength(3);
    await inputs[0].setValue('1234');
    await inputs[1].setValue('5678');
    await inputs[2].setValue('5678');
    await pin.find('form').trigger('submit');
    expect(pin.text()).toContain('AT+CPWD="SC","****","****"');
    expect(sent().some((c) => c.startsWith('AT+CPWD'))).toBe(false);
    await btn(pin, 'Confirm')!.trigger('click');
    expect(sent().some((c) => c.startsWith('AT+CPWD'))).toBe(false);
    await pastGuard();
    await btn(pin, 'Send anyway')!.trigger('click');
    await until(() => pin.text().includes('The PIN is changed.'));
    expect(settings.tools.pin).toBe('5678');
    expect(sent().filter((c) => c.startsWith('AT+CPWD'))).toEqual(['AT+CPWD="SC","1234","5678"']);
    expect(document.body.innerHTML).not.toMatch(/"(1234|5678)"/);
    expect(document.body.innerHTML).not.toContain('value="5678"');
    expect(pin.findAll('input').every((i) => (i.element as HTMLInputElement).value === '')).toBe(true);
  });

  test('a wrong PIN is sent once and the count goes down', async () => {
    const w = await opened();
    const pin = tool(w, 'pin');
    await btn(pin, 'Stop asking')!.trigger('click');
    await pin.find('input[type="password"]').setValue('9999');
    await pin.find('form').trigger('submit');
    await btn(pin, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(pin, 'Send anyway')!.trigger('click');
    await until(() => pin.text().includes('incorrect password'));
    expect(sent().filter((c) => c.startsWith('AT+CLCK="SC",0'))).toHaveLength(1);
    await until(() => pin.text().includes('PIN 2, PUK 10'));
  });

  test('a locked SIM is unlocked, and on the last attempt the PIN has to be typed twice', async () => {
    settings.tools.state = 'SIM PIN';
    settings.tools.pinLeft = 1;
    const w = await opened();
    const pin = tool(w, 'pin');
    await btn(pin, 'Unlock with PIN')!.trigger('click');
    const inputs = pin.findAll('input[type="password"]');
    expect(inputs).toHaveLength(2);
    await inputs[0].setValue('1234');
    await inputs[1].setValue('1235');
    await pin.find('form').trigger('submit');
    expect(pin.text()).toContain('differ');
    await inputs[1].setValue('1234');
    await pin.find('form').trigger('submit');
    expect(pin.text()).toContain('This is the last PIN attempt');
    await btn(pin, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(pin, 'Send anyway')!.trigger('click');
    await until(() => pin.text().includes('The SIM is unlocked.'), 6000);
    expect(settings.tools.state).toBe('READY');
  }, 10000);

  test('USSD: a menu, a reply, and the answer', async () => {
    const w = await opened();
    const u = tool(w, 'ussd');
    await u.find('input').setValue('*123#');
    await u.find('form').trigger('submit');
    await btn(u, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(u, 'Send anyway')!.trigger('click');
    await until(() => u.text().includes('waits for your reply'));
    expect(u.find('pre.answer').text()).toBe('Demo menu\n1 Balance\n2 Exit');
    await u.find('input').setValue('1');
    await u.find('form').trigger('submit');
    await btn(u, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(u, 'Send anyway')!.trigger('click');
    await until(() => u.text().includes('Your balance is 12.50.'));
  });

  test('ping: four answers, no confirmation, nothing written', async () => {
    const w = await opened();
    const p = tool(w, 'ping');
    await p.find('form').trigger('submit');
    await until(() => p.findAll('.ping-bars li').length === 4, 5000);
    expect(p.find('.ping-head').text()).toContain('41 ms average');
    expect(p.find('.ping-stats').text()).toContain('4 of 4');
    expect(p.find('details.raw').exists()).toBe(true);
    expect((p.find('details.raw').element as HTMLDetailsElement).open).toBe(false);
    expect(sent().filter((c) => /^AT\+QPING=1/.test(c))).toEqual(['AT+QPING=1,"8.8.8.8",4,4']);
  });

  test('SMS: read, delete with two clicks, send in PDU mode', async () => {
    const w = await opened();
    const s = tool(w, 'sms');
    await btn(s, 'Read messages')!.trigger('click');
    await until(() => s.text().includes('Grüezi from the demo €'));
    expect(s.text()).toContain('2 of 20 used');
    expect(s.text()).toContain('new');
    await btn(s.find('.messages'), 'Delete')!.trigger('click');
    await btn(s, 'Confirm')!.trigger('click');
    expect(s.text()).toContain('cannot be brought back');
    await pastGuard();
    await btn(s, 'Send anyway')!.trigger('click');
    await until(() => s.text().includes('1 of 20 used'));
    expect(settings.tools.sms.has(0)).toBe(false);

    await s.find('input[type="tel"]').setValue('+10000000009');
    await s.find('textarea').setValue('Hello from ModemLens');
    await s.findAll('form').at(-1)!.trigger('submit');
    await btn(s, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(s, 'Send anyway')!.trigger('click');
    await until(() => s.text().includes('Sent.'), 5000);
    expect(sent().filter((c) => c.startsWith('AT+CMGS='))).toHaveLength(1);
  }, 12000);

  test('hide identifiers hides SMS numbers and texts', async () => {
    const w = await opened();
    const s = tool(w, 'sms');
    await btn(s, 'Read messages')!.trigger('click');
    await until(() => s.text().includes('Grüezi'));
    await w.find('input[role="switch"], .switch input, input[type="checkbox"]').setValue(true);
    await until(() => !s.text().includes('Grüezi'));
    expect(s.text()).not.toContain('+10000000002');
  });

  test('operator: search, a manual choice, back to automatic', async () => {
    const w = await opened();
    const o = tool(w, 'operator');
    await until(() => o.text().includes('Automatic'));
    await btn(o, 'Search networks')!.trigger('click');
    await until(() => o.text().includes('Other Demo'));
    const otherRow = o.findAll('.networks li').find((li) => li.text().includes('Other Demo'))!;
    await btn(otherRow, 'Use')!.trigger('click');
    await btn(o, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(o, 'Send anyway')!.trigger('click');
    await until(() => settings.tools.copsMode === '1');
    expect(sent()).toContain('AT+COPS=1,2,"00102",7');
  });
});

describe('Speed test in the demo', () => {
  test('both tests run against stand-ins and never touch the network', async () => {
    const realFetch = vi.spyOn(globalThis, 'fetch');
    const w = mount(App, { props: { demo: true, demoDelayMs: 0, donateUrl: null }, attachTo: document.body });
    wrappers.push(w);
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    await btn(w.find('nav.tabs'), 'Actions')!.trigger('click');
    await until(() => tool(w, 'speed').exists() && !!btn(tool(w, 'speed'), 'Test inside the modem'));
    const s = tool(w, 'speed');

    await btn(s, 'Test through this computer')!.trigger('click');
    expect(s.text()).toContain('speed.cloudflare.com, stat.ripe.net');
    expect(s.text()).toContain('switch off Wi-Fi');
    await btn(s, 'Confirm')!.trigger('click');
    await until(() => s.find('.speed-result').exists(), 15000);
    const tiles = s.findAll('.speed-tile').map((t) => t.find('.speed-label').text());
    expect(tiles).toEqual(['Download', 'Upload', 'Latency']);
    expect(s.text()).toContain('DEMO-MOBILE Demo Mobile Ltd');
    expect(s.text()).toContain("This matches the modem's operator, Demo Mobile.");

    await btn(s, 'Test inside the modem')!.trigger('click');
    await btn(s, 'Confirm')!.trigger('click');
    await pastGuard();
    await btn(s, 'Send anyway')!.trigger('click');
    await until(() => s.text().includes('Inside the modem') && s.text().includes('MB in'), 8000);
    // Only the page's own files: the speed test went to the stand-in.
    for (const c of realFetch.mock.calls) expect(String(c[0])).not.toMatch(/cloudflare|ripe/);
  }, 25000);
});
