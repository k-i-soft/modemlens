import { field, splitArgs } from './standard';
import type { Field, Parser } from './standard';

/** Finds `^NAME: args` lines (case-insensitive, the space after the colon is optional). */
function caretPrefixed(lines: string[], name: string): string[] {
  const re = new RegExp(`^\\^${name}:\\s*(.*)$`, 'i');
  const out: string[] = [];
  for (const l of lines) {
    const m = re.exec(l.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

const isInt = (s: string | undefined): s is string => s !== undefined && /^\d+$/.test(s);
const named = (names: Record<string, string>, code: string): string => names[code] ?? `code ${code}`;

const SERVICE: Record<string, string> = {
  '0': 'no service', '1': 'restricted service', '2': 'valid service', '3': 'restricted regional service', '4': 'power saving',
};
const SERVICE_DOMAIN: Record<string, string> = {
  '0': 'no service', '1': 'CS only', '2': 'PS only', '3': 'CS and PS', '4': 'searching', '255': 'not supported',
};
const SYSTEM_MODE: Record<string, string> = {
  '0': 'no service', '1': 'AMPS', '2': 'CDMA', '3': 'GSM/GPRS', '4': 'HDR', '5': 'WCDMA', '6': 'GPS',
  '7': 'GSM/WCDMA', '8': 'CDMA/HDR', '15': 'TD-SCDMA',
};
const SIM_STATE: Record<string, string> = {
  '0': 'invalid', '1': 'valid', '2': 'invalid for CS', '3': 'invalid for PS', '4': 'invalid for CS and PS',
  '240': 'ROM SIM', '255': 'not present',
};
const SUBMODE: Record<string, string> = {
  '0': 'no service', '1': 'GSM', '2': 'GPRS', '3': 'EDGE', '4': 'WCDMA', '5': 'HSDPA', '6': 'HSUPA',
  '7': 'HSDPA and HSUPA', '8': 'TD-SCDMA', '9': 'HSPA+', '17': 'HSPA+ (64QAM)', '18': 'HSPA+ (MIMO)',
};

/**
 * "^SYSINFO:<service>,<domain>,<roaming>,<system mode>,<SIM state>[,<lock state>,<submode>]".
 * The SIM state says whether the network rejected the card, which is the usual reason a Huawei stick keeps searching.
 */
const hwSysinfo: Parser = (r) => {
  const a = caretPrefixed(r.lines, 'SYSINFO')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  if (![0, 1, 2, 3, 4].every((i) => isInt(args[i]))) return [];
  const out: Field[] = [
    field('service', 'Service', named(SERVICE, args[0])),
    field('service_domain', 'Service domain', named(SERVICE_DOMAIN, args[1])),
    field('roaming', 'Roaming', args[2] === '1' ? 'yes' : args[2] === '0' ? 'no' : `code ${args[2]}`),
    field('system_mode', 'System mode', named(SYSTEM_MODE, args[3])),
    field('sim', 'SIM', named(SIM_STATE, args[4])),
  ];
  if (isInt(args[6])) out.push(field('submode', 'Technology', named(SUBMODE, args[6])));
  return out;
};

const NETWORK_MODE: Record<string, string> = { '2': 'automatic', '13': 'GSM only', '14': 'WCDMA only', '16': 'unchanged' };
const ACQUISITION_ORDER: Record<string, string> = { '0': 'automatic', '1': 'GSM first', '2': 'WCDMA first', '3': 'unchanged' };
const ROAMING: Record<string, string> = { '0': 'not allowed', '1': 'allowed', '2': 'unchanged' };
const CFG_DOMAIN: Record<string, string> = { '0': 'CS only', '1': 'PS only', '2': 'CS and PS', '3': 'any', '4': 'unchanged' };

/** "^SYSCFG:<mode>,<acquisition order>,<band mask>,<roaming>,<service domain>": the stored network settings. */
const hwSyscfg: Parser = (r) => {
  const a = caretPrefixed(r.lines, 'SYSCFG')[0];
  if (a === undefined) return [];
  const args = splitArgs(a);
  if (![0, 1, 3, 4].every((i) => isInt(args[i])) || !/^[0-9A-Fa-f]{1,16}$/.test(args[2] ?? '')) return [];
  return [
    field('network_mode', 'Network mode', named(NETWORK_MODE, args[0])),
    field('acquisition_order', 'Acquisition order', named(ACQUISITION_ORDER, args[1])),
    field('band_mask', 'Band mask', args[2].toUpperCase()),
    field('roaming', 'Roaming', named(ROAMING, args[3])),
    field('service_domain', 'Service domain', named(CFG_DOMAIN, args[4])),
  ];
};

/** "^HWVER:"CD25TCPV"". */
const hwHwver: Parser = (r) => {
  const v = caretPrefixed(r.lines, 'HWVER')[0]?.replace(/"/g, '').trim();
  return v && /^[A-Za-z0-9._-]{2,40}$/.test(v) ? [field('hardware_version', 'Hardware version', v)] : [];
};

/** "^CARDMODE:2": 1 is a SIM, 2 a USIM. Anything else says nothing. */
const hwCardmode: Parser = (r) => {
  const v = caretPrefixed(r.lines, 'CARDMODE')[0]?.trim();
  if (v === '1') return [field('card_type', 'Card type', 'SIM')];
  if (v === '2') return [field('card_type', 'Card type', 'USIM')];
  return [];
};

export const HUAWEI_PARSERS: Record<string, Parser> = {
  hw_sysinfo: hwSysinfo, hw_syscfg: hwSyscfg, hw_hwver: hwHwver, hw_cardmode: hwCardmode,
};
