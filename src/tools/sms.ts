import type { AtResponse } from '../at/engine';
import { capture } from '../actions/ec200a';
import { encodeSubmit, parseSmsList } from './pdu';
import type { StoredSms } from './pdu';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

const LIST_MS = 30000;
const SEND_MS = 60000;

export interface SmsStorage {
  used: number;
  total: number;
}

export function parseStorage(r: AtResponse): SmsStorage | null {
  const m = capture(r, /^\+CPMS:\s*("[^"]*"\s*,\s*\d+\s*,\s*\d+)/i);
  if (!m) return null;
  const n = /,\s*(\d+)\s*,\s*(\d+)$/.exec(m);
  return n ? { used: Number(n[1]), total: Number(n[2]) } : null;
}

type Moded<T> = { ok: true; value: T } | { ok: false; refused: AtResponse };

/** Runs `work` in PDU mode and puts the previous message format back afterwards. */
async function inPduMode<T>(io: ToolIo, work: () => Promise<T>): Promise<Moded<T>> {
  const before = capture(await io.send('AT+CMGF?'), /^\+CMGF:\s*(\d)/i);
  if (before !== '0') {
    const r = await io.send('AT+CMGF=0');
    if (r.status !== 'ok') return { ok: false, refused: r };
  }
  try {
    return { ok: true, value: await work() };
  } finally {
    if (before === '1') await io.send('AT+CMGF=1');
  }
}

export interface SmsList extends ToolOutcome {
  messages: StoredSms[];
  storage: SmsStorage | null;
}

/** Lists every stored message. Unread messages count as read afterwards: the modem marks them. */
export async function listSms(io: ToolIo): Promise<SmsList> {
  const storage = parseStorage(await io.send('AT+CPMS?'));
  const moded = await inPduMode(io, () => io.send('AT+CMGL=4', { timeoutMs: LIST_MS }));
  const r = moded.ok ? moded.value : moded.refused;
  if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: r.command, answer: literal(r), messages: [], storage };
  const messages = parseSmsList(r.lines);
  const message = messages.length === 0 ? 'No messages are stored.' : `${messages.length} message${messages.length === 1 ? '' : 's'}.`;
  return { tone: 'ok', message, shown: 'AT+CMGL=4', answer: [], messages, storage };
}

/** Deletes every part of one message. Stops at the first part the modem refuses. */
export async function deleteSms(io: ToolIo, indexes: number[]): Promise<ToolOutcome> {
  const answer: string[] = [];
  for (const i of indexes) {
    if (!Number.isInteger(i) || i < 0 || i > 999) return { tone: 'bad', message: 'Not a storage index. Nothing more was sent.', answer };
    const r = await io.send(`AT+CMGD=${i}`, { timeoutMs: LIST_MS });
    answer.push(...literal(r));
    if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: `AT+CMGD=${i}`, answer };
  }
  return { tone: 'ok', message: indexes.length > 1 ? `Deleted, all ${indexes.length} parts.` : 'Deleted.', shown: indexes.map((i) => `AT+CMGD=${i}`).join(', '), answer };
}

/** Sends a text, part by part. Each part is a separate message to the network and may cost money. */
export async function sendSms(io: ToolIo, number: string, text: string, ref = Math.floor(Math.random() * 256)): Promise<ToolOutcome> {
  const pdus = encodeSubmit(number, text, ref);
  if (!pdus) return { tone: 'bad', message: 'The number or the text cannot be sent. Nothing was sent.', answer: [] };
  const answer: string[] = [];
  const moded = await inPduMode(io, async () => {
    for (const [i, pdu] of pdus.entries()) {
      const sent = await io.send(`AT+CMGS=${pdu.length}`, { timeoutMs: SEND_MS, body: pdu.hex });
      answer.push(...literal(sent));
      if (sent.status !== 'ok') return { failedAt: i + 1, sent };
    }
    return { failedAt: 0, sent: undefined };
  });
  if (!moded.ok) return { tone: 'bad', message: refusal(moded.refused), answer };
  const r = moded.value;
  if (r.failedAt > 0) {
    const sentBefore = r.failedAt - 1;
    const already = sentBefore > 0 ? ` ${sentBefore} of ${pdus.length} parts went out before.` : '';
    return { tone: 'bad', message: `${refusal(r.sent!)}${already}`, shown: 'AT+CMGS', answer };
  }
  return { tone: 'ok', message: pdus.length > 1 ? `Sent in ${pdus.length} parts.` : 'Sent.', shown: 'AT+CMGS', answer };
}
