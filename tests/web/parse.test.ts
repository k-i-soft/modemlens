import { describe, expect, test } from 'vitest';
import { parseResponse } from '../../src/parse';
import type { Field } from '../../src/parse';
import { INFORMATION, PLMN, SIGNAL } from './fixtures';

const ok = (body: string) => ({ command: 'GET /x', status: 'ok' as const, lines: body.split('\n'), durationMs: 0 });
const parse = (parser: string, body: string) => parseResponse(parser, ok(body));
const by = (fields: Field[] | null, key: string) => fields?.find((f) => f.key === key);

describe('hilink information', () => {
  const fields = parse('hilink_information', INFORMATION);

  test('hilink parser marks identifiers sensitive', () => {
    const expected: Record<string, string> = {
      imei: 'imei', imsi: 'imsi', iccid: 'iccid', msisdn: 'msisdn', serial: 'serial', mac1: 'serial', mac2: 'serial',
      wan_ip: 'ip', wan_ipv6: 'ip', wan_dns: 'ip', wan_ipv6_dns: 'ip',
    };
    for (const [key, sensitive] of Object.entries(expected)) expect(by(fields, key)?.sensitive, key).toBe(sensitive);
  });

  test('uses the keys the dashboard reads and decodes entities', () => {
    expect(by(fields, 'model')?.value).toBe('DEMO-STICK-1');
    expect(by(fields, 'firmware')?.value).toBe('DEMOFW(FAKE)');
    expect(by(fields, 'manufacturer')?.value).toBe('Huawei');
    expect(by(fields, 'work_mode')?.value).toBe('LTE');
    expect(by(fields, 'imei')?.value).toBe('123456789012345');
  });

  test('never carries a tag it does not know', () => {
    expect(fields!.some((f) => f.value === '' || /empty/i.test(f.key))).toBe(false);
    const extra = parse('hilink_information', '<response><DeviceName>A</DeviceName><Password>hunter2</Password></response>');
    expect(JSON.stringify(extra)).not.toContain('hunter2');
  });

  test('empty values produce no field', () => {
    const f = parse('hilink_information', '<response><DeviceName>A</DeviceName><Imei></Imei><Imsi>   </Imsi></response>');
    expect(f!.map((x) => x.key).sort()).toEqual(['manufacturer', 'model']);
  });
});

describe('hilink signal', () => {
  const fields = parse('hilink_signal', SIGNAL);

  test('numbers lose their unit', () => {
    const expected: Record<string, string> = {
      rsrp_dbm: '-86', rsrq_db: '-5.0', rssi_dbm: '-63', sinr_db: '20',
      dl_bandwidth_mhz: '20', ul_bandwidth_mhz: '10', dl_frequency_khz: '1870000', ul_frequency_khz: '1775000',
    };
    for (const [key, value] of Object.entries(expected)) expect(by(fields, key)?.value, key).toBe(value);
  });

  test('a clamped reading keeps its number', () => {
    const f = parse('hilink_signal', '<response><rssi>&gt;=-51dBm</rssi><rsrp>&lt;=-140dBm</rsrp></response>');
    expect(by(f, 'rssi_dbm')?.value).toBe('-51');
    expect(by(f, 'rsrp_dbm')?.value).toBe('-140');
  });

  test('a value that is not a number is left out', () => {
    expect(by(parse('hilink_signal', '<response><band>3</band><rsrp>unknown</rsrp></response>'), 'rsrp_dbm')).toBeUndefined();
  });

  test('the channel splits into downlink and uplink', () => {
    expect(by(fields, 'earfcn')?.value).toBe('1850');
    expect(by(fields, 'ul_earfcn')?.value).toBe('19850');
    expect(by(parse('hilink_signal', '<response><earfcn>6300</earfcn></response>'), 'earfcn')?.value).toBe('6300');
  });

  test('cell position is sensitive and an empty tag is absent', () => {
    for (const key of ['cell_id', 'pci', 'tac', 'enodeb_id', 'nei_cellid']) expect(by(fields, key)?.sensitive, key).toBe('location');
    expect(by(fields, 'lac')).toBeUndefined();
    expect(by(parse('hilink_signal', '<response><lac>1234</lac></response>'), 'lac')?.sensitive).toBe('location');
  });

  test('band and plmn are plain', () => {
    expect(by(fields, 'band')).toMatchObject({ value: '3', sensitive: 'none' });
    expect(by(fields, 'plmn')).toMatchObject({ value: '00101', sensitive: 'none' });
  });
});

describe('hilink current-plmn', () => {
  test('operator, plmn and technology', () => {
    const f = parse('hilink_plmn', PLMN);
    expect(by(f, 'operator')?.value).toBe('Demo Mobile');
    expect(by(f, 'plmn')?.value).toBe('00101');
    expect(by(f, 'rat')?.value).toBe('LTE');
    expect(by(f, 'spn')).toBeUndefined();
  });

  test('the short name stands in for a missing full name', () => {
    expect(by(parse('hilink_plmn', '<response><ShortName>Demo</ShortName></response>'), 'operator')?.value).toBe('Demo');
  });
});

describe('xml that cannot be used', () => {
  test.each([
    ['truncated', '<response><rsrp>-86dBm'],
    ['not xml', 'hello'],
    ['empty', ''],
    ['html page', '<!doctype html><html><body><p>x</body></html>'],
    ['error document', '<error><code>125002</code><message></message></error>'],
    ['entity declaration', '<!DOCTYPE r [<!ENTITY a "b">]><response><DeviceName>&a;</DeviceName></response>'],
  ])('malformed xml gives null, no throw: %s', (_name, body) => {
    expect(() => parse('hilink_signal', body)).not.toThrow();
    expect(parse('hilink_signal', body)).toBeNull();
    expect(parse('hilink_information', body)).toBeNull();
  });

  test('a tag with markup inside is not a value', () => {
    const f = parse('hilink_information', '<response><DeviceName>A</DeviceName><Imei><b>1</b></Imei></response>');
    expect(by(f, 'imei')).toBeUndefined();
  });

  test('an absurdly long value is dropped', () => {
    const f = parse('hilink_information', `<response><DeviceName>${'A'.repeat(5000)}</DeviceName><Imei>123456789012345</Imei></response>`);
    expect(by(f, 'model')).toBeUndefined();
  });
});

describe('zte status', () => {
  test('is tolerant about which names a firmware uses', () => {
    const f = parse('zte_status', JSON.stringify({
      modem_model: 'DEMO-MIFI', cr_version: 'DEMOFW1', imei: '123456789012345', sim_imsi: '001010123456789', iccid: '',
      network_provider: 'Demo Mobile', network_type: 'LTE', lte_rsrp: '-90', Z_SINR: '12', rssi: '-70dBm', cell_id: '7654321',
      wan_ipaddr: '192.0.2.10', unknown_thing: 'ignored',
    }));
    expect(by(f, 'model')?.value).toBe('DEMO-MIFI');
    expect(by(f, 'firmware')?.value).toBe('DEMOFW1');
    expect(by(f, 'imei')?.sensitive).toBe('imei');
    expect(by(f, 'imsi')?.sensitive).toBe('imsi');
    expect(by(f, 'iccid')).toBeUndefined();
    expect(by(f, 'operator')?.value).toBe('Demo Mobile');
    expect(by(f, 'work_mode')?.value).toBe('LTE');
    expect(by(f, 'rsrp_dbm')?.value).toBe('-90');
    expect(by(f, 'sinr_db')?.value).toBe('12');
    expect(by(f, 'rssi_dbm')?.value).toBe('-70');
    expect(by(f, 'cell_id')?.sensitive).toBe('location');
    expect(by(f, 'wan_ip')?.sensitive).toBe('ip');
    expect(JSON.stringify(f)).not.toContain('ignored');
  });

  test('shows the software version next to the firmware, and either name for the hardware', () => {
    const f = parse('zte_status', JSON.stringify({ web_version: 'DEMO-WEB-1', wa_inner_version: 'DEMOFW2', hw_version: '', hardware_version: 'DEMO-HW-1' }));
    expect(by(f, 'software')?.value).toBe('DEMO-WEB-1');
    expect(by(f, 'firmware')?.value).toBe('DEMOFW2');
    expect(by(f, 'hardware')?.value).toBe('DEMO-HW-1');
  });

  test('reads an RSSI that also names its asu', () => {
    expect(by(parse('zte_status', JSON.stringify({ rssi: '-86 dBm  54 asu' })), 'rssi_dbm')?.value).toBe('-86');
  });

  test.each([['not json', '{oops'], ['a list', '[1,2]'], ['nothing known', '{"a":"b"}'], ['null', 'null']])('%s gives null', (_n, body) => {
    expect(parse('zte_status', body)).toBeNull();
  });
});
