import type { AtResponse, SendOptions } from '../at/engine';

export type ToolId = 'pin' | 'ussd' | 'operator' | 'sms' | 'ping' | 'modem-speed';

/** Unsolicited lines that one tool waits for, collected from before its command is sent. */
export interface Listener {
  readonly lines: string[];
  /** True once `done` holds for the lines so far, false when the time runs out first. */
  wait: (done: (lines: string[]) => boolean, timeoutMs: number) => Promise<boolean>;
  stop: () => void;
}

/** What a tool may do with the modem while it holds it. */
export interface ToolIo {
  send: (command: string, opts?: SendOptions) => Promise<AtResponse>;
  /** Start before sending: an answer can arrive in the same chunk as the OK. */
  listen: (accept: (line: string) => boolean) => Listener;
}

/** A tool's result in plain words, and what the modem literally said. Secrets are masked in both. */
export interface ToolOutcome {
  tone: 'ok' | 'warn' | 'bad';
  message: string;
  /** The command as it may be shown. */
  shown?: string;
  answer: string[];
}

/** Turns the engine's URC registration into a listener. */
export function createListener(onUrc: (cb: (line: string) => void) => () => void, accept: (line: string) => boolean): Listener {
  const lines: string[] = [];
  let notify: (() => void) | undefined;
  const off = onUrc((line) => {
    if (!accept(line)) return;
    lines.push(line);
    notify?.();
  });
  return {
    lines,
    wait: (done, timeoutMs) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          notify = undefined;
          resolve(false);
        }, timeoutMs);
        notify = () => {
          if (!done(lines)) return;
          clearTimeout(timer);
          notify = undefined;
          resolve(true);
        };
        notify();
      }),
    stop: off,
  };
}

/** The literal answer of one command, with its final status, as the result shows it. */
export function literal(r: AtResponse): string[] {
  const detail = r.errorDetail ? ` ${r.errorDetail}` : '';
  return [...r.lines, `[${r.status}${detail}]`];
}

/** Says why the modem refused, in its own words when it gave any. */
export function refusal(r: AtResponse): string {
  if (r.status === 'timeout') return 'The modem did not answer in time.';
  if (r.status === 'disconnected') return 'The connection to the modem was lost.';
  return `The modem refused this${r.errorDetail ? `: ${r.errorDetail}` : ''}.`;
}
