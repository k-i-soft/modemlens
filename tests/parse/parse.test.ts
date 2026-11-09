import { describe, expect, test } from 'vitest';
import type { AtResponse, AtStatus } from '../../src/at/engine';
import type { ScanItem, ScanReport } from '../../src/scan/scanner';
import { KNOWN_PARSERS, buildSummary, parseResponse } from '../../src/parse';
import { STANDARD_CATALOG } from '../../src/catalog/standard';
import { PROFILES } from '../../src/profiles';

const ok = (lines: string[], command = ''): AtResponse => ({ command, status: 'ok', lines, durationMs: 1 });
const val = (parser: string, lines: string[], key: string, command = ''): string | undefined =>
  parseResponse(parser, ok(lines, command))?.find(f => f.key === key)?.value;

describe('parseResponse', () => {
  test('spec examples', () => {
    expect(parseResponse('csq', ok(['+CSQ: 20,99']))).toContainEqual(expect.objectContaining({ key: 'rssi_dbm', value: '-73' }));
    expect(parseResponse('csq', ok(['+CSQ: 99,99']))).toContainEqual(expect.objectContaining({ key: 'rssi_dbm', value: 'unknown' }));
    expect(parseResponse('creg', ok(['+CEREG: 0,1']))).toContainEqual(expect.objectContaining({ key: 'status', value: 'registered, home' }));
    expect(parseResponse('cops', ok(['+COPS: 0,0,"Sunrise",7']))).toContainEqual(expect.objectContaining({ key: 'operator', value: 'Sunrise' }));
    expect(parseResponse('cpin', ok(['+CPIN: READY']))).toContainEqual(expect.objectContaining({ key: 'state', value: 'READY' }));
    expect(parseResponse('cgsn', ok(['123456789012345']))![0].sensitive).toBe('imei');
    expect(parseResponse('cimi', ok(['228011234567890']))![0].sensitive).toBe('imsi');
  });

  test.each(KNOWN_PARSERS)('%s survives garbage', p => {
    for (const lines of [[], ['???'], ['+X: ,,,'], ['\u0000ÿ'], ['+CREG:'], ['+QENG: "servingcell"']])
      for (const command of ['', 'ATI', 'AT+CLCK="SC",2'])
        expect(() => parseResponse(p, ok(lines, command))).not.toThrow();
  });

  test('null for unknown parser, non-ok status, toString-like ids', () => {
    expect(parseResponse('nope', ok(['x']))).toBeNull();
    expect(parseResponse('toString', ok(['x']))).toBeNull();
    for (const status of ['error', 'cme_error', 'timeout', 'disconnected'] as AtStatus[])
      expect(parseResponse('cpin', { command: '', status, lines: ['+CPIN: READY'], durationMs: 1 })).toBeNull();
    expect(parseResponse('csq', ok(['garbage']))).toBeNull();
  });

  test('every parser id used by catalog and profiles is registered', () => {
    const ids = new Set<string>();
    for (const e of STANDARD_CATALOG) if (e.parser) ids.add(e.parser);
    for (const p of PROFILES) for (const c of p.commands) if (c.parser) ids.add(c.parser);
    for (const id of ids) expect(KNOWN_PARSERS).toContain(id);
  });

  test('identity uses the command', () => {
    const ati = parseResponse('identity', ok(['Quectel', 'EC25', 'Revision: EC25EFAR06A', 'IMEI: 861234567890123'], 'ATI'))!;
    expect(ati).toContainEqual(expect.objectContaining({ key: 'manufacturer', value: 'Quectel' }));
    expect(ati).toContainEqual(expect.objectContaining({ key: 'model', value: 'EC25' }));
    expect(ati).toContainEqual(expect.objectContaining({ key: 'firmware', value: 'EC25EFAR06A' }));
    expect(ati).toContainEqual(expect.objectContaining({ key: 'imei', sensitive: 'imei' }));
    expect(val('identity', ['Quectel_Ltd'], 'manufacturer', 'AT+CGMI')).toBe('Quectel_Ltd');
    expect(val('identity', ['EC25'], 'model', 'AT+GMM')).toBe('EC25');
    expect(val('identity', ['EC25EFAR06A'], 'firmware', 'AT+CGMR')).toBe('EC25EFAR06A');
  });

  test('cgsn marks odd values as serial, never none', () => {
    expect(parseResponse('cgsn', ok(['ABC123']))![0].sensitive).toBe('serial');
  });

  test('clck', () => {
    expect(val('clck', ['+CLCK: 1'], 'lock_sc', 'AT+CLCK="SC",2')).toBe('enabled');
    expect(val('clck', ['+CLCK: 0'], 'lock_pn', 'AT+CLCK="PN",2')).toBe('disabled');
  });

  test('crsm_iccid decodes nibble-swapped BCD', () => {
    const f = parseResponse('crsm_iccid', ok(['+CRSM: 144,0,"98101430121181157002"']))!;
    expect(f[0]).toMatchObject({ key: 'iccid', value: '89014103211118510720', sensitive: 'iccid' });
    expect(parseResponse('crsm_iccid', ok(['+CRSM: 144,0,"98011430121118F5"']))![0].value).toBe('891041032111815');
    expect(parseResponse('crsm_iccid', ok(['+CRSM: 106,130,""']))).toBeNull();
  });

  test('qccid', () => {
    expect(parseResponse('qccid', ok(['+QCCID: 89410000000000000001']))![0]).toMatchObject({ value: '89410000000000000001', sensitive: 'iccid' });
  });

  test('creg variants and location marking', () => {
    const f = parseResponse('creg', ok(['+CREG: 2,5,"1A2B","00C0FFEE",7']))!;
    expect(f).toContainEqual(expect.objectContaining({ key: 'status', value: 'registered, roaming' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'lac', value: '1A2B', sensitive: 'location' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'cell_id', sensitive: 'location' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'act', value: 'E-UTRAN' }));
    expect(val('creg', ['+CGREG: 0,0'], 'status')).toBe('not registered');
    expect(val('creg', ['+C5GREG: 0,2'], 'status')).toBe('searching');
    expect(val('creg', ['+CEREG: 0,3'], 'status')).toBe('denied');
    expect(val('creg', ['+CREG: 0,4'], 'status')).toBe('unknown');
    expect(parseResponse('creg', ok(['+CEREG: 0,1,"2D0F","0123ABC",7']))!.find(f => f.key === 'tac')?.sensitive).toBe('location');
  });

  test('cesq', () => {
    const f = parseResponse('cesq', ok(['+CESQ: 99,99,255,255,20,50']))!;
    expect(f).toContainEqual(expect.objectContaining({ key: 'rsrp_dbm', value: '-91' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'rsrq_db', value: '-10' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'rscp_dbm', value: 'unknown' }));
    expect(val('cesq', ['+CESQ: 99,99,255,255,255,255'], 'rsrp_dbm')).toBe('unknown');
  });

  test('cesq rxlev, rscp, ecno use the lower bound', () => {
    const f = parseResponse('cesq', ok(['+CESQ: 40,99,60,20,255,255']))!;
    expect(f).toContainEqual(expect.objectContaining({ key: 'rxlev_dbm', value: '-71' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'rscp_dbm', value: '-61' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'ecno_db', value: '-14.5' }));
  });

  test('data contexts mark addresses as ip', () => {
    const f = parseResponse('cgdcont', ok(['+CGDCONT: 1,"IPV4V6","internet","10.1.2.3",0,0', '+CGDCONT: 2,"IP","ims"']))!;
    expect(f).toContainEqual(expect.objectContaining({ key: 'ctx1_apn', value: 'internet', sensitive: 'none' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'ctx1_addr', sensitive: 'ip' }));
    expect(parseResponse('cgact', ok(['+CGACT: 1,1', '+CGACT: 2,0']))).toContainEqual(expect.objectContaining({ key: 'ctx1_active', value: 'active' }));
    const p = parseResponse('cgpaddr', ok(['+CGPADDR: 1,"10.1.2.3","fe80::1"']))!;
    expect(p.map(x => x.sensitive)).toEqual(['ip', 'ip']);
  });

  test('quectel parsers', () => {
    expect(parseResponse('qspn', ok(['+QSPN: "Sunrise","Sunrise","",0,"22802"']))).toContainEqual(expect.objectContaining({ key: 'full_name', value: 'Sunrise' }));
    const nw = parseResponse('qnwinfo', ok(['+QNWINFO: "FDD LTE",26201,"LTE BAND 3",1300']))!;
    expect(nw.map(f => [f.key, f.value])).toEqual([['act', 'FDD LTE'], ['plmn', '26201'], ['band', 'LTE BAND 3'], ['channel', '1300']]);
    const q = parseResponse('qcsq', ok(['+QCSQ: "LTE",-60,-85,146,-10']))!;
    expect(q).toContainEqual(expect.objectContaining({ key: 'rsrp_dbm', value: '-85' }));
    expect(q).toContainEqual(expect.objectContaining({ key: 'rsrq_db', value: '-10' }));
    expect(q.some(f => f.key === 'sinr_db')).toBe(false);
  });

  test('qcsq: positive RSSI is a magnitude, SINR is not reported', () => {
    const q = parseResponse('qcsq', ok(['+QCSQ: "LTE",56,-84,100,-11']))!;
    expect(q.map(f => [f.key, f.value])).toEqual([
      ['sysmode', 'LTE'], ['rssi_dbm', '-56'], ['rsrp_dbm', '-84'], ['rsrq_db', '-11'],
    ]);
    expect(val('qcsq', ['+QCSQ: "GSM",60'], 'rssi_dbm')).toBe('-60');
    expect(val('qcsq', ['+QCSQ: "GSM",-60'], 'rssi_dbm')).toBe('-60');
  });

  test('qtemp: one field per real sensor, 255 means none', () => {
    const f = parseResponse('qtemp', ok(['+QTEMP: 37,255,255']))!;
    expect(f.map(x => [x.key, x.value])).toEqual([['temp_1', '37']]);
    expect(parseResponse('qtemp', ok(['+QTEMP: 255,255']))).toBeNull();
    expect(parseResponse('qtemp', ok(['+QTEMP: 40,41,255']))!.map(x => x.key)).toEqual(['temp_1', 'temp_2']);
    expect(val('qtemp', ['+QTEMP: "35"'], 'temp_1')).toBe('35');
  });

  test.each([
    ['+QNETDEVCTL: 1,1,1,1', 'on'],
    ['+QNETDEVCTL: 0,0,0,0', 'off'],
    ['+qnetdevctl:1, 1, 1, 0', 'off'],
  ])('qnetdevctl %s: host connection %s', (line, value) => {
    expect(val('qnetdevctl', [line], 'host_connection')).toBe(value);
  });

  test.each(['+QNETDEVCTL: 1,1,1,2', '+QNETDEVCTL: 1,1', 'nonsense'])('qnetdevctl %s says nothing', (line) => {
    expect(parseResponse('qnetdevctl', ok([line]))).toBeNull();
  });

  test('qcfg reads the NAT setting', () => {
    expect(val('qcfg', ['+QCFG: "nat",1'], 'nat')).toBe('1');
  });

  test('qcfg band: raw value kept, LTE bands decoded', () => {
    const f = parseResponse('qcfg', ok(['+QCFG: "band",0xd3,0x1a0080800d5']))!;
    expect(f).toContainEqual(expect.objectContaining({ key: 'band', value: '0xd3,0x1a0080800d5' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'lte_bands', value: '1,3,5,7,8,20,28,38,40,41' }));
    for (const bad of ['+QCFG: "band",0xd3', '+QCFG: "band",0xd3,zz', '+QCFG: "band",0xd3,0x0']) {
      const g = parseResponse('qcfg', ok([bad]));
      expect(g?.some(x => x.key === 'lte_bands') ?? false).toBe(false);
    }
    expect(parseResponse('qcfg', ok(['+QCFG: "usbnet",0']))!.some(x => x.key === 'lte_bands')).toBe(false);
  });

  test('simple settings parsers', () => {
    expect(val('cfun', ['+CFUN: 1'], 'functionality')).toBe('full');
    expect(val('cfun', ['+CFUN: 0'], 'functionality')).toBe('minimum');
    expect(val('cfun', ['+CFUN: 4'], 'functionality')).toBe('radio off');
    expect(val('cgatt', ['+CGATT: 1'], 'attached')).toBe('attached');
    expect(val('cgatt', ['+CGATT: 0'], 'attached')).toBe('detached');
    expect(val('cmee', ['+CMEE: 2'], 'error_reporting')).toBe('verbose text');
    expect(val('cscs', ['+CSCS: "GSM"'], 'charset')).toBe('GSM');
    expect(val('clvl', ['+CLVL: 3'], 'volume')).toBe('3');
    expect(val('ctzu', ['+CTZU: 1'], 'auto_time_zone')).toBe('on');
    const clip = parseResponse('clip', ok(['+CLIP: 0,2']))!;
    expect(clip.map(f => f.value)).toEqual(['hidden', 'unknown']);
    for (const p of ['cfun', 'cgatt', 'cmee', 'cscs', 'clvl', 'ctzu', 'clip', 'cclk', 'csca', 'qpinc', 'qgmr', 'cops_scan', 'qeng_neighbour'])
      expect(parseResponse(p, ok(['+X: nonsense']))).toBeNull();
  });

  test('cclk shows the modem time with its zone', () => {
    expect(val('cclk', ['+CCLK: "26/11/09,15:33:20+04"'], 'time')).toBe('2026-11-09 15:33:20 UTC+01:00');
    expect(val('cclk', ['+CCLK: "26/11/09,15:33:20-02"'], 'time')).toBe('2026-11-09 15:33:20 UTC-00:30');
    expect(parseResponse('cclk', ok(['+CCLK: "garbage"']))).toBeNull();
  });

  test('csca marks the SMS centre as smsc', () => {
    const f = parseResponse('csca', ok(['+CSCA: "+41790000000",145']))!;
    expect(f[0]).toMatchObject({ key: 'smsc', value: '+41790000000', sensitive: 'smsc' });
  });

  test('qpinc reads PIN and PUK attempts per facility', () => {
    const f = parseResponse('qpinc', ok(['+QPINC: "SC",3,10', '+QPINC: "P2",3,10']))!;
    expect(f.map(x => [x.key, x.value])).toEqual([
      ['sc_pin_left', '3'], ['sc_puk_left', '10'], ['p2_pin_left', '3'], ['p2_puk_left', '10'],
    ]);
  });

  test('qgmr gives the firmware build', () => {
    expect(val('qgmr', ['EC200AEUHAR01A30M16'], 'firmware_build')).toBe('EC200AEUHAR01A30M16');
  });

  test('qgmr ignores lines that are not a plain build string', () => {
    expect(val('qgmr', ['$GPGGA,123519,4807.038,N,01131.000,E,1,08', 'EC200AEUHAR01A30M16'], 'firmware_build')).toBe('EC200AEUHAR01A30M16');
    expect(parseResponse('qgmr', ok(['$GPGGA,123519,4807.038,N,01131.000,E,1,08']))).toBeNull();
  });

  test('cops_scan lists one field per operator', () => {
    const f = parseResponse('cops_scan', ok(['+COPS: (2,"Sunrise","Sunrise","22802",7),(1,"X","X","22801",7),,(0,1,2,3,4),(0,1,2)']))!;
    expect(f.map(x => [x.key, x.value])).toEqual([
      ['operator_1', 'Sunrise (22802) LTE, current'],
      ['operator_2', 'X (22801) LTE, available'],
    ]);
    expect(val('cops_scan', ['+COPS: (3,"Y (b)","Y","22803",2),(0,"Z","Z","22804",13),(1,"W","W","22805",12),(1,"V","V","22806",9)'], 'operator_1')).toBe('Y (b) (22803) UMTS, forbidden');
    const g = parseResponse('cops_scan', ok(['+COPS: (0,"Z","Z","22804",13),(1,"W","W","22805",12),(1,"V","V","22806",9)']))!;
    expect(g.map(x => x.value)).toEqual(['Z (22804) NR, unknown', 'W (22805) NB-IoT, available', 'V (22806) 9, available']);
  });

  test('qeng_neighbour: one group per LTE neighbour line', () => {
    const f = parseResponse('qeng_neighbour', ok([
      '+QENG: "neighbourcell intra","LTE",6200,101,-81,-11,-52,8,0,12,6',
      '+QENG: "neighbourcell inter","LTE",1300,202,-95,-14,-60,3,0,0,0,0',
      '+QENG: "neighbourcell","WCDMA",1,2,3',
      '+QENG: "neighbourcell intra","LTE",abc,1,2,3',
    ]))!;
    expect(f.filter(x => x.key.endsWith('_kind')).map(x => x.value)).toEqual(['intra', 'inter']);
    expect(f).toContainEqual(expect.objectContaining({ key: 'n1_earfcn', value: '6200' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'n1_rsrq_db', value: '-11' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'n1_rsrp_dbm', value: '-81' }));
    expect(f).toContainEqual(expect.objectContaining({ key: 'n2_rsrp_dbm', value: '-95' }));
    expect(f.filter(x => x.key.endsWith('_pci')).every(x => x.sensitive === 'location')).toBe(true);
    expect(parseResponse('qeng_neighbour', ok(['+QENG: "servingcell","NOCONN","LTE"']))).toBeNull();
  });

  describe('qeng_neighbour on real output', () => {
    const INTER = '+QENG: "neighbourcell inter","LTE",1850,65535,-140,-20,-,-,0,20,22,6';
    const INTRA = '+QENG: "neighbourcell intra","LTE",2850,247,-116,-20,-,-,10,6,9,8,29';

    test('columns after LTE are EARFCN, PCI, RSRP, RSRQ', () => {
      const f = parseResponse('qeng_neighbour', ok([INTRA]))!;
      expect(f).toContainEqual(expect.objectContaining({ key: 'n1_earfcn', value: '2850' }));
      expect(f).toContainEqual(expect.objectContaining({ key: 'n1_pci', value: '247', sensitive: 'location' }));
      expect(f).toContainEqual(expect.objectContaining({ key: 'n1_rsrp_dbm', value: '-116' }));
      expect(f).toContainEqual(expect.objectContaining({ key: 'n1_rsrq_db', value: '-20' }));
    });

    test('a line without a measured cell is left out, and numbering stays continuous', () => {
      const f = parseResponse('qeng_neighbour', ok([INTER, INTRA]))!;
      expect(f.filter(x => x.key.endsWith('_kind')).map(x => [x.key, x.value])).toEqual([['n1_kind', 'intra']]);
    });

    test.each([
      ['PCI 65535 alone', '+QENG: "neighbourcell intra","LTE",1850,65535,-100,-10'],
      ['RSRP -140 alone', '+QENG: "neighbourcell intra","LTE",1850,247,-140,-10'],
    ])('%s is enough to leave a line out', (_, line) => {
      expect(parseResponse('qeng_neighbour', ok([line]))).toBeNull();
    });

    test('only placeholders: no fields at all', () => {
      expect(parseResponse('qeng_neighbour', ok([INTER]))).toBeNull();
    });
  });

  test('qeng_serving: LTE layout, location marking, tolerant of other layouts', () => {
    const f = parseResponse('qeng_serving', ok(['+QENG: "servingcell","NOCONN","LTE","FDD",262,01,2D0F103,123,1300,3,5,5,2A1B,-95,-10,-65,15,50']))!;
    for (const k of ['cell_id', 'pci', 'tac']) expect(f.find(x => x.key === k)?.sensitive).toBe('location');
    expect(f).toContainEqual(expect.objectContaining({ key: 'rsrp_dbm', value: '-95' }));
    const w = parseResponse('qeng_serving', ok(['+QENG: "servingcell","NOCONN","WCDMA","FDD",262,01']))!;
    expect(w.map(x => x.key)).toEqual(['state', 'rat']);
    expect(parseResponse('qeng_serving', ok(['+QENG: "servingcell","SEARCH"']))!.map(x => x.key)).toEqual(['state']);
  });

  test('qtemp and qcfg are generic and flag credential names', () => {
    expect(parseResponse('qtemp', ok(['+QTEMP:"cpu-thermal","45"']))).toContainEqual(expect.objectContaining({ key: 'cpu_thermal', value: '45' }));
    expect(parseResponse('qtemp', ok(['+QTEMP: 35']))![0].value).toBe('35');
    expect(parseResponse('qcfg', ok(['+QCFG: "usbnet",0']))).toContainEqual(expect.objectContaining({ key: 'usbnet', value: '0' }));
    expect(parseResponse('qcfg', ok(['+QCFG: "apn_password","hunter2"']))![0].sensitive).toBe('credential');
  });
});

const item = (id: string, command: string, response?: AtResponse, state: ScanItem['state'] = 'done', parser?: string): ScanItem => {
  const i: ScanItem = { id, command, category: 'other', state };
  if (response) i.response = response;
  if (parser) i.parser = parser;
  return i;
};
const report = (items: ScanItem[]): ScanReport => ({ startedAt: 'x', items, commandList: [] });

describe('buildSummary', () => {
  test('empty and partial reports', () => {
    expect(buildSummary(report([]))).toEqual({});
    expect(buildSummary(report([item('cpin', 'AT+CPIN?', undefined, 'skipped', 'cpin')]))).toEqual({});
  });

  test('full report', () => {
    const s = buildSummary(report([
      item('ati', 'ATI', ok(['Quectel', 'EC25', 'Revision: EC25EFAR06A'], 'ATI'), 'done', 'identity'),
      item('cgmr', 'AT+CGMR', ok(['EC25EFAR06A'], 'AT+CGMR'), 'done', 'identity'),
      item('cpin', 'AT+CPIN?', ok(['+CPIN: READY']), 'done', 'cpin'),
      item('creg', 'AT+CREG?', ok(['+CREG: 0,2']), 'done', 'creg'),
      item('cereg', 'AT+CEREG?', ok(['+CEREG: 0,1']), 'done', 'creg'),
      item('cops', 'AT+COPS?', ok(['+COPS: 0,0,"Sunrise",7']), 'done', 'cops'),
      item('csq', 'AT+CSQ', ok(['+CSQ: 20,99']), 'done', 'csq'),
      item('qcsq', 'AT+QCSQ', ok(['+QCSQ: "LTE",-60,-85,146,-10']), 'done', 'qcsq'),
      item('qnwinfo', 'AT+QNWINFO', ok(['+QNWINFO: "FDD LTE",26201,"LTE BAND 3",1300']), 'done', 'qnwinfo'),
    ]));
    expect(s).toEqual({
      model: 'EC25', firmware: 'EC25EFAR06A', simState: 'READY', registration: 'registered, home',
      operator: 'Sunrise', signal: 'RSRP -85 dBm', rat: 'FDD LTE',
    });
  });

  test('CME ERROR on CPIN gives unavailable', () => {
    const r: AtResponse = { command: 'AT+CPIN?', status: 'cme_error', lines: [], errorDetail: 'SIM not inserted', durationMs: 1 };
    expect(buildSummary(report([item('cpin', 'AT+CPIN?', r, 'unsupported', 'cpin')])).simState).toBe('unavailable');
  });

  test('falls back to csq', () => {
    expect(buildSummary(report([item('csq', 'AT+CSQ', ok(['+CSQ: 20,99']), 'done', 'csq')])).signal).toBe('RSSI -73 dBm');
  });
});
