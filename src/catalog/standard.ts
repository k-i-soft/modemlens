import type { CatalogEntry, Category } from './types';

export const CLAC_COMMAND = 'AT+CLAC';

function auto(id: string, command: string, category: Category, needsSim = false, parser?: string): CatalogEntry {
  const entry: CatalogEntry = { id, command, category, phase: 'auto' };
  if (parser) entry.parser = parser;
  if (needsSim) entry.needsSim = true;
  return entry;
}

// Every 'auto' entry must be a read/query form: the automatic scan never writes to the modem.
export const STANDARD_CATALOG: CatalogEntry[] = [
  // identity
  auto('ati', 'ATI', 'identity', false, 'identity'),
  auto('gmi', 'AT+GMI', 'identity', false, 'identity'),
  auto('gmm', 'AT+GMM', 'identity', false, 'identity'),
  auto('gmr', 'AT+GMR', 'identity', false, 'identity'),
  auto('cgmi', 'AT+CGMI', 'identity', false, 'identity'),
  auto('cgmm', 'AT+CGMM', 'identity', false, 'identity'),
  auto('cgmr', 'AT+CGMR', 'identity', false, 'identity'),
  auto('cgsn', 'AT+CGSN', 'identity', false, 'cgsn'),
  auto('gsn', 'AT+GSN', 'identity', false, 'cgsn'),
  // sim
  auto('cpin', 'AT+CPIN?', 'sim', false, 'cpin'),
  auto('cimi', 'AT+CIMI', 'sim', true, 'cimi'),
  auto('crsm-iccid', 'AT+CRSM=176,12258,0,0,10', 'sim', true, 'crsm_iccid'),
  // locks (status queries, mode 2)
  ...['SC', 'PN', 'PU', 'PP', 'PS', 'PF'].map(f =>
    auto(`clck-${f.toLowerCase()}`, `AT+CLCK="${f}",2`, 'locks', false, 'clck')),
  // network
  auto('cops', 'AT+COPS?', 'network', false, 'cops'),
  auto('creg', 'AT+CREG?', 'network', false, 'creg'),
  auto('cgreg', 'AT+CGREG?', 'network', false, 'creg'),
  auto('cereg', 'AT+CEREG?', 'network', false, 'creg'),
  auto('c5greg', 'AT+C5GREG?', 'network', false, 'creg'),
  // power saving: what an IoT module asked the network for (standard read forms, answered from local settings)
  auto('cpsms', 'AT+CPSMS?', 'network', false, 'cpsms'),
  auto('cedrxs', 'AT+CEDRXS?', 'network', false, 'cedrxs'),
  // signal
  auto('csq', 'AT+CSQ', 'signal', false, 'csq'),
  auto('cesq', 'AT+CESQ', 'signal', false, 'cesq'),
  // data
  auto('cgdcont', 'AT+CGDCONT?', 'data', false, 'cgdcont'),
  auto('cgact', 'AT+CGACT?', 'data', false, 'cgact'),
  auto('cgatt', 'AT+CGATT?', 'data', false, 'cgatt'),
  auto('cgpaddr', 'AT+CGPADDR', 'data', false, 'cgpaddr'),
  // voice
  auto('clcc-test', 'AT+CLCC=?', 'voice'),
  auto('clvl', 'AT+CLVL?', 'voice', false, 'clvl'),
  auto('crsl', 'AT+CRSL?', 'voice'),
  auto('calm', 'AT+CALM?', 'voice'),
  auto('clip', 'AT+CLIP?', 'voice', false, 'clip'),
  // other
  auto('cfun', 'AT+CFUN?', 'other', false, 'cfun'),
  auto('cmee', 'AT+CMEE?', 'other', false, 'cmee'),
  auto('cscs', 'AT+CSCS?', 'other', false, 'cscs'),
  auto('cclk', 'AT+CCLK?', 'other', false, 'cclk'),
  auto('ctzu', 'AT+CTZU?', 'other', false, 'ctzu'),
  auto('csca', 'AT+CSCA?', 'other', false, 'csca'),
  // manual: network scan takes minutes and disturbs the registration
  { id: 'cops-scan', command: 'AT+COPS=?', category: 'network', phase: 'manual', timeoutMs: 180000, parser: 'cops_scan' },
];
