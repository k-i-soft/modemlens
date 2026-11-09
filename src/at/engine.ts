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
/** A modem that never stops talking must not hold queued commands back for longer than this. */
const MAX_QUIET_MS = 2000;
/** A partial line longer than this is noise, not a response. */
const MAX_LINE_BUFFER = 64 * 1024;
const CTRL_Z = '\x1a';
const ESC = '\x1b';

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

export interface SendOptions {
  timeoutMs?: number;
  /** Text sent after the modem's "> " prompt, followed by Ctrl+Z. */
  body?: string;
  /** Only for commands a user typed: on timeout, leave an open "> " prompt with ESC. */
  cancelPromptOnTimeout?: boolean;
}

interface Active {
  command: string;
  prefix: string;
  body?: string;
  bodySent: boolean;
  cancelPrompt: boolean;
  promptOpen: boolean;
  echoSeen: boolean;
  /** Output was discarded because it arrived ahead of this command's own echo. */
  droppedAhead: boolean;
  /** Writes handed to the transport that have not settled yet. */
  pendingWrites: number;
  lines: string[];
  startedAt: number;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: AtResponse) => void;
  done: () => void;
}

interface Queued {
  command: string;
  opts: SendOptions;
  resolve: (r: AtResponse) => void;
}

/**
 * Sequential AT command engine. It only ever writes what `send()` is told to:
 * no initialisation, no echo switching, nothing on its own.
 *
 * The single exception is one ESC byte, sent when a command with
 * `cancelPromptOnTimeout` timed out at a "> " prompt, because every later
 * command would otherwise become message text. Only the terminal sets that
 * option, so the scans can never cause this byte.
 */
export class AtEngine {
  private readonly defaultTimeoutMs: number;
  private readonly quietMs: number;
  private queue: Queued[] = [];
  private active: Active | null = null;
  private buffer = '';
  private quiet = false;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private quietDeadline = 0;
  private pumping = false;
  private gone = false;
  /** Learned from the last answered command. */
  private modemEchoes = false;
  /** A timed-out command can still be answered, ahead of the next command's own echo. */
  private lateAnswerPossible = false;
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

  send(command: string, opts: SendOptions = {}): Promise<AtResponse> {
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

  /** Resolves when the command is finished. A write that never settles cannot hold it up. */
  private start(q: Queued): Promise<void> {
    const timeoutMs = q.opts.timeoutMs ?? this.defaultTimeoutMs;
    this.buffer = '';
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const active: Active = {
      command: q.command,
      prefix: ownPrefix(q.command),
      body: q.opts.body,
      bodySent: false,
      cancelPrompt: q.opts.cancelPromptOnTimeout === true,
      promptOpen: false,
      echoSeen: false,
      droppedAhead: false,
      pendingWrites: 0,
      lines: [],
      startedAt: Date.now(),
      timeoutMs,
      resolve: q.resolve,
      done,
      timer: setTimeout(() => this.onTimeout(active), timeoutMs),
    };
    this.active = active;
    this.write(`${q.command}\r`, active);
    return finished;
  }

  /** Never waits for the transport. Any write failure means the connection is gone. */
  private write(text: string, a?: Active): void {
    if (a) a.pendingWrites++;
    const settled = (): void => {
      if (a) a.pendingWrites--;
    };
    const failed = (e: unknown): void => {
      settled();
      this.handleDisconnect(e instanceof Error ? e.message : String(e));
    };
    try {
      this.transport.write(encode(text)).then(settled, failed);
    } catch (e) {
      failed(e);
    }
  }

  private complete(a: Active, status: AtStatus, errorDetail?: string): void {
    if (this.active !== a) return;
    clearTimeout(a.timer);
    this.active = null;
    if (status === 'timeout') {
      // Output but never the echo: the modem has stopped echoing, so waiting for one would stall every command.
      if (a.droppedAhead && !a.echoSeen) this.modemEchoes = false;
      this.lateAnswerPossible = true;
    } else if (status !== 'disconnected') {
      this.modemEchoes = a.echoSeen;
    }
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
    if (a.pendingWrites > 0) {
      this.handleDisconnect('write stalled');
      return;
    }
    this.buffer = '';
    this.complete(a, 'timeout');
    this.enterQuiet();
    if (a.promptOpen) this.write(ESC);
  }

  private enterQuiet(): void {
    this.quiet = true;
    this.quietDeadline = Date.now() + MAX_QUIET_MS;
    this.restartQuietTimer();
  }

  private restartQuietTimer(): void {
    const remaining = this.quietDeadline - Date.now();
    // At the deadline the running timer is due: replacing it could starve it under a flood of data.
    if (remaining <= 0 && this.quietTimer) return;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.quiet = false;
      this.buffer = '';
      void this.pump();
    }, Math.min(this.quietMs, Math.max(0, remaining)));
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
    if (this.buffer.length > MAX_LINE_BUFFER) this.buffer = '';
    for (const raw of parts) {
      const line = raw.trim();
      if (line === '') continue;
      this.handleLine(line);
    }
    this.checkPrompt();
  }

  private checkPrompt(): void {
    const a = this.active;
    if (!a || a.bodySent || this.buffer.trim() !== '>') return;
    if (a.body === undefined) {
      a.promptOpen = a.cancelPrompt;
      return;
    }
    a.bodySent = true;
    this.buffer = '';
    this.write(a.body + CTRL_Z, a);
  }

  private handleLine(line: string): void {
    const a = this.active;
    if (!a) {
      // Idle: stray terminators are noise, everything else is unsolicited.
      if (terminal(line)) return;
      this.emitUrc(line);
      return;
    }
    if (line === a.command.trim()) {
      a.echoSeen = true;
      this.lateAnswerPossible = false;
      return;
    }
    // A slow modem answers in order: whatever comes before this command's echo belongs to the one that timed out.
    if (this.lateAnswerPossible && this.modemEchoes && !a.echoSeen) {
      a.droppedAhead = true;
      if (this.isUrc(line)) this.emitUrc(line);
      return;
    }
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
