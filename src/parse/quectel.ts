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
  // Some firmwares report the RSSI as an unsigned magnitude ("56" for -56 dBm).
  const addRssi = (i: number): void => {
    const v = num(i);
    if (v !== undefined) out.push(field('rssi_dbm', 'RSSI (dBm)', Number(v) > 0 ? `-${Number(v)}` : v));
  };
  // SINR is left out on purpose: its scale differs between firmwares, qeng_serving has a reliable value.
  const m = mode.toUpperCase();
  if (m === 'LTE') {
    addRssi(1);
    add(2, 'rsrp_dbm', 'RSRP (dBm)');
    add(4, 'rsrq_db', 'RSRQ (dB)');
  } else if (m === 'GSM' || m === 'CAT-M1' || m === 'CAT-NB1') {
    addRssi(1);
  } else if (m === 'WCDMA') {
    addRssi(1);
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

/**
 * "+QTEMP: 37,255,255": one value per sensor in degrees C, 255 meaning no sensor. Older firmwares answer
 * with quoted names ("cpu-thermal","45"), which the generic reader handles.
 */
const qtemp: Parser = (r) => {
  const out: Field[] = [];
  const named: string[] = [];
  let sensor = 0;
  for (const a of prefixed(r.lines, 'QTEMP')) {
    const args = splitArgs(a);
    if (args.length >= 2 && args[0] !== '' && !/^-?\d+$/.test(args[0])) {
      named.push(`+QTEMP: ${a}`);
      continue;
    }
    for (const v of args) {
      sensor++;
      if (/^-?\d+$/.test(v) && v !== '255') out.push(field(`temp_${sensor}`, `Temperature ${sensor} (°C)`, String(Number(v))));
    }
  }
  return [...genericKv(named, 'temp', 'Temperature'), ...out];
};

/** Bit n of the mask is LTE band n+1. Undefined when the text is not a usable hexadecimal mask. */
function decodeLteBands(mask: string | undefined): string | undefined {
  if (mask === undefined || !/^0x[0-9a-f]{1,32}$/i.test(mask)) return undefined;
  const bits = BigInt(mask);
  const bands: number[] = [];
  for (let n = 0; n < 128; n++) if ((bits >> BigInt(n)) & 1n) bands.push(n + 1);
  return bands.length > 0 ? bands.join(',') : undefined;
}

const qcfg: Parser = (r) => {
  const lines = prefixed(r.lines, 'QCFG');
  const out: Field[] = [];
  for (const a of lines) {
    const fields = genericKv([`+QCFG: ${a}`], 'qcfg', 'Setting');
    out.push(...fields);
    const args = splitArgs(a);
    if (args[0]?.toLowerCase() === 'band' && fields.length > 0) {
      const bands = decodeLteBands(args[2]);
      if (bands) out.push(field('lte_bands', 'LTE bands (decoded)', bands));
    }
  }
  return out;
};

const isInt = (s: string | undefined): s is string => s !== undefined && /^-?\d+$/.test(s);

/** "+QPINC: "SC",3,10": PIN and PUK attempts left per facility. */
const qpinc: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'QPINC')) {
    const args = splitArgs(a);
    if (!/^[A-Za-z0-9]{2}$/.test(args[0] ?? '') || !isInt(args[1]) || !isInt(args[2])) continue;
    const fac = args[0].toUpperCase();
    const k = fac.toLowerCase();
    out.push(field(`${k}_pin_left`, `${fac} PIN attempts left`, args[1]));
    out.push(field(`${k}_puk_left`, `${fac} PUK attempts left`, args[2]));
  }
  return out;
};

const qgmr: Parser = (r) => {
  const line = r.lines.map(l => l.trim().replace(/^\+QGMR:\s*/i, '').replace(/"/g, '')).find(l => l !== '');
  return line && line.length <= 80 && !line.startsWith('+') ? [field('firmware_build', 'Firmware build', line)] : [];
};

/**
 * LTE neighbour cells, one line each:
 * "neighbourcell intra"|"neighbourcell inter","LTE",earfcn,pci,rsrq,rsrp,... (further columns are ignored).
 * Lines of another layout or technology are skipped.
 */
const qengNeighbour: Parser = (r) => {
  const out: Field[] = [];
  for (const a of prefixed(r.lines, 'QENG')) {
    const args = splitArgs(a);
    const kind = /^neighbourcell\s+(intra|inter)$/i.exec(args[0] ?? '')?.[1]?.toLowerCase();
    if (!kind || args[1]?.toUpperCase() !== 'LTE') continue;
    if (![2, 3, 4, 5].every(i => isInt(args[i]))) continue;
    const n = out.length / 6 + 1;
    out.push(
      field(`n${n}_kind`, `Neighbour ${n} kind`, kind),
      field(`n${n}_earfcn`, `Neighbour ${n} EARFCN`, args[2]),
      field(`n${n}_pci`, `Neighbour ${n} PCI`, args[3], 'location'),
      field(`n${n}_rsrq_db`, `Neighbour ${n} RSRQ (dB)`, args[4]),
      field(`n${n}_rsrp_dbm`, `Neighbour ${n} RSRP (dBm)`, args[5]),
      field(`n${n}_rat`, `Neighbour ${n} technology`, 'LTE'),
    );
  }
  return out;
};

export const QUECTEL_PARSERS: Record<string, Parser> = {
  qccid, qspn, qnwinfo, qeng_serving: qengServing, qcsq, qtemp, qcfg, qpinc, qgmr, qeng_neighbour: qengNeighbour,
};
