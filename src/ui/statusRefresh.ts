import type { AtResponse, SendOptions } from '../at/engine';
import { STANDARD_CATALOG } from '../catalog/standard';
import type { CatalogEntry, Profile } from '../catalog/types';
import { commandName } from '../scan/scanner';
import type { ScanItem, ScanReport } from '../scan/scanner';

export const REFRESH_INTERVAL_MS = 5000;
export const URC_DEBOUNCE_MS = 500;
/** A modem that keeps sending unsolicited lines must not be polled without a pause. */
export const MIN_URC_GAP_MS = 3000;
/** This many cycles in a row in which nothing answered, and the modem counts as no longer answering. */
export const MAX_FAILED_CYCLES = 2;
/** A cycle gives up after this many timeouts in a row, so that a silent modem costs seconds and not minutes. */
const MAX_TIMEOUTS_IN_A_ROW = 3;

const STANDARD_IDS = ['cfun', 'cpin', 'creg', 'cgreg', 'cereg', 'c5greg', 'cops', 'cesq', 'csq', 'cgatt', 'cgact', 'cgpaddr'];
const PROFILE_IDS = ['qnwinfo', 'qeng-serving', 'qcsq', 'qnetdevctl'];

/** What one cycle reads: catalog rows only, each in the read form the scan uses. */
export function refreshEntries(profile?: Profile): CatalogEntry[] {
  const byId = (rows: CatalogEntry[], ids: string[]): CatalogEntry[] =>
    ids.flatMap((id) => rows.filter((e) => e.id === id && e.phase === 'auto'));
  const deny = new Set((profile?.denyCommands ?? []).map((d) => d.trim().toUpperCase()));
  return [...byId(STANDARD_CATALOG, STANDARD_IDS), ...byId(profile?.commands ?? [], PROFILE_IDS)].filter((e) => {
    const name = commandName(e.command);
    return !(name && deny.has(name));
  });
}

export type Overlay = Readonly<Record<string, ScanItem>>;

/** A scan answer the refresh does not repeat, and the answer that replaces it: the operator name after leaving the network. */
const SUPERSEDED_BY: Record<string, string[]> = {
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
  /** What a one-shot cycle has to read, until it has run. */
  private forced: CatalogEntry[] | null = null;
  private failedCycles = 0;
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
    this.forced = null;
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
    const delay = Math.max(URC_DEBOUNCE_MS, this.lastFinished + MIN_URC_GAP_MS - Date.now());
    this.debounce = setTimeout(() => void this.cycle(), delay);
  }

  /**
   * One cycle because the modem was just changed on purpose: now, or as soon as the modem is free.
   * The toggle, a stall and a scan that never finished do not hold it back: it needs only a live connection.
   */
  runNow(entries: CatalogEntry[]): void {
    this.forced = entries;
    this.runForced();
  }

  private runForced(): void {
    if (!this.paused && !this.refreshing) void this.cycle(true);
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
    this.failedCycles = 0;
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
    if (this.forced) {
      this.runForced();
      return;
    }
    this.schedule(delayMs);
    if (this.owed && this.canRun()) {
      this.owed = false;
      this.trigger();
    }
  }

  private notify(): void {
    this.callbacks.onState({ enabled: this.wanted, refreshing: this.refreshing, stalled: this.stalled, updatedAt: this.updatedAt });
  }

  private async cycle(forced = false): Promise<void> {
    if (this.refreshing || this.paused || (!forced && !this.canRun())) return;
    const entries = forced ? this.forced ?? [] : this.entries;
    if (forced) this.forced = null;
    this.clearTimers();
    const run = this.run;
    this.refreshing = true;
    this.notify();
    const items: ScanItem[] = [];
    let timeouts = 0;
    let timeoutsInARow = 0;
    let complete = true;
    for (const entry of entries) {
      if (this.paused) {
        complete = false;
        break;
      }
      const r = await this.send(entry.command, entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {});
      if (run !== this.run) return;
      if (r.status === 'timeout') {
        timeouts++;
        timeoutsInARow++;
        // One slow command says nothing about the others.
        if (timeoutsInARow >= MAX_TIMEOUTS_IN_A_ROW) {
          complete = false;
          break;
        }
        continue;
      }
      if (r.status === 'disconnected') {
        complete = false;
        break;
      }
      timeoutsInARow = 0;
      items.push({ ...entry, state: r.status === 'ok' ? 'done' : 'unsupported', response: r });
    }
    this.refreshing = false;
    this.lastFinished = Date.now();
    if (items.length > 0) this.callbacks.onResults(items);
    if (complete) this.updatedAt = this.lastFinished;
    if (!forced) {
      if (items.length > 0) this.failedCycles = 0;
      else if (timeouts > 0) this.failedCycles++;
      this.stalled = this.failedCycles >= MAX_FAILED_CYCLES;
    }
    this.continueAfter(REFRESH_INTERVAL_MS);
    this.notify();
  }
}
