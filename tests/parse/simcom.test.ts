import { describe, expect, test } from 'vitest';
import type { AtResponse } from '../../src/at/engine';
import { KNOWN_PARSERS, parseResponse } from '../../src/parse';

const ok = (lines: string[]): AtResponse => ({ command: '', status: 'ok', lines, durationMs: 1 });
const fields = (parser: string, lines: string[]) =>
  Object.fromEntries((parseResponse(parser, ok(lines)) ?? []).map((f) => [f.key, f.value]));

describe('SIMCom parsers', () => {
  test('all four are registered', () => {
    for (const p of ['sim_cpsi', 'sim_cnmp', 'sim_cmnb', 'sim_cbandcfg']) expect(KNOWN_PARSERS).toContain(p);
  });

  test('+CPSI on LTE Cat-M1', () => {
    expect(fields('sim_cpsi', ['+CPSI: LTE CAT-M1,Online,228-01,0x1A2B,12345678,123,EUTRAN-BAND20,6300,3,3,-10,-95,-65,15'])).toEqual({
      system_mode: 'LTE CAT-M1',
      operation_mode: 'Online',
      plmn: '228-01',
      tac: '0x1A2B',
      cell_id: '12345678',
      pci: '123',
      band: 'B20',
      earfcn: '6300',
      rsrq_db: '-10',
      rsrp_dbm: '-95',
      rssi_dbm: '-65',
      sinr_db: '15',
    });
  });

  test('+CPSI marks the cell as location', () => {
    const f = parseResponse('sim_cpsi', ok(['+CPSI: LTE NB-IOT,Online,228-01,0x1A2B,12345678,123,EUTRAN-BAND8,3740,0,0,-12,-110,-90,3']))!;
    const sens = Object.fromEntries(f.map((x) => [x.key, x.sensitive]));
    expect(sens).toMatchObject({ tac: 'location', cell_id: 'location', pci: 'location', band: 'none', rsrp_dbm: 'none' });
    expect(Object.fromEntries(f.map((x) => [x.key, x.value]))).toMatchObject({ system_mode: 'LTE NB-IOT', band: 'B8' });
  });

  test('+CPSI without service', () => {
    expect(fields('sim_cpsi', ['+CPSI: NO SERVICE,Online'])).toEqual({ system_mode: 'no service', operation_mode: 'Online' });
  });

  test('+CPSI on GSM keeps only what has the same meaning', () => {
    expect(fields('sim_cpsi', ['+CPSI: GSM,Online,228-01,0x182d,12401,27 EGSM 900,-64,2110,42-42'])).toEqual({
      system_mode: 'GSM',
      operation_mode: 'Online',
      plmn: '228-01',
    });
  });

  test.each([['+CPSI:'], ['+CSQ: 20,99'], ['LTE CAT-M1,Online']])('+CPSI %j says nothing', (line) => {
    expect(parseResponse('sim_cpsi', ok([line]))).toBeNull();
  });

  test.each([
    ['+CNMP: 2', 'automatic'],
    ['+CNMP: 13', 'GSM only'],
    ['+CNMP: 38', 'LTE only'],
    ['+CNMP: 51', 'GSM and LTE only'],
    ['+CNMP: 7', 'code 7'],
  ])('%s', (line, value) => expect(fields('sim_cnmp', [line])).toEqual({ mode_preference: value }));

  test.each([
    ['+CMNB: 1', 'CAT-M'],
    ['+CMNB: 2', 'NB-IoT'],
    ['+CMNB: 3', 'CAT-M and NB-IoT'],
  ])('%s', (line, value) => expect(fields('sim_cmnb', [line])).toEqual({ lte_mode: value }));

  test.each([['+CNMP: x'], ['+CMNB:']])('%s says nothing', (line) => {
    expect(parseResponse(line.includes('CNMP') ? 'sim_cnmp' : 'sim_cmnb', ok([line]))).toBeNull();
  });

  test('+CBANDCFG lists the bands per mode', () => {
    expect(fields('sim_cbandcfg', [
      '+CBANDCFG: "CAT-M",1,2,3,4,5,8,12,13,14,18,19,20,26,28,39',
      '+CBANDCFG: "NB-IOT",3,8,20',
    ])).toEqual({
      catm_bands: 'B1, B2, B3, B4, B5, B8, B12, B13, B14, B18, B19, B20, B26, B28, B39',
      nbiot_bands: 'B3, B8, B20',
    });
  });

  test.each([['+CBANDCFG: "CAT-M",x'], ['+CBANDCFG: "LTE",3,8']])('+CBANDCFG %j says nothing', (line) => {
    expect(parseResponse('sim_cbandcfg', ok([line]))).toBeNull();
  });
});
