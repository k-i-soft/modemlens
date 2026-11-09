import { expect, test } from 'vitest';
import { classifyTerminalCommand, discoveryForms, isDiscoverable, parseCommandList } from '../../src/catalog/safety';
import { STANDARD_CATALOG } from '../../src/catalog/standard';

test.each(['Z', '&F', '&W', 'D', 'E', 'H', 'O'])('basic %s not discoverable', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+QPOWD', '+CRESET', '+QFOTADL', '+CPOF', '^RESET', '+QPRTPARA', '!DFU', '+QFLASH'])('dangerous %s denied', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+COPS', '+QSCAN', '+QOPS'])('scan command %s excluded', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+CPIN', '+CLCK', '+CPWD', '+CMGS', '+CMGD', '+CMGR', '+CMGL', '+CPBR', '+CPBW'])('secret/content %s denied', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+CSQ', '+QENG', '^SYSINFO', '#SCFG', '!GSTATUS', '$QCSQ', '%CSQ', '*CNTI'])('extended %s ok', n => expect(isDiscoverable(n)).toBe(true));
test.each([
  '#REBOOT', '#SHDN', '#SYSHALT', '^SMSO', '^MSO', '!BOOTHOLD',
  '+UFWUPD', '+UFWINSTALL', '#FWSWITCH', '+QNVW', '+QNVFW', '+QPRTPARA',
  '+CNETSCAN', '^NETSCAN', '+QCOPS',
  '+CGDATA', '+CIICR', '+CIPSHUT', '+NETOPEN', '+NETCLOSE', '+QIACT', '+QIDEACT', '$QCRMCALL',
  '+CHUP', '+QHUP', '+CSIM', '+CRSM', '+CCHO', '+CGLA',
  '^CPIN', '+CPIN2', '^CARDLOCK', '^DATALOCK', '^SPWD', '^SLCK',
  '+CMGDA', '+QMGDA', '+CMGW', '+CMSS', '+QCMGS', '+QCMGR', '^HCMGR', '^HCMGS', '^HCMGL', '^SMGR', '^SMGL',
  '+CPBF', '+CPBS', '+CNUM', '+CUSD',
  '$QCPWRDN', '+CPWROFF', '^PWRCTL',
])('denied family %s', n => expect(isDiscoverable(n)).toBe(false));
test.each(['+CSQ;Z', '+X;+CFUN=0', '+', '+CSQ=1', '+CSQ?', ' +CSQ', '+CSQ ', '+C SQ', '+CSQ\n', '', 'CSQ'])('malformed %j rejected', n => expect(isDiscoverable(n)).toBe(false));
test('lowercase is normalised, not rejected', () => expect(isDiscoverable('+qeng')).toBe(true));
test('+CCLK stays discoverable', () => expect(isDiscoverable('+CCLK')).toBe(true));
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
const CATALOG_READ_FORM = /^AT(I|\+\w+\?|\+\w+=\?|\+(CSQ|CESQ|CIMI|CGSN|GSN|GMI|GMM|GMR|CGMI|CGMM|CGMR|CGPADDR)|\+CLCK="\w\w",2|\+CRSM=176,\d+,\d+,\d+,\d+)$/;
test('every auto catalog entry is a read form', () => {
  for (const e of STANDARD_CATALOG.filter(e => e.phase === 'auto')) expect(e.command).toMatch(CATALOG_READ_FORM);
});
test.each(['AT+CSQ?;+CFUN=0', 'ATIxyz', 'AT+CSQ;+CFUN=0', 'AT+CLCK="SC",2;+CFUN=0', 'AT+CRSM=176,1,0,0,10;Z'])('read-form check rejects %s', c =>
  expect(c).not.toMatch(CATALOG_READ_FORM));
test('no PIN sets in catalog', () => expect(STANDARD_CATALOG.some(e => /CPIN=/.test(e.command))).toBe(false));
test('catalog ids unique, COPS scan is manual', () => {
  const ids = STANDARD_CATALOG.map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(STANDARD_CATALOG.find(e => e.command === 'AT+COPS=?')).toMatchObject({ phase: 'manual', timeoutMs: 180000 });
});

test('parser ids wired', () => {
  const p = (id: string) => STANDARD_CATALOG.find(e => e.id === id)?.parser;
  expect(p('ati')).toBe('identity'); expect(p('gsn')).toBe('cgsn'); expect(p('cimi')).toBe('cimi');
  expect(p('crsm-iccid')).toBe('crsm_iccid'); expect(p('clck-pn')).toBe('clck'); expect(p('c5greg')).toBe('creg');
  expect(p('clip')).toBe('clip'); expect(p('cfun')).toBe('cfun'); expect(p('cops-scan')).toBe('cops_scan'); expect(p('clcc-test')).toBeUndefined();
});
