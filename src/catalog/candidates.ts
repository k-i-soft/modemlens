/**
 * Extended command names the deep scan tries when the modem cannot list its own commands (AT+CLAC).
 * Written from the public 3GPP TS 27.007 / 27.005 command sets and commonly documented vendor families.
 * Every name still goes through isDiscoverable at run time, and only its `=?` and `?` forms are ever sent.
 */
const STANDARD_3GPP = [
  // identification, status, general
  '+CGMI', '+CGMM', '+CGMR', '+CGSN', '+CIMI', '+CMUX', '+CMEE', '+CMER', '+CFUN', '+CPAS', '+CIND',
  '+CEER', '+CRC', '+CR', '+CSNS', '+CVHU', '+CMOD', '+CBST', '+CRLP', '+CLAN', '+CLAE',
  '+GMI', '+GMM', '+GMR', '+GSN', '+GCAP', '+GOI', '+GCI', '+IPR', '+ICF', '+IFC', '+WS46', '+CSCS',
  // call related
  '+CCWA', '+CCFC', '+CLIP', '+CLCC', '+CSSN',
  '+CAOC', '+CACM', '+CAMM', '+CPUC', '+CCUG', '+CMUT', '+CLVL', '+CRSL', '+CALM',
  '+CVMOD', '+CSVM', '+CSTA', '+CSDF', '+CSTF', '+CSGT', '+CEN', '+CHSN',
  // signal, time, registration
  '+CSQ', '+CESQ', '+CREG', '+CGREG', '+CEREG', '+C5GREG', '+CSCON', '+CTZR', '+CTZU', '+CCLK',
  '+CALA', '+CALD', '+CAPD', '+CTZDST', '+CEMODE', '+CIPCA', '+CPSMS', '+CEDRXS', '+CEDRXRDP',
  '+CCIOTOPT', '+CRCES', '+CNEC', '+CPNER', '+CABTSR', '+CABTRDP', '+CEUS', '+CATR', '+CPSMRDP',
  // packet domain
  '+CGATT', '+CGACT', '+CGDCONT', '+CGDSCONT', '+CGTFT', '+CGEQREQ', '+CGEQMIN', '+CGEQNEG',
  '+CGQREQ', '+CGQMIN', '+CGEREP', '+CGPADDR', '+CGCLASS', '+CGSMS', '+CGAUTO',
  '+CGEQOS', '+CGEQOSRDP', '+CGCONTRDP', '+CGSCONTRDP', '+CGTFTRDP', '+CGPIAF', '+CGAPNRC',
  '+CGMOD', '+CRTDCP', '+CGDNS', '+CGEVEV',
  // SIM, SIM toolkit, user-to-user signalling (read forms only)
  '+CSUS', '+CUSATD', '+CUSATP', '+CUSATS', '+CUUS1',
  // SMS settings
  '+CSMS', '+CPMS', '+CMGF', '+CSCA', '+CSMP', '+CSDH', '+CSCB', '+CNMI', '+CMMS',
  // other commonly documented
  '+CLTS', '+CNTPCID', '+CBC', '+CBAND', '+CPSI', '+CNSMOD', '+CNMP', '+CNBP', '+CRM',
];

const QUECTEL = [
  '+QCFG', '+QCCID', '+QSPN', '+QNWINFO', '+QENG', '+QCSQ', '+QTEMP', '+QPINC', '+QGMR', '+QINISTAT',
  '+QSIMSTAT', '+QSIMDET', '+QSIMVOL', '+QNWPREFCFG', '+QNETDEVSTATUS', '+QNETRC',
  '+QURCCFG', '+QDEVCDC', '+QADC', '+QBLACKCELL', '+QCAINFO', '+QENDC',
  '+QRSRP', '+QRSRQ', '+QSINR', '+QLTS', '+QAUDCFG', '+QAUDMOD', '+QDAI',
  '+QSIDET', '+QMIC', '+QRXGAIN', '+QTONEDET', '+QISTATE', '+QICFG', '+QIDNSCFG',
  '+QIMUX', '+QIGETERROR', '+QMTCFG', '+QHTTPCFG', '+QFTPCFG', '+QSSLCFG',
  '+QGPS', '+QGPSCFG', '+QGPSXTRA', '+QCLCC', '+QSMSCFG', '+QBAND', '+QSCLK',
  '+QLEDMODE', '+QLEDCFG', '+QGDCNT', '+QCTCFG', '+QDSIM', '+QTHERMAL', '+QCELLINFO', '+QIND',
  '+QUIMSLOT', '+QSTK', '+QSTKCFG', '+QSIMCFG', '+QPRODNO', '+QDEVINFO', '+QSYSMODE', '+QAPN',
  '+QMAP', '+QUSBCFG', '+QGDEFCONT',
];

const OTHER_VENDORS = [
  // ^ family
  '^SYSINFO', '^SYSINFOEX', '^SYSCFG', '^SYSCFGEX', '^CARDMODE', '^HCSQ', '^RSSI', '^MODE', '^CURC',
  '^HWVER', '^SIMST', '^SRVST', '^LTERSRP', '^TIME', '^SPN', '^ICCID', '^TEMP', '^PREFMODE',
  // # family
  '#SERVINFO', '#MONI', '#RFSTS', '#TEMPMON', '#GPIO', '#ADC', '#NITZ', '#SIMDET',
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
