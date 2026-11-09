import { describe, expect, test } from 'vitest';
import raw from './quectel-ec200a.json';
import type { ScanReport } from '../../src/scan/scanner';
import { buildSummary, parseResponse } from '../../src/parse';
import { buildDashboard } from '../../src/ui/dashboard';
import { redactReport } from '../../src/report/redact';
import { toJson, toMarkdown } from '../../src/report/export';
import { PROFILES } from '../../src/profiles';

// A real EC200A scan in which every identifier was replaced by an obviously fake value.
const report = raw as unknown as ScanReport;
const FAKE = {
  imei: '123456789012345', imsi: '001010123456789', iccid: '89000000000000000019',
  smsc: '+10000000000', cell: '0ABCDE', tac: 'FACE',
};

const field = (id: string, key: string): string | undefined => {
  const item = report.items.find(i => i.id === id);
  const f = item?.response && item.parser ? parseResponse(item.parser, item.response) : null;
  return f?.find(x => x.key === key)?.value;
};

describe('quectel-ec200a fixture', () => {
  test('summary', () => {
    const s = buildSummary(report);
    expect(s.model).toBe('EC200A');
    expect(s.firmware).toBe('EC200AEUHAR01A30M16');
    expect(s.simState).toBe('READY');
    expect(s.registration).toBe('registered, home');
    expect(s.operator).toBe('Demo Mobile');
  });

  test('dashboard', () => {
    const d = buildDashboard(report);
    const sig = (m: string) => d.signal.values.find(v => v.metric === m);
    expect(sig('rsrp')?.value).toBe(-94);
    expect(sig('sinr')?.value).toBe(15);
    expect(sig('rssi')?.value).toBe(-67); // serving cell wins; the qcsq value (-68) is asserted below
    expect(d.bands.items.find(b => b.band === 7)?.active).toBe(true);
    expect(d.bands.items.map(b => b.band)).toEqual(expect.arrayContaining([1, 3, 5, 7, 8, 20, 28, 38, 40, 41]));
    expect(d.sim.pinLeft).toBe(3);
    expect(d.sim.pukLeft).toBe(10);
    expect(d.device.temperature).toBe(29);
    expect(d.device.usbMode).toMatch(/ECM/);
    const ctx = d.data.find(c => c.cid === 1);
    expect(ctx?.apn).toBe('internet');
  });

  test('field level values', () => {
    expect(field('qcsq', 'rssi_dbm')).toBe('-68');
    expect(field('qeng-serving', 'rsrp_dbm')).toBe('-94');
    expect(field('qeng-serving', 'sinr_db')).toBe('15');
    expect(field('qtemp', 'temp_1')).toBe('29');
    expect(field('qtemp', 'temp_2')).toBeUndefined();
    expect(field('qtemp', 'temp_3')).toBeUndefined();
    expect(field('qcfg-band', 'lte_bands')).toBe('1,3,5,7,8,20,28,38,40,41');
    expect(field('qpinc', 'sc_pin_left')).toBe('3');
    expect(field('qpinc', 'sc_puk_left')).toBe('10');
    expect(field('qcfg-usbnet', 'usbnet')).toBe('1');
    expect(field('cgdcont', 'ctx1_apn')).toBe('internet');
  });

  test('every answered parser item yields fields, except legitimately empty ones', () => {
    const empty = new Set(['qeng-neighbour', 'clcc-test']);
    for (const item of report.items) {
      if (!item.parser || !item.response || item.response.status !== 'ok' || empty.has(item.id)) continue;
      expect(parseResponse(item.parser, item.response), item.id).not.toBeNull();
    }
  });

  test('the raw fixture holds only the listed fake identifiers', () => {
    const lines = (id: string) => report.items.find(i => i.id === id)?.response?.lines.join(' ') ?? '';
    expect(lines('cgsn')).toBe(FAKE.imei);
    expect(lines('gsn')).toBe(FAKE.imei);
    expect(lines('cimi')).toBe(FAKE.imsi);
    expect(lines('qccid')).toContain(FAKE.iccid);
    expect(lines('crsm-iccid')).toContain('98000000000000000091');
  });

  test('the redacted export contains no identifier', () => {
    const shared = redactReport(report);
    const out = toJson(shared) + toMarkdown(shared);
    for (const v of [...Object.values(FAKE), '10.0.0.2', '10.0.0.3', '98000000000000000091']) expect(out).not.toContain(v);
    expect(out).not.toMatch(/\b10\.0\.0\.\d+\b/);
    expect(out).not.toMatch(/\d{14,20}/);
    expect(out).toContain('EC200AEUHAR01A30M16');
  });
});

test('profile verification status', () => {
  expect(PROFILES.find(p => p.id === 'quectel-ec200a')?.verified).toBe(true);
  for (const p of PROFILES.filter(p => p.id !== 'quectel-ec200a')) expect(p.verified, p.id).toBe(false);
});

// Public repository: every capture in this folder may hold only obviously fake values.
const ALLOWED_DIGIT_RUNS = new Set([FAKE.imei, FAKE.imsi, FAKE.iccid, '98000000000000000091']);
const ALLOWED_QUOTED = new Set(['Demo Mobile', '00101', 'FDD LTE', 'LTE BAND 7']);
const captures = import.meta.glob('./*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe.each(Object.entries(captures))('fixture contains no secrets: %s', (_name, text) => {
  test('digit runs', () => {
    for (const m of text.match(/\d{14,20}/g) ?? []) expect(ALLOWED_DIGIT_RUNS.has(m), m).toBe(true);
  });
  test('IPv4 addresses', () => {
    for (const m of text.match(/\d+(?:\.\d+)+/g) ?? []) {
      const parts = m.split('.');
      if (parts.length === 4 && parts.every(p => p.length <= 3 && Number(p) <= 255)) {
        expect(/^10\.0\.0\.\d{1,3}$/.test(m) || m === '0.0.0.0', m).toBe(true);
      } else if (parts.length > 4) {
        expect(parts.every(p => Number(p) === 0), m).toBe(true);
      }
    }
  });
  test('IPv6 addresses', () => {
    for (const m of text.match(/[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,}/g) ?? []) {
      expect(/^\d\d:\d\d:\d\d$/.test(m) || /^[0:]+$/.test(m), m).toBe(true);
    }
  });
  test('operator names and PLMN strings', () => {
    const cap = JSON.parse(text) as ScanReport;
    for (const item of cap.items) {
      if (!['cops', 'qspn', 'qnwinfo'].includes(item.parser ?? '')) continue;
      for (const l of item.response?.lines ?? [])
        for (const q of l.match(/"[^"]*"/g) ?? []) expect(ALLOWED_QUOTED.has(q.slice(1, -1)), q).toBe(true);
    }
  });
});
