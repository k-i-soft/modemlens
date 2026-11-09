import type { ScanItem, ScanReport } from '../scan/scanner';
import { parseResponse } from './index';
import type { Field } from './standard';

export interface Summary {
  model?: string;
  firmware?: string;
  simState?: string;
  registration?: string;
  operator?: string;
  signal?: string;
  rat?: string;
}

function fieldsOf(items: ScanItem[], id: string, parser: string): Field[] | null {
  const item = items.find(i => i.id === id);
  if (!item?.response) return null;
  return parseResponse(item.parser ?? parser, item.response);
}

function pick(items: ScanItem[], ids: string[], parser: string, key: string): string | undefined {
  for (const id of ids) {
    const v = fieldsOf(items, id, parser)?.find(f => f.key === key)?.value;
    if (v) return v;
  }
  return undefined;
}

/** Web answers have no command names, so they are looked up by what they report. */
function web(items: ScanItem[], key: string): string | undefined {
  for (const item of items) {
    if (item.category !== 'web' || !item.parser || !item.response) continue;
    const v = parseResponse(item.parser, item.response)?.find(f => f.key === key)?.value;
    if (v) return v;
  }
  return undefined;
}

export const NO_SIM = 'No SIM';
/** The CME error number for a missing SIM. */
const SIM_NOT_INSERTED = '10';

function simState(items: ScanItem[]): string | undefined {
  const item = items.find(i => i.id === 'cpin');
  const r = item?.response;
  if (!r) return undefined;
  if (r.status === 'ok') return parseResponse('cpin', r)?.find(f => f.key === 'state')?.value;
  if (r.status === 'cme_error' && r.errorDetail === SIM_NOT_INSERTED) return NO_SIM;
  // +CME ERROR (SIM failure and the like) or plain ERROR: the SIM cannot be queried.
  if (r.status === 'cme_error' || r.status === 'error' || r.status === 'cms_error') return 'unavailable';
  return undefined;
}

function registration(items: ScanItem[]): string | undefined {
  let first: string | undefined;
  for (const id of ['c5greg', 'cereg', 'cgreg', 'creg']) {
    const v = pick(items, [id], 'creg', 'status');
    if (!v) continue;
    if (v.startsWith('registered')) return v;
    first ??= v;
  }
  return first;
}

function signal(items: ScanItem[]): string | undefined {
  const qcsq = fieldsOf(items, 'qcsq', 'qcsq');
  const rsrp = qcsq?.find(f => f.key === 'rsrp_dbm')?.value ?? pick(items, ['cesq'], 'cesq', 'rsrp_dbm');
  if (rsrp && rsrp !== 'unknown') return `RSRP ${rsrp} dBm`;
  const rssi = qcsq?.find(f => f.key === 'rssi_dbm')?.value ?? pick(items, ['csq'], 'csq', 'rssi_dbm');
  if (rssi && rssi !== 'unknown') return `RSSI ${rssi} dBm`;
  return undefined;
}

/** Tolerates a partial report: every part that is missing or unparsable is simply left out. */
export function buildSummary(report: ScanReport): Summary {
  const items = report.items ?? [];
  const s: Summary = {};
  const set = <K extends keyof Summary>(k: K, v: Summary[K]): void => { if (v) s[k] = v; };
  set('model', pick(items, ['cgmm', 'gmm', 'ati'], 'identity', 'model') ?? web(items, 'model'));
  set('firmware', pick(items, ['cgmr', 'gmr', 'ati'], 'identity', 'firmware') ?? web(items, 'firmware'));
  set('simState', simState(items));
  set('registration', registration(items));
  set('operator', pick(items, ['cops'], 'cops', 'operator') ?? pick(items, ['qspn'], 'qspn', 'full_name') ?? web(items, 'operator'));
  set('signal', signal(items));
  set('rat', pick(items, ['qnwinfo'], 'qnwinfo', 'act') ?? pick(items, ['cops'], 'cops', 'rat') ?? web(items, 'rat'));
  return s;
}
