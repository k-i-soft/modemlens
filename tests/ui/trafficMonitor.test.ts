import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AtResponse, AtStatus } from '../../src/at/engine';
import { COUNTER_READ } from '../../src/tools/traffic';
import { TRAFFIC_INTERVAL_MS, TRAFFIC_WINDOW_MS, TrafficMonitor } from '../../src/ui/trafficMonitor';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A counter that grows by `step` bytes received per reading. */
function modem(step = 125_000, status: AtStatus = 'ok') {
  let received = 1_000_000;
  const send = vi.fn((command: string): Promise<AtResponse> => {
    received += step;
    return Promise.resolve({ command, status, lines: status === 'ok' ? [`+QGDCNT: 5000,${received}`] : [], durationMs: 1 });
  });
  return { send, monitor: new TrafficMonitor(send) };
}

describe('TrafficMonitor', () => {
  test('reads the counter at once and every second, and keeps the totals', async () => {
    const { send, monitor } = modem();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith(COUNTER_READ);
    expect(monitor.totals.value).toEqual({ sent: 5000, received: 1_125_000 });
    await vi.advanceTimersByTimeAsync(TRAFFIC_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledTimes(4);
    expect(monitor.totals.value?.received).toBe(1_500_000);
    expect(monitor.available.value).toBe(true);
    monitor.stop();
  });

  test('keeps only the window it shows, plus a step', async () => {
    const { monitor } = modem();
    monitor.start();
    await vi.advanceTimersByTimeAsync(TRAFFIC_WINDOW_MS * 3);
    const kept = monitor.samples.value.filter((s) => s !== null);
    expect(kept.at(-1)!.at - kept[0].at).toBeLessThanOrEqual(TRAFFIC_WINDOW_MS + TRAFFIC_INTERVAL_MS);
    monitor.stop();
  });

  test('a modem that refuses the counter is asked once and then left alone', async () => {
    const { send, monitor } = modem(0, 'error');
    monitor.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(monitor.available.value).toBe(false);
    expect(monitor.running.value).toBe(false);
  });

  test('a pause sends nothing and breaks the line, so no speed spans it', async () => {
    const { send, monitor } = modem();
    monitor.start();
    await vi.advanceTimersByTimeAsync(TRAFFIC_INTERVAL_MS);
    monitor.setPaused(true);
    const during = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send.mock.calls.length).toBe(during);
    monitor.setPaused(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.length).toBe(during + 1);
    expect(monitor.samples.value.filter((s) => s === null)).toHaveLength(1);
    monitor.stop();
  });

  test('a slow answer never stacks a second read', async () => {
    let release!: (r: AtResponse) => void;
    const send = vi.fn(() => new Promise<AtResponse>((r) => (release = r)));
    const monitor = new TrafficMonitor(send);
    monitor.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    release({ command: COUNTER_READ, status: 'ok', lines: ['+QGDCNT: 1,2'], durationMs: 1 });
    await vi.advanceTimersByTimeAsync(TRAFFIC_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  test('a lost connection stops it', async () => {
    const { monitor } = modem(0, 'disconnected');
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.running.value).toBe(false);
  });

  test('stop and start again begin a fresh line', async () => {
    const { monitor } = modem();
    monitor.start();
    await vi.advanceTimersByTimeAsync(TRAFFIC_INTERVAL_MS * 3);
    monitor.stop();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.samples.value).toHaveLength(1);
    monitor.stop();
  });
});
