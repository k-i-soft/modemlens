import { credentialIfNamed, field, prefixed, slug, splitArgs } from './standard';
import type { Field, Parser } from './standard';

const qccid: Parser = (r) => {
  const raw = (prefixed(r.lines, 'QCCID')[0] ?? prefixed(r.lines, 'ICCID')[0] ?? r.lines.map(l => l.trim()).find(l => l !== ''))
    ?.replace(/"/g, '').trim();
  if (!raw || !/^[0-9A-Fa-f]{10,22}$/.test(raw)) return [];
  const iccid = raw.toUpperCase().replace(/F+$/, '');
  return [field('iccid', 'ICCID', iccid, 'iccid')];
};

const qspn: Parser = (r) => {
  const a = prefixed(r.lines, 'QSPN')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const out: Field[] = [];
  if (args[0]) out.push(field('full_name', 'Full name', args[0]));
  if (args[1]) out.push(field('short_name', 'Short name', args[1]));
  if (args[2]) out.push(field('spn', 'SPN', args[2]));
  if (args[4]) out.push(field('plmn', 'PLMN', args[4]));
  return out;
};

const qnwinfo: Parser = (r) => {
  const a = prefixed(r.lines, 'QNWINFO')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const out: Field[] = [];
  if (args[0]) out.push(field('act', 'Access technology', args[0]));
  if (args[1]) out.push(field('plmn', 'PLMN', args[1]));
  if (args[2]) out.push(field('band', 'Band', args[2]));
  if (args[3]) out.push(field('channel', 'Channel', args[3]));
  return out;
};

const qcsq: Parser = (r) => {
  const a = prefixed(r.lines, 'QCSQ')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  const mode = args[0];
  if (!mode) return [];
  const out: Field[] = [field('sysmode', 'System mode', mode)];
  const num = (i: number): string | undefined => (/^-?\d+$/.test(args[i] ?? '') ? args[i] : undefined);
  const add = (i: number, key: string, label: string): void => {
    const v = num(i);
    if (v !== undefined) out.push(field(key, label, v));
  };
  const m = mode.toUpperCase();
  if (m === 'LTE') {
    add(1, 'rssi_dbm', 'RSSI (dBm)');
    add(2, 'rsrp_dbm', 'RSRP (dBm)');
    const sinr = num(3);
    // Quectel scale: 0..250 maps to -20..30 dB in steps of 0.2.
    if (sinr !== undefined) out.push(field('sinr_db', 'SINR (dB)', (Number(sinr) * 0.2 - 20).toFixed(1)));
    add(4, 'rsrq_db', 'RSRQ (dB)');
  } else if (m === 'GSM' || m === 'CAT-M1' || m === 'CAT-NB1') {
    add(1, 'rssi_dbm', 'RSSI (dBm)');
  } else if (m === 'WCDMA') {
    add(1, 'rssi_dbm', 'RSSI (dBm)');
    add(2, 'rscp_dbm', 'RSCP (dBm)');
    add(3, 'ecio_db', 'Ec/Io (dB)');
  }
  return out;
};

/**
 * Serving cell varies a lot between firmwares; only the LTE layout is decoded:
 * "servingcell",state,"LTE",is_tdd,mcc,mnc,cellid,pcid,earfcn,band,ul_bw,dl_bw,tac,rsrp,rsrq,rssi,sinr,...
 * Everything else yields only state and technology.
 */
const qengServing: Parser = (r) => {
  for (const a of prefixed(r.lines, 'QENG')) {
    const args = splitArgs(a);
    if (args[0]?.toLowerCase() !== 'servingcell') continue;
    const out: Field[] = [];
    const state = args[1];
    if (state) out.push(field('state', 'State', state));
    const rat = args[2];
    if (rat) out.push(field('rat', 'Access technology', rat));
    if (rat?.toUpperCase() === 'LTE' && args.length >= 14) {
      const num = (i: number): string | undefined => (/^-?\d+$/.test(args[i] ?? '') ? args[i] : undefined);
      const add = (i: number, key: string, label: string, s: Field['sensitive'] = 'none'): void => {
        const v = args[i];
        if (v !== undefined && v !== '') out.push(field(key, label, v, s));
      };
      if (args[3]) out.push(field('duplex', 'Duplex', args[3]));
      add(4, 'mcc', 'MCC');
      add(5, 'mnc', 'MNC');
      add(6, 'cell_id', 'Cell ID', 'location');
      add(7, 'pci', 'PCI', 'location');
      add(8, 'earfcn', 'EARFCN');
      add(9, 'band', 'Band');
      add(12, 'tac', 'TAC', 'location');
      for (const [i, key, label] of [[13, 'rsrp_dbm', 'RSRP (dBm)'], [14, 'rsrq_db', 'RSRQ (dB)'], [15, 'rssi_dbm', 'RSSI (dBm)'], [16, 'sinr_db', 'SINR (dB)']] as const) {
        const v = num(i);
        if (v !== undefined) out.push(field(key, label, v));
      }
    }
    return out;
  }
  return [];
};

/** Generic key/value reader: "+X: "name",v1,v2" gives name=v1,v2; "+X: v1,v2" gives <prefix>_n. */
function genericKv(lines: string[], prefix: string, name: string): Field[] {
  const out: Field[] = [];
  const re = /^\+[A-Za-z0-9_]+:\s*(.*)$/;
  let n = 0;
  for (const l of lines) {
    const m = re.exec(l.trim());
    if (!m) continue;
    n++;
    const rawArgs = m[1];
    const args = splitArgs(rawArgs);
    const named = /^"/.test(rawArgs.trim()) && args.length >= 2 && args[0] !== '';
    const key = named ? slug(args[0]) || `${prefix}_${n}` : `${prefix}_${n}`;
    const value = (named ? args.slice(1) : args).join(',');
    if (value === '') continue;
    const sens = named ? credentialIfNamed(args[0]) : 'none';
    out.push(field(key, named ? args[0] : `${name} ${n}`, value, sens));
  }
  return out;
}

const qtemp: Parser = (r) => genericKv(r.lines, 'temp', 'Temperature');
const qcfg: Parser = (r) => genericKv(prefixed(r.lines, 'QCFG').map(a => `+QCFG: ${a}`), 'qcfg', 'Setting');

export const QUECTEL_PARSERS: Record<string, Parser> = {
  qccid, qspn, qnwinfo, qeng_serving: qengServing, qcsq, qtemp, qcfg,
};
