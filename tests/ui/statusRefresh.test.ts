import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AtEngine } from '../../src/at/engine';
import type { AtResponse, AtStatus } from '../../src/at/engine';
import { PROFILES } from '../../src/profiles';
import type { ScanItem } from '../../src/scan/scanner';
import { MAX_TIMEOUT_CYCLES, REFRESH_INTERVAL_MS, StatusRefresher, URC_DEBOUNCE_MS, mergeOverlay, refreshEntries } from '../../src/ui/statusRefresh';
import type { RefreshState } from '../../src/ui/statusRefresh';
import { FakeTransport } from '../helpers/fakeTransport';

const EC200A = PROFILES.find((p) => p.id === 'quectel-ec200a')!;
const STANDARD = ['AT+CFUN?', 'AT+CPIN?', 'AT+CREG?', 'AT+CEREG?', 'AT+COPS?', 'AT+CESQ', 'AT+CSQ', 'AT+CGATT?', 'AT+CGACT?', 'AT+CGPADDR'];
const FOR_PROFILE = ['AT+QNWINFO', 'AT+QENG="servingcell"', 'AT+QCSQ', 'AT+QNETDEVCTL?'];
const ALLOWED = new Set([...STANDARD, ...FOR_PROFILE]);

describe('refreshEntries', () => {
  test('without a profile: the standard rows', () => {
    expect(refreshEntries().map((e) => e.command)).toEqual(STANDARD);
  });
  test('with the EC200A profile: the standard rows and its own', () => {
    expect(refreshEntries(EC200A).map((e) => e.command)).toEqual([...STANDARD, ...FOR_PROFILE]);
  });
  test.each(PROFILES.map((p) => [p.id, p] as const))('%s only adds rows it has, all from the allowed list', (_, profile) => {
    for (const e of refreshEntries(profile)) expect(ALLOWED.has(e.command), e.command).toBe(true);
  });
});

function item(id: string, line: string): ScanItem {
  const response: AtResponse = { command: id, status: 'ok', lines: [line], durationMs: 1 };
  return { id, command: id, category: 'network', state: 'done', response, parser: 'creg' };
}

describe('mergeOverlay', () => {
  test('the overlay wins, and the report is not touched', () => {
    const report = { startedAt: 'x', commandList: [], items: [item('creg', 'old'), item('cops', 'kept')] };
    const before = JSON.stringify(report);
    const merged = mergeOverlay(report, { creg: item('creg', 'new') });
    expect(merged.items.find((i) => i.id === 'creg')!.response!.lines).toEqual(['new']);
    expect(merged.items.find((i) => i.id === 'cops')!.response!.lines).toEqual(['kept']);
    expect(JSON.stringify(report)).toBe(before);
    expect(merged.startedAt).toBe('x');
  });
  test('an answer the scan did not have is added', () => {
    const merged = mergeOverlay({ items: [item('creg', 'a')] }, { qnetdevctl: item('qnetdevctl', 'b') });
    expect(merged.items.map((i) => i.id)).toEqual(['creg', 'qnetdevctl']);
  });
  test('an empty overlay changes nothing', () => {
    const items = [item('cgreg', 'a'), item('qspn', 'b')];
    expect(mergeOverlay({ items }, {}).items).toEqual(items);
  });
  test.each([
    ['cgreg', 'creg'], ['cgreg', 'cereg'], ['c5greg', 'creg'], ['c5greg', 'cereg'], ['qspn', 'cops'],
  ])('a scan answer of %s does not outlive a fresh %s', (stale, fresh) => {
    const merged = mergeOverlay({ items: [item(stale, 'old')] }, { [fresh]: item(fresh, 'new') });
    expect(merged.items.map((i) => i.id)).toEqual([fresh]);
  });
});

describe('StatusRefresher', () => {
  const entries = refreshEntries(EC200A);
  const N = entries.length;
  let t: FakeTransport;
  let engine: AtEngine;
  let results: ScanItem[][];
  let state: RefreshState;
  let refresher: StatusRefresher;

  const sent = (): string[] => t.written.map((w) => w.replace(/\r$/, ''));
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    t = new FakeTransport();
    t.reply(/.*/, ['\r\nOK\r\n']);
    engine = new AtEngine(t, { defaultTimeoutMs: 100, quietAfterTimeoutMs: 1 });
    results = [];
    refresher = new StatusRefresher((c, o) => engine.send(c, o ?? {}), {
      onResults: (r) => results.push(r),
      onState: (s) => (state = s),
    });
  });
  afterEach(() => {
    refresher.stop();
    engine.dispose();
    vi.useRealTimers();
  });

  test('the first cycle comes an interval after the start, and only reads the allowed commands', async () => {
    refresher.start(entries);
    await tick(REFRESH_INTERVAL_MS - 1);
    expect(sent()).toEqual([]);
    await tick(1);
    expect(sent()).toEqual([...STANDARD, ...FOR_PROFILE]);
    await tick(REFRESH_INTERVAL_MS * 3);
    expect(sent().length).toBe(N * 4);
    for (const c of sent()) expect(ALLOWED.has(c), c).toBe(true);
  });

  test('results come as items with the catalog id and parser', async () => {
    t = new FakeTransport();
    t.reply('AT+CFUN?', ['\r\n+CFUN: 4\r\n\r\nOK\r\n']);
    t.reply(/.*/, ['\r\nERROR\r\n']);
    engine = new AtEngine(t, { defaultTimeoutMs: 100 });
    refresher.start(entries);
    await tick(REFRESH_INTERVAL_MS);
    const cfun = results[0].find((i) => i.id === 'cfun')!;
    expect(cfun).toMatchObject({ command: 'AT+CFUN?', parser: 'cfun', state: 'done' });
    expect(cfun.response!.lines).toEqual(['+CFUN: 4']);
    expect(results[0].find((i) => i.id === 'cereg')!.state).toBe('unsupported');
  });

  test('the next cycle waits for the previous one, and an interval after it', async () => {
    const release: Array<() => void> = [];
    let active = 0;
    let most = 0;
    const calls: string[] = [];
    const slow = new StatusRefresher(async (command) => {
      calls.push(command);
      active++;
      most = Math.max(most, active);
      await new Promise<void>((r) => release.push(r));
      active--;
      return { command, status: 'ok' as AtStatus, lines: [], durationMs: 1 };
    }, { onResults: () => {}, onState: () => {} });
    slow.start(entries);
    await tick(REFRESH_INTERVAL_MS);
    expect(calls).toHaveLength(1);
    // Time passes and things are asked for: none of it starts a second cycle.
    await tick(REFRESH_INTERVAL_MS * 3);
    slow.trigger();
    slow.runNow();
    await tick(URC_DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(1);
    for (let i = 0; i < N; i++) {
      release.shift()!();
      await tick(0);
    }
    expect(calls).toHaveLength(N);
    expect(most).toBe(1);
    await tick(URC_DEBOUNCE_MS);
    expect(calls).toHaveLength(N + 1);
    slow.stop();
  });

  test('a pause and resume during a cycle does not start a second one beside it', async () => {
    let release = (): void => {};
    const calls: string[] = [];
    const slow = new StatusRefresher(async (command) => {
      calls.push(command);
      await new Promise<void>((r) => (release = r));
      return { command, status: 'ok' as AtStatus, lines: [], durationMs: 1 };
    }, { onResults: () => {}, onState: () => {} });
    slow.start(entries);
    await tick(REFRESH_INTERVAL_MS);
    slow.setPaused(true);
    slow.setPaused(false);
    await tick(REFRESH_INTERVAL_MS * 2);
    expect(calls).toEqual(['AT+CFUN?']);
    release();
    await tick(0);
    expect(calls).toEqual(['AT+CFUN?', 'AT+CPIN?']);
    slow.stop();
  });

  test('state shows a cycle while it runs and when it finished', async () => {
    t = new FakeTransport();
    engine = new AtEngine(t, { defaultTimeoutMs: 1000 });
    refresher.start(entries);
    const startedAt = state.updatedAt;
    await tick(REFRESH_INTERVAL_MS);
    expect(state.refreshing).toBe(true);
    for (let i = 0; i < N; i++) {
      t.emit('\r\nOK\r\n');
      await tick(0);
    }
    expect(state.refreshing).toBe(false);
    expect(state.updatedAt).toBeGreaterThan(startedAt!);
  });

  describe('pause', () => {
    test('nothing is sent while paused, and it resumes after', async () => {
      refresher.start(entries);
      refresher.setPaused(true);
      await tick(REFRESH_INTERVAL_MS * 3);
      expect(sent()).toEqual([]);
      refresher.setPaused(false);
      await tick(0);
      expect(sent().length).toBe(N);
    });

    test('a pause stops a running cycle between two commands', async () => {
      t = new FakeTransport();
      engine = new AtEngine(t, { defaultTimeoutMs: 1000 });
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS);
      t.emit('\r\n+CFUN: 1\r\n\r\nOK\r\n');
      await tick(0);
      expect(sent()).toEqual(['AT+CFUN?', 'AT+CPIN?']);
      refresher.setPaused(true);
      t.emit('\r\nOK\r\n');
      await tick(REFRESH_INTERVAL_MS);
      expect(sent()).toEqual(['AT+CFUN?', 'AT+CPIN?']);
      expect(state.refreshing).toBe(false);
      expect(results[0].map((i) => i.id)).toEqual(['cfun', 'cpin']);
    });

    test('a resume within the interval waits for the rest of it', async () => {
      refresher.start(entries);
      await tick(1000);
      refresher.setPaused(true);
      await tick(1000);
      refresher.setPaused(false);
      await tick(REFRESH_INTERVAL_MS - 2001);
      expect(sent()).toEqual([]);
      await tick(1);
      expect(sent().length).toBe(N);
    });

    test('a pause does not count as a success or a failure', async () => {
      refresher.start(entries);
      const before = state.updatedAt;
      refresher.setPaused(true);
      await tick(1);
      expect(state.updatedAt).toBe(before);
      expect(state.stalled).toBe(false);
    });
  });

  describe('stop and toggle', () => {
    test('stop ends everything, and an answer in flight is dropped', async () => {
      t = new FakeTransport();
      engine = new AtEngine(t, { defaultTimeoutMs: 1000 });
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS);
      refresher.stop();
      t.emit('\r\n+CFUN: 4\r\n\r\nOK\r\n');
      await tick(REFRESH_INTERVAL_MS * 2);
      expect(sent()).toEqual(['AT+CFUN?']);
      expect(results).toEqual([]);
    });

    test('a cable pulled during a cycle ends it without calling it a failure', async () => {
      t = new FakeTransport();
      engine = new AtEngine(t, { defaultTimeoutMs: 1000 });
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS);
      t.disconnect('pulled');
      await tick(0);
      expect(state.stalled).toBe(false);
      expect(state.refreshing).toBe(false);
    });

    test('turned off, nothing runs; turned on, it continues', async () => {
      refresher.start(entries);
      refresher.setEnabled(false);
      refresher.trigger();
      refresher.runNow();
      await tick(REFRESH_INTERVAL_MS * 2);
      expect(sent()).toEqual([]);
      expect(state.enabled).toBe(false);
      refresher.setEnabled(true);
      await tick(0);
      expect(sent().length).toBe(N);
    });

    test('the choice to turn it off holds for the next session', async () => {
      refresher.start(entries);
      refresher.setEnabled(false);
      refresher.stop();
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS * 2);
      expect(sent()).toEqual([]);
      expect(state.enabled).toBe(false);
    });

    test('nothing runs before start or after stop', async () => {
      refresher.trigger();
      refresher.runNow();
      await tick(REFRESH_INTERVAL_MS);
      expect(sent()).toEqual([]);
    });
  });

  describe('unsolicited lines', () => {
    const SECRET = '+CMTI: "SECRET-URC-TEXT",7';
    beforeEach(() => engine.onUrc(() => refresher.trigger()));

    test('a burst triggers one cycle, debounced', async () => {
      refresher.start(entries);
      await tick(1000);
      t.emit(`\r\n${SECRET}\r\n`);
      await tick(URC_DEBOUNCE_MS - 1);
      t.emit(`\r\n${SECRET}\r\n`);
      await tick(URC_DEBOUNCE_MS - 1);
      expect(sent()).toEqual([]);
      await tick(1);
      expect(sent().length).toBe(N);
      await tick(URC_DEBOUNCE_MS * 2);
      expect(sent().length).toBe(N);
    });

    test('the text of the line is kept nowhere', async () => {
      refresher.start(entries);
      t.emit(`\r\n${SECRET}\r\n`);
      await tick(URC_DEBOUNCE_MS);
      expect(sent().length).toBe(N);
      expect(JSON.stringify({ results, state, refresher })).not.toContain('SECRET-URC-TEXT');
    });

    test('a line during a pause runs one cycle after it', async () => {
      refresher.start(entries);
      await tick(4000);
      refresher.setPaused(true);
      t.emit(`\r\n${SECRET}\r\n`);
      t.emit(`\r\n${SECRET}\r\n`);
      await tick(REFRESH_INTERVAL_MS);
      expect(sent()).toEqual([]);
      refresher.setPaused(false);
      await tick(URC_DEBOUNCE_MS);
      expect(sent().length).toBe(N);
      await tick(URC_DEBOUNCE_MS);
      expect(sent().length).toBe(N);
    });

    test('a pause does not lose a line that is waiting for its debounce', async () => {
      refresher.start(entries);
      await tick(1000);
      t.emit(`\r\n${SECRET}\r\n`);
      await tick(100);
      refresher.setPaused(true);
      await tick(1000);
      expect(sent()).toEqual([]);
      refresher.setPaused(false);
      await tick(URC_DEBOUNCE_MS);
      expect(sent().length).toBe(N);
    });
  });

  test('runNow runs at once, and after a pause when paused', async () => {
    refresher.start(entries);
    refresher.runNow();
    await tick(0);
    expect(sent().length).toBe(N);
    refresher.setPaused(true);
    refresher.runNow();
    await tick(REFRESH_INTERVAL_MS);
    expect(sent().length).toBe(N);
    refresher.setPaused(false);
    await tick(URC_DEBOUNCE_MS);
    expect(sent().length).toBe(N * 2);
  });

  describe('a modem that stops answering', () => {
    function silent(): void {
      t = new FakeTransport();
      engine = new AtEngine(t, { defaultTimeoutMs: 100, quietAfterTimeoutMs: 1 });
    }

    test('stops after two cycles with timeouts, and each ends at its first timeout', async () => {
      silent();
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS + 200);
      expect(sent()).toEqual(['AT+CFUN?']);
      expect(state.stalled).toBe(false);
      await tick(REFRESH_INTERVAL_MS + 200);
      expect(sent()).toHaveLength(MAX_TIMEOUT_CYCLES);
      expect(state.stalled).toBe(true);
      await tick(REFRESH_INTERVAL_MS * 4);
      expect(sent()).toHaveLength(MAX_TIMEOUT_CYCLES);
    });

    test('a timeout does not replace what is known', async () => {
      silent();
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS + 200);
      expect(results).toEqual([]);
    });

    test('a good cycle in between resets the count', async () => {
      silent();
      refresher.start(entries);
      await tick(REFRESH_INTERVAL_MS + 200);
      t.reply(/.*/, ['\r\nOK\r\n']);
      await tick(REFRESH_INTERVAL_MS);
      expect(state.stalled).toBe(false);
      expect(sent().length).toBe(1 + N);
    });

    test('nothing wakes it but the resume, which tries at once', async () => {
      silent();
      engine.onUrc(() => refresher.trigger());
      refresher.start(entries);
      await tick((REFRESH_INTERVAL_MS + 200) * 2);
      expect(state.stalled).toBe(true);
      const before = sent().length;
      t.emit('\r\n+CMTI: "x",1\r\n');
      refresher.runNow();
      await tick(REFRESH_INTERVAL_MS);
      expect(sent().length).toBe(before);

      t.reply(/.*/, ['\r\nOK\r\n']);
      refresher.resume();
      await tick(0);
      expect(state.stalled).toBe(false);
      expect(sent().length).toBe(before + N);
      await tick(REFRESH_INTERVAL_MS);
      expect(sent().length).toBe(before + N * 2);
    });
  });
});
