import type { AtResponse, AtStatus, SendOptions } from '../../src/at/engine';
import { createListener } from '../../src/tools/types';
import type { ToolIo } from '../../src/tools/types';

export interface Reply {
  status?: AtStatus;
  lines?: string[];
  errorDetail?: string;
  /** Unsolicited lines the modem sends after this answer. */
  after?: string[];
}

/** A modem that answers from a table. Every command sent is recorded, with its options. */
export function fakeIo(table: Record<string, Reply | ((opts: SendOptions) => Reply)>) {
  const sent: Array<{ command: string; opts: SendOptions }> = [];
  const listeners: Array<(line: string) => void> = [];
  const onUrc = (cb: (line: string) => void) => {
    listeners.push(cb);
    return () => listeners.splice(listeners.indexOf(cb), 1);
  };
  const io: ToolIo = {
    async send(command, opts = {}) {
      sent.push({ command, opts });
      const entry = table[command];
      const reply = typeof entry === 'function' ? entry(opts) : entry ?? { status: 'error' as const };
      const r: AtResponse = { command, status: reply.status ?? 'ok', lines: reply.lines ?? [], durationMs: 1 };
      if (reply.errorDetail) r.errorDetail = reply.errorDetail;
      if (reply.after) setTimeout(() => { for (const l of reply.after!) for (const cb of [...listeners]) cb(l); }, 0);
      return r;
    },
    listen: (accept) => createListener(onUrc, accept),
  };
  return { io, sent, commands: () => sent.map((s) => s.command), listeners };
}
