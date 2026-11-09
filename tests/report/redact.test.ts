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
      item('deep:+QXYZ', 'AT+QXYZ?', ['+QXYZ: +41791234567 89410123456789012345 user1 pass1']),
      item('qeng', 'AT+QENG="servingcell"', ['+QENG: "servingcell","NOCONN","WCDMA",228,01,1A2B,ABCDEF1,10737,1,-90,-10'], 'qeng_serving'),
      item('deep:+X123456789012345?', 'AT+X123456789012345?', ['ERR']),
    ], ['+CGSN', 'AT+SECRET123456789012345', '<script>', '+41791234567']);
    r.usb = '2c7c:0125 SN=AB12CD34EF56 89410123456789012345';
    const out = toJson(redactReport(r));
    for (const s of SECRETS) expect(out).not.toContain(s);
    expect(out).not.toContain('SECRET1234');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('1A2B');
    expect(out).not.toContain('ABCDEF1');
    expect(out).not.toContain('SN=');
  });

  const leaks = (items: ScanItem[], needles: string[], cl: string[] = [], usb?: string) => {
    const r = report(items, cl);
    if (usb) r.usb = usb;
    const j = toJson(redactReport(r));
    for (const n of needles) expect(j).not.toContain(n);
    return redactReport(r);
  };
  const qeng = (lines: string[]) => item('qeng', 'AT+QENG="servingcell"', lines, 'qeng_serving');

  test('partial QENG parses do not leak cell ids', () => {
    leaks([qeng(['+QENG: "servingcell","NOCONN","WCDMA",228,01,1A2B,ABCDEF1,10737,1,-90,-10'])], ['1A2B', 'ABCDEF1']);
    leaks([qeng(['+QENG: "servingcell","NOCONN","GSM",228,01,1A2B,C3D4,20,50'])], ['1A2B', 'C3D4']);
    leaks([qeng(['+QENG: "servingcell","NOCONN"', '+QENG: "LTE","FDD",228,01,ABCDEF1,123,1300,3,5,5,1A2B,-90,-10,-60,15'])], ['ABCDEF1', '1A2B']);
  });

  test('later CREG line does not leak', () => {
    leaks([item('creg', 'AT+CREG?', ['+CREG: 0,1,"1A2B","ABCDEF1",7', '+CREG: 2,1,"1A2B","ABCDEF1",7'], 'creg')], ['1A2B', 'ABCDEF1']);
  });

  test('identity with serial lines is shape only', () => {
    const a = leaks([item('ati', 'ATI', ['Acme', 'M1', 'Revision: 1', 'Serial: AB12CD34EF56'], 'identity')], ['AB12CD34EF56']);
    expect(a.items[0].fields).toBeUndefined();
    leaks([item('ati', 'ATI', ['SN AB12CD34EF56', 'M1'], 'identity')], ['AB12CD34EF56']);
    leaks([item('cgmr', 'AT+CGMR', ['R1', 'SN:AB12CD34EF56'], 'identity')], ['AB12CD34EF56']);
    leaks([item('cgmr', 'AT+CGMR', ['35-209900-176148-1'], 'identity')], ['35-209900-176148-1']);
  });

  test('deep item names carrying identifiers are replaced', () => {
    const r = leaks([item('deep:+X123456789012345?', 'AT+X123456789012345?', ['ERR'])], ['123456789012345']);
    expect(r.items[0].id).toBe('deep:[redacted]');
  });

  test('commandList drops E.164 and learned values', () => {
    const r = leaks([item('cgsn', 'AT+CGSN', ['AB12CD34EF56'], 'cgsn')], ['+41791234567', 'AB12CD34EF56'], ['+41791234567', 'AB12CD34EF56', '+CGMI']);
    expect(r.commandList).toEqual(['+CGMI']);
  });

  test('usb kept only as vid:pid', () => {
    expect(leaks([], ['SN='], [], '2c7c:0125 SN=AB12CD34EF56').usb).toBeUndefined();
    expect(leaks([], [], [], '2c7c:0125').usb).toBe('2c7c:0125');
  });

  test('prefixed IP forms are masked', () => {
    leaks([item('c', 'AT+X', ['addr:2001:db8::1'], 'csq')], ['2001:db8::1']);
    leaks([item('c', 'AT+X', ['IP10.40.1.2'], 'csq')], ['10.40.1.2']);
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
