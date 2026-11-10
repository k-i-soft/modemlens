import { COPS_RAT_SHORT, field } from './standard';
import type { Field, Parser, Sensitivity } from './standard';

/** A longer value is not something a modem reports; a crafted capture must not fill the screen with it. */
const MAX_VALUE_LENGTH = 200;

type Read = (value: string) => string | undefined;
/** Source name or names, first one present wins; field key; label; how sensitive; how to read the value. */
type Spec = [source: string | string[], key: string, label: string, sensitive?: Sensitivity, read?: Read];

/** "-86dBm", "-5.0dB", "20MHz", a clamped ">=-51dBm", and "-86 dBm  54 asu". */
const NUMBER_WITH_UNIT = /^[<>]?=?\s*([+-]?\d+(?:\.\d+)?)\s*[a-z]*(?:\s+\d+\s*asu)?$/i;
const number: Read = (v) => NUMBER_WITH_UNIT.exec(v)?.[1];

/** "DL:1850 UL:19850", or a plain number for the downlink. */
const channel = (direction: 'DL' | 'UL'): Read => (v) => {
  const m = new RegExp(`${direction}:\\s*(\\d+)`, 'i').exec(v)?.[1];
  return m ?? (direction === 'DL' && /^\d+$/.test(v) ? v : undefined);
};

const technology: Read = (v) => (Object.hasOwn(COPS_RAT_SHORT, v) ? COPS_RAT_SHORT[v] : v);

const usable = (raw: string): string | undefined => {
  const v = raw.trim();
  return v !== '' && v.length <= MAX_VALUE_LENGTH ? v : undefined;
};

function extract(values: Map<string, string>, specs: Spec[]): Field[] {
  return specs.flatMap(([source, key, label, sensitive = 'none', read]) => {
    const raw = [source].flat().map((name) => values.get(name)).find((v) => v !== undefined);
    const value = raw === undefined ? undefined : read ? read(raw) : raw;
    return value ? [field(key, label, value, sensitive)] : [];
  });
}

/**
 * The plain child elements of a `<response>` document. Null for anything else, including an `<error>`
 * document. A capture is untrusted, so a document type (which could declare entities) is not accepted.
 */
function responseTags(body: string): Map<string, string> | null {
  if (/<!DOCTYPE/i.test(body)) return null;
  const doc = new DOMParser().parseFromString(body.trim(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || doc.documentElement?.tagName !== 'response') return null;
  const tags = new Map<string, string>();
  for (const element of Array.from(doc.documentElement.children)) {
    if (element.children.length > 0) continue;
    const value = usable(element.textContent ?? '');
    if (value !== undefined && !tags.has(element.tagName)) tags.set(element.tagName, value);
  }
  return tags;
}

const xmlParser = (specs: Spec[]): Parser => (r) => {
  const tags = responseTags(r.lines.join('\n'));
  return tags ? extract(tags, specs) : [];
};

const HILINK_INFORMATION: Spec[] = [
  ['DeviceName', 'model', 'Model'],
  ['SoftwareVersion', 'firmware', 'Firmware'],
  ['HardwareVersion', 'hardware', 'Hardware'],
  ['WebUIVersion', 'webui_version', 'Web interface'],
  ['SerialNumber', 'serial', 'Serial number', 'serial'],
  ['Imei', 'imei', 'IMEI', 'imei'],
  ['Imsi', 'imsi', 'IMSI', 'imsi'],
  ['Iccid', 'iccid', 'ICCID', 'iccid'],
  ['Msisdn', 'msisdn', 'Phone number', 'msisdn'],
  ['MacAddress1', 'mac1', 'MAC address 1', 'serial'],
  ['MacAddress2', 'mac2', 'MAC address 2', 'serial'],
  ['WanIPAddress', 'wan_ip', 'WAN IP', 'ip'],
  ['WanIPv6Address', 'wan_ipv6', 'WAN IPv6', 'ip'],
  ['wan_dns_address', 'wan_dns', 'DNS', 'ip'],
  ['wan_ipv6_dns_address', 'wan_ipv6_dns', 'IPv6 DNS', 'ip'],
  ['ProductFamily', 'product_family', 'Product family'],
  ['Classify', 'classify', 'Device class'],
  ['supportmode', 'support_mode', 'Supported modes'],
  ['workmode', 'work_mode', 'Work mode'],
  ['Mccmnc', 'home_plmn', 'Home PLMN'],
  ['uptime', 'uptime', 'Uptime (s)'],
];

const HILINK_SIGNAL: Spec[] = [
  ['rsrp', 'rsrp_dbm', 'RSRP (dBm)', 'none', number],
  ['rsrq', 'rsrq_db', 'RSRQ (dB)', 'none', number],
  ['rssi', 'rssi_dbm', 'RSSI (dBm)', 'none', number],
  ['sinr', 'sinr_db', 'SINR (dB)', 'none', number],
  ['earfcn', 'earfcn', 'EARFCN', 'none', channel('DL')],
  ['earfcn', 'ul_earfcn', 'Uplink EARFCN', 'none', channel('UL')],
  ['dlbandwidth', 'dl_bandwidth_mhz', 'Downlink width (MHz)', 'none', number],
  ['ulbandwidth', 'ul_bandwidth_mhz', 'Uplink width (MHz)', 'none', number],
  ['dlfrequency', 'dl_frequency_khz', 'Downlink (kHz)', 'none', number],
  ['ulfrequency', 'ul_frequency_khz', 'Uplink (kHz)', 'none', number],
  ['band', 'band', 'Band'],
  ['plmn', 'plmn', 'PLMN'],
  ['mode', 'mode', 'Mode'],
  ['cell_id', 'cell_id', 'Cell ID', 'location'],
  ['pci', 'pci', 'PCI', 'location'],
  ['tac', 'tac', 'TAC', 'location'],
  ['lac', 'lac', 'LAC', 'location'],
  ['enodeb_id', 'enodeb_id', 'eNodeB', 'location'],
  ['nei_cellid', 'nei_cellid', 'Neighbour cells', 'location'],
];

const HILINK_PLMN: Spec[] = [
  [['FullName', 'ShortName'], 'operator', 'Operator'],
  ['Numeric', 'plmn', 'PLMN'],
  ['Rat', 'rat', 'Access technology', 'none', technology],
  ['Spn', 'spn', 'Service provider'],
  ['State', 'state', 'Operator state'],
];

/** Unverified: no real capture yet, so every value has its usual alternative names and none is required. */
const ZTE_STATUS: Spec[] = [
  [['modem_model', 'model'], 'model', 'Model'],
  ['web_version', 'software', 'Software version'],
  [['cr_version', 'wa_inner_version'], 'firmware', 'Firmware'],
  [['hw_version', 'hardware_version'], 'hardware', 'Hardware'],
  ['imei', 'imei', 'IMEI', 'imei'],
  [['imsi', 'sim_imsi'], 'imsi', 'IMSI', 'imsi'],
  [['iccid', 'ziccid'], 'iccid', 'ICCID', 'iccid'],
  ['msisdn', 'msisdn', 'Phone number', 'msisdn'],
  ['mac_address', 'mac1', 'MAC address 1', 'serial'],
  ['wan_ipaddr', 'wan_ip', 'WAN IP', 'ip'],
  ['ipv6_wan_ipaddr', 'wan_ipv6', 'WAN IPv6', 'ip'],
  ['network_provider', 'operator', 'Operator'],
  ['network_type', 'work_mode', 'Work mode'],
  ['lte_rsrp', 'rsrp_dbm', 'RSRP (dBm)', 'none', number],
  ['lte_rsrq', 'rsrq_db', 'RSRQ (dB)', 'none', number],
  [['lte_snr', 'Z_SINR'], 'sinr_db', 'SINR (dB)', 'none', number],
  ['rssi', 'rssi_dbm', 'RSSI (dBm)', 'none', number],
  [['cell_id', 'Z_CELL_ID'], 'cell_id', 'Cell ID', 'location'],
  ['lac_code', 'lac', 'LAC', 'location'],
];

const zteStatus: Parser = (r) => {
  const data: unknown = JSON.parse(r.lines.join('\n'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const values = new Map<string, string>();
  for (const [name, raw] of Object.entries(data)) {
    const value = typeof raw === 'string' || typeof raw === 'number' ? usable(String(raw)) : undefined;
    if (value !== undefined) values.set(name, value);
  }
  return extract(values, ZTE_STATUS);
};

const hilinkInformation: Parser = (r) => {
  const fields = xmlParser(HILINK_INFORMATION)(r);
  return fields.length > 0 ? [field('manufacturer', 'Manufacturer', 'Huawei'), ...fields] : [];
};

export const WEB_PARSERS: Record<string, Parser> = {
  hilink_information: hilinkInformation,
  hilink_signal: xmlParser(HILINK_SIGNAL),
  hilink_plmn: xmlParser(HILINK_PLMN),
  zte_status: zteStatus,
};

export const WEB_PARSER_NAMES: string[] = Object.keys(WEB_PARSERS);
