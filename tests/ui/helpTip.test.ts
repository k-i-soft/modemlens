import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import DataPanel from '../../src/ui/DataPanel.vue';
import HelpTip from '../../src/ui/HelpTip.vue';
import SimPanel from '../../src/ui/SimPanel.vue';
import { GLOSSARY } from '../../src/ui/glossary';
import type { GlossaryTerm } from '../../src/ui/glossary';

const OPEN_MS = 120;
const CLOSE_MS = 400;
const wrappers: VueWrapper[] = [];

function tip(term: GlossaryTerm = 'RSRP'): VueWrapper {
  const w = mount(HelpTip, { props: { term }, attachTo: document.body });
  wrappers.push(w);
  return w;
}
const bubbleOf = (w: VueWrapper): HTMLElement => document.getElementById(w.find('button').attributes('aria-describedby')!)!;
const isOpen = (w: VueWrapper): boolean => bubbleOf(w).style.display !== 'none';
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await flushPromises();
};
const fireOn = async (el: Element, type: string): Promise<void> => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  await flushPromises();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('HelpTip', () => {
  test('is a real button, linked to its text through aria-describedby', () => {
    const w = tip('PCI');
    const button = w.find('button');
    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-label')).toContain('PCI');
    const bubble = bubbleOf(w);
    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(bubble.textContent).toBe(GLOSSARY.PCI);
    expect(isOpen(w)).toBe(false);
  });

  test('opens on hover after about 120 ms', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS - 1);
    expect(isOpen(w)).toBe(false);
    await tick(1);
    expect(isOpen(w)).toBe(true);
  });

  test('a pointer that just passes by opens nothing', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS - 1);
    await w.trigger('mouseleave');
    await tick(OPEN_MS * 2);
    expect(isOpen(w)).toBe(false);
  });

  test('closes about 400 ms after leaving', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS);
    await w.trigger('mouseleave');
    await tick(CLOSE_MS - 1);
    expect(isOpen(w)).toBe(true);
    await tick(1);
    expect(isOpen(w)).toBe(false);
  });

  test('stays while the pointer moves onto the bubble', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS);
    await w.trigger('mouseleave');
    await tick(CLOSE_MS - 100);
    await fireOn(bubbleOf(w), 'mouseenter');
    await tick(CLOSE_MS * 3);
    expect(isOpen(w)).toBe(true);
    await fireOn(bubbleOf(w), 'mouseleave');
    await tick(CLOSE_MS);
    expect(isOpen(w)).toBe(false);
  });

  test('coming back to the icon keeps it open', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS);
    await w.trigger('mouseleave');
    await tick(100);
    await w.trigger('mouseenter');
    await tick(CLOSE_MS * 2);
    expect(isOpen(w)).toBe(true);
  });

  test('a click opens it at once, and a second click closes it', async () => {
    const w = tip();
    await w.find('button').trigger('click');
    expect(isOpen(w)).toBe(true);
    await w.find('button').trigger('click');
    expect(isOpen(w)).toBe(false);
  });

  test('a tap, which also reports a hover, is not undone by the hover timer', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await w.find('button').trigger('click');
    await tick(OPEN_MS * 2);
    expect(isOpen(w)).toBe(true);
  });

  test('clicking a bubble that hovering opened keeps it open', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS);
    await w.find('button').trigger('click');
    expect(isOpen(w)).toBe(true);
  });

  test('a press elsewhere closes it, a press on the bubble does not', async () => {
    const w = tip();
    await w.find('button').trigger('click');
    await fireOn(bubbleOf(w), 'pointerdown');
    expect(isOpen(w)).toBe(true);
    await fireOn(document.body, 'pointerdown');
    expect(isOpen(w)).toBe(false);
  });

  test('Escape closes it', async () => {
    const w = tip();
    await w.trigger('mouseenter');
    await tick(OPEN_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(isOpen(w)).toBe(false);
  });

  test('other keys do not', async () => {
    const w = tip();
    await w.find('button').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await flushPromises();
    expect(isOpen(w)).toBe(true);
  });

  test('only one is open at a time', async () => {
    const a = tip('RSRP');
    const b = tip('RSRQ');
    await a.find('button').trigger('click');
    expect(isOpen(a)).toBe(true);
    await b.trigger('mouseenter');
    await tick(OPEN_MS);
    expect(isOpen(a)).toBe(false);
    expect(isOpen(b)).toBe(true);
  });

  describe('placement', () => {
    const rect = (r: Partial<DOMRect>) => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect;

    function measured(icon: Partial<DOMRect>, box: Partial<DOMRect>): VueWrapper {
      const w = tip();
      vi.spyOn(w.find('button').element, 'getBoundingClientRect').mockReturnValue(rect(icon));
      vi.spyOn(bubbleOf(w), 'getBoundingClientRect').mockReturnValue(rect(box));
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(375);
      return w;
    }

    test('above the icon when there is room', async () => {
      const w = measured({ top: 200, bottom: 216, left: 100, width: 16 }, { width: 100, height: 60 });
      await w.find('button').trigger('click');
      await flushPromises();
      expect(bubbleOf(w).dataset.placement).toBe('above');
      expect(bubbleOf(w).style.top).toBe('132px');
    });

    test('flipped below when there is none', async () => {
      const w = measured({ top: 20, bottom: 36, left: 100, width: 16 }, { width: 100, height: 60 });
      await w.find('button').trigger('click');
      await flushPromises();
      expect(bubbleOf(w).dataset.placement).toBe('below');
      expect(bubbleOf(w).style.top).toBe('44px');
    });

    test.each([
      ['left edge', 4, '8px'],
      ['right edge', 360, '167px'],
    ])('stays inside a 375 px window at the %s', async (_, left, expected) => {
      const w = measured({ top: 200, bottom: 216, left, width: 16 }, { width: 200, height: 60 });
      await w.find('button').trigger('click');
      await flushPromises();
      expect(bubbleOf(w).style.left).toBe(expected);
    });
  });
});

describe('glossary', () => {
  const SOURCES = ['src/ui', 'src'].flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.(vue|ts)$/.test(f) && f !== 'glossary.ts')
      .map((f) => readFileSync(join(dir, f), 'utf8')));
  const ALL = SOURCES.join('\n');
  const VUE = ['src/ui', 'src'].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.vue')).map((f) => readFileSync(join(dir, f), 'utf8'))).join('\n');

  test('every term written in the UI exists', () => {
    const used = [...VUE.matchAll(/(?<![:\w])term="([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const term of used) expect(GLOSSARY, term).toHaveProperty([term]);
  });

  test.each([
    'RSRP', 'RSRQ', 'SINR', 'RSSI', 'Signal bars', 'LTE bands', 'Active band', 'PLMN', 'EARFCN', 'Cell ID', 'PCI', 'TAC', 'Duplex', 'RRC state',
    'IMEI', 'IMSI', 'ICCID', 'SMS centre', 'PIN attempts', 'PUK attempts', 'Data connection', 'Context number', 'APN', 'IMS', 'Host connection',
    'Radio', 'USB mode', 'ECM', 'RNDIS', 'NAT', 'Modem does NAT', 'Carrier address on the computer', 'Network mode', 'Roaming', 'Restart',
    'Live signal', 'Auto refresh', 'Deep scan', 'Network scan', 'Hide identifiers', 'Verified profile', 'Unverified profile',
  ] as GlossaryTerm[])('%s has text and is used somewhere', (term) => {
    expect(GLOSSARY[term].length).toBeGreaterThan(10);
    expect(ALL.includes(`term="${term}"`) || ALL.includes(`'${term}'`), term).toBe(true);
  });

  test('every term in the glossary is used', () => {
    for (const term of Object.keys(GLOSSARY)) {
      expect(ALL.includes(`term="${term}"`) || ALL.includes(`'${term}'`), term).toBe(true);
    }
  });

  test.each(Object.entries(GLOSSARY))('%s is one to three sentences', (_, text) => {
    const sentences = text.split(/(?<=[.!?])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  test('the texts the owner asked for say what was asked', () => {
    expect(GLOSSARY['Context number']).toContain('separate data profile');
    expect(GLOSSARY['Context number']).toMatch(/IMS.*voice and messaging, not internet/);
    expect(GLOSSARY['Host connection']).toMatch(/active inside the modem/);
    expect(GLOSSARY['Host connection']).toMatch(/computer/);
  });

  test('a dynamic term only ever comes from the app\'s own tables', () => {
    const dynamic = [...new Set([...VUE.matchAll(/:term="([^"]+)"/g)].map((m) => m[1]))].sort();
    expect(dynamic).toEqual([
      "CHOICE_HELP.get(c.label)!",
      "HELP.get(f.key)!",
      "HELP.get(k)!",
      "HELP.get(r.key)!",
      "ACTION_HELP[row.action.id]",
      "METRICS[reading.metric].label",
      "a.term",
      "identity.verified ? 'Verified profile' : 'Unverified profile'",
    ].sort());
  });

  test('a name from the modem is only ever a reason to show fixed text', () => {
    const w = mount(DataPanel, { props: { contexts: [{ cid: 1, apn: 'ims.<b>modem-text</b>', addresses: [] }] }, attachTo: document.body });
    wrappers.push(w);
    const bubbles = w.findAll('button.help-q').map((b) => document.getElementById(b.attributes('aria-describedby')!)!.textContent);
    expect(bubbles).toContain(GLOSSARY.IMS);
    for (const text of bubbles) expect(text).not.toContain('modem-text');
  });

  test('an APN not named IMS gets no IMS help', () => {
    const w = mount(DataPanel, { props: { contexts: [{ cid: 1, apn: 'internet', addresses: [] }] }, attachTo: document.body });
    wrappers.push(w);
    const bubbles = w.findAll('button.help-q').map((b) => document.getElementById(b.attributes('aria-describedby')!)!.textContent);
    expect(bubbles).not.toContain(GLOSSARY.IMS);
  });

  test('the help component keeps to the content security policy', () => {
    const source = readFileSync('src/ui/HelpTip.vue', 'utf8');
    expect(source).not.toMatch(/\sstyle="|v-html/);
  });
});

describe('SIM PIN lock', () => {
  const pill = (lock?: string): VueWrapper => {
    const w = mount(SimPanel, { props: { sim: { state: 'Ready', ...(lock ? { lock } : {}) } } });
    wrappers.push(w);
    return w;
  };

  test('on reads as a green status with a word', () => {
    const p = pill('enabled').find('.pin-lock');
    expect(p.text()).toBe('PIN on');
    expect(p.attributes('data-tone')).toBe('ok');
    expect(p.find('.dot').exists()).toBe(true);
  });

  test('off reads as a neutral status with a word', () => {
    const p = pill('disabled').find('.pin-lock');
    expect(p.text()).toBe('PIN off');
    expect(p.attributes('data-tone')).toBe('neutral');
  });

  test('it is a status, not a control', () => {
    const w = pill('enabled');
    const p = w.find('.pin-lock');
    expect(p.element.tagName).toBe('SPAN');
    expect(p.attributes('role')).toBeUndefined();
    expect(w.find('.pin-lock input, .pin-lock button, [role="switch"]').exists()).toBe(false);
  });

  test.each([[undefined], ['2']])('nothing is shown for %j', (lock) => {
    expect(pill(lock).find('.pin-lock').exists()).toBe(false);
  });
});
