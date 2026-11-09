/**
 * Extended command names the deep scan tries when the modem cannot list its own commands (AT+CLAC).
 * Written from the public 3GPP TS 27.007 / 27.005 command sets and commonly documented vendor families.
 * Every name still goes through isDiscoverable at run time, and only its `=?` and `?` forms are ever sent.
 */
const STANDARD_3GPP = [
  // identification, status, general
  '+CGMI', '+CGMM', '+CGMR', '+CGSN', '+CIMI', '+CMUX', '+CMEE', '+CMER', '+CFUN', '+CPAS', '+CIND',
  '+CEER', '+CRC', '+CR', '+CSNS', '+CVHU', '+CMOD', '+CBST', '+CRLP', '+CESP', '+CLAN', '+CLAE',
  '+GMI', '+GMM', '+GMR', '+GSN', '+GCAP', '+GOI', '+GCI', '+IPR', '+ICF', '+IFC', '+WS46', '+CSCS',
  // call related
  '+CHLD', '+CCWA', '+CCFC', '+CLIP', '+CLIR', '+CLCC', '+COLP', '+COLR', '+CDIP', '+CNAP', '+CSSN',
  '+CAOC', '+CACM', '+CAMM', '+CPUC', '+CCUG', '+CTFR', '+CMUT', '+CLVL', '+CRSL', '+CALM',
  '+CVMOD', '+CSVM', '+CSTA', '+CSDF', '+CSTF', '+CSGT', '+CEN', '+CHSN',
  // signal, time, registration
  '+CSQ', '+CESQ', '+CREG', '+CGREG', '+CEREG', '+C5GREG', '+CSCON', '+CTZR', '+CTZU', '+CCLK',
  '+CALA', '+CALD', '+CAPD', '+CTZDST', '+CEMODE', '+CIPCA', '+CPSMS', '+CEDRXS', '+CEDRXRDP',
  '+CCIOTOPT', '+CRCES', '+CNEC', '+CPNER', '+CABTSR', '+CABTRDP', '+CEUS', '+CATR', '+CPSMRDP',
  // packet domain
  '+CGATT', '+CGACT', '+CGDCONT', '+CGDSCONT', '+CGTFT', '+CGEQREQ', '+CGEQMIN', '+CGEQNEG',
  '+CGQREQ', '+CGQMIN', '+CGEREP', '+CGPADDR', '+CGCLASS', '+CGSMS', '+CGAUTO', '+CGCMOD',
  '+CGEQOS', '+CGEQOSRDP', '+CGCONTRDP', '+CGSCONTRDP', '+CGTFTRDP', '+CGPIAF', '+CGAPNRC',
  '+CGMOD', '+CNMPSD', '+CRTDCP', '+CSODCP', '+CGDNS', '+CGEVEV',
  // SIM and phonebook (read forms only)
  '+CUAD', '+CEAP', '+CERP', '+CRLA', '+CSUS', '+CUSATD', '+CUSATP', '+CUSATS', '+CUUS1',
  '+CPOL', '+CPLS', '+CPBP', '+CPBG', '+CPBM', 
  // SMS settings
  '+CSMS', '+CPMS', '+CMGF', '+CSCA', '+CSMP', '+CSDH', '+CSCB', '+CNMI', '+CMMS', '+CNMA',
  // other commonly documented
  '+CLTS', '+CNTP', '+CNTPCID', '+CBC', '+CBAND', '+CPSI', '+CNSMOD', '+CNMP', '+CNBP', '+CRM',
];

const QUECTEL = [
  '+QCFG', '+QCCID', '+QSPN', '+QNWINFO', '+QENG', '+QCSQ', '+QTEMP', '+QPINC', '+QGMR', '+QINISTAT',
  '+QSIMSTAT', '+QSIMDET', '+QSIMVOL', '+QNWPREFCFG', '+QNETDEVSTATUS', '+QNETDEVCTL', '+QNETRC',
  '+QURCCFG', '+QDEVCDC', '+QMBNCFG', '+QADC', '+QBLACKCELL', '+QCAINFO', '+QENDC',
  '+QRSRP', '+QRSRQ', '+QSINR', '+QLTS', '+QNTP', '+QAUDCFG', '+QAUDMOD', '+QAUDLOOP', '+QDAI',
  '+QSIDET', '+QMIC', '+QRXGAIN', '+QLDTMF', '+QTONEDET', '+QTTS', '+QISTATE', '+QICFG', '+QIDNSCFG',
  '+QIMUX', '+QIGETERROR', '+QMTCFG', '+QHTTPCFG', '+QFTPCFG', '+QSSLCFG', '+QFLST', '+QFLDS',
  '+QGPS', '+QGPSCFG', '+QGPSLOC', '+QGPSXTRA', '+QCLCC', '+QSMSCFG', '+QBAND', '+QSCLK',
  '+QLEDMODE', '+QLEDCFG', '+QGDCNT', '+QCTCFG', '+QDSIM', '+QTHERMAL', '+QCELLINFO', '+QIND',
  '+QUIMSLOT', '+QSTK', '+QSTKCFG', '+QSIMCFG', '+QPRODNO', '+QDEVINFO', '+QSYSMODE', '+QAPN',
  '+QMAP', '+QUSBCFG', '+QGDEFCONT',
];

const OTHER_VENDORS = [
  // ^ family
  '^SYSINFO', '^SYSINFOEX', '^SYSCFG', '^SYSCFGEX', '^CARDMODE', '^HCSQ', '^RSSI', '^MODE', '^CURC',
  '^HWVER', '^SIMST', '^SRVST', '^LTERSRP', '^TIME', '^SPN', '^ICCID', '^TEMP', '^PREFMODE',
  // # family
  '#SERVINFO', '#MONI', '#CSURV', '#RFSTS', '#TEMPMON', '#GPIO', '#ADC', '#NITZ', '#SIMDET', '#SGACT',
  '#BND', '#SELINT', '#CPUMODE', '#USBCFG', '#PORTCFG',
  // $ family
  '$QCSIMSTAT', '$QCBANDPREF', '$QCRSRP', '$QCSYSMODE', '$QCSLOT', '$QCAPNE', '$QCVOLT', 
  '$MYTYPE', '$MYSYSINFO', '$MYGMR', '$MYCCID', '$MYBAND',
  // ! family
  '!GSTATUS', '!GCAP', '!GMR', '!GBAND', '!GVER', '!GDATAD', '!PCINFO', '!SELRAT', '!BAND', '!LTEINFO',
  '!PCTEMP', '!PCVOLT', '!USBSPEED', '!SIMDET', '!PLMN', '!SKU',
  // * family
  '*CNTI', '*BAND', '*CSQ', '*ENG', '*TEMP', '*VER', '*MODE',
];

/** Deduplicated, upper case, in the order written above. */
export const CANDIDATE_COMMANDS: string[] = [
  ...new Set([...STANDARD_3GPP, ...QUECTEL, ...OTHER_VENDORS].map(n => n.toUpperCase())),
];
