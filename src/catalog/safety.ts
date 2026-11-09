/** Safety rules deciding which commands may ever be probed or sent without an explicit user action. */

// Substring rules: reset/power/bootloader, firmware/NV, scans, SMS/phonebook, PIN/lock/password families.
const DENY_PATTERN = new RegExp(
  [
    'RESET', 'POW', 'PWR', 'OFF', 'DOWN', 'ERASE', 'DEL', 'FOTA', 'UPDATE', 'FLASH', 'FACTORY', 'RST', 'DFU', 'DIAL',
    'BOOT', 'SHDN', 'HALT', 'SMSO', 'FWUPD', 'FWINST', 'FWSWITCH', 'SCAN', 'NVW', 'NVFW', 'PRTPARA',
    'CMG[SDRLWC]', 'CMSS', 'HCMG', 'SMG[RLS]', 'CPB[RWFS]', 'CPIN', 'LOCK', 'CPWD|SPWD',
  ].join('|'),
  'i',
);

// Short power-off style names such as ^MSO, ^SMSO.
const DENY_SHAPE = /^.MSO$/i;

const DENY_FIXED = new Set([
  '+CPOF', '+COPS', '+QSCAN', '+QOPS', '+QCOPS', '+CPIN', '+CLCK', '+CPWD',
  '+CMGS', '+CMGD', '+CMGR', '+CMGL', '+CPBR', '+CPBW',
  '+CGDATA', '+CIICR', '+CIPSHUT', '+NETOPEN', '+NETCLOSE', '+QIACT', '+QIDEACT', '$QCRMCALL',
  '+CHUP', '+QHUP',
  '+CSIM', '+CRSM', '+CCHO', '+CGLA',
  '^SLCK', '+QMGDA', '+CNUM', '+CUSD',
]);

// A name is one prefix character followed by letters, digits or underscores, nothing else.
const NAME_SHAPE = /^[+$^#!%*][A-Z0-9_]+$/;

/** Turns lines of an AT+CLAC answer into bare command names ("AT+CREG" -> "+CREG"). */
export function parseCommandList(lines: string[]): string[] {
  const names: string[] = [];
  for (const raw of lines) {
    const name = raw.trim().replace(/^AT(?=[+$^#!%*&])/i, '');
    if (name) names.push(name);
  }
  return names;
}

/** Only well-formed extended names (+ $ ^ # ! % * prefix) that are not on a deny list may be probed. Case-insensitive; whitespace is rejected, not trimmed. */
export function isDiscoverable(name: string, extraDeny: string[] = []): boolean {
  const n = name.toUpperCase();
  if (!NAME_SHAPE.test(n)) return false;
  if (DENY_PATTERN.test(n) || DENY_SHAPE.test(n)) return false;
  if (DENY_FIXED.has(n)) return false;
  if (extraDeny.some(d => d.trim().toUpperCase() === n)) return false;
  return true;
}

/** Read-only probe forms: [test form, read form]. */
export function discoveryForms(name: string): [string, string] {
  return [`AT${name}=?`, `AT${name}?`];
}

const READ_QUERY = /^AT[+$^#!%*][A-Z0-9_]+(\?|=\?)$/;
const READ_BARE = /^(AT|ATI\d?|AT\+(CSQ|CESQ|CIMI|CGSN|GSN|GMI|GMM|GMR|CGMI|CGMM|CGMR|CGPADDR))$/;

/** Conservative: anything not clearly a query is a write, and chained commands are always writes. */
export function classifyTerminalCommand(cmd: string): 'read' | 'write' {
  const c = cmd.trim().toUpperCase().replace(/\s+/g, '');
  if (c.includes(';')) return 'write';
  return READ_QUERY.test(c) || READ_BARE.test(c) ? 'read' : 'write';
}
