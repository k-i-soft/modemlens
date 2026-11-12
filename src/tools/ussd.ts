import { decodeGsm7Packed, decodeUcs2Hex } from './pdu';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

/** Digits, * and #, starting with * or #. Nothing else can get into the command. */
export const USSD_CODE = /^[*#][0-9*#]{1,31}$/;
/** An answer inside a USSD menu: usually a digit or two. */
export const USSD_REPLY = /^[0-9*#]{1,32}$/;
const ANSWER_MS = 30000;

export interface UssdAnswer {
  /** 0 done, 1 the network waits for a reply, 2 ended by the network, 3 another client answered, 4 not supported, 5 timeout. */
  status: number;
  text: string;
}

export const USSD_STATUS: Record<number, string> = {
  0: 'The network answered.',
  1: 'The network waits for your reply.',
  2: 'The network ended the session.',
  3: 'Another program on this modem answered first.',
  4: 'The network does not support this code.',
  5: 'The network did not answer in time.',
};

/** Whether `dcs` asks for UCS2 text (3GPP TS 23.038). */
export function isUcs2(dcs: number): boolean {
  if ((dcs & 0xc0) === 0x40 || (dcs & 0xf0) === 0x90) return ((dcs >> 2) & 0x03) === 2;
  return dcs === 0x11;
}

/**
 * Turns the text of a +CUSD answer into words. Modems send it as typed text, as UCS2 hex,
 * or (some Huawei) as packed GSM 7-bit hex.
 */
export function decodeUssdText(raw: string, dcs: number | undefined): string {
  const hex = /^(?:[0-9A-Fa-f]{2})+$/.test(raw) && raw.length >= 4;
  if (hex && dcs !== undefined && isUcs2(dcs)) return decodeUcs2Hex(raw);
  // Only a run with hex letters in it: a code or an amount made of digits is text.
  if (hex && dcs === 15 && /[A-Fa-f]/.test(raw)) {
    const septets = Math.floor((raw.length / 2) * 8 / 7);
    const text = decodeGsm7Packed(raw, septets).replace(/[\r@]+$/, '');
    if (/^[\p{L}\p{N}\p{P}\p{Zs}\n\r$€£¥]+$/u.test(text)) return text;
  }
  return raw;
}

/** Reads one complete +CUSD answer, which may run over several lines. */
export function parseUssd(lines: string[]): UssdAnswer | null {
  const text = lines.join('\n');
  const m = /^\+CUSD:\s*(\d)\s*(?:,\s*"([\s\S]*)"\s*(?:,\s*(\d+))?)?\s*$/.exec(text.trim());
  if (!m) return null;
  const dcs = m[3] === undefined ? undefined : Number(m[3]);
  return { status: Number(m[1]), text: m[2] === undefined ? '' : decodeUssdText(m[2], dcs) };
}

/** Whether the collected lines hold the whole answer: a status alone, or a quoted text that has closed. */
export function ussdComplete(lines: string[]): boolean {
  return parseUssd(lines) !== null;
}

/** Accepts the +CUSD line and whatever continues it until the answer is complete. */
export function ussdAccept(): (line: string) => boolean {
  let open = false;
  const seen: string[] = [];
  return (line) => {
    if (!open && !line.startsWith('+CUSD:')) return false;
    if (!open) {
      open = true;
      seen.length = 0;
    }
    seen.push(line);
    if (ussdComplete(seen)) open = false;
    return true;
  };
}

export function buildUssd(code: string): string | null {
  return USSD_CODE.test(code) ? `AT+CUSD=1,"${code}",15` : null;
}

export function buildUssdReply(reply: string): string | null {
  return USSD_REPLY.test(reply) ? `AT+CUSD=1,"${reply}",15` : null;
}

export const USSD_CANCEL = 'AT+CUSD=2';

export interface UssdResult extends ToolOutcome {
  /** The network waits for a reply. */
  open: boolean;
  text?: string;
}

/** Sends a code or a reply and waits for the network's answer. */
export async function runUssd(io: ToolIo, command: string): Promise<UssdResult> {
  const listener = io.listen(ussdAccept());
  try {
    const r = await io.send(command, { timeoutMs: ANSWER_MS });
    // Some modems hold the OK back until the network has answered, and put the answer before it.
    const start = r.lines.findIndex((l) => l.startsWith('+CUSD:'));
    const inline = start < 0 ? [] : r.lines.slice(start);
    if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: command, answer: literal(r), open: false };
    const answerLines = parseUssd(inline) ? inline : (await listener.wait(ussdComplete, ANSWER_MS)) ? listener.lines : [];
    const answer = parseUssd(answerLines);
    if (!answer) return { tone: 'bad', message: 'No answer from the network within 30 seconds.', shown: command, answer: literal(r), open: false };
    const tone = answer.status <= 2 ? 'ok' : 'bad';
    return { tone, message: USSD_STATUS[answer.status] ?? `Status ${answer.status}.`, shown: command, answer: answerLines, open: answer.status === 1, text: answer.text };
  } finally {
    listener.stop();
  }
}
