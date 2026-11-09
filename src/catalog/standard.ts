import type { CatalogEntry, Category } from './types';

export const CLAC_COMMAND = 'AT+CLAC';

function auto(id: string, command: string, category: Category, needsSim = false): CatalogEntry {
  const entry: CatalogEntry = { id, command, category, phase: 'auto' };
  if (needsSim) entry.needsSim = true;
  return entry;
}

// Every 'auto' entry must be a read/query form: the automatic scan never writes to the modem.
export const STANDARD_CATALOG: CatalogEntry[] = [
  // identity
  auto('ati', 'ATI', 'identity'),
  auto('gmi', 'AT+GMI', 'identity'),
  auto('gmm', 'AT+GMM', 'identity'),
  auto('gmr', 'AT+GMR', 'identity'),
  auto('cgmi', 'AT+CGMI', 'identity'),
  auto('cgmm', 'AT+CGMM', 'identity'),
  auto('cgmr', 'AT+CGMR', 'identity'),
  auto('cgsn', 'AT+CGSN', 'identity'),
  auto('gsn', 'AT+GSN', 'identity'),
  // sim
  auto('cpin', 'AT+CPIN?', 'sim'),
  auto('cimi', 'AT+CIMI', 'sim', true),
  auto('crsm-iccid', 'AT+CRSM=176,12258,0,0,10', 'sim', true),
  // locks (status queries, mode 2)
  ...['SC', 'PN', 'PU', 'PP', 'PS', 'PF'].map(f =>
    auto(`clck-${f.toLowerCase()}`, `AT+CLCK="${f}",2`, 'locks')),
  // network
  auto('cops', 'AT+COPS?', 'network'),
  auto('creg', 'AT+CREG?', 'network'),
  auto('cgreg', 'AT+CGREG?', 'network'),
  auto('cereg', 'AT+CEREG?', 'network'),
  auto('c5greg', 'AT+C5GREG?', 'network'),
  // signal
  auto('csq', 'AT+CSQ', 'signal'),
  auto('cesq', 'AT+CESQ', 'signal'),
  // data
  auto('cgdcont', 'AT+CGDCONT?', 'data'),
  auto('cgact', 'AT+CGACT?', 'data'),
  auto('cgatt', 'AT+CGATT?', 'data'),
  auto('cgpaddr', 'AT+CGPADDR', 'data'),
  // voice
  auto('clcc-test', 'AT+CLCC=?', 'voice'),
  auto('clvl', 'AT+CLVL?', 'voice'),
  auto('crsl', 'AT+CRSL?', 'voice'),
  auto('calm', 'AT+CALM?', 'voice'),
  auto('clip', 'AT+CLIP?', 'voice'),
  // other
  auto('cfun', 'AT+CFUN?', 'other'),
  auto('cmee', 'AT+CMEE?', 'other'),
  auto('cscs', 'AT+CSCS?', 'other'),
  auto('cclk', 'AT+CCLK?', 'other'),
  auto('ctzu', 'AT+CTZU?', 'other'),
  auto('csca', 'AT+CSCA?', 'other'),
  // manual: network scan takes minutes and disturbs the registration
  { id: 'cops-scan', command: 'AT+COPS=?', category: 'network', phase: 'manual', timeoutMs: 180000 },
];
