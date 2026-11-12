import { ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { AtResponse } from '../at/engine';
import { COUNTER_READ, parseCounter } from '../tools/traffic';
import type { Counter, Sample } from '../tools/traffic';

export const TRAFFIC_INTERVAL_MS = 1000;
/** The chart shows the last minute. */
export const TRAFFIC_WINDOW_MS = 60_000;

/**
 * Reads the modem's data counter once a second for the Overview, as long as the modem is connected.
 * Like the live signal it sends one read at a time and waits during scans; unlike it, it also reads
 * while an action runs, because the speed test inside the modem is when the traffic is worth seeing.
 * What it reads never enters a report.
 */
export class TrafficMonitor {
  readonly running: Ref<boolean> = ref(false);
  readonly paused: Ref<boolean> = ref(false);
  /** False once the modem refused the counter: it is not asked again until the next start. */
  readonly available: Ref<boolean | null> = ref(null);
  readonly totals: ShallowRef<Counter | null> = shallowRef(null);
  /** Readings in order; null where one is missing, so the chart breaks the line there. */
  readonly samples: ShallowRef<Array<Sample | null>> = shallowRef([]);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private run = 0;

  constructor(private readonly send: (command: string) => Promise<AtResponse>, private readonly now: () => number = () => performance.now()) {}

  start(): void {
    if (this.running.value) return;
    this.running.value = true;
    this.available.value = null;
    this.samples.value = [];
    this.run++;
    this.inFlight = false;
    if (!this.paused.value) void this.poll();
  }

  stop(): void {
    this.running.value = false;
    this.run++;
    this.inFlight = false;
    this.clearTimer();
  }

  setPaused(paused: boolean): void {
    if (this.paused.value === paused) return;
    this.paused.value = paused;
    if (paused) {
      this.clearTimer();
      this.gap();
    } else if (this.running.value && !this.inFlight) {
      void this.poll();
    }
  }

  /** The counter jumped, after a reset: no speed may be drawn across it. */
  gap(): void {
    if (this.samples.value.at(-1) !== null && this.samples.value.length > 0) this.samples.value = [...this.samples.value, null];
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    const run = this.run;
    this.inFlight = true;
    const r = await this.send(COUNTER_READ);
    if (run !== this.run) return;
    this.inFlight = false;
    if (r.status === 'disconnected') {
      this.stop();
      return;
    }
    const c = parseCounter(r);
    if (!c && this.available.value !== true) {
      // A modem without the counter: once is enough.
      this.available.value = false;
      this.stop();
      return;
    }
    const at = this.now();
    if (c) {
      this.available.value = true;
      this.totals.value = c;
    }
    const next = [...this.samples.value, c ? { at, ...c } : null];
    const first = next.findIndex((s) => s !== null && at - s.at <= TRAFFIC_WINDOW_MS + TRAFFIC_INTERVAL_MS);
    this.samples.value = first > 0 ? next.slice(first) : next;
    if (!this.paused.value) this.timer = setTimeout(() => void this.poll(), TRAFFIC_INTERVAL_MS);
  }
}
