import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LIVE_COMMAND, LIVE_INTERVAL_MS, LIVE_MAX_SAMPLES, LiveSignal } from '../../src/ui/liveSignal';
import type { AtResponse, AtStatus } from '../../src/at/engine';

const answer = (rsrpCode = 60, status: AtStatus = 'ok'): AtResponse => ({
  command: LIVE_COMMAND, status, lines: status === 'ok' ? [`+CESQ: 99,99,255,255,20,${rsrpCode}`] : [], durationMs: 1,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function live(reply: () => Promise<AtResponse> = () => Promise.resolve(answer())) {
  const send = vi.fn(reply);
  return { send, signal: new LiveSignal(send) };
}

describe('LiveSignal', () => {
  test('sends nothing until started, then polls at once and every 2 s', async () => {
    const { send, signal } = live();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
    signal.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(LIVE_COMMAND);
    await vi.advanceTimersByTimeAsync(LIVE_INTERVAL_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(signal.samples.value.map((s) => s.rsrp)).toEqual([-81, -81]);
    signal.stop();
  });

  test('a slow answer never stacks a second command', async () => {
    let release!: (r: AtResponse) => void;
    const { send, signal } = live(() => new Promise((r) => (release = r)));
    signal.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    release(answer());
    await vi.advanceTimersByTimeAsync(LIVE_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    signal.stop();
  });

  test('pausing stops the polling and resuming polls at once', async () => {
    const { send, signal } = live();
    signal.start();
    await vi.advanceTimersByTimeAsync(0);
    signal.setPaused(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(signal.enabled.value).toBe(true);
    signal.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    signal.stop();
  });

  test('started while paused, it waits for the end of the pause', async () => {
    const { send, signal } = live();
    signal.setPaused(true);
    signal.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    signal.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    signal.stop();
  });

  test('stop ends it, and a late answer is dropped', async () => {
    let release!: (r: AtResponse) => void;
    const { send, signal } = live(() => new Promise((r) => (release = r)));
    signal.start();
    signal.stop();
    release(answer());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(signal.samples.value).toEqual([]);
  });

  test('a lost connection stops it', async () => {
    const { send, signal } = live(() => Promise.resolve(answer(60, 'disconnected')));
    signal.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(signal.enabled.value).toBe(false);
  });

  test('a missing reading is a gap, not a value', async () => {
    const { signal } = live(() => Promise.resolve(answer(255)));
    signal.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.samples.value.map((s) => s.rsrp)).toEqual([null]);
    signal.stop();
  });

  test('a timeout is a gap and polling goes on', async () => {
    const { send, signal } = live(() => Promise.resolve(answer(0, 'timeout')));
    signal.start();
    await vi.advanceTimersByTimeAsync(LIVE_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(signal.samples.value.every((s) => s.rsrp === null)).toBe(true);
    signal.stop();
  });

  test('keeps the last 120 samples and starts fresh each time', async () => {
    const { signal } = live();
    signal.start();
    await vi.advanceTimersByTimeAsync(LIVE_INTERVAL_MS * (LIVE_MAX_SAMPLES + 20));
    expect(signal.samples.value).toHaveLength(LIVE_MAX_SAMPLES);
    signal.stop();
    signal.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.samples.value).toHaveLength(1);
    signal.stop();
  });
});
