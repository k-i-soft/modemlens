import { ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { AtResponse } from '../at/engine';
import { parseResponse } from '../parse';

export const LIVE_COMMAND = 'AT+CESQ';
export const LIVE_INTERVAL_MS = 2000;
export const LIVE_MAX_SAMPLES = 120;

export interface LiveSample {
  at: number;
  /** Null when the modem answered without an RSRP, or not at all. */
  rsrp: number | null;
}

function rsrpOf(r: AtResponse): number | null {
  const v = parseResponse('cesq', r)?.find((f) => f.key === 'rsrp_dbm')?.value;
  if (v === undefined || v === 'unknown') return null;
  return Number(v);
}

/**
 * Polls the signal for the live view. It runs only between `start` and `stop`, and it sends only one
 * command at a time. What it reads stays here: none of it enters a scan report.
 */
export class LiveSignal {
  readonly enabled: Ref<boolean> = ref(false);
  readonly paused: Ref<boolean> = ref(false);
  readonly samples: ShallowRef<LiveSample[]> = shallowRef([]);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  /** Bumped by `start` and `stop`, so that an answer to an older run is dropped. */
  private run = 0;

  constructor(private readonly send: (command: string) => Promise<AtResponse>) {}

  start(): void {
    if (this.enabled.value) return;
    this.enabled.value = true;
    this.samples.value = [];
    this.run++;
    this.inFlight = false;
    if (!this.paused.value) void this.poll();
  }

  stop(): void {
    this.enabled.value = false;
    this.run++;
    this.inFlight = false;
    this.clearTimer();
  }

  /** While paused nothing is sent. Resuming polls at once. */
  setPaused(paused: boolean): void {
    if (this.paused.value === paused) return;
    this.paused.value = paused;
    if (paused) this.clearTimer();
    else if (this.enabled.value && !this.inFlight) void this.poll();
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    const run = this.run;
    this.inFlight = true;
    const r = await this.send(LIVE_COMMAND);
    if (run !== this.run) return;
    this.inFlight = false;
    if (r.status === 'disconnected') {
      this.stop();
      return;
    }
    this.samples.value = [...this.samples.value, { at: Date.now(), rsrp: rsrpOf(r) }].slice(-LIVE_MAX_SAMPLES);
    if (!this.paused.value) this.timer = setTimeout(() => void this.poll(), LIVE_INTERVAL_MS);
  }
}
