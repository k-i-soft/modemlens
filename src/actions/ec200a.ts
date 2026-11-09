import type { AtResponse } from '../at/engine';
import type { ActionDefinition, ActionRead } from './types';

export const EC200A_PROFILE_ID = 'quectel-ec200a';

/** Rejects quotes and control characters, so that a typed APN cannot change the command it goes into. */
export const APN_PATTERN = /^[A-Za-z0-9.-]{1,63}$/;
export const APN_TYPES = ['IP', 'IPV4V6', 'IPV6'] as const;
export const NETWORK_USB_MODES = ['1', '3'];
export const RNDIS_USB_MODE = '3';
export const RADIO_ON = '1';

export const SLOW_WRITE_MS = 15000;

/** The capture of the last line that matches: an unsolicited line of the same name can come before the answer. */
export function capture(r: AtResponse, pattern: RegExp): string | null {
  if (r.status !== 'ok') return null;
  for (const line of [...r.lines].reverse()) {
    const m = pattern.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

function qcfgRead(name: string): ActionRead {
  return {
    command: `AT+QCFG="${name}"`,
    parse: (r) => capture(r, new RegExp(`^\\+QCFG:\\s*"?${name}"?\\s*,\\s*(\\d+)`, 'i')),
  };
}

/** A typed APN and its type travel as one value: neither part can contain the separator. */
const APN_SEPARATOR = '/';

export function apnValue(type: string, apn: string): string {
  return `${type}${APN_SEPARATOR}${apn}`;
}

export function splitApnValue(value: string): { type: string; apn: string } {
  const at = value.indexOf(APN_SEPARATOR);
  return at < 0 ? { type: value, apn: '' } : { type: value.slice(0, at), apn: value.slice(at + 1) };
}

/** Why an APN cannot be used, or undefined when it can. */
export function apnProblem(apn: string): string | undefined {
  if (APN_PATTERN.test(apn)) return undefined;
  return 'An APN is 1 to 63 letters, digits, dots or hyphens.';
}

export function parseApn(r: AtResponse): string | null {
  if (r.status !== 'ok') return null;
  for (const line of r.lines) {
    const m = /^\+CGDCONT:\s*1\s*,\s*"?([^",]*)"?\s*,\s*"?([^",]*)"?/i.exec(line.trim());
    if (m) return apnValue(m[1].trim().toUpperCase(), m[2].trim());
  }
  return null;
}

/** The fourth field of AT+QNETDEVCTL? says whether the host connection is up. */
function parseData(r: AtResponse): string | null {
  const state = capture(r, /^\+QNETDEVCTL:\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)/i);
  if (state === '1') return 'on';
  return state === '0' ? 'off' : null;
}

/** Not an action of its own, but APN and data changes depend on it. */
export const SIM_READ: ActionRead = {
  command: 'AT+CPIN?',
  parse: (r) => capture(r, /^\+CPIN:\s*(.+)$/i)?.trim().toUpperCase() ?? null,
};

export const ACTIONS: ActionDefinition[] = [
  {
    id: 'apn',
    kind: 'apn',
    label: 'APN',
    summary: 'The access point of data context 1.',
    read: { command: 'AT+CGDCONT?', parse: parseApn },
    choices: [],
    needsRestart: false,
    verified: true,
    warning: 'A wrong APN stops mobile data until it is corrected. No username or password is set.',
    needsSimReady: true,
    afterSuccess: 'Restart the data connection for the new APN to be used.',
  },
  {
    id: 'data',
    kind: 'choice',
    label: 'Data connection',
    summary: 'The connection from the modem to this computer.',
    read: { command: 'AT+QNETDEVCTL?', parse: parseData },
    choices: [
      { value: 'on', label: 'On', command: 'AT+QNETDEVCTL=1,1,1', warning: 'The modem starts the data connection to the computer.' },
      { value: 'off', label: 'Off', command: 'AT+QNETDEVCTL=0,1,1', verified: false, warning: 'The computer loses its data connection through this modem.' },
    ],
    needsRestart: false,
    verified: true,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
    // The answer comes before the connection is up.
    settle: { attempts: 8, delayMs: 1000 },
    needsSimReady: true,
    needsRadioOn: true,
    needsNetworkUsbMode: true,
  },
  {
    id: 'radio',
    kind: 'choice',
    label: 'Radio',
    summary: 'Whether the modem is on the mobile network at all.',
    read: { command: 'AT+CFUN?', parse: (r) => capture(r, /^\+CFUN:\s*(\d+)/i) },
    choices: [
      { value: '1', label: 'On', command: 'AT+CFUN=1', warning: 'The modem returns to the network.' },
      { value: '4', label: 'Off', command: 'AT+CFUN=4', warning: 'The modem leaves the network until it is switched back on.' },
    ],
    needsRestart: false,
    verified: true,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
  },
  {
    id: 'usb-mode',
    kind: 'choice',
    label: 'USB mode',
    summary: 'How the modem presents its network connection to the computer.',
    read: qcfgRead('usbnet'),
    choices: [
      { value: '1', label: 'ECM', command: 'AT+QCFG="usbnet",1' },
      { value: '3', label: 'RNDIS', command: 'AT+QCFG="usbnet",3' },
    ],
    needsRestart: true,
    verified: true,
    warning: 'Takes effect after a restart. The modem then comes back as a different USB device, so it may appear differently in the browser and on the computer.',
  },
  {
    id: 'nat',
    kind: 'choice',
    label: 'NAT',
    summary: 'Whether the modem shares its connection or hands the carrier address to the computer.',
    read: qcfgRead('nat'),
    choices: [
      { value: '0', label: 'Modem does NAT', command: 'AT+QCFG="nat",0', warning: 'Takes effect after a restart. The computer gets a private address from the modem.' },
      {
        value: '1',
        label: 'Carrier address on the computer',
        command: 'AT+QCFG="nat",1',
        strongWarning: true,
        warning: "The computer gets the carrier address directly. The modem's own protection is gone, and inbound connections are limited only by the carrier and this computer's firewall. Takes effect after a restart. The modem may reconnect repeatedly for a while after switching.",
      },
    ],
    needsRestart: true,
    verified: true,
    warning: '',
    needsNetworkUsbMode: true,
  },
  {
    id: 'network-mode',
    kind: 'choice',
    label: 'Network mode',
    summary: 'Which mobile technologies the modem may use.',
    read: qcfgRead('nwscanmode'),
    choices: [
      { value: '0', label: 'Automatic', command: 'AT+QCFG="nwscanmode",0' },
      { value: '1', label: 'GSM only', command: 'AT+QCFG="nwscanmode",1' },
      { value: '2', label: 'WCDMA only', command: 'AT+QCFG="nwscanmode",2' },
      { value: '3', label: 'LTE only', command: 'AT+QCFG="nwscanmode",3' },
    ],
    needsRestart: false,
    verified: false,
    warning: 'Where the chosen technology is not available, the modem has no service until this is changed back.',
  },
  {
    id: 'roaming',
    kind: 'choice',
    label: 'Roaming',
    summary: 'Whether the modem may use networks abroad.',
    read: qcfgRead('roamservice'),
    choices: [
      { value: '1', label: 'Off', command: 'AT+QCFG="roamservice",1,1' },
      { value: '2', label: 'On', command: 'AT+QCFG="roamservice",2,1' },
    ],
    needsRestart: false,
    verified: false,
    warning: 'Roaming can cost money, depending on the SIM contract.',
  },
  {
    id: 'restart',
    kind: 'trigger',
    label: 'Restart',
    summary: 'Restarts the modem.',
    choices: [{ value: 'restart', label: 'Restart', command: 'AT+CFUN=1,1' }],
    needsRestart: false,
    verified: true,
    warning: 'The connection to the modem drops. Reconnect when it is back.',
    timeoutMs: SLOW_WRITE_MS,
  },
];

export function actionById(id: string): ActionDefinition | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** The only place a write command comes from. Null for anything that is not an allowed value. */
export function buildWrite(action: ActionDefinition, value: string): string | null {
  if (action.kind === 'apn') {
    const { type, apn } = splitApnValue(value);
    if (!(APN_TYPES as readonly string[]).includes(type) || apnProblem(apn) !== undefined) return null;
    return `AT+CGDCONT=1,"${type}","${apn}"`;
  }
  return action.choices.find((c) => c.value === value)?.command ?? null;
}

export function isVerified(action: ActionDefinition, value: string): boolean {
  return action.choices.find((c) => c.value === value)?.verified ?? action.verified;
}

export function warningFor(action: ActionDefinition, value: string): string {
  return action.choices.find((c) => c.value === value)?.warning ?? action.warning;
}

export function isStrongWarning(action: ActionDefinition, value: string): boolean {
  return action.choices.find((c) => c.value === value)?.strongWarning === true;
}

/** A value as a person reads it. A readable value outside the allowed ones is still named. */
export function valueLabel(action: ActionDefinition, value: string | null | undefined): string {
  if (value === null || value === undefined) return 'unknown';
  if (action.kind === 'apn') {
    const { type, apn } = splitApnValue(value);
    return `${apn === '' ? 'No APN' : apn} (${type})`;
  }
  return action.choices.find((c) => c.value === value)?.label ?? `Value ${value}`;
}
