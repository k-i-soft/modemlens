import { describe, expect, test } from 'vitest';
import type { ScanItem, ScanReport } from '../../src/scan/scanner';
import { redactReport, shapeOf } from '../../src/report/redact';
import { toJson } from '../../src/report/export';

const resp = (command: string, lines: string[], status: 'ok' | 'error' = 'ok') =>
  ({ command, status, lines, durationMs: 1 }) as ScanItem['response'];
const item = (id: string, command: string, lines: string[], parser?: string): ScanItem => ({
  id, command, category: 'other', state: 'done', response: resp(command, lines), ...(parser ? { parser } : {}),
});
const report = (items: ScanItem[], commandList: string[] = []): ScanReport =>
  ({ startedAt: '2026-01-01T00:00:00Z', items, commandList });

export const SECRETS = ['123456789012345', '228011234567890', '89410123456789012345', '+41791234567', '10.40.1.2', '2001:db8::1', 'user1', 'pass1'];

describe('redactReport', () => {
  test('known secrets never appear anywhere', () => {
    const r = report([
      item('cgsn', 'AT+CGSN', ['123456789012345'], 'cgsn'),
      item('cimi', 'AT+CIMI', ['228011234567890'], 'cimi'),
      item('crsm', 'AT+CRSM=176,12258,0,0,10', ['+CRSM: 144,0,"98 01 21 10 32 54 76 98 09 F1"'], 'crsm_iccid'),
      item('cgpaddr', 'AT+CGPADDR', ['+CGPADDR: 1,"10.40.1.2"', '+CGPADDR: 2,"2001:db8::1"'], 'cgpaddr'),
      item('cgdcont', 'AT+CGDCONT?', ['+CGDCONT: 1,"IP","internet","10.40.1.2",0,0'], 'cgdcont'),
      item('deep:+QXYZ', 'AT+QXYZ?', ['+QXYZ: +41791234567 89410123456789012345 user1 pass1'])
    ], ['+CGSN', 'AT+SECRET123456789012345', '<script>']);
    const out = toJson(redactReport(r));
    for (const s of SECRETS) expect(out).not.toContain(s);
    expect(out).not.toContain('SECRET1234');
    expect(out).not.toContain('<script>');
  });

  test('unknown response body kept only as shape', () => {
    const r = redactReport(report([item('deep:+QXYZ', 'AT+QXYZ?', ['+QXYZ: secretvalue 42'])]));
    expect(JSON.stringify(r)).not.toContain('secretvalue');
    expect(r.items[0].shape).toEqual({ length: 21, lines: 1, classes: expect.any(String) });
    expect(r.items[0].lines).toBeUndefined();
  });

  test('known parser that cannot interpret the response is shape only', () => {
    const r = redactReport(report([item('x', 'AT+X', ['garbage secretvalue'], 'no_such_parser')]));
    expect(JSON.stringify(r)).not.toContain('secretvalue');
    expect(r.items[0].shape).toBeDefined();
  });

  test('CRSM bodies are excluded', () => {
    const r = redactReport(report([item('crsm', 'AT+CRSM=176,12258,0,0,10', ['+CRSM: 144,0,"98012110325476980 9F1"'], 'crsm_iccid')]));
    const it = r.items[0];
    expect(it.fields).toBeUndefined();
    expect(it.lines).toBeUndefined();
    expect(it.shape).toBeDefined();
    expect(JSON.stringify(r)).not.toContain('9F1');
  });

  test('sensitive parsed item has fields but no raw lines', () => {
    const r = redactReport(report([item('cgsn', 'AT+CGSN', ['123456789012345'], 'cgsn')]));
    expect(r.items[0].lines).toBeUndefined();
    expect(r.items[0].fields?.[0].value).toBe('[redacted]');
  });

  test('15-digit runs masked in known responses', () => {
    const r = redactReport(report([item('ati', 'ATI', ['Quectel', 'EC25', 'Revision: 999888777666555'], 'identity')]));
    expect(JSON.stringify(r)).not.toContain('999888777666555');
  });

  test('short learned values do not corrupt other text', () => {
    const r = redactReport(report([
      item('cgdcont', 'AT+CGDCONT?', ['+CGDCONT: 1,"IP","internet","10.40.1.2",0,0'], 'cgdcont'),
      item('ati', 'ATI', ['Quectel', 'EC25'], 'identity'),
    ]));
    expect(JSON.stringify(r)).toContain('Quectel');
  });

  test('terminal traffic is not part of report', () => {
    const r = redactReport(report([]));
    expect(Object.keys(r).some((k) => /terminal/i.test(k))).toBe(false);
    expect(Object.keys(r).sort()).toEqual(['commandList', 'items', 'redacted', 'startedAt']);
  });

  test('errorDetail never exported', () => {
    const it = item('x', 'AT+X', ['a']);
    it.response!.errorDetail = 'secret 123456789012345';
    expect(toJson(redactReport(report([it])))).not.toContain('secret');
  });

  test('command list is kept, odd entries dropped', () => {
    const r = redactReport(report([], ['+CGMI', '$QCSQ', '+BAD ENTRY', '+X123456789012345']));
    expect(r.commandList).toEqual(['+CGMI', '$QCSQ']);
  });

  test('shapeOf', () => {
    expect(shapeOf(['+QXYZ: secretvalue 42'])).toEqual({ length: 21, lines: 1, classes: 'alpha,digit,space,punct' });
  });
});
