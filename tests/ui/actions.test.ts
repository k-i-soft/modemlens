import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

vi.mock('../../src/ui/download', () => ({ downloadText: vi.fn() }));

import App from '../../src/App.vue';
import ActionsPanel from '../../src/ui/ActionsPanel.vue';
import { AtEngine } from '../../src/at/engine';
import type { AtResponse, AtStatus, SendOptions } from '../../src/at/engine';
import { ACTIONS } from '../../src/actions/ec200a';
import type { ActionSend } from '../../src/actions/types';
import { createDemoSettings, createDemoTransport } from '../../src/ui/demo';
import type { DemoSettings, DemoTransport } from '../../src/ui/demo';
import { downloadText } from '../../src/ui/download';
import { Scanner } from '../../src/scan/scanner';

const ORIGINAL_SEND = AtEngine.prototype.send;
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

const WRITES = ACTIONS.flatMap((a) => a.choices.map((c) => c.command));
const isWrite = (c: string): boolean => WRITES.includes(c) || /^AT\+CGDCONT=/.test(c);
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().includes(text));
const row = (w: VueWrapper, id: string) => w.find(`[data-action="${id}"]`);
/** A little longer than the panel holds back the second confirmation. */
const pastSecondConfirmGuard = () => new Promise((r) => setTimeout(r, 650));
const rowBtn = (w: VueWrapper, id: string, text: string) => row(w, id).findAll('button').find((b) => b.text().includes(text));

describe('Actions tab in the app', () => {
  let lastTransport: DemoTransport;
  let settings: DemoSettings;
  let send: MockInstance<AtEngine['send']>;
  const sent = (): string[] => send.mock.calls.map((c) => c[0] as string);
  const writes = (): string[] => sent().filter(isWrite);

  /** Answers one command without asking the modem. */
  function answer(command: string, response: AtResponse): void {
    send.mockImplementation(async function (this: AtEngine, c: string, opts?: SendOptions): Promise<AtResponse> {
      return c === command ? response : ORIGINAL_SEND.call(this, c, opts);
    });
  }

  function connectors() {
    const make = () => {
      lastTransport = createDemoTransport({ delayMs: 0, settings });
      return Promise.resolve(lastTransport);
    };
    return { serial: make, usb: make };
  }

  async function scanned(): Promise<VueWrapper> {
    const w = mount(App, { props: { connectors: connectors(), donateUrl: null }, attachTo: document.body });
    wrappers.push(w);
    await btn(w, 'Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    return w;
  }

  const openTab = (w: VueWrapper) => w.findAll('nav button')[3].trigger('click');

  async function opened(): Promise<VueWrapper> {
    const w = await scanned();
    await openTab(w);
    await until(() => row(w, 'nat').find('.value').text() === 'Modem does NAT' && !rowBtn(w, 'nat', 'Carrier')!.element.disabled);
    return w;
  }

  beforeEach(() => {
    settings = createDemoSettings();
    send = vi.spyOn(AtEngine.prototype, 'send');
  });

  /** Holds the answer to one command until `release` is called. */
  function hold(command: string): { release: () => void } {
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    send.mockImplementation(async function (this: AtEngine, c: string, opts?: SendOptions): Promise<AtResponse> {
      if (c === command) await gate;
      return ORIGINAL_SEND.call(this, c, opts);
    });
    return { release };
  }

  test('opening the tab reads the current values and writes nothing', async () => {
    const w = await scanned();
    expect(sent()).not.toContain('AT+QNETDEVCTL?');
    await openTab(w);
    await until(() => sent().includes('AT+QCFG="roamservice"'));
    await until(() => row(w, 'roaming').find('.value').text() === 'On');
    expect(writes()).toEqual([]);
    expect(row(w, 'apn').find('.value').text()).toBe('demo.apn (IP)');
    expect(row(w, 'data').find('.value').text()).toBe('Off');
    expect(row(w, 'radio').find('.value').text()).toBe('On');
    expect(row(w, 'usb-mode').find('.value').text()).toBe('ECM');
    expect(row(w, 'network-mode').find('.value').text()).toBe('Automatic');
  });

  test('picking a value sends nothing; cancelling sends nothing; only the confirm click does', async () => {
    const w = await opened();
    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    await flushPromises();
    expect(writes()).toEqual([]);
    expect(row(w, 'nat').find('.confirm').text()).toContain('Modem does NAT');
    expect(row(w, 'nat').find('.confirm').text()).toContain('Carrier address on the computer');
    expect(row(w, 'nat').find('.confirm').text()).toContain('AT+QCFG="nat",1');
    await rowBtn(w, 'nat', 'Cancel')!.trigger('click');
    await flushPromises();
    expect(writes()).toEqual([]);
    expect(row(w, 'nat').find('.confirm').exists()).toBe(false);

    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    await rowBtn(w, 'nat', 'Confirm')!.trigger('click');
    await until(() => row(w, 'nat').find('.result').exists());
    expect(writes()).toEqual(['AT+QCFG="nat",1']);
    expect(settings.qcfg.nat).toBe('1');
  });

  test('the strong NAT warning is shown before anything is sent', async () => {
    const w = await opened();
    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    const strong = row(w, 'nat').find('.confirm .strong');
    expect(strong.text()).toContain('carrier address directly');
    expect(strong.text()).toContain('firewall');
  });

  test('an unverified write takes a second confirmation', async () => {
    const w = await opened();
    await rowBtn(w, 'network-mode', 'LTE only')!.trigger('click');
    await rowBtn(w, 'network-mode', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(writes()).toEqual([]);
    expect(row(w, 'network-mode').find('.confirm').text()).toContain('not been tested on this firmware');
    await pastSecondConfirmGuard();
    await rowBtn(w, 'network-mode', 'Send anyway')!.trigger('click');
    await until(() => row(w, 'network-mode').find('.result').exists());
    expect(writes()).toEqual(['AT+QCFG="nwscanmode",3']);
  });

  test('a verified write needs one confirmation', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    expect(row(w, 'radio').find('.confirm').text()).toContain('leaves the network');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => row(w, 'radio').find('.result').exists());
    expect(writes()).toEqual(['AT+CFUN=4']);
    expect(row(w, 'radio').find('.result').text()).toContain('Confirmed');
    expect(row(w, 'radio').find('.result pre').text()).toContain('[ok]');
    await until(() => row(w, 'radio').find('.value').text() === 'Off');
  });

  test('radio off disables the data toggle and says why', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => row(w, 'data').text().includes('radio is off'));
    expect(rowBtn(w, 'data', 'On')!.attributes('disabled')).toBeDefined();
  });

  test('a success offers putting it back and a rescan; putting back needs its own confirm', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => btn(w, 'Put it back') !== undefined && !btn(w, 'Put it back')!.element.disabled);
    expect(btn(w, 'Rescan')).toBeTruthy();
    expect(btn(w, 'Put it back')!.text()).toContain('On');

    const before = writes().length;
    await btn(w, 'Put it back')!.trigger('click');
    await flushPromises();
    expect(writes().length).toBe(before);
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => row(w, 'radio').find('.result').exists());
    expect(writes().at(-1)).toBe('AT+CFUN=1');
    await until(() => row(w, 'radio').find('.value').text() === 'On');
    expect(btn(w, 'Put it back')).toBeUndefined();
  });

  test('rescan runs a fresh automatic scan and shows the changed value', async () => {
    const w = await opened();
    await row(w, 'apn').find('input').setValue('new.apn');
    await row(w, 'apn').find('form').trigger('submit');
    expect(row(w, 'apn').find('.confirm').text()).toContain('AT+CGDCONT=1,"IP","new.apn"');
    await rowBtn(w, 'apn', 'Confirm')!.trigger('click');
    await until(() => btn(w, 'Rescan') !== undefined && !btn(w, 'Rescan')!.element.disabled);
    expect(row(w, 'apn').find('.result').text()).toContain('Restart the data connection');
    await btn(w, 'Rescan')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    expect(settings.apn).toBe('new.apn');
    await w.findAll('nav button')[0].trigger('click');
    expect(w.text()).toContain('new.apn');
  });

  test('an APN with a quote never reaches a confirm panel', async () => {
    const w = await opened();
    await row(w, 'apn').find('input').setValue('bad"apn');
    await row(w, 'apn').find('form').trigger('submit');
    expect(row(w, 'apn').find('.problem').exists()).toBe(true);
    expect(row(w, 'apn').find('.confirm').exists()).toBe(false);
    await flushPromises();
    expect(writes()).toEqual([]);
  });

  test('a needsRestart change offers a restart; the restart reports reconnecting, not a lost connection', async () => {
    const w = await opened();
    await rowBtn(w, 'usb-mode', 'RNDIS')!.trigger('click');
    await rowBtn(w, 'usb-mode', 'Confirm')!.trigger('click');
    await until(() => btn(w, 'Restart now') !== undefined);
    expect(row(w, 'usb-mode').find('.result').text()).toContain('after a restart');

    await btn(w, 'Restart now')!.trigger('click');
    expect(row(w, 'restart').find('.confirm').text()).toContain('connection to the modem drops');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await until(() => w.text().includes('restarting, reconnect when it is back'));
    expect(writes()).toEqual(['AT+QCFG="usbnet",3', 'AT+CFUN=1,1']);
    expect(w.text()).not.toContain('Connection lost');
    expect(w.text()).toContain('change how the modem appears');
    expect(btn(w, 'Reconnect: Serial port')).toBeTruthy();

    // The simulated modem goes away a moment later: still no alarm.
    await new Promise((r) => setTimeout(r, 200));
    await flushPromises();
    expect(w.text()).not.toContain('Connection lost');

    await btn(w, 'Reconnect: Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    expect(w.text()).not.toContain('restarting, reconnect');
    await until(() => row(w, 'usb-mode').find('.value').text() === 'RNDIS');
    await until(() => btn(w, 'Put it back') !== undefined);
    expect(btn(w, 'Put it back')!.text()).toContain('ECM');
  });

  test('a cable pulled after a confirmed USB mode change, with no restart sent, is a lost connection', async () => {
    const w = await opened();
    await rowBtn(w, 'usb-mode', 'RNDIS')!.trigger('click');
    await rowBtn(w, 'usb-mode', 'Confirm')!.trigger('click');
    await until(() => btn(w, 'Restart now') !== undefined);
    lastTransport.disconnect('pulled');
    await until(() => w.text().includes('Connection lost: pulled'));
    expect(w.text()).not.toContain('restarting, reconnect');
  });

  test('a restart that got no answer reads nothing, and a later pull is a lost connection', async () => {
    answer('AT+CFUN=1,1', { command: 'AT+CFUN=1,1', status: 'timeout', lines: [], durationMs: 15000 });
    const w = await opened();
    await rowBtn(w, 'restart', 'Restart')!.trigger('click');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await until(() => row(w, 'restart').find('.result').exists());
    await flushPromises();
    expect(sent().at(-1)).toBe('AT+CFUN=1,1');
    lastTransport.disconnect('pulled');
    await until(() => w.text().includes('Connection lost: pulled'));
    expect(w.text()).not.toContain('restarting, reconnect');
  });

  test('a write cut off by a pull says it is not confirmed, and keeps saying so until the next modem is identified', async () => {
    const h = hold('AT+QCFG="usbnet",3');
    const w = await opened();
    await rowBtn(w, 'usb-mode', 'RNDIS')!.trigger('click');
    await rowBtn(w, 'usb-mode', 'Confirm')!.trigger('click');
    await flushPromises();
    lastTransport.disconnect('pulled');
    h.release();
    await until(() => w.find('.actions-view').text().includes('not confirmed'));
    expect(w.find('.actions-view').text()).toContain('USB mode');
    expect(w.find('.actions-view .result pre').text()).toContain('[disconnected');
    expect(w.text()).toContain('Connection lost: pulled');
    expect(w.text()).not.toContain('restarting, reconnect');

    send.mockRestore();
    await btn(w, 'Reconnect: Serial port')!.trigger('click');
    await until(() => w.text().includes('Automatic scan finished'));
    expect(w.find('.actions-view').text()).not.toContain('not confirmed');
  });

  test('a restart cut off mid-command reports restarting, not a lost connection', async () => {
    const h = hold('AT+CFUN=1,1');
    const w = await opened();
    await rowBtn(w, 'restart', 'Restart')!.trigger('click');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await flushPromises();
    lastTransport.disconnect('gone');
    h.release();
    await until(() => w.text().includes('restarting, reconnect when it is back'));
    expect(w.text()).not.toContain('Connection lost');
  });

  test('a restart that is accepted leaves nothing to follow it, not even with Live on', async () => {
    const w = await opened();
    await w.findAll('nav button')[0].trigger('click');
    await w.find('.live input').setValue(true);
    await until(() => sent().includes('AT+CESQ'));
    await openTab(w);
    await until(() => !rowBtn(w, 'restart', 'Restart')!.element.disabled);
    await rowBtn(w, 'restart', 'Restart')!.trigger('click');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await until(() => w.text().includes('restarting, reconnect when it is back'));
    await flushPromises();
    expect(sent().at(-1)).toBe('AT+CFUN=1,1');
  });

  describe('going back on a different modem', () => {
    /** Every connection is the next modem in the list. */
    function serials(...list: Array<string | null>): void {
      let call = 0;
      send.mockImplementation(async function (this: AtEngine, c: string, opts?: SendOptions): Promise<AtResponse> {
        if (c !== 'AT+CGSN' && c !== 'AT+GSN') return ORIGINAL_SEND.call(this, c, opts);
        if (c === 'AT+CGSN') call++;
        const serial = list[Math.min(call, list.length) - 1];
        if (serial === null) return { command: c, status: 'error', lines: [], durationMs: 1 };
        return { command: c, status: 'ok', lines: serial === '' ? [] : [serial], durationMs: 1 };
      });
    }

    async function changeRadio(w: VueWrapper): Promise<void> {
      await rowBtn(w, 'radio', 'Off')!.trigger('click');
      await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
      await until(() => row(w, 'radio').find('.value').text() === 'Off' && !!row(w, 'radio').find('.result').exists());
    }

    async function reconnect(w: VueWrapper): Promise<void> {
      lastTransport.disconnect('pulled');
      await until(() => btn(w, 'Reconnect: Serial port') !== undefined);
      await btn(w, 'Reconnect: Serial port')!.trigger('click');
      await until(() => w.text().includes('Automatic scan finished'));
      await until(() => row(w, 'radio').find('.value').text() === 'Off' && !rowBtn(w, 'nat', 'Carrier')!.element.disabled);
    }

    test('the value of one modem is not offered on the next', async () => {
      serials('111111111111111', '222222222222222');
      const w = await opened();
      await changeRadio(w);
      expect(btn(w, 'Put it back')).toBeTruthy();
      await reconnect(w);
      expect(btn(w, 'Put it back')).toBeUndefined();
    });

    test('the same modem back again keeps its way back', async () => {
      serials('111111111111111', '111111111111111');
      const w = await opened();
      await changeRadio(w);
      await reconnect(w);
      expect(btn(w, 'Put it back')).toBeTruthy();
    });

    test('an empty serial identifies nothing', async () => {
      serials('', '');
      const w = await opened();
      await changeRadio(w);
      expect(btn(w, 'Put it back')).toBeUndefined();
      await reconnect(w);
      expect(btn(w, 'Put it back')).toBeUndefined();
    });

    test('a modem whose serial cannot be read is offered no way back', async () => {
      serials('111111111111111', null);
      const w = await opened();
      await changeRadio(w);
      await reconnect(w);
      expect(btn(w, 'Put it back')).toBeUndefined();
    });
  });

  test('losing the modem after an ordinary change is a lost connection', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => row(w, 'radio').find('.result').exists());
    lastTransport.disconnect('pulled');
    await until(() => w.text().includes('Connection lost: pulled'));
    expect(w.text()).not.toContain('restarting, reconnect');
  });

  test('a cable pulled during an action is a lost connection, and no success is shown', async () => {
    const h = hold('AT+CFUN=4');
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    lastTransport.disconnect('pulled');
    h.release();
    await until(() => w.text().includes('Connection lost: pulled'));
    expect(w.text()).not.toContain('Confirmed');
  });

  test('everything else stands down during an action and comes back after it', async () => {
    const h = hold('AT+CFUN=4');
    const w = await opened();
    await w.findAll('nav button')[0].trigger('click');
    await w.find('.live input').setValue(true);
    await until(() => sent().includes('AT+CESQ'));
    await openTab(w);
    await until(() => !rowBtn(w, 'radio', 'Off')!.element.disabled);
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    await until(() => sent().includes('AT+CFUN=4'));

    expect(w.find('.live').text()).toContain('Paused while a scan or an action runs');
    expect(w.find('input[aria-label="AT command"]').attributes('disabled')).toBeDefined();
    expect(w.find('.terminal').text()).toContain('while an action is running');
    expect(btn(w, 'Deep scan')!.attributes('disabled')).toBeDefined();
    expect(btn(w, 'Network scan')!.attributes('disabled')).toBeDefined();
    expect(btn(w, 'Serial port')!.attributes('disabled')).toBeDefined();
    expect(rowBtn(w, 'nat', 'Carrier')!.attributes('disabled')).toBeDefined();
    const cesqDuring = sent().filter((c) => c === 'AT+CESQ').length;

    h.release();
    await until(() => row(w, 'radio').find('.result').exists());
    await until(() => w.find('input[aria-label="AT command"]').attributes('disabled') === undefined);
    expect(w.find('.terminal').text()).not.toContain('while an action is running');
    await until(() => sent().filter((c) => c === 'AT+CESQ').length > cesqDuring);
  });

  test('a scan disables everything, says why, and reads afterwards', async () => {
    const w = await scanned();
    let finish = (): void => {};
    vi.spyOn(Scanner.prototype, 'runManual').mockReturnValue(new Promise((r) => (finish = () => r({} as never))));
    await btn(w, 'Network scan')!.trigger('click');
    await openTab(w);
    await flushPromises();
    expect(w.find('.actions-view').text()).toContain('A scan is running');
    for (const b of row(w, 'restart').findAll('button')) expect(b.attributes('disabled')).toBeDefined();
    expect(sent()).not.toContain('AT+QNETDEVCTL?');
    finish();
    await until(() => sent().includes('AT+QNETDEVCTL?'));
    expect(writes()).toEqual([]);
  });

  test('a confirmation does not survive leaving the tab', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await w.findAll('nav button')[0].trigger('click');
    await openTab(w);
    await flushPromises();
    expect(row(w, 'radio').find('.confirm').exists()).toBe(false);
    expect(writes()).toEqual([]);
  });

  test('nothing about an action reaches an export', async () => {
    const w = await opened();
    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    await rowBtn(w, 'nat', 'Confirm')!.trigger('click');
    await until(() => row(w, 'nat').find('.result').exists());
    await w.findAll('nav button')[0].trigger('click');
    await btn(w, 'Export JSON')!.trigger('click');
    await btn(w, 'Full export')!.trigger('click');
    await btn(w, 'Download full JSON')!.trigger('click');
    expect(dl).toHaveBeenCalledTimes(2);
    for (const call of dl.mock.calls) {
      expect(call[1]).not.toContain('QNETDEVCTL');
      expect(call[1]).not.toContain('"nat"');
      expect(call[1]).not.toContain('Carrier address');
    }
  });

  test('"Hide identifiers" withholds the literal answer', async () => {
    const w = await opened();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await until(() => row(w, 'radio').find('.result pre').exists());
    expect(row(w, 'radio').find('.result pre').text()).toContain('[ok]');
    await w.find('input[role="switch"]').setValue(true);
    expect(row(w, 'radio').find('.result pre').text()).toContain('Hidden');
    expect(row(w, 'radio').find('.result pre').text()).not.toContain('[ok]');
  });
});

describe('ActionsPanel', () => {
  const HAPPY: Record<string, string[]> = {
    'AT+CPIN?': ['+CPIN: READY'],
    'AT+CGDCONT?': ['+CGDCONT: 1,"IP","demo.apn"'],
    'AT+QNETDEVCTL?': ['+QNETDEVCTL: 0,0,0,0'],
    'AT+CFUN?': ['+CFUN: 1'],
    'AT+QCFG="usbnet"': ['+QCFG: "usbnet",1'],
    'AT+QCFG="nat"': ['+QCFG: "nat",0'],
    'AT+QCFG="nwscanmode"': ['+QCFG: "nwscanmode",0'],
    'AT+QCFG="roamservice"': ['+QCFG: "roamservice",1,1'],
  };

  type Answer = string[] | AtStatus;

  function modem(over: Record<string, Answer> = {}) {
    const sent: string[] = [];
    const answers: Record<string, Answer> = { ...HAPPY, ...over };
    const send: ActionSend = async (command) => {
      sent.push(command);
      const a = answers[command];
      // A write of the radio changes what the radio reads as.
      if (command === 'AT+CFUN=4') answers['AT+CFUN?'] = ['+CFUN: 4'];
      if (typeof a === 'string') return { command, status: a, lines: [], durationMs: 1 };
      return { command, status: 'ok', lines: a ?? [], durationMs: 1 };
    };
    return { send, sent };
  }

  function panel(send: ActionSend, props: Record<string, unknown> = {}) {
    const w = mount(ActionsPanel, {
      props: {
        active: true, connected: true, imported: false, profileId: 'quectel-ec200a', scanning: false,
        send, begin: () => true, end: () => {}, platform: 'Win32', modemKey: 'serial-1', ...props,
      },
    });
    wrappers.push(w);
    return w;
  }

  test.each([
    [{ profileId: 'quectel-ec25' }, 'only available on a Quectel EC200A'],
    [{ connected: false }, 'need a connected modem'],
    [{ imported: true, connected: false }, 'imported from a file'],
  ])('%j: the tab says why and shows no settings', async (props, reason) => {
    const { send, sent } = modem();
    const w = panel(send, props);
    await flushPromises();
    expect(w.text()).toContain(reason);
    expect(w.find('.setting').exists()).toBe(false);
    expect(sent).toEqual([]);
  });

  test('nothing is read until the tab is open', async () => {
    const { send, sent } = modem();
    const w = panel(send, { active: false });
    await flushPromises();
    expect(sent).toEqual([]);
    await w.setProps({ active: true });
    await flushPromises();
    expect(sent.length).toBeGreaterThan(0);
  });

  test('without the modem to itself the tab sends nothing', async () => {
    const { send, sent } = modem();
    panel(send, { begin: () => false });
    await flushPromises();
    expect(sent).toEqual([]);
  });

  test('a confirm that cannot take the modem sends nothing', async () => {
    const { send, sent } = modem();
    let free = true;
    const w = panel(send, { begin: () => free });
    await flushPromises();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    free = false;
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(sent.filter(isWrite)).toEqual([]);
  });

  test('a read-back mismatch is a failure on screen', async () => {
    const { send } = modem({ 'AT+QCFG="nat",1': [] });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    await rowBtn(w, 'nat', 'Confirm')!.trigger('click');
    await flushPromises();
    const result = row(w, 'nat').find('.result');
    expect(result.text()).toContain('not confirmed');
    expect(result.text()).not.toContain('Confirmed:');
    expect(result.attributes('data-tone')).toBe('bad');
    expect(btn(w, 'Rescan')).toBeUndefined();
    expect(btn(w, 'Restart now')).toBeUndefined();
  });

  test('a timeout is not shown as success', async () => {
    const { send } = modem({ 'AT+CFUN=4': 'timeout' });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(row(w, 'radio').find('.result').text()).toContain('may or may not');
    expect(row(w, 'radio').find('.result').text()).toContain('[timeout]');
    expect(btn(w, 'Rescan')).toBeUndefined();
  });

  test('the literal refusal of the modem is shown', async () => {
    const { send } = modem({ 'AT+CFUN=4': 'error' });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(row(w, 'radio').find('.result').text()).toContain('refused');
    expect(row(w, 'radio').find('.result pre').text()).toBe('[error]');
    expect(btn(w, 'Put it back')).toBeUndefined();
  });

  test('an unreadable value shows "unknown" and the write is still possible', async () => {
    const { send } = modem({ 'AT+QCFG="nat"': 'error', 'AT+QCFG="nat",1': [] });
    const w = panel(send);
    await flushPromises();
    expect(row(w, 'nat').find('.value').text()).toBe('unknown');
    expect(rowBtn(w, 'nat', 'Carrier')!.attributes('disabled')).toBeUndefined();
    await rowBtn(w, 'nat', 'Carrier')!.trigger('click');
    expect(row(w, 'nat').find('.confirm').text()).toContain('unknown');
  });

  test('an unknown previous value offers no way back', async () => {
    const { send } = modem({ 'AT+QCFG="roamservice"': 'error', 'AT+QCFG="roamservice",2,1': [] });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'roaming', 'On')!.trigger('click');
    await rowBtn(w, 'roaming', 'Confirm')!.trigger('click');
    await pastSecondConfirmGuard();
    await rowBtn(w, 'roaming', 'Send anyway')!.trigger('click');
    await flushPromises();
    expect(btn(w, 'Put it back')).toBeUndefined();
  });

  test('unreadable gating values disable what depends on them', async () => {
    const { send } = modem({ 'AT+CPIN?': 'error', 'AT+CFUN?': 'error', 'AT+QCFG="usbnet"': 'error' });
    const w = panel(send);
    await flushPromises();
    expect(row(w, 'data').text()).toContain('could not be read');
    for (const b of row(w, 'data').findAll('button')) expect(b.attributes('disabled')).toBeDefined();
    expect(row(w, 'apn').text()).toContain('could not be read');
    expect(row(w, 'nat').text()).toContain('could not be read');
    expect(rowBtn(w, 'restart', 'Restart')!.attributes('disabled')).toBeUndefined();
  });

  test('a SIM that is not ready keeps APN and data off and says so', async () => {
    const { send } = modem({ 'AT+CPIN?': ['+CPIN: SIM PIN'] });
    const w = panel(send);
    await flushPromises();
    expect(row(w, 'apn').text()).toContain('SIM PIN');
    expect(row(w, 'apn').find('button').attributes('disabled')).toBeDefined();
    expect(rowBtn(w, 'radio', 'Off')!.attributes('disabled')).toBeUndefined();
  });

  test('a USB mode without a network offers neither NAT nor data, and says why', async () => {
    const { send } = modem({ 'AT+QCFG="usbnet"': ['+QCFG: "usbnet",0'] });
    const w = panel(send);
    await flushPromises();
    expect(row(w, 'nat').exists()).toBe(false);
    expect(row(w, 'data').exists()).toBe(false);
    expect(w.findAll('.hidden-row').map((p) => p.text()).join(' ')).toContain('NAT: Only offered in a network USB mode');
    expect(row(w, 'usb-mode').find('.value').text()).toBe('Value 0');
  });

  test('on a Mac RNDIS is not offered, and the reason is shown', async () => {
    const { send } = modem();
    const w = panel(send, { platform: 'MacIntel' });
    await flushPromises();
    expect(rowBtn(w, 'usb-mode', 'RNDIS')).toBeUndefined();
    expect(rowBtn(w, 'usb-mode', 'ECM')).toBeTruthy();
    expect(row(w, 'usb-mode').text()).toContain('RNDIS is not offered on a Mac');
  });

  test('elsewhere RNDIS is offered', async () => {
    const { send } = modem();
    const w = panel(send);
    await flushPromises();
    expect(rowBtn(w, 'usb-mode', 'RNDIS')).toBeTruthy();
  });

  test('the current value cannot be picked again', async () => {
    const { send } = modem();
    const w = panel(send);
    await flushPromises();
    const current = rowBtn(w, 'radio', 'On')!;
    expect(current.attributes('aria-pressed')).toBe('true');
    expect(current.attributes('disabled')).toBeDefined();
  });

  test('a previous value that is not writable is not offered back', async () => {
    const { send } = modem({
      'AT+CGDCONT?': ['+CGDCONT: 1,"IP",""'],
      'AT+CGDCONT=1,"IP","new"': [],
    });
    const w = panel(send);
    await flushPromises();
    expect(row(w, 'apn').find('.value').text()).toBe('No APN (IP)');
    await row(w, 'apn').find('input').setValue('new');
    await row(w, 'apn').find('form').trigger('submit');
    await rowBtn(w, 'apn', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(btn(w, 'Put it back')).toBeUndefined();
    expect(row(w, 'apn').text()).toContain('cannot be put back');
  });

  test('a way back belongs to the modem it was remembered on', async () => {
    const { send } = modem({ 'AT+CFUN=4': [] });
    const w = panel(send, { modemKey: 'a' });
    await flushPromises();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(btn(w, 'Put it back')).toBeTruthy();
    await w.setProps({ modemKey: undefined });
    expect(btn(w, 'Put it back')).toBeUndefined();
    await w.setProps({ modemKey: 'b' });
    expect(btn(w, 'Put it back')).toBeUndefined();
    await w.setProps({ modemKey: 'a' });
    expect(btn(w, 'Put it back')).toBeTruthy();
  });

  test('with no serial nothing is remembered', async () => {
    const { send } = modem({ 'AT+CFUN=4': [] });
    const w = panel(send, { modemKey: undefined });
    await flushPromises();
    await rowBtn(w, 'radio', 'Off')!.trigger('click');
    await rowBtn(w, 'radio', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(btn(w, 'Put it back')).toBeUndefined();
    await w.setProps({ modemKey: 'a' });
    expect(btn(w, 'Put it back')).toBeUndefined();
  });

  test('the second confirmation is a new button that ignores an immediate activation', async () => {
    const { send, sent } = modem({ 'AT+QCFG="nwscanmode",3': [] });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'network-mode', 'LTE only')!.trigger('click');
    const first = row(w, 'network-mode').find('.confirm button.primary').element;
    await rowBtn(w, 'network-mode', 'Confirm')!.trigger('click');
    const second = row(w, 'network-mode').find('.confirm button.primary').element;
    expect(second).not.toBe(first);
    expect(second.textContent).toContain('Send anyway');
    expect(first.isConnected).toBe(false);

    await rowBtn(w, 'network-mode', 'Send anyway')!.trigger('click');
    await flushPromises();
    expect(sent.filter(isWrite)).toEqual([]);
    expect(row(w, 'network-mode').find('.confirm').exists()).toBe(true);

    await pastSecondConfirmGuard();
    await rowBtn(w, 'network-mode', 'Send anyway')!.trigger('click');
    await flushPromises();
    expect(sent.filter(isWrite)).toEqual(['AT+QCFG="nwscanmode",3']);
  });

  test('a refused restart sends nothing after it', async () => {
    const { send, sent } = modem({ 'AT+CFUN=1,1': 'error' });
    const w = panel(send);
    await flushPromises();
    await rowBtn(w, 'restart', 'Restart')!.trigger('click');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(sent.at(-1)).toBe('AT+CFUN=1,1');
    expect(w.emitted('restarted')).toBeUndefined();
  });

  test('the modem is told to go down before it is released', async () => {
    const order: string[] = [];
    const { send } = modem({ 'AT+CFUN=1,1': [] });
    const w = mount(ActionsPanel, {
      props: {
        active: true, connected: true, imported: false, profileId: 'quectel-ec200a', scanning: false,
        send, begin: () => true, end: () => order.push('end'), platform: 'Win32', modemKey: 'serial-1',
        onRestarted: () => order.push('restarted'),
      },
    });
    wrappers.push(w);
    await flushPromises();
    order.length = 0;
    await rowBtn(w, 'restart', 'Restart')!.trigger('click');
    await rowBtn(w, 'restart', 'Confirm')!.trigger('click');
    await flushPromises();
    expect(order).toEqual(['restarted', 'end']);
  });
});

describe('the actions source', () => {
  test.each(['src/ui/ActionsPanel.vue'])('%s keeps to the content security policy', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/\sstyle=|:style=|v-html/);
  });
});
