import { expect, test } from 'vitest';
import { classifyTerminalCommand, discoveryForms, isDiscoverable, parseCommandList } from '../../src/catalog/safety';
import { STANDARD_CATALOG } from '../../src/catalog/standard';

test.each(['Z', '&F', '&W', 'D', 'E', 'H', 'O'])('basic %s not discoverable', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+QPOWD', '+CRESET', '+QFOTADL', '+CPOF', '^RESET', '+QPRTPARA_ERASE', '!DFU', '+QFLASH'])('dangerous %s denied', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+COPS', '+QSCAN', '+QOPS'])('scan command %s excluded', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+CPIN', '+CLCK', '+CPWD', '+CMGS', '+CMGD', '+CMGR', '+CMGL', '+CPBR', '+CPBW'])('secret/content %s denied', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+CSQ', '+QENG', '^SYSINFO', '#SCFG', '!GSTATUS', '$QCSQ', '%CSQ', '*CNTI'])('extended %s ok', n => expect(isDiscoverable(n)).toBe(true));
test('extra deny', () => expect(isDiscoverable('+QXYZ', ['+QXYZ'])).toBe(false));
test('forms', () => expect(discoveryForms('+QXYZ')).toEqual(['AT+QXYZ=?', 'AT+QXYZ?']));
test('terminal read', () => {
  expect(classifyTerminalCommand('AT+CSQ?')).toBe('read');
  expect(classifyTerminalCommand('AT+CSQ=?')).toBe('read');
  expect(classifyTerminalCommand('ati')).toBe('read');
});
test('terminal write', () => {
  expect(classifyTerminalCommand('AT+CFUN=0')).toBe('write');
  expect(classifyTerminalCommand('ATZ')).toBe('write');
  expect(classifyTerminalCommand('AT+CSQ?;+CFUN=0')).toBe('write');
  expect(classifyTerminalCommand('AT+CFUN=1?')).toBe('write');
  expect(classifyTerminalCommand('AT+CPIN="1234"')).toBe('write');
});
test('parse clac', () => expect(parseCommandList(['+CSQ', '&F', 'AT+CREG'])).toEqual(['+CSQ', '&F', '+CREG']));

// invariant of the catalog
test('every auto catalog entry is a read form', () => {
  for (const e of STANDARD_CATALOG.filter(e => e.phase === 'auto'))
    expect(e.command).toMatch(/^AT(I|\+\w+\?|\+\w+=\?|\+(CSQ|CESQ|CIMI|CGSN|GSN|GMI|GMM|GMR|CGMI|CGMM|CGMR|CGPADDR)$|\+CLCK="\w\w",2$|\+CRSM=176,)/);
});
test('no PIN sets in catalog', () => expect(STANDARD_CATALOG.some(e => /CPIN=/.test(e.command))).toBe(false));
test('catalog ids unique, COPS scan is manual', () => {
  const ids = STANDARD_CATALOG.map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(STANDARD_CATALOG.find(e => e.command === 'AT+COPS=?')).toMatchObject({ phase: 'manual', timeoutMs: 180000 });
});
