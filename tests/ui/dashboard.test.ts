import { describe, expect, test } from 'vitest';
import { buildDashboard, MASK, METRICS, rate, signalBars } from '../../src/ui/dashboard';
import type { Metric, Rating } from '../../src/ui/dashboard';
import type { ScanItem, ScanReport } from '../../src/scan/scanner';
import { PROFILES } from '../../src/profiles';

function item(parser: string, lines: string[], command = 'AT+X', id: string = parser): ScanItem {
  return {
    id, command, category: 'other', state: 'done', parser,
    response: { command, status: 'ok', lines, durationMs: 1 },
  };
}
function failed(parser: string, command = 'AT+X'): ScanItem {
  return {
    id: parser, command, category: 'other', state: 'unsupported', parser,
    response: { command, status: 'error', lines: [], durationMs: 1 },
  };
}
const report = (items: ScanItem[], extra: Partial<ScanReport> = {}): ScanReport => ({ startedAt: 't', items, commandList: [], ...extra });

const SERVING = '+QENG: "servingcell","NOCONN","LTE","FDD",001,01,1A2B3C,321,1300,3,5,5,ABCD,-85,-9,-60,16,20,5';
const serving = () => item('qeng_serving', [SERVING], 'AT+QENG="servingcell"', 'qeng-serving');

describe('ratings', () => {
  const cases: Array<[Metric, number, Rating, number, Rating]> = [
    // value on the boundary, its rating, the next value below, its rating
    ['rsrp', -80, 'excellent', -80.5, 'good'],
    ['rsrp', -90, 'good', -90.5, 'fair'],
    ['rsrp', -100, 'fair', -100.5, 'poor'],
    ['rsrq', -10, 'excellent', -10.5, 'good'],
    ['rsrq', -15, 'good', -15.5, 'fair'],
    ['rsrq', -20, 'fair', -20.5, 'poor'],
    ['sinr', 20, 'excellent', 19.5, 'good'],
    ['sinr', 13, 'good', 12.5, 'fair'],
    ['sinr', 0, 'fair', -0.5, 'poor'],
    ['rssi', -65, 'excellent', -65.5, 'good'],
    ['rssi', -75, 'good', -75.5, 'fair'],
    ['rssi', -85, 'fair', -85.5, 'poor'],
  ];
  test.each(cases)('%s %d is %s, %d is %s', (metric, on, onRating, below, belowRating) => {
    expect(rate(metric, on)).toBe(onRating);
    expect(rate(metric, below)).toBe(belowRating);
  });

  test('the thresholds are exported as data', () => {
    expect(METRICS.rsrp).toMatchObject({ excellent: -80, good: -90, fair: -100, unit: 'dBm' });
    expect(METRICS.sinr).toMatchObject({ excellent: 20, good: 13, fair: 0, unit: 'dB' });
  });

  test.each([
    ['rsrp', -80, 5], ['rsrp', -80.5, 4], ['rsrp', -90, 4], ['rsrp', -100, 3], ['rsrp', -110, 2], ['rsrp', -120, 1], ['rsrp', -120.5, 0],
    ['rssi', -65, 5], ['rssi', -75, 4], ['rssi', -85, 3], ['rssi', -95, 2], ['rssi', -105, 1], ['rssi', -106, 0],
  ] as const)('%s %d gives %d bars', (metric, value, bars) => {
    expect(signalBars(metric, value)).toBe(bars);
  });
});

describe('signal', () => {
  const qcsq = () => item('qcsq', ['+QCSQ: "LTE",-61,-95,150,-12'], 'AT+QCSQ');
  const cesq = () => item('cesq', ['+CESQ: 99,99,255,255,20,50'], 'AT+CESQ');
  const csq = () => item('csq', ['+CSQ: 21,99'], 'AT+CSQ');
  const value = (d: ReturnType<typeof buildDashboard>, m: Metric) => d.signal.values.find((v) => v.metric === m);

  test('prefers the serving cell, then QCSQ, CESQ and CSQ', () => {
    const all = buildDashboard(report([csq(), cesq(), qcsq(), serving()]));
    expect(value(all, 'rsrp')).toMatchObject({ value: -85, rating: 'good', unit: 'dBm', source: 'qeng_serving' });
    expect(value(all, 'sinr')).toMatchObject({ value: 16, rating: 'good', unit: 'dB' });
    expect(value(buildDashboard(report([csq(), cesq(), qcsq()])), 'rsrp')).toMatchObject({ value: -95, source: 'qcsq' });
    expect(value(buildDashboard(report([csq(), cesq()])), 'rsrp')).toMatchObject({ value: -91, source: 'cesq' });
    expect(value(buildDashboard(report([csq()])), 'rssi')).toMatchObject({ value: -71, source: 'csq' });
  });

  test('bars come from RSRP, and from RSSI when RSRP is absent', () => {
    expect(buildDashboard(report([serving()])).signal).toMatchObject({ bars: 4, rating: 'good', word: 'Good', basis: 'rsrp' });
    expect(buildDashboard(report([csq()])).signal).toMatchObject({ bars: 4, rating: 'good', basis: 'rssi' });
  });

  test('"unknown" readings count as absent', () => {
    const d = buildDashboard(report([item('cesq', ['+CESQ: 99,99,255,255,255,255'], 'AT+CESQ'), item('csq', ['+CSQ: 99,99'], 'AT+CSQ')]));
    expect(d.signal.values).toEqual([]);
    expect(d.signal.bars).toBeUndefined();
    expect(d.signal.word).toBeUndefined();
  });

  test('a placeholder for "no measurement" counts as absent', () => {
    const d = buildDashboard(report([item('qeng_serving', ['+QENG: "servingcell","SEARCH","LTE","FDD",001,01,1,2,1300,3,5,5,AB,-32768,-32768,-32768,-32768'])]));
    expect(d.signal.values).toEqual([]);
  });
});

describe('identity and status', () => {
  const profile = PROFILES[0];
  test('identity', () => {
    const d = buildDashboard(report([
      item('identity', ['Maker Co', 'XM100', 'Revision: FW1'], 'ATI', 'ati'),
      item('cgsn', ['123456789012345'], 'AT+CGSN', 'cgsn'),
    ], { usb: '2c7c:6005', profile }));
    expect(d.identity).toEqual({
      manufacturer: 'Maker Co', model: 'XM100', firmware: 'FW1', imei: '123456789012345',
      usb: '2c7c:6005', profileId: profile.id, profileLabel: profile.label, verified: profile.verified,
    });
  });

  test('chips and network status', () => {
    const d = buildDashboard(report([
      item('cpin', ['+CPIN: READY'], 'AT+CPIN?', 'cpin'),
      item('creg', ['+CEREG: 0,1'], 'AT+CEREG?', 'cereg'),
      item('cops', ['+COPS: 0,0,"Demo Mobile",7'], 'AT+COPS?', 'cops'),
      item('qnwinfo', ['+QNWINFO: "FDD LTE","00101","LTE BAND 3",1300'], 'AT+QNWINFO', 'qnwinfo'),
    ]));
    expect(d.chips).toEqual([
      { key: 'sim', label: 'SIM', value: 'Ready', tone: 'ok' },
      { key: 'registration', label: 'Registration', value: 'Registered, home', tone: 'ok' },
      { key: 'technology', label: 'Technology', value: 'FDD LTE', tone: 'neutral' },
      { key: 'operator', label: 'Operator', value: 'Demo Mobile', tone: 'neutral' },
    ]);
    expect(d.network).toEqual({ word: 'On the network', tone: 'ok' });
  });

  test.each([
    ['2', 'Searching for a network', 'warn'],
    ['3', 'Registration denied', 'bad'],
    ['0', 'Not on the network', 'bad'],
  ])('registration %s reads as %s', (stat, word, tone) => {
    expect(buildDashboard(report([item('creg', [`+CEREG: 0,${stat}`], 'AT+CEREG?', 'cereg')])).network).toEqual({ word, tone });
  });

  test('a SIM error is a bad chip, a locked SIM a warning', () => {
    const cpin = { ...failed('cpin', 'AT+CPIN?'), id: 'cpin' };
    expect(buildDashboard(report([cpin])).chips[0]).toMatchObject({ value: 'Unavailable', tone: 'bad' });
    expect(buildDashboard(report([item('cpin', ['+CPIN: SIM PIN'], 'AT+CPIN?', 'cpin')])).chips[0]).toMatchObject({ value: 'SIM PIN', tone: 'warn' });
  });
});

describe('bands', () => {
  const band = () => item('qcfg', ['+QCFG: "band",0x3,0x80800C5'], 'AT+QCFG="band"', 'qcfg-band');
  test('enabled bands with the active one from QNWINFO', () => {
    const d = buildDashboard(report([band(), item('qnwinfo', ['+QNWINFO: "FDD LTE","00101","LTE BAND 3",1300'], 'AT+QNWINFO', 'qnwinfo')]));
    expect(d.bands.items.map((b) => b.band)).toEqual([1, 3, 7, 8, 20, 28]);
    expect(d.bands.items.filter((b) => b.active).map((b) => b.band)).toEqual([3]);
  });
  test('the active band can come from the serving cell', () => {
    const d = buildDashboard(report([band(), serving()]));
    expect(d.bands.items.find((b) => b.active)?.band).toBe(3);
  });
  test('an active band missing from the mask still shows, in order', () => {
    const d = buildDashboard(report([item('qcfg', ['+QCFG: "band",0x3,0x5'], 'AT+QCFG="band"', 'qcfg-band'), serving()]));
    expect(d.bands.items).toEqual([{ band: 1, active: false }, { band: 3, active: true }]);
  });
  test('a band of another technology is not taken for an LTE band', () => {
    const d = buildDashboard(report([band(), item('qnwinfo', ['+QNWINFO: "WCDMA","00101","WCDMA 2100",10700'], 'AT+QNWINFO', 'qnwinfo')]));
    expect(d.bands.items.some((b) => b.active)).toBe(false);
    expect(d.bands.otherActive).toBe('WCDMA 2100');
  });
  test('nothing known', () => {
    expect(buildDashboard(report([])).bands).toEqual({ items: [] });
  });
});

describe('cell, neighbours and operators', () => {
  test('cell rows from the serving cell', () => {
    const d = buildDashboard(report([serving()]));
    expect(d.cell.map((r) => [r.key, r.value])).toEqual([
      ['plmn', '00101'], ['earfcn', '1300'], ['cell_id', '1A2B3C'], ['pci', '321'], ['tac', 'ABCD'], ['state', 'NOCONN'],
    ]);
  });
  test('cell rows fall back to QNWINFO and CEREG', () => {
    const d = buildDashboard(report([
      item('qnwinfo', ['+QNWINFO: "FDD LTE","00102","LTE BAND 3",1400'], 'AT+QNWINFO', 'qnwinfo'),
      item('creg', ['+CEREG: 2,1,"BEEF","CAFE01",7'], 'AT+CEREG?', 'cereg'),
    ]));
    expect(d.cell.map((r) => [r.key, r.value])).toEqual([
      ['plmn', '00102'], ['earfcn', '1400'], ['cell_id', 'CAFE01'], ['tac', 'BEEF'],
    ]);
  });
  test('neighbours, strongest first and rated', () => {
    const d = buildDashboard(report([item('qeng_neighbour', [
      '+QENG: "neighbourcell intra","LTE",1300,10,-12,-105,0,0',
      '+QENG: "neighbourcell inter","LTE",6300,20,-9,-78,0,0',
    ], 'AT+QENG="neighbourcell"', 'qeng-neighbour')]));
    expect(d.neighbours).toEqual([
      { kind: 'inter', earfcn: '6300', pci: '20', rsrp: -78, rsrq: -9, rating: 'excellent', word: 'Excellent' },
      { kind: 'intra', earfcn: '1300', pci: '10', rsrp: -105, rsrq: -12, rating: 'poor', word: 'Poor' },
    ]);
  });
  test('operators after a network scan, the current one flagged', () => {
    const d = buildDashboard(report([item('cops_scan', ['+COPS: (2,"Demo Mobile","Demo","00101",7),(3,"Other (Net)","Oth","00102",0),,(0-4),(0-2)'], 'AT+COPS=?', 'cops-scan')]));
    expect(d.operators).toEqual([
      { name: 'Demo Mobile', plmn: '00101', technology: 'LTE', status: 'current', current: true },
      { name: 'Other (Net)', plmn: '00102', technology: 'GSM', status: 'forbidden', current: false },
    ]);
  });
  test('the newest network scan wins', () => {
    const old = item('cops_scan', ['+COPS: (1,"Old","O","00109",7),,(0-4),(0-2)'], 'AT+COPS=?', 'cops-scan');
    const fresh = item('cops_scan', ['+COPS: (1,"New","N","00108",7),,(0-4),(0-2)'], 'AT+COPS=?', 'cops-scan');
    expect(buildDashboard(report([old, fresh])).operators.map((o) => o.name)).toEqual(['New']);
  });
});

describe('sim, data and device', () => {
  test('sim', () => {
    const d = buildDashboard(report([
      item('cpin', ['+CPIN: READY'], 'AT+CPIN?', 'cpin'),
      item('clck', ['+CLCK: 0'], 'AT+CLCK="SC",2', 'clck-sc'),
      item('qpinc', ['+QPINC: "SC",2,10', '+QPINC: "P2",3,9'], 'AT+QPINC?', 'qpinc'),
      item('qccid', ['+QCCID: 98000000000000000099'], 'AT+QCCID', 'qccid'),
      item('cimi', ['001010123456789'], 'AT+CIMI', 'cimi'),
    ]));
    expect(d.sim).toEqual({ state: 'Ready', lock: 'disabled', pinLeft: 2, pukLeft: 10, iccid: '98000000000000000099', imsi: '001010123456789' });
  });

  test('contexts are joined by number, without empty addresses', () => {
    const d = buildDashboard(report([
      item('cgdcont', ['+CGDCONT: 1,"IP","demo.apn","10.0.0.2",0,0', '+CGDCONT: 8,"IPV4V6","ims","0.0.0.0",0,0'], 'AT+CGDCONT?', 'cgdcont'),
      item('cgact', ['+CGACT: 1,1', '+CGACT: 8,0'], 'AT+CGACT?', 'cgact'),
      item('cgpaddr', ['+CGPADDR: 1,"10.0.0.2","fd00::2"', '+CGPADDR: 8,"0.0.0.0"'], 'AT+CGPADDR', 'cgpaddr'),
    ]));
    expect(d.data).toEqual([
      { cid: 1, apn: 'demo.apn', type: 'IP', active: true, addresses: ['10.0.0.2', 'fd00::2'] },
      { cid: 8, apn: 'ims', type: 'IPV4V6', active: false, addresses: [] },
    ]);
  });

  test('device', () => {
    const d = buildDashboard(report([
      item('qtemp', ['+QTEMP: 37,41,255'], 'AT+QTEMP', 'qtemp'),
      item('qcfg', ['+QCFG: "usbnet",1'], 'AT+QCFG="usbnet"', 'qcfg-usbnet'),
      item('cfun', ['+CFUN: 1'], 'AT+CFUN?', 'cfun'),
      item('cclk', ['+CCLK: "26/01/01,12:00:00+04"'], 'AT+CCLK?', 'cclk'),
    ]));
    expect(d.device).toEqual({ temperature: 41, usbMode: 'ECM (mode 1)', functionMode: 'full', time: '2026-01-01 12:00:00 UTC+01:00' });
  });

  test('temperature from named sensors, unknown USB modes keep their number', () => {
    const d = buildDashboard(report([
      item('qtemp', ['+QTEMP: "cpu-thermal","45"', '+QTEMP: "modem-thermal","39"'], 'AT+QTEMP', 'qtemp'),
      item('qcfg', ['+QCFG: "usbnet",9'], 'AT+QCFG="usbnet"', 'qcfg-usbnet'),
    ]));
    expect(d.device).toEqual({ temperature: 45, usbMode: 'mode 9' });
  });
});

describe('partial and empty reports', () => {
  test('an empty report has every part empty and nothing undefined in it', () => {
    const d = buildDashboard(report([]));
    expect(d.identity).toEqual({});
    expect(d.chips).toEqual([]);
    expect(d.network).toBeUndefined();
    expect(d.signal).toEqual({ values: [] });
    expect(d.cell).toEqual([]);
    expect(d.neighbours).toEqual([]);
    expect(d.operators).toEqual([]);
    expect(d.sim).toEqual({});
    expect(d.data).toEqual([]);
    expect(d.device).toEqual({});
  });

  test('a report without items is tolerated', () => {
    expect(() => buildDashboard({ startedAt: 't', commandList: [] } as unknown as ScanReport)).not.toThrow();
  });

  test('failed and skipped commands leave no trace', () => {
    const skipped: ScanItem = { id: 'cimi', command: 'AT+CIMI', category: 'sim', state: 'skipped', parser: 'cimi' };
    const d = buildDashboard(report([skipped, failed('qeng_serving'), failed('cesq')]));
    expect(d.signal.values).toEqual([]);
    expect(d.sim).toEqual({});
    expect(JSON.stringify(d)).not.toContain('undefined');
  });
});

describe('hide identifiers', () => {
  const items = () => [
    item('cgsn', ['123456789012345'], 'AT+CGSN', 'cgsn'),
    item('cimi', ['001010123456789'], 'AT+CIMI', 'cimi'),
    item('qccid', ['+QCCID: 98000000000000000099'], 'AT+QCCID', 'qccid'),
    item('cgpaddr', ['+CGPADDR: 1,"10.0.0.2"'], 'AT+CGPADDR', 'cgpaddr'),
    item('qeng_neighbour', ['+QENG: "neighbourcell intra","LTE",1300,77,-12,-105,0,0'], 'AT+QENG="neighbourcell"', 'qeng-neighbour'),
    serving(),
  ];

  test('off by default', () => {
    const text = JSON.stringify(buildDashboard(report(items())));
    expect(text).toContain('123456789012345');
    expect(text).not.toContain(MASK);
  });

  test('masks every value marked sensitive, and only those', () => {
    const d = buildDashboard(report(items()), { hideIdentifiers: true });
    const text = JSON.stringify(d);
    for (const secret of ['123456789012345', '001010123456789', '98000000000000000099', '10.0.0.2', '1A2B3C', 'ABCD', '321', '"77"']) {
      expect(text).not.toContain(secret);
    }
    expect(d.identity.imei).toBe(MASK);
    expect(d.sim).toMatchObject({ imsi: MASK, iccid: MASK });
    expect(d.data[0].addresses).toEqual([MASK]);
    expect(d.neighbours[0].pci).toBe(MASK);
    const cell = Object.fromEntries(d.cell.map((r) => [r.key, r.value]));
    expect(cell).toMatchObject({ cell_id: MASK, pci: MASK, tac: MASK, earfcn: '1300', plmn: '00101', state: 'NOCONN' });
  });

  test('two masked addresses of one context stay two', () => {
    const d = buildDashboard(report([item('cgpaddr', ['+CGPADDR: 1,"10.0.0.2","fd00::2"'], 'AT+CGPADDR', 'cgpaddr')]), { hideIdentifiers: true });
    expect(d.data[0].addresses).toEqual([MASK, MASK]);
  });
});
