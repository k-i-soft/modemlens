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
test.each([
  '#CSURV', '+CPBP', '+CPBG', '+CPBM',
  '+CLIR', '+COLP', '+CNAP', '+CDIP', '+COLR',
  '+CGCMOD', '+CNMPSD', '+CSODCP', '#SGACT', '+QNETDEVCTL', '+CESP', '+CHLD', '+CTFR', '+CNTP', '+QNTP',
  '+CRLA', '+CEAP', '+CERP', '+CUAD', '+CPOL', '+CPLS',
  '+QFLST', '+QFLDS', '+QAUDLOOP', '+QLDTMF', '+QTTS', '+QGPSLOC', '+QMBNCFG', '+CNMA',
])('own CLAC list cannot bring back %s', n => expect(isDiscoverable(n)).toBe(false));
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
test.each([
  'AT+COPS=?', 'at+cops=?', 'AT+ COPS =?', 'AT+COPS?', 'AT+QSCAN=?', 'AT+QOPS=?', 'AT+CPIN?', 'AT+CLCK=?', 'AT+CMGL=?', 'AT+CMGR=?',
  'AT+CPBR=?', 'AT+CUSD?', 'AT+CRSM=?', 'AT+CSIM=?', 'AT+QPOWD=?', 'AT^RESET?', 'AT+CGDATA=?', 'AT+CHUP=?',
])('terminal warns for the denied name in %s', (c) => expect(classifyTerminalCommand(c)).toBe('write'));
test.each(['AT+CREG?', 'AT+CREG=?', 'AT+QENG=?', 'AT^SYSINFO?', 'AT+CGMR', 'AT+GMR', 'AT+CGPADDR', 'AT'])('terminal query %s stays a read', (c) =>
  expect(classifyTerminalCommand(c)).toBe('read'));
test('parse clac', () => expect(parseCommandList(['+CSQ', '&F', 'AT+CREG'])).toEqual(['+CSQ', '&F', '+CREG']));
test('an answer that is no command list gives no names', () =>
  expect(parseCommandList(['AT+CSCA?', '+CSCA: "+41000000000",145', '+CTZU: 1'])).toEqual([]));

// Huawei and Qualcomm firmware answer with one comma list after the prefix instead of one name per line.
test('single-line clac list', () =>
  expect(parseCommandList(['+CLAC:&C,&D,\\S,+CSQ,^SYSCFG,$QCSLOT,^pcmrecord,'])).toEqual(['&C', '&D', '+CSQ', '^SYSCFG', '$QCSLOT', '^pcmrecord']));
test('single-line clac list with spaces', () =>
  expect(parseCommandList(['+CLAC: +CSQ, +CREG'])).toEqual(['+CSQ', '+CREG']));
test('only a +CLAC line is split at commas', () =>
  expect(parseCommandList(['+CSCA: "+41000000000",145'])).toEqual([]));

// Qualcomm and Huawei names whose query form is not worth the risk: diag/BREW mode, saving or restoring settings, passwords, clearing.
test.each(['$QCDMG', '$BREW', '+CSAS', '+CRES', '^OPWORD', '^CPWORD', '^DSFLOWCLR', '$QCCLR'])('%s not discoverable', n =>
  expect(isDiscoverable(n)).toBe(false));

// The real answer of a Huawei K3715 (12d1:1001, firmware 11.113.03.00.00), captured 2026-11-10.
const K3715_CLAC =
  '+CLAC:&C,&D,&E,&F,&S,&V,&W,E,I,L,M,Q,V,X,Z,T,P,\\S,\\V,%V,D,A,H,O,S0,S3,S4,S5,S6,S7,S8,S9,S10,S11,S30,S103,S104,+FCLASS,+ICF,+IFC,+IPR,+GMI,+GMM,+GMR,+GCAP,+GSN,+DR,+DS,+WS46,+CLAC,+CCLK,+CBST,+CRLP,+CV120,+CHSN,+CSSN,+CREG,+CGREG,+CFUN,+GCAP,+CSCS,+CSTA,+CR,+CEER,+CRC,+CMEE,+CGDCONT,+CGDSCONT,+CGTFT,+CGEQREQ,+CGEQMIN,+CGQREQ,+CGQMIN,+CGEQNEG,+CGEREP,+CGPADDR,+CGCLASS,+CGSMS,+CSMS,+CMGF,+CSAS,+CRES,+CSCA,+CSMP,+CSDH,+CSCB,+FDD,+FAR,+FCL,+FIT,+ES,+ESA,+CMOD,+CVHU,+CGDATA,+CSQ,+CBC,+CPAS,+CPIN,+CMEC,+CIND,+CMER,+CGATT,+CGACT,+CGCMOD,+CPBS,+CPBR,+CPBF,+CPBW,+CPMS,+CNMI,+CMGL,+CMGR,+CMGS,+CMSS,+CMGW,+CMGD,+CMGC,+CNMA,+CMMS,+FTS,+FRS,+FTH,+FRH,+FTM,+FRM,+CHUP,+CCFC,+CCUG,+COPS,+CLCK,+CPWD,+CUSD,+CAOC,+CACM,+CAMM,+CPUC,+CCWA,+CHLD,+CIMI,+CGMI,+CGMM,+CGMR,+CGSN,+CNUM,+CSIM,+CRSM,+CCLK,+CLVL,+CMUT,+CLCC,+COPN,+CPOL,+CPLS,+CTZR,+CTZU,+CLAC,+CLIP,+COLP,+CDIP,+CTFR,+CLIR,$QCSIMSTAT,$QCCNMI,$QCCLR,$QCDMG,$QCDMR,$QCDNSP,$QCDNSS,$QCTER,$QCSLOT,$QCPINSTAT,$QCPDPP,$QCPDPLT,$QCPWRDN,$QCDGEN,$BREW,$QCSYSMODE,^CVOICE,^DDSETEX,^pcmrecord,^SYSINFO,^SYSCFG,^IMSICHG,^HS,^DTMF,^EARST,^CDUR,^LIGHT,^CPBR,^CPBW,^HWVER,^HVER,^DSFLOWCLR,^DSFLOWQRY,^DSFLOWRPT,^SPN,^PORTSEL,^CPIN,^PNN,^OPL,^CPNN,^SN,^CARDLOCK,^BOOT,^FHVER,^CURC,^FREQLOCK,^HSDPA,^HSUPA,^CARDMODE,^U2DIAG,^CELLMODE,^HSPA,^SCSIOVERTIME,^SETPID,^ADCTEMP,^YJCX,^OPWORD,^CPWORD,^DISLOG,^ANQUERY,^RSCPCFG,^ECIOCFG,^LIGHT,^FPLMN,^FPLMNCTRL,^OPRTMODE,^DIALMODE,';

test('a Huawei K3715 list gives its own names, without the dangerous ones', () => {
  const names = parseCommandList([K3715_CLAC]);
  expect(names).toEqual(expect.arrayContaining(['+CSQ', '^SYSCFG', '^HWVER', '$QCSIMSTAT', '^pcmrecord']));
  const probed = names.filter((n) => isDiscoverable(n));
  expect(probed).toEqual(expect.arrayContaining(['^SYSCFG', '^HWVER', '^SYSINFO', '$QCSIMSTAT', '+CGDCONT']));
  for (const bad of ['$QCPWRDN', '$QCDMG', '$BREW', '$QCCLR', '^EARST', '^CARDLOCK', '^FREQLOCK', '^BOOT', '^DSFLOWCLR', '^DIALMODE',
    '^OPWORD', '^CPWORD', '^CPBW', '^CPIN', '+CSAS', '+CRES', '+CMGS', '+CMGD', '+CHUP', '+CGDATA', '+COPS', '+CPWD', '+CUSD', '+CSIM', '+CRSM'])
    expect(probed, bad).not.toContain(bad);
});

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
