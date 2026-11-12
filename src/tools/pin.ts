import type { AtResponse } from '../at/engine';
import { capture } from '../actions/ec200a';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

export const PIN_PATTERN = /^\d{4,8}$/;
export const PUK_PATTERN = /^\d{8}$/;
const MASK = '****';
const SLOW_MS = 15000;

export type PinOperation = 'unlock' | 'puk' | 'change' | 'lock-on' | 'lock-off';

export interface PinStatus {
  /** READY, SIM PIN, SIM PUK or whatever else the modem says. Null when unreadable. */
  state: string | null;
  /** Whether the SIM asks for the PIN at start. Null when unreadable, as it is while the SIM is locked. */
  lockOn: boolean | null;
  pinLeft: number | null;
  pukLeft: number | null;
}

export const OPERATION_LABEL: Record<PinOperation, string> = {
  unlock: 'Unlock with PIN',
  puk: 'Unblock with PUK',
  change: 'Change PIN',
  'lock-on': 'Ask for the PIN at start',
  'lock-off': 'Stop asking for the PIN',
};

/** Which counter an operation uses up when the code is wrong. */
export const SPENDS: Record<PinOperation, 'pin' | 'puk'> = { unlock: 'pin', puk: 'puk', change: 'pin', 'lock-on': 'pin', 'lock-off': 'pin' };

export function parseSimState(r: AtResponse): string | null {
  return capture(r, /^\+CPIN:\s*(.+)$/i)?.trim().toUpperCase() ?? null;
}

export function parseLock(r: AtResponse): boolean | null {
  const v = capture(r, /^\+CLCK:\s*(\d)/i);
  return v === null ? null : v === '1';
}

interface CounterRead {
  command: string;
  parse: (r: AtResponse) => { pin: number; puk: number } | null;
}

const nums = (m: RegExpExecArray | null, a: number, b: number) => (m ? { pin: Number(m[a]), puk: Number(m[b]) } : null);
const lastLine = (r: AtResponse, re: RegExp) => (r.status === 'ok' ? [...r.lines].reverse().map((l) => re.exec(l.trim())).find(Boolean) ?? null : null);

/** The remaining attempts are not standard: each family has its own read. */
const COUNTERS: Array<{ profile: RegExp; read: CounterRead }> = [
  { profile: /^quectel-/, read: { command: 'AT+QPINC="SC"', parse: (r) => nums(lastLine(r, /^\+QPINC:\s*"SC"\s*,\s*(\d+)\s*,\s*(\d+)/i), 1, 2) } },
  { profile: /^simcom-/, read: { command: 'AT+SPIC', parse: (r) => nums(lastLine(r, /^\+SPIC:\s*(\d+)\s*,\s*(\d+)/i), 1, 2) } },
  // ^CPIN: <code>,[<times>],<puk_times>,<pin_times>,<puk2_times>,<pin2_times>
  { profile: /^huawei-/, read: { command: 'AT^CPIN?', parse: (r) => nums(lastLine(r, /^\^CPIN:\s*[^,]*,\s*\d*\s*,\s*(\d+)\s*,\s*(\d+)/i), 2, 1) } },
];

export function counterRead(profileId: string | undefined): CounterRead | undefined {
  return profileId === undefined ? undefined : COUNTERS.find((c) => c.profile.test(profileId))?.read;
}

export async function readPinStatus(io: ToolIo, profileId: string | undefined): Promise<PinStatus> {
  const status: PinStatus = { state: null, lockOn: null, pinLeft: null, pukLeft: null };
  const sim = await io.send('AT+CPIN?');
  if (sim.status === 'disconnected') return status;
  status.state = parseSimState(sim);
  if (status.state === 'READY') {
    const lock = await io.send('AT+CLCK="SC",2', { timeoutMs: SLOW_MS });
    if (lock.status === 'disconnected') return status;
    status.lockOn = parseLock(lock);
  }
  const counters = counterRead(profileId);
  if (counters) {
    const r = await io.send(counters.command);
    const c = counters.parse(r);
    if (c) {
      status.pinLeft = c.pin;
      status.pukLeft = c.puk;
    }
  }
  return status;
}

/** What can be done with the SIM in this state. Nothing while the state is unknown. */
export function operationsFor(s: PinStatus): PinOperation[] {
  if (s.state === 'SIM PIN') return ['unlock'];
  if (s.state === 'SIM PUK') return ['puk'];
  if (s.state !== 'READY') return [];
  if (s.lockOn === true) return ['change', 'lock-off'];
  if (s.lockOn === false) return ['lock-on'];
  return [];
}

export interface PinInput {
  /** The PIN, or the PUK for "puk". */
  code: string;
  /** The new PIN for "puk" and "change". */
  newPin?: string;
}

/** Why the input cannot be sent, or undefined when it can. */
export function inputProblem(op: PinOperation, input: PinInput, repeat: string | undefined): string | undefined {
  if (op === 'puk' ? !PUK_PATTERN.test(input.code) : !PIN_PATTERN.test(input.code)) {
    return op === 'puk' ? 'A PUK is exactly 8 digits.' : 'A PIN is 4 to 8 digits.';
  }
  if (op === 'puk' || op === 'change') {
    if (!PIN_PATTERN.test(input.newPin ?? '')) return 'The new PIN is 4 to 8 digits.';
    if (repeat !== input.newPin) return 'The new PIN and its repetition differ.';
  }
  return undefined;
}

/** The only place a code goes into a command. Null for anything that is not digits of the right length. */
export function buildPinCommand(op: PinOperation, input: PinInput): string | null {
  if (inputProblem(op, input, input.newPin) !== undefined) return null;
  switch (op) {
    case 'unlock': return `AT+CPIN="${input.code}"`;
    case 'puk': return `AT+CPIN="${input.code}","${input.newPin}"`;
    case 'change': return `AT+CPWD="SC","${input.code}","${input.newPin}"`;
    case 'lock-on': return `AT+CLCK="SC",1,"${input.code}"`;
    case 'lock-off': return `AT+CLCK="SC",0,"${input.code}"`;
  }
}

/** Every quoted run of digits becomes ****, so that a command can be shown. */
export function maskCommand(command: string): string {
  return command.replace(/"\d+"/g, `"${MASK}"`);
}

/** Removes the codes from anything the modem sends back, in case it repeats one. */
export function maskLines(lines: string[], secrets: string[]): string[] {
  const codes = secrets.filter((s) => s.length > 0);
  return lines.map((l) => codes.reduce((acc, c) => acc.split(c).join(MASK), l));
}

/** How a warning reads before the code is sent. */
export function attemptWarning(op: PinOperation, s: PinStatus): { text: string; strong: boolean } {
  const left = SPENDS[op] === 'pin' ? s.pinLeft : s.pukLeft;
  const name = SPENDS[op] === 'pin' ? 'PIN' : 'PUK';
  if (left === null) return { text: `This modem does not say how many ${name} attempts are left. A wrong ${name} uses one up.`, strong: true };
  if (left <= 1) {
    const after = name === 'PIN' ? 'the SIM is blocked until its PUK is entered' : 'the SIM is blocked for good and has to be replaced';
    return { text: `This is the last ${name} attempt. If the ${name} is wrong, ${after}.`, strong: true };
  }
  return { text: `${left} ${name} attempts are left. A wrong ${name} uses one up.`, strong: false };
}

/** Whether the operation may be offered at all with these counters. */
export function exhausted(op: PinOperation, s: PinStatus): boolean {
  const left = SPENDS[op] === 'pin' ? s.pinLeft : s.pukLeft;
  return left === 0;
}

/** Sends one PIN operation, once. There is never a retry: each try can use up an attempt. */
export async function runPin(io: ToolIo, op: PinOperation, input: PinInput): Promise<ToolOutcome> {
  const command = buildPinCommand(op, input);
  if (command === null) return { tone: 'bad', message: 'That is not a valid code. Nothing was sent.', answer: [] };
  const secrets = [input.code, input.newPin ?? ''];
  const r = await io.send(command, { timeoutMs: SLOW_MS });
  const shown = maskCommand(command);
  const answer = maskLines(literal(r), secrets);
  if (r.status === 'ok') {
    const done: Record<PinOperation, string> = {
      unlock: 'The SIM is unlocked.',
      puk: 'The SIM is unblocked and has the new PIN.',
      change: 'The PIN is changed.',
      'lock-on': 'The SIM now asks for the PIN at every start.',
      'lock-off': 'The SIM no longer asks for the PIN.',
    };
    return { tone: 'ok', message: done[op], shown, answer };
  }
  return { tone: 'bad', message: `${refusal(r)} Check the remaining attempts before you try again.`, shown, answer };
}
