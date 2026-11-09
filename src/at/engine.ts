import type { Transport } from '../transport/types';

export type AtStatus = 'ok' | 'error' | 'cme_error' | 'cms_error' | 'no_carrier' | 'timeout' | 'disconnected';

export interface AtResponse {
  command: string;
  status: AtStatus;
  lines: string[];
  errorDetail?: string;
  durationMs: number;
}

const URC_PREFIXES = [
  'RDY', 'RING', '+CREG:', '+CGREG:', '+CEREG:', '+C5GREG:', '+CGEV:', '+CMTI:',
  '+CUSD:', '+CLIP:', '+QIND:', '+QUSIM:', '+CPIN:', '+CFUN:',
];

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_QUIET_AFTER_TIMEOUT_MS = 300;
const CTRL_Z = '\x1a';

interface Terminal {
  status: AtStatus;
  detail?: string;
}

/** Returns the terminal result if the line ends a response, otherwise undefined. */
function terminal(line: string): Terminal | undefined {
  if (line === 'OK') return { status: 'ok' };
  if (line === 'ERROR') return { status: 'error' };
  if (line.startsWith('+CME ERROR:')) return { status: 'cme_error', detail: line.slice(11).trim() };
  if (line.startsWith('+CMS ERROR:')) return { status: 'cms_error', detail: line.slice(11).trim() };
  if (line === 'NO CARRIER') return { status: 'no_carrier' };
  if (line === 'BUSY' || line === 'NO ANSWER' || line === 'NO DIALTONE') return { status: 'error', detail: line };
  return undefined;
}

/** "AT+CREG?" -> "+CREG:", "ATI" -> "" (no own prefix). */
function ownPrefix(command: string): string {
  const m = /^AT([+^$#&*%!][A-Za-z0-9_]+)/i.exec(command.trim());
  return m ? `${m[1].toUpperCase()}:` : '';
}

function decode(chunk: Uint8Array): string {
  // latin1 maps every byte to a character and never throws.
  return new TextDecoder('latin1').decode(chunk);
}

function encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

interface Active {
  command: string;
  prefix: string;
  body?: string;
  bodySent: boolean;
  lines: string[];
  startedAt: number;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: AtResponse) => void;
  done: () => void;
}

interface Queued {
  command: string;
  opts: { timeoutMs?: number; body?: string };
  resolve: (r: AtResponse) => void;
}

/**
 * Sequential AT command engine. It only ever writes what `send()` is told to:
 * no initialisation, no echo switching, nothing on its own.
 */
export class AtEngine {
  private readonly defaultTimeoutMs: number;
  private readonly quietMs: number;
  private queue: Queued[] = [];
  private active: Active | null = null;
  private buffer = '';
  private quiet = false;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private pumping = false;
  private gone = false;
  private urcCbs: Array<(line: string) => void> = [];
  private disconnectCbs: Array<(reason: string) => void> = [];

  constructor(
    private readonly transport: Transport,
    opts: { defaultTimeoutMs?: number; quietAfterTimeoutMs?: number } = {},
  ) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.quietMs = opts.quietAfterTimeoutMs ?? DEFAULT_QUIET_AFTER_TIMEOUT_MS;
    transport.onData((chunk) => this.handleData(chunk));
    transport.onDisconnect((reason) => this.handleDisconnect(reason));
  }

  send(command: string, opts: { timeoutMs?: number; body?: string } = {}): Promise<AtResponse> {
    return new Promise((resolve) => {
      if (this.gone) {
        resolve({ command, status: 'disconnected', lines: [], durationMs: 0 });
        return;
      }
      this.queue.push({ command, opts, resolve });
      void this.pump();
    });
  }

  onUrc(cb: (line: string) => void): void {
    this.urcCbs.push(cb);
  }

  onDisconnect(cb: (reason: string) => void): void {
    this.disconnectCbs.push(cb);
  }

  dispose(): void {
    this.gone = true;
    this.finishAll('disconnected');
    this.clearQuiet();
    this.urcCbs = [];
    this.disconnectCbs = [];
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.gone && !this.active && !this.quiet && this.queue.length > 0) {
        const next = this.queue.shift()!;
        await this.start(next);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async start(q: Queued): Promise<void> {
    const timeoutMs = q.opts.timeoutMs ?? this.defaultTimeoutMs;
    this.buffer = '';
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const active: Active = {
      command: q.command,
      prefix: ownPrefix(q.command),
      body: q.opts.body,
      bodySent: false,
      lines: [],
      startedAt: Date.now(),
      timeoutMs,
      resolve: q.resolve,
      done,
      timer: setTimeout(() => this.onTimeout(active), timeoutMs),
    };
    this.active = active;
    try {
      await this.transport.write(encode(`${q.command}\r`));
    } catch (e) {
      if (this.active === active) this.complete(active, 'disconnected', e instanceof Error ? e.message : String(e));
    }
    // Wait until this command is finished before the pump continues.
    await finished;
  }

  private complete(a: Active, status: AtStatus, errorDetail?: string): void {
    if (this.active !== a) return;
    clearTimeout(a.timer);
    this.active = null;
    const res: AtResponse = {
      command: a.command,
      status,
      lines: a.lines,
      durationMs: status === 'timeout' ? a.timeoutMs : Date.now() - a.startedAt,
    };
    if (errorDetail !== undefined) res.errorDetail = errorDetail;
    a.resolve(res);
    a.done();
  }

  private onTimeout(a: Active): void {
    if (this.active !== a) return;
    this.buffer = '';
    this.complete(a, 'timeout');
    this.enterQuiet();
  }

  private enterQuiet(): void {
    this.quiet = true;
    this.restartQuietTimer();
  }

  private restartQuietTimer(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.quiet = false;
      this.buffer = '';
      void this.pump();
    }, this.quietMs);
  }

  private clearQuiet(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.quiet = false;
  }

  private finishAll(status: AtStatus, detail?: string): void {
    if (this.active) this.complete(this.active, status, detail);
    const pending = this.queue;
    this.queue = [];
    for (const q of pending) q.resolve({ command: q.command, status, lines: [], durationMs: 0, ...(detail ? { errorDetail: detail } : {}) });
  }

  private handleDisconnect(reason: string): void {
    if (this.gone) return;
    this.gone = true;
    this.clearQuiet();
    this.finishAll('disconnected', reason);
    for (const cb of this.disconnectCbs) cb(reason);
  }

  private handleData(chunk: Uint8Array): void {
    if (this.gone) return;
    let text: string;
    try {
      text = decode(chunk);
    } catch {
      return;
    }
    if (this.quiet) {
      // Silence period after a timeout: swallow everything, restart the timer.
      this.restartQuietTimer();
      return;
    }
    this.buffer += text;
    const parts = this.buffer.split(/[\r\n]/);
    this.buffer = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.trim();
      if (line === '') continue;
      this.handleLine(line);
    }
    this.checkPrompt();
  }

  private checkPrompt(): void {
    const a = this.active;
    if (!a || a.body === undefined || a.bodySent) return;
    if (this.buffer.trim() === '>') {
      a.bodySent = true;
      this.buffer = '';
      this.transport.write(encode(a.body + CTRL_Z)).catch(() => {});
    }
  }

  private handleLine(line: string): void {
    const a = this.active;
    if (!a) {
      // Idle: stray terminators are noise, everything else is unsolicited.
      if (terminal(line)) return;
      this.emitUrc(line);
      return;
    }
    if (line === a.command.trim()) return; // echo
    const t = terminal(line);
    if (t) {
      this.complete(a, t.status, t.detail);
      return;
    }
    if (this.isUrc(line) && !(a.prefix && line.toUpperCase().startsWith(a.prefix))) {
      this.emitUrc(line);
      return;
    }
    a.lines.push(line);
  }

  private isUrc(line: string): boolean {
    return URC_PREFIXES.some((p) => line === p || line.startsWith(p));
  }

  private emitUrc(line: string): void {
    for (const cb of this.urcCbs) {
      try {
        cb(line);
      } catch {
        // a faulty listener must not break the engine
      }
    }
  }
}
