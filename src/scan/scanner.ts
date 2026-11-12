import type { AtEngine, AtResponse } from '../at/engine';
import type { CatalogEntry, Category, Profile } from '../catalog/types';
import { CLAC_COMMAND, STANDARD_CATALOG } from '../catalog/standard';
import { CANDIDATE_COMMANDS } from '../catalog/candidates';
import { discoveryForms, isDiscoverable, parseCommandList } from '../catalog/safety';
import { matchProfile } from '../profiles';

export type ItemState = 'done' | 'skipped' | 'unsupported' | 'failed';

export interface ScanItem {
  id: string;
  command: string;
  /** 'web' marks an answer imported from a modem's own web page. */
  category: Category | 'discovery' | 'web';
  state: ItemState;
  response?: AtResponse;
  parser?: string;
}

export interface ScanReport {
  startedAt: string;
  /** The ModemLens build that made the report, "version (commit)". Tells an old cached page apart. */
  app?: string;
  usb?: string;
  profile?: Profile;
  items: ScanItem[];
  commandList: string[];
  interrupted?: string;
}

const IDENTITY_MODEL_COMMANDS = ['ATI', 'AT+GMM', 'AT+CGMM'];
const CPIN_QUERY = 'AT+CPIN?';
const NO_RESPONSE = 'no response, wrong port?';
/** Consecutive identity timeouts after which the port counts as silent. */
const MAX_IDENTITY_TIMEOUTS = 2;
/** Deep scan: a silent command costs this long, and this many in a row end the scan. */
const DEEP_TIMEOUT_MS = 1500;
const MAX_DEEP_TIMEOUTS = 5;
const DEEP_SILENT = `deep scan stopped: ${MAX_DEEP_TIMEOUTS} commands in a row got no answer`;

/** "AT+QENG=\"servingcell\"" -> "+QENG"; undefined for plain commands such as ATI. */
export function commandName(command: string): string | undefined {
  const m = /^AT([+$^#!%*][A-Za-z0-9_]+)/i.exec(command.trim());
  return m ? m[1].toUpperCase() : undefined;
}

function stateOf(r: AtResponse): ItemState {
  switch (r.status) {
    case 'ok': return 'done';
    case 'error':
    case 'cme_error':
    case 'cms_error': return 'unsupported';
    default: return 'failed';
  }
}

/**
 * Runs the read-only survey of a modem. The automatic and deep phases only
 * send commands taken from the catalog, the profile or a safe probe form of a
 * name the modem itself listed. Nothing is ever written to the modem.
 */
export class Scanner {
  readonly report: ScanReport;
  private cbs: Array<(item: ScanItem) => void> = [];
  private commandCbs: Array<(command: string) => void> = [];
  private simReady = false;
  private disconnectReason?: string;
  /** Second forms the running deep scan no longer needs: the name turned out not to exist. */
  private deepFormsDropped = 0;

  constructor(private readonly engine: AtEngine, opts: { usb?: string; profile?: Profile } = {}) {
    this.report = { startedAt: new Date().toISOString(), items: [], commandList: [] };
    if (opts.usb !== undefined) this.report.usb = opts.usb;
    if (opts.profile) this.report.profile = opts.profile;
    engine.onDisconnect((reason) => { this.disconnectReason = reason; });
  }

  onItem(cb: (item: ScanItem) => void): void {
    this.cbs.push(cb);
  }

  /** Called with each command just before it is sent. */
  onCommand(cb: (command: string) => void): void {
    this.commandCbs.push(cb);
  }

  /** How many commands the automatic scan issues, as far as that is known yet: a profile adds to it. */
  plannedAutoCommands(): number {
    const commands = new Set([...STANDARD_CATALOG.filter(e => e.phase === 'auto'), ...this.profileEntries()].map(e => e.command));
    return commands.size + 1; // the closing command-list query
  }

  /** How many commands the deep scan issues at most, as far as that is known: a name without an answer costs fewer. */
  plannedDeepCommands(): number {
    return this.deepNames().reduce((sum, name) => sum + discoveryForms(name).length, 0) - this.deepFormsDropped;
  }

  async runAuto(signal?: AbortSignal): Promise<ScanReport> {
    const done = new Set<string>();
    const run = async (entries: CatalogEntry[], stopIfSilent = false): Promise<boolean> => {
      let timeouts = 0;
      for (const e of entries) {
        if (done.has(e.command)) continue;
        done.add(e.command);
        if (!(await this.step(e, signal))) return false;
        const last = this.report.items[this.report.items.length - 1];
        timeouts = last.response?.status === 'timeout' ? timeouts + 1 : 0;
        if (stopIfSilent && timeouts >= MAX_IDENTITY_TIMEOUTS) {
          this.report.interrupted = NO_RESPONSE;
          return false;
        }
      }
      return true;
    };
    const auto = STANDARD_CATALOG.filter(e => e.phase === 'auto');
    const identity = auto.filter(e => e.category === 'identity');
    const cpin = auto.filter(e => e.command === CPIN_QUERY);
    const standardRest = auto.filter(e => e.category !== 'identity' && e.command !== CPIN_QUERY);

    // A silent port would otherwise cost minutes of timeouts.
    if (!(await run(identity, true))) return this.report;
    this.detectProfile(identity);
    // CPIN must run before every needsSim row.
    if (!(await run(cpin))) return this.report;
    if (!(await run([...standardRest, ...this.profileEntries()]))) return this.report;
    await this.step({ id: 'clac', command: CLAC_COMMAND, category: 'other', phase: 'auto' }, signal, true);
    return this.report;
  }

  async runDeep(signal?: AbortSignal): Promise<ScanReport> {
    delete this.report.interrupted;
    this.deepFormsDropped = 0;
    try {
      return await this.deepScan(signal);
    } finally {
      this.deepFormsDropped = 0;
    }
  }

  /** The names a deep scan asks about: not covered elsewhere, each once, none on a deny list. */
  private deepNames(): string[] {
    const profile = this.report.profile;
    const covered = new Set<string>();
    for (const e of [...STANDARD_CATALOG, ...(profile?.commands ?? [])]) {
      const n = commandName(e.command);
      if (n) covered.add(n);
    }
    // The modem's own list when it gave one, otherwise the built-in candidates.
    const names = this.report.commandList.length > 0 ? this.report.commandList : CANDIDATE_COMMANDS;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
      const name = raw.trim().toUpperCase();
      if (seen.has(name) || covered.has(name)) continue;
      seen.add(name);
      if (isDiscoverable(name, profile?.denyCommands)) out.push(name);
    }
    return out;
  }

  private async deepScan(signal?: AbortSignal): Promise<ScanReport> {
    let timeouts = 0;
    for (const name of this.deepNames()) {
      // Ask whether the name exists first; only a modem that answered OK is asked for the current value.
      const forms = discoveryForms(name);
      for (const [i, command] of forms.entries()) {
        const entry: CatalogEntry = { id: `deep:${command.slice(2)}`, command, category: 'other', phase: 'auto', timeoutMs: DEEP_TIMEOUT_MS };
        if (!(await this.step(entry, signal, false, 'discovery', forms.length - i - 1))) return this.report;
        const last = this.report.items[this.report.items.length - 1].response;
        timeouts = last?.status === 'timeout' ? timeouts + 1 : 0;
        if (timeouts >= MAX_DEEP_TIMEOUTS) {
          this.report.interrupted = DEEP_SILENT;
          return this.report;
        }
        if (last?.status !== 'ok') break;
      }
    }
    return this.report;
  }

  /** Explicit user action: the only place a 'manual' entry is sent. */
  async runManual(entry: CatalogEntry): Promise<ScanItem> {
    delete this.report.interrupted;
    this.announce(entry.command);
    const r = await this.engine.send(entry.command, entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {});
    if (r.status === 'disconnected') this.report.interrupted = this.disconnectReason ?? r.errorDetail ?? 'disconnected';
    return this.record(entry, r, stateOf(r));
  }

  private profileEntries(): CatalogEntry[] {
    const p = this.report.profile;
    if (!p) return [];
    const deny = new Set(p.denyCommands.map(d => d.trim().toUpperCase()));
    return p.commands.filter(e => {
      if (e.phase !== 'auto') return false;
      const n = commandName(e.command);
      return !(n && deny.has(n));
    });
  }

  private detectProfile(identity: CatalogEntry[]): void {
    if (this.report.profile) return;
    const model: string[] = [];
    for (const e of identity) {
      if (!IDENTITY_MODEL_COMMANDS.includes(e.command)) continue;
      const item = this.report.items.find(i => i.id === e.id);
      if (item?.response?.status === 'ok') model.push(...item.response.lines);
    }
    const hit = matchProfile({ usb: this.report.usb, model: model.join('\n') });
    if (hit) this.report.profile = hit;
  }

  /** Returns false when the scan has to stop (abort or disconnect). */
  private async step(entry: CatalogEntry, signal?: AbortSignal, isClac = false, category?: 'discovery', formsAfter = 0): Promise<boolean> {
    if (signal?.aborted) {
      this.report.interrupted = 'aborted';
      return false;
    }
    if (entry.needsSim && !this.simReady) {
      this.record(entry, undefined, 'skipped');
      return true;
    }
    this.announce(entry.command);
    const r = await this.engine.send(entry.command, entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {});
    if (r.status === 'disconnected') {
      this.report.interrupted = this.disconnectReason ?? r.errorDetail ?? 'disconnected';
      return false;
    }
    if (entry.command === CPIN_QUERY) {
      this.simReady = r.status === 'ok' && r.lines.some(l => /^\+CPIN:\s*READY\b/i.test(l));
    }
    const state = stateOf(r);
    if (isClac && state === 'done') this.report.commandList = parseCommandList(r.lines);
    // Before the item is announced, so that whoever shows the total never lags behind it.
    if (r.status !== 'ok') this.deepFormsDropped += formsAfter;
    this.record(entry, r, state, category);
    return true;
  }

  private announce(command: string): void {
    for (const cb of this.commandCbs) {
      try { cb(command); } catch { /* a faulty listener must not stop the scan */ }
    }
  }

  private record(entry: CatalogEntry, response: AtResponse | undefined, state: ItemState, category?: 'discovery'): ScanItem {
    const item: ScanItem = { id: entry.id, command: entry.command, category: category ?? entry.category, state };
    if (response) item.response = response;
    if (entry.parser) item.parser = entry.parser;
    this.report.items.push(item);
    for (const cb of this.cbs) {
      try { cb(item); } catch { /* a faulty listener must not stop the scan */ }
    }
    return item;
  }
}
