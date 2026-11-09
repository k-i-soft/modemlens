import type { ScanReport } from '../scan/scanner';
import { buildSummary, parseResponse } from '../parse';
import type { Field } from '../parse';

export type Metric = 'rsrp' | 'rsrq' | 'sinr' | 'rssi';
export type Rating = 'excellent' | 'good' | 'fair' | 'poor';
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export interface MetricSpec {
  label: string;
  unit: 'dBm' | 'dB';
  /** Lowest value that still earns the rating: a value on a boundary takes the better rating. */
  excellent: number;
  good: number;
  fair: number;
  /** Ends of the linear scale on screen. */
  min: number;
  max: number;
}

export const METRICS: Record<Metric, MetricSpec> = {
  rsrp: { label: 'RSRP', unit: 'dBm', excellent: -80, good: -90, fair: -100, min: -130, max: -60 },
  rsrq: { label: 'RSRQ', unit: 'dB', excellent: -10, good: -15, fair: -20, min: -30, max: -3 },
  sinr: { label: 'SINR', unit: 'dB', excellent: 20, good: 13, fair: 0, min: -10, max: 30 },
  rssi: { label: 'RSSI', unit: 'dBm', excellent: -65, good: -75, fair: -85, min: -110, max: -45 },
};

export const RATING_WORDS: Record<Rating, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };

export function rate(metric: Metric, value: number): Rating {
  const m = METRICS[metric];
  if (value >= m.excellent) return 'excellent';
  if (value >= m.good) return 'good';
  if (value >= m.fair) return 'fair';
  return 'poor';
}

/** Below the fair threshold, each further 10 dB costs one of the remaining two bars. */
export function signalBars(metric: 'rsrp' | 'rssi', value: number): number {
  const m = METRICS[metric];
  if (value >= m.excellent) return 5;
  if (value >= m.good) return 4;
  if (value >= m.fair) return 3;
  if (value >= m.fair - 10) return 2;
  if (value >= m.fair - 20) return 1;
  return 0;
}

/** What is shown instead of an identifier while "Hide identifiers" is on. */
export const MASK = '••••••';

export interface Chip { key: string; label: string; value: string; tone: Tone }
export interface SignalValue { metric: Metric; label: string; value: number; unit: string; rating: Rating; word: string; source: string }
export interface Row { key: string; label: string; value: string }
export interface Neighbour { kind?: string; earfcn?: string; pci?: string; rsrp: number; rsrq?: number; rating: Rating; word: string }
export interface Operator { name: string; plmn: string; technology?: string; status: string; current: boolean }
export interface DataContext { cid: number; apn?: string; type?: string; active?: boolean; addresses: string[] }

export interface Dashboard {
  identity: {
    manufacturer?: string; model?: string; firmware?: string; imei?: string; usb?: string;
    profileId?: string; profileLabel?: string; verified?: boolean;
  };
  network?: { word: string; tone: Tone };
  chips: Chip[];
  signal: { values: SignalValue[]; bars?: number; rating?: Rating; word?: string; basis?: 'rsrp' | 'rssi' };
  bands: { items: Array<{ band: number; active: boolean }>; otherActive?: string };
  cell: Row[];
  neighbours: Neighbour[];
  operators: Operator[];
  sim: { state?: string; lock?: string; pinLeft?: number; pukLeft?: number; iccid?: string; imsi?: string };
  data: DataContext[];
  device: { temperature?: number; usbMode?: string; functionMode?: string; time?: string };
}

export interface DashboardOptions {
  /** Masks every value a parser marked as sensitive. */
  hideIdentifiers?: boolean;
}

/** Drops absent values, so that a view can test for a key and nothing undefined reaches the screen. */
function present<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Quectel reports -32768 where it has no measurement. */
const MAX_PLAUSIBLE_MAGNITUDE = 1000;
function reading(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) < MAX_PLAUSIBLE_MAGNITUDE ? n : undefined;
}

const SIGNAL_KEYS: Record<Metric, string> = { rsrp: 'rsrp_dbm', rsrq: 'rsrq_db', sinr: 'sinr_db', rssi: 'rssi_dbm' };
const SIGNAL_SOURCES = ['qeng_serving', 'qcsq', 'cesq', 'csq'];
const USB_MODES: Record<string, string> = { '0': 'RmNet', '1': 'ECM', '2': 'MBIM', '3': 'RNDIS', '5': 'NCM' };
const UNUSED_ADDRESS = /^[0.:]*$/;
const NEIGHBOUR_KEY = /^n(\d+)_(kind|earfcn|pci|rsrq_db|rsrp_dbm)$/;
const CONTEXT_KEY = /^ctx(\d+)_(type|apn|active|addr\d*)$/;
/** The parser's own text: "name (plmn) technology, status". */
const OPERATOR_TEXT = /^(.*) \((\d{5,6})\)(?: ([^,]+))?, (.+)$/;

function networkStatus(registration: string | undefined): Dashboard['network'] {
  if (!registration) return undefined;
  if (registration.startsWith('registered')) return { word: 'On the network', tone: 'ok' };
  if (registration === 'searching') return { word: 'Searching for a network', tone: 'warn' };
  if (registration === 'denied') return { word: 'Registration denied', tone: 'bad' };
  return { word: 'Not on the network', tone: 'bad' };
}

/** Tolerates a partial report: whatever is missing or unparsable is left out. */
export function buildDashboard(report: ScanReport, opts: DashboardOptions = {}): Dashboard {
  const items = report.items ?? [];
  // Newest first: a repeated network scan replaces the earlier answer.
  const parsed = items
    .flatMap((item) => {
      const fields = item.parser && item.response ? parseResponse(item.parser, item.response) : null;
      return fields ? [{ parser: item.parser as string, fields }] : [];
    })
    .reverse();

  const shown = (f: Field): string => (opts.hideIdentifiers && f.sensitive !== 'none' ? MASK : f.value);
  const fieldsOf = (parser: string): Field[][] => parsed.filter((p) => p.parser === parser).map((p) => p.fields);
  const find = (parser: string, key: string): Field | undefined => {
    for (const fields of fieldsOf(parser)) {
      const f = fields.find((x) => x.key === key);
      if (f) return f;
    }
    return undefined;
  };
  const text = (parser: string, key: string): string | undefined => {
    const f = find(parser, key);
    return f ? shown(f) : undefined;
  };

  const summary = buildSummary({ ...report, items });

  // ---- status ----
  const simState = summary.simState === undefined ? undefined : summary.simState === 'READY' ? 'Ready' : capitalise(summary.simState);
  const technology = summary.rat ?? text('qeng_serving', 'rat');
  const chips: Chip[] = [];
  if (simState) chips.push({ key: 'sim', label: 'SIM', value: simState, tone: simState === 'Ready' ? 'ok' : simState === 'Unavailable' ? 'bad' : 'warn' });
  const network = networkStatus(summary.registration);
  if (summary.registration && network) chips.push({ key: 'registration', label: 'Registration', value: capitalise(summary.registration), tone: network.tone });
  if (technology) chips.push({ key: 'technology', label: 'Technology', value: technology, tone: 'neutral' });
  if (summary.operator) chips.push({ key: 'operator', label: 'Operator', value: summary.operator, tone: 'neutral' });

  // ---- signal ----
  const values: SignalValue[] = [];
  for (const metric of Object.keys(METRICS) as Metric[]) {
    for (const source of SIGNAL_SOURCES) {
      const value = reading(find(source, SIGNAL_KEYS[metric])?.value);
      if (value === undefined) continue;
      const rating = rate(metric, value);
      values.push({ metric, label: METRICS[metric].label, value, unit: METRICS[metric].unit, rating, word: RATING_WORDS[rating], source });
      break;
    }
  }
  const basis = values.find((v) => v.metric === 'rsrp') ?? values.find((v) => v.metric === 'rssi');
  const signal: Dashboard['signal'] = { values };
  if (basis) {
    const metric = basis.metric as 'rsrp' | 'rssi';
    Object.assign(signal, { bars: signalBars(metric, basis.value), rating: basis.rating, word: basis.word, basis: metric });
  }

  // ---- bands ----
  const enabled = find('qcfg', 'lte_bands')?.value.split(',').map(Number).filter((n) => Number.isInteger(n)) ?? [];
  const reportedBand = find('qnwinfo', 'band')?.value;
  const lteBand = reportedBand === undefined ? undefined : /^LTE BAND (\d+)$/i.exec(reportedBand.trim())?.[1];
  const servingBand = reading(find('qeng_serving', 'band')?.value);
  const active = lteBand !== undefined ? Number(lteBand) : reportedBand === undefined ? servingBand : undefined;
  const bandNumbers = [...new Set(active === undefined ? enabled : [...enabled, active])].sort((a, b) => a - b);
  const bands: Dashboard['bands'] = { items: bandNumbers.map((band) => ({ band, active: band === active })) };
  if (reportedBand !== undefined && lteBand === undefined) bands.otherActive = reportedBand;

  // ---- cell ----
  const mcc = find('qeng_serving', 'mcc')?.value;
  const mnc = find('qeng_serving', 'mnc')?.value;
  const cellRows: Array<[string, string, string | undefined]> = [
    ['plmn', 'PLMN', text('qnwinfo', 'plmn') ?? text('qspn', 'plmn') ?? (mcc && mnc ? `${mcc}${mnc}` : undefined)],
    ['earfcn', 'EARFCN', text('qeng_serving', 'earfcn') ?? text('qnwinfo', 'channel')],
    ['cell_id', 'Cell ID', text('qeng_serving', 'cell_id') ?? text('creg', 'cell_id')],
    ['pci', 'PCI', text('qeng_serving', 'pci')],
    ['tac', 'TAC', text('qeng_serving', 'tac') ?? text('creg', 'tac')],
    ['state', 'State', text('qeng_serving', 'state')],
  ];
  const cell = cellRows.flatMap(([key, label, value]) => (value === undefined ? [] : [{ key, label, value }]));

  // ---- neighbours ----
  const byNeighbour = new Map<string, Record<string, Field>>();
  for (const f of fieldsOf('qeng_neighbour')[0] ?? []) {
    const m = NEIGHBOUR_KEY.exec(f.key);
    if (!m) continue;
    byNeighbour.set(m[1], { ...byNeighbour.get(m[1]), [m[2]]: f });
  }
  const neighbours: Neighbour[] = [...byNeighbour.values()]
    .flatMap((n) => {
      const rsrp = reading(n.rsrp_dbm?.value);
      if (rsrp === undefined) return [];
      const rating = rate('rsrp', rsrp);
      return [present<Neighbour>({
        kind: n.kind?.value,
        earfcn: n.earfcn?.value,
        pci: n.pci && shown(n.pci),
        rsrp,
        rsrq: reading(n.rsrq_db?.value),
        rating,
        word: RATING_WORDS[rating],
      })];
    })
    .sort((a, b) => b.rsrp - a.rsrp);

  // ---- operators ----
  const operators = (fieldsOf('cops_scan')[0] ?? []).flatMap((f) => {
    const m = OPERATOR_TEXT.exec(f.value);
    if (!m) return [];
    return [present<Operator>({ name: m[1], plmn: m[2], technology: m[3], status: m[4], current: m[4] === 'current' })];
  });

  // ---- data ----
  const contexts = new Map<number, { type?: Field; apn?: Field; active?: Field; addresses: Field[] }>();
  const context = (cid: number) => {
    let c = contexts.get(cid);
    if (!c) contexts.set(cid, (c = { addresses: [] }));
    return c;
  };
  // CGPADDR is the live answer, so its addresses come before what CGDCONT has configured.
  for (const parser of ['cgpaddr', 'cgdcont', 'cgact']) {
    for (const f of fieldsOf(parser)[0] ?? []) {
      const m = CONTEXT_KEY.exec(f.key);
      if (!m) continue;
      const c = context(Number(m[1]));
      if (m[2].startsWith('addr')) {
        if (!UNUSED_ADDRESS.test(f.value) && !c.addresses.some((a) => a.value === f.value)) c.addresses.push(f);
      } else {
        c[m[2] as 'type' | 'apn' | 'active'] = f;
      }
    }
  }
  const data: DataContext[] = [...contexts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([cid, c]) => present<DataContext>({
      cid,
      apn: c.apn && shown(c.apn),
      type: c.type && shown(c.type),
      active: c.active ? c.active.value === 'active' : undefined,
      addresses: c.addresses.map(shown),
    }));

  // ---- device ----
  const temperatures = (fieldsOf('qtemp')[0] ?? []).map((f) => reading(f.value)).filter((n): n is number => n !== undefined);
  const usbnet = find('qcfg', 'usbnet')?.value;
  const usbLabel = usbnet === undefined ? undefined : USB_MODES[usbnet];

  const firstField = (key: string): Field | undefined => find('identity', key);
  const imei = find('cgsn', 'imei');
  const profile = report.profile;

  return {
    identity: present({
      manufacturer: firstField('manufacturer')?.value,
      model: summary.model,
      firmware: summary.firmware,
      imei: imei && shown(imei),
      usb: report.usb,
      profileId: profile?.id,
      profileLabel: profile?.label,
      verified: profile?.verified,
    }),
    ...(network ? { network } : {}),
    chips,
    signal,
    bands,
    cell,
    neighbours,
    operators,
    sim: present({
      state: simState,
      lock: text('clck', 'lock_sc'),
      pinLeft: reading(find('qpinc', 'sc_pin_left')?.value),
      pukLeft: reading(find('qpinc', 'sc_puk_left')?.value),
      iccid: text('qccid', 'iccid') ?? text('crsm_iccid', 'iccid'),
      imsi: text('cimi', 'imsi'),
    }),
    data,
    device: present({
      temperature: temperatures.length > 0 ? Math.max(...temperatures) : undefined,
      usbMode: usbnet === undefined ? undefined : usbLabel ? `${usbLabel} (mode ${usbnet})` : `mode ${usbnet}`,
      functionMode: text('cfun', 'functionality'),
      time: text('cclk', 'time'),
    }),
  };
}

/** A number as it reads on the panel, with a real minus sign. */
export function formatNumber(n: number): string {
  return String(n).replace('-', '−');
}
