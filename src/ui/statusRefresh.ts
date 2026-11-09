import type { AtResponse, SendOptions } from '../at/engine';
import { STANDARD_CATALOG } from '../catalog/standard';
import type { CatalogEntry, Profile } from '../catalog/types';
import type { ScanItem, ScanReport } from '../scan/scanner';

export const REFRESH_INTERVAL_MS = 5000;
export const URC_DEBOUNCE_MS = 500;
/** This many cycles in a row with a timeout, and the modem counts as no longer answering. */
export const MAX_TIMEOUT_CYCLES = 2;

const STANDARD_IDS = ['cfun', 'cpin', 'creg', 'cereg', 'cops', 'cesq', 'csq', 'cgatt', 'cgact', 'cgpaddr'];
const PROFILE_IDS = ['qnwinfo', 'qeng-serving', 'qcsq', 'qnetdevctl'];

/** What one cycle reads: catalog rows only, each in the read form the scan uses. */
export function refreshEntries(profile?: Profile): CatalogEntry[] {
  const byId = (rows: CatalogEntry[], ids: string[]): CatalogEntry[] =>
    ids.flatMap((id) => rows.filter((e) => e.id === id && e.phase === 'auto'));
  return [...byId(STANDARD_CATALOG, STANDARD_IDS), ...byId(profile?.commands ?? [], PROFILE_IDS)];
}

export type Overlay = Readonly<Record<string, ScanItem>>;

/**
 * Answers the refresh does not repeat, and the answer that replaces each. Left in, an old
 * "registered" from the scan would keep the modem on the network after it has left.
 */
const SUPERSEDED_BY: Record<string, string[]> = {
  cgreg: ['creg', 'cereg'],
  c5greg: ['creg', 'cereg'],
  qspn: ['cops'],
};

/** The report as it is now: newer answers replace the scan's. The report itself is left alone. */
export function mergeOverlay<T extends Pick<ScanReport, 'items'>>(report: T, overlay: Overlay): T {
  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(overlay, id);
  const items = report.items
    .filter((item) => !SUPERSEDED_BY[item.id]?.some(has))
    .map((item) => (has(item.id) ? overlay[item.id] : item));
  const known = new Set(report.items.map((item) => item.id));
  return { ...report, items: [...items, ...Object.values(overlay).filter((item) => !known.has(item.id))] };
}

export interface RefreshState {
  enabled: boolean;
  refreshing: boolean;
  /** Stopped because the modem no longer answers. */
  stalled: boolean;
  /** When the last complete reading was taken. */
  updatedAt: number | null;
}

export interface RefreshCallbacks {
  onResults: (items: ScanItem[]) => void;
  onState: (state: RefreshState) => void;
}

type Send = (command: string, opts?: SendOptions) => Promise<AtResponse>;

/**
 * Keeps the status current by repeating read commands from the catalog. Cycles never overlap,
 * and a cycle stops between two commands as soon as something else needs the modem.
 */
export class StatusRefresher {
  private entries: CatalogEntry[] = [];
  /** The person's choice, kept across sessions. */
  private wanted = true;
  private active = false;
  private paused = false;
  private stalled = false;
  private refreshing = false;
  /** A cycle was asked for while none could start. */
  private owed = false;
  private timeoutCycles = 0;
  private updatedAt: number | null = null;
  private lastFinished = 0;
  /** Bumped when polling stops, so that an answer to an older cycle is dropped. */
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly send: Send, private readonly callbacks: RefreshCallbacks) {}

  /** Begins polling a session whose scan has just read everything: the first cycle is an interval away. */
  start(entries: CatalogEntry[]): void {
    this.halt();
    this.entries = entries;
    this.active = true;
    this.updatedAt = Date.now();
    this.lastFinished = Date.now();
    this.schedule(REFRESH_INTERVAL_MS);
    this.notify();
  }

  /** Ends polling for this session. */
  stop(): void {
    this.halt();
    this.active = false;
    this.notify();
  }

  setEnabled(on: boolean): void {
    this.wanted = on;
    this.halt();
    if (on) this.schedule(this.remainingInterval());
    this.notify();
  }

  /** After the modem stopped answering: tries again at once. */
  resume(): void {
    this.halt();
    void this.cycle();
    this.notify();
  }

  /** While paused nothing is sent. Resuming picks up where the interval would have been. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      if (this.debounce !== undefined) this.owed = true;
      this.clearTimers();
    } else {
      this.continueAfter(this.remainingInterval());
    }
  }

  /** Something happened on the modem: one cycle, after things have settled. */
  trigger(): void {
    if (!this.active || !this.wanted || this.stalled) return;
    if (this.paused || this.refreshing) {
      this.owed = true;
      return;
    }
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.cycle(), URC_DEBOUNCE_MS);
  }

  /** One cycle now, or as soon as the modem is free. */
  runNow(): void {
    if (!this.active || !this.wanted || this.stalled) return;
    if (this.paused || this.refreshing) this.owed = true;
    else void this.cycle();
  }

  private canRun(): boolean {
    return this.active && this.wanted && !this.stalled && !this.paused;
  }

  private remainingInterval(): number {
    return Math.max(0, REFRESH_INTERVAL_MS - (Date.now() - this.lastFinished));
  }

  /** Forgets everything under way, but not the person's choice or the time of the last reading. */
  private halt(): void {
    this.run++;
    this.clearTimers();
    this.refreshing = false;
    this.stalled = false;
    this.owed = false;
    this.timeoutCycles = 0;
  }

  private clearTimers(): void {
    clearTimeout(this.timer);
    clearTimeout(this.debounce);
    this.timer = undefined;
    this.debounce = undefined;
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.canRun()) this.timer = setTimeout(() => void this.cycle(), delayMs);
  }

  private continueAfter(delayMs: number): void {
    this.schedule(delayMs);
    if (this.owed && this.canRun()) {
      this.owed = false;
      this.trigger();
    }
  }

  private notify(): void {
    this.callbacks.onState({ enabled: this.wanted, refreshing: this.refreshing, stalled: this.stalled, updatedAt: this.updatedAt });
  }

  private async cycle(): Promise<void> {
    if (this.refreshing || !this.canRun()) return;
    this.clearTimers();
    const run = this.run;
    this.refreshing = true;
    this.notify();
    const items: ScanItem[] = [];
    let timedOut = false;
    let complete = true;
    for (const entry of this.entries) {
      if (this.paused) {
        complete = false;
        break;
      }
      const r = await this.send(entry.command, entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {});
      if (run !== this.run) return;
      if (r.status === 'timeout') {
        timedOut = true;
        break;
      }
      if (r.status === 'disconnected') {
        complete = false;
        break;
      }
      items.push({ ...entry, state: r.status === 'ok' ? 'done' : 'unsupported', response: r });
    }
    this.refreshing = false;
    this.lastFinished = Date.now();
    if (items.length > 0) this.callbacks.onResults(items);
    if (timedOut) {
      this.timeoutCycles++;
      this.stalled = this.timeoutCycles >= MAX_TIMEOUT_CYCLES;
    } else if (complete) {
      this.timeoutCycles = 0;
      this.updatedAt = this.lastFinished;
    }
    this.continueAfter(REFRESH_INTERVAL_MS);
    this.notify();
  }
}
