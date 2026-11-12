import type { AtResponse } from '../at/engine';
import { COPS_RAT_SHORT, groups, splitArgs } from '../parse/standard';
import type { ToolIo, ToolOutcome } from './types';
import { literal, refusal } from './types';

export const SCAN_MS = 180000;
const SELECT_MS = 120000;
const PLMN = /^\d{5,6}$/;
const ACTS = new Set(['0', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);

export interface Network {
  status: 'unknown' | 'available' | 'current' | 'forbidden';
  name: string;
  plmn: string;
  act?: string;
  /** For people: LTE, GSM and so on. */
  tech?: string;
}

const STATUS: Network['status'][] = ['unknown', 'available', 'current', 'forbidden'];

export function parseNetworks(r: AtResponse): Network[] {
  const out: Network[] = [];
  for (const line of r.lines) {
    const m = /^\+COPS:\s*(.*)$/i.exec(line.trim());
    if (!m) continue;
    for (const g of groups(m[1])) {
      const a = splitArgs(g);
      if (a.length < 4 || !/^\d$/.test(a[0]) || !PLMN.test(a[3])) continue;
      const act = /^\d+$/.test(a[4] ?? '') ? a[4] : undefined;
      out.push({ status: STATUS[Number(a[0])] ?? 'unknown', name: a[1] || a[2] || a[3], plmn: a[3], act, tech: act ? COPS_RAT_SHORT[act] ?? `AcT ${act}` : undefined });
    }
  }
  return out;
}

/** 0 automatic, 1 manual, 4 manual with fallback to automatic. */
export function parseMode(r: AtResponse): string | null {
  const m = r.status === 'ok' ? r.lines.map((l) => /^\+COPS:\s*(\d)/i.exec(l.trim())).find(Boolean) : null;
  return m ? m[1] : null;
}

export function buildSelect(plmn: string, act?: string): string | null {
  if (!PLMN.test(plmn)) return null;
  if (act !== undefined && !ACTS.has(act)) return null;
  return act === undefined ? `AT+COPS=1,2,"${plmn}"` : `AT+COPS=1,2,"${plmn}",${act}`;
}

export const SELECT_AUTOMATIC = 'AT+COPS=0';

export async function scanNetworks(io: ToolIo): Promise<ToolOutcome & { networks: Network[] }> {
  const r = await io.send('AT+COPS=?', { timeoutMs: SCAN_MS });
  if (r.status !== 'ok') return { tone: 'bad', message: refusal(r), shown: 'AT+COPS=?', answer: literal(r), networks: [] };
  const networks = parseNetworks(r);
  return { tone: 'ok', message: networks.length ? `${networks.length} networks found.` : 'No network found.', shown: 'AT+COPS=?', answer: [], networks };
}

export async function select(io: ToolIo, command: string): Promise<ToolOutcome> {
  const r = await io.send(command, { timeoutMs: SELECT_MS });
  if (r.status !== 'ok') return { tone: 'bad', message: `${refusal(r)} The modem may now have no service: choose Automatic to go back.`, shown: command, answer: literal(r) };
  const mode = parseMode(await io.send('AT+COPS?'));
  const message = command === SELECT_AUTOMATIC
    ? (mode === '0' ? 'Confirmed: the modem chooses the network by itself again.' : 'Accepted, but the modem does not read back as automatic.')
    : (mode === '1' ? 'Confirmed: the modem stays on the chosen network.' : 'Accepted, but the modem does not read back as manual.');
  return { tone: mode === (command === SELECT_AUTOMATIC ? '0' : '1') ? 'ok' : 'warn', message, shown: command, answer: literal(r) };
}
