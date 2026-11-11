import { describe, expect, test } from 'vitest';
import type { AtResponse } from '../../src/at/engine';
import { KNOWN_PARSERS, parseResponse } from '../../src/parse';

const ok = (lines: string[]): AtResponse => ({ command: '', status: 'ok', lines, durationMs: 1 });
const fields = (parser: string, lines: string[]) =>
  Object.fromEntries((parseResponse(parser, ok(lines)) ?? []).map((f) => [f.key, f.value]));

describe('Huawei parsers', () => {
  test('all four are registered', () => {
    for (const p of ['hw_sysinfo', 'hw_syscfg', 'hw_hwver', 'hw_cardmode']) expect(KNOWN_PARSERS).toContain(p);
  });

  test('^SYSINFO on a stick that has service', () => {
    expect(fields('hw_sysinfo', ['^SYSINFO:2,3,0,5,1,,4'])).toEqual({
      service: 'valid service',
      service_domain: 'CS and PS',
      roaming: 'no',
      system_mode: 'WCDMA',
      sim: 'valid',
      submode: 'WCDMA',
    });
  });

  test('^SYSINFO says why a stick does not register', () => {
    expect(fields('hw_sysinfo', ['^SYSINFO: 1,4,0,5,4'])).toMatchObject({
      service: 'restricted service',
      service_domain: 'searching',
      sim: 'invalid for CS and PS',
    });
  });

  test('^SYSINFO shows an unknown code as its number', () => {
    expect(fields('hw_sysinfo', ['^SYSINFO:2,3,0,99,1'])).toMatchObject({ system_mode: 'code 99' });
  });

  test.each([['^SYSINFO:2,3'], ['^SYSINFO:a,b,c,d,e'], ['+CSQ: 20,99'], ['']])('^SYSINFO %j says nothing', (line) => {
    expect(parseResponse('hw_sysinfo', ok([line]))).toBeNull();
  });

  // The answer of the K3715 captured 2026-11-10.
  test('^SYSCFG of the K3715: data (PS) is not in the service domain', () => {
    expect(fields('hw_syscfg', ['^SYSCFG:2,2,2000000780380,1,0'])).toEqual({
      network_mode: 'automatic',
      acquisition_order: 'WCDMA first',
      band_mask: '2000000780380',
      roaming: 'allowed',
      service_domain: 'CS only',
    });
  });

  test('^SYSCFG with spaces and the usual setting', () => {
    expect(fields('hw_syscfg', ['^SYSCFG: 14, 0, 3FFFFFFF, 0, 2'])).toMatchObject({
      network_mode: 'WCDMA only',
      acquisition_order: 'automatic',
      roaming: 'not allowed',
      service_domain: 'CS and PS',
    });
  });

  test.each([['^SYSCFG:2,2'], ['^SYSCFG:x,2,3FFF,1,0'], ['^SYSCFG:2,2,not-hex,1,0']])('^SYSCFG %j says nothing', (line) => {
    expect(parseResponse('hw_syscfg', ok([line]))).toBeNull();
  });

  test.each([
    ['^HWVER:"CD25TCPV"', 'CD25TCPV'],
    ['^HWVER: CH1E3531SM', 'CH1E3531SM'],
  ])('^HWVER %s', (line, value) => expect(fields('hw_hwver', [line])).toEqual({ hardware_version: value }));

  test.each([['^HWVER:""'], ['^HWVER:"<script>"'], ['OK']])('^HWVER %j says nothing', (line) => {
    expect(parseResponse('hw_hwver', ok([line]))).toBeNull();
  });

  test.each([
    ['^CARDMODE:1', 'SIM'],
    ['^CARDMODE: 2', 'USIM'],
  ])('%s', (line, value) => expect(fields('hw_cardmode', [line])).toEqual({ card_type: value }));

  test.each([['^CARDMODE:0'], ['^CARDMODE:7'], ['^CARDMODE:']])('%s says nothing', (line) => {
    expect(parseResponse('hw_cardmode', ok([line]))).toBeNull();
  });
});
