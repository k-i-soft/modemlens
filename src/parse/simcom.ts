import { field, prefixed, splitArgs } from './standard';
import type { Field, Parser } from './standard';

const isInt = (s: string | undefined): s is string => s !== undefined && /^-?\d+$/.test(s);
const named = (names: Record<string, string>, code: string): string => names[code] ?? `code ${code}`;

/**
 * "+CPSI: <system mode>,<operation mode>,<MCC-MNC>,<TAC>,<cell id>,<PCI>,EUTRAN-BAND<n>,<EARFCN>,<dl bw>,<ul bw>,<RSRQ>,<RSRP>,<RSSI>,<SINR>"
 * on LTE (Cat-M1 and NB-IoT). Other technologies have their own layout: only the first three values mean the same there.
 */
const simCpsi: Parser = (r) => {
  const a = prefixed(r.lines, 'CPSI')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const mode = args[0];
  if (!mode || !args[1]) return [];
  if (/^NO SERVICE$/i.test(mode)) return [field('system_mode', 'System mode', 'no service'), field('operation_mode', 'Operation mode', args[1])];
  const out: Field[] = [field('system_mode', 'System mode', mode), field('operation_mode', 'Operation mode', args[1])];
  if (/^\d{3}-\d{2,3}$/.test(args[2] ?? '')) out.push(field('plmn', 'PLMN', args[2]));
  if (!/^LTE\b/i.test(mode)) return out;
  if (/^0x[0-9A-Fa-f]+$/.test(args[3] ?? '')) out.push(field('tac', 'TAC', args[3], 'location'));
  if (isInt(args[4])) out.push(field('cell_id', 'Cell ID', args[4], 'location'));
  if (isInt(args[5])) out.push(field('pci', 'PCI', args[5], 'location'));
  const band = /^EUTRAN-BAND(\d+)$/i.exec(args[6] ?? '')?.[1];
  if (band) out.push(field('band', 'Band', `B${band}`));
  if (isInt(args[7])) out.push(field('earfcn', 'EARFCN', args[7]));
  if (isInt(args[10])) out.push(field('rsrq_db', 'RSRQ (dB)', args[10]));
  if (isInt(args[11])) out.push(field('rsrp_dbm', 'RSRP (dBm)', args[11]));
  if (isInt(args[12])) out.push(field('rssi_dbm', 'RSSI (dBm)', args[12]));
  if (isInt(args[13])) out.push(field('sinr_db', 'SINR (dB)', args[13]));
  return out;
};

const MODE_PREFERENCE: Record<string, string> = { '2': 'automatic', '13': 'GSM only', '38': 'LTE only', '51': 'GSM and LTE only' };

/** "+CNMP: 38": the preferred radio technology. */
const simCnmp: Parser = (r) => {
  const v = prefixed(r.lines, 'CNMP')[0]?.trim();
  return isInt(v) ? [field('mode_preference', 'Mode preference', named(MODE_PREFERENCE, v))] : [];
};

const LTE_MODE: Record<string, string> = { '1': 'CAT-M', '2': 'NB-IoT', '3': 'CAT-M and NB-IoT' };

/** "+CMNB: 1": which kind of LTE the module looks for. */
const simCmnb: Parser = (r) => {
  const v = prefixed(r.lines, 'CMNB')[0]?.trim();
  return isInt(v) ? [field('lte_mode', 'LTE mode', named(LTE_MODE, v))] : [];
};

/** "+CBANDCFG: "CAT-M",1,3,8,20" and the same for "NB-IOT": the enabled bands per mode. */
const simCbandcfg: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'CBANDCFG')) {
    const [mode, ...bands] = splitArgs(a);
    if (bands.length === 0 || !bands.every((b) => /^\d+$/.test(b))) continue;
    const list = bands.map((b) => `B${b}`).join(', ');
    if (/^CAT-M$/i.test(mode)) out.push(field('catm_bands', 'Cat-M bands', list));
    else if (/^NB-IOT$/i.test(mode)) out.push(field('nbiot_bands', 'NB-IoT bands', list));
  }
  return out;
};

export const SIMCOM_PARSERS: Record<string, Parser> = {
  sim_cpsi: simCpsi, sim_cnmp: simCnmp, sim_cmnb: simCmnb, sim_cbandcfg: simCbandcfg,
};
