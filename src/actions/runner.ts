import type { AtResponse } from '../at/engine';
import { ACTIONS, SIM_READ, buildWrite, expectsModemToDrop, valueLabel } from './ec200a';
import type { ActionDefinition, ActionId, ActionSend } from './types';

export type OutcomeKind =
  | 'confirmed'
  /** The modem said no. */
  | 'refused'
  /** The value read back is not the one that was written, or could not be read. */
  | 'mismatch'
  | 'no-answer'
  /** The modem went away, and that was not expected. */
  | 'lost'
  /** The modem went away because of this action. */
  | 'restarting'
  /** Not an allowed value. Nothing was sent. */
  | 'invalid';

export interface ActionOutcome {
  kind: OutcomeKind;
  message: string;
  /** Null when nothing was sent. */
  command: string | null;
  /** What the modem literally answered to the write. */
  answer: string[];
}

export interface Readings {
  sim: string | null;
  values: Partial<Record<ActionId, string | null>>;
}

export function emptyReadings(): Readings {
  return { sim: null, values: {} };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function literal(r: AtResponse): string[] {
  const detail = r.errorDetail ? ` ${r.errorDetail}` : '';
  return [...r.lines, `[${r.status}${detail}]`];
}

/** Reads the current values, read forms only. Stops at a lost connection: the rest stays unknown. */
export async function readCurrent(send: ActionSend): Promise<Readings> {
  const out = emptyReadings();
  const sim = await send(SIM_READ.command);
  if (sim.status === 'disconnected') return out;
  out.sim = SIM_READ.parse(sim);
  for (const action of ACTIONS) {
    if (!action.read) continue;
    const r = await send(action.read.command);
    if (r.status === 'disconnected') return out;
    out.values[action.id] = action.read.parse(r);
  }
  return out;
}

function goneOutcome(action: ActionDefinition, command: string, answer: string[], stage: string): ActionOutcome {
  if (expectsModemToDrop(action)) {
    const message = action.kind === 'trigger'
      ? 'The modem is restarting. Reconnect when it is back.'
      : `The modem went away ${stage}, which can happen with this setting. Reconnect when it is back and check the value: this change is not confirmed.`;
    return { kind: 'restarting', message, command, answer };
  }
  return { kind: 'lost', message: `The connection was lost ${stage}. This change is not confirmed.`, command, answer };
}

/**
 * Sends one write and reports what is known afterwards. The caller has already had the
 * person's confirmation. Only a read-back that matches counts as a confirmed change.
 */
export async function runAction(
  send: ActionSend,
  action: ActionDefinition,
  value: string,
  wait: (ms: number) => Promise<void> = delay,
): Promise<ActionOutcome> {
  const command = buildWrite(action, value);
  if (command === null) return { kind: 'invalid', message: 'That is not an allowed value. Nothing was sent.', command: null, answer: [] };

  const written = await send(command, action.timeoutMs ? { timeoutMs: action.timeoutMs } : {});
  const answer = literal(written);
  if (written.status === 'disconnected') return goneOutcome(action, command, answer, 'during the change');
  if (written.status === 'timeout') {
    return { kind: 'no-answer', message: 'The modem did not answer in time. The setting may or may not have changed.', command, answer };
  }
  if (written.status !== 'ok') {
    const detail = written.errorDetail ? `: ${written.errorDetail}` : '';
    return { kind: 'refused', message: `The modem refused this${detail}.`, command, answer };
  }
  if (!action.read) {
    return { kind: 'restarting', message: 'The modem is restarting. Reconnect when it is back.', command, answer };
  }

  const attempts = action.settle?.attempts ?? 1;
  let read: string | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(action.settle!.delayMs);
    const r = await send(action.read.command);
    if (r.status === 'disconnected') return goneOutcome(action, command, answer, 'while reading the value back');
    read = action.read.parse(r);
    if (read === value) {
      return { kind: 'confirmed', message: `Confirmed: the modem now reads ${valueLabel(action, read)}.`, command, answer };
    }
  }
  const message = read === null
    ? 'The modem accepted the command, but the value could not be read back. This change is not confirmed.'
    : `The modem accepted the command, but it reads ${valueLabel(action, read)} instead of ${valueLabel(action, value)}. This change is not confirmed.`;
  return { kind: 'mismatch', message, command, answer };
}
