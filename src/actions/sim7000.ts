import type { AtResponse } from '../at/engine';
import { SLOW_WRITE_MS, capture, parseApn } from './ec200a';
import type { ActionDefinition } from './types';

export const SIM7000_PROFILE_ID = 'simcom-sim7000';

/** The 20.48 s cycle that a SIM7000E reported on its own. */
export const EDRX_DEFAULT = '0010';

const number = (prefix: string) => (r: AtResponse) => capture(r, new RegExp(`^\\+${prefix}:\\s*(\\d+)`, 'i'));

/** The requested eDRX cycle for LTE-M, or "off" when the modem lists none for it. */
export function parseEdrx(r: AtResponse): string | null {
  if (r.status !== 'ok') return null;
  for (const line of r.lines) {
    const m = /^\+CEDRXS:\s*4\s*,\s*"?([01]{4})"?/i.exec(line.trim());
    if (m) return m[1];
  }
  return 'off';
}

/** No write has run on this model yet, so every action here takes the second confirmation. */
export const SIM7000_ACTIONS: ActionDefinition[] = [
  {
    id: 'apn',
    kind: 'apn',
    label: 'APN',
    summary: 'The access point of data context 1.',
    read: { command: 'AT+CGDCONT?', parse: parseApn },
    choices: [],
    needsRestart: false,
    verified: false,
    warning: 'A wrong APN stops mobile data until it is corrected. No username or password is set.',
    needsSimReady: true,
    afterSuccess: 'Switch the radio off and on for the new APN to be used.',
  },
  {
    id: 'app-data',
    kind: 'choice',
    label: 'Modem data',
    summary: "The modem's own internet connection, which ping uses.",
    read: { command: 'AT+CNACT?', parse: number('CNACT') },
    choices: [
      { value: '1', label: 'On', command: 'AT+CNACT=1', warning: 'The modem opens its own data connection. This uses a little mobile data.' },
      { value: '0', label: 'Off', command: 'AT+CNACT=0', warning: "The modem closes its own data connection." },
    ],
    needsRestart: false,
    verified: false,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
    settle: { attempts: 6, delayMs: 1000 },
    needsSimReady: true,
    needsRadioOn: true,
  },
  {
    id: 'radio',
    kind: 'choice',
    label: 'Radio',
    summary: 'Whether the modem is on the mobile network at all.',
    read: { command: 'AT+CFUN?', parse: number('CFUN') },
    choices: [
      { value: '1', label: 'On', command: 'AT+CFUN=1', warning: 'The modem returns to the network.' },
      { value: '4', label: 'Off', command: 'AT+CFUN=4', warning: 'The modem leaves the network until it is switched back on.' },
    ],
    needsRestart: false,
    verified: false,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
  },
  {
    id: 'network-mode',
    kind: 'choice',
    label: 'Network mode',
    summary: 'Which mobile technologies the modem may use.',
    read: { command: 'AT+CNMP?', parse: number('CNMP') },
    choices: [
      { value: '2', label: 'Automatic', command: 'AT+CNMP=2' },
      { value: '13', label: 'GSM only', command: 'AT+CNMP=13' },
      { value: '38', label: 'LTE only', command: 'AT+CNMP=38' },
      { value: '51', label: 'GSM and LTE', command: 'AT+CNMP=51' },
    ],
    needsRestart: false,
    verified: false,
    warning: 'Where the chosen technology is not available, the modem has no service until this is changed back.',
  },
  {
    id: 'lte-mode',
    kind: 'choice',
    label: 'LTE mode',
    summary: 'Which kind of IoT LTE the modem looks for: LTE-M, NB-IoT or both.',
    read: { command: 'AT+CMNB?', parse: number('CMNB') },
    choices: [
      { value: '1', label: 'LTE-M', command: 'AT+CMNB=1' },
      { value: '2', label: 'NB-IoT', command: 'AT+CMNB=2' },
      { value: '3', label: 'LTE-M and NB-IoT', command: 'AT+CMNB=3' },
    ],
    needsRestart: false,
    verified: false,
    warning: 'Not every SIM and operator offers both. With the wrong one the modem finds no network until this is changed back.',
  },
  {
    id: 'psm',
    kind: 'choice',
    label: 'Power saving (PSM)',
    summary: 'Whether the modem may fall into deep sleep between data transfers.',
    read: { command: 'AT+CPSMS?', parse: number('CPSMS') },
    choices: [
      { value: '0', label: 'Off', command: 'AT+CPSMS=0', warning: 'The modem stays reachable all the time. It uses more power.' },
      {
        value: '1',
        label: 'On',
        command: 'AT+CPSMS=1',
        strongWarning: true,
        warning: 'In deep sleep the modem stops answering, also to this tool, until it wakes up by itself or is woken by its board. Switch it on only if your device knows how to wake it.',
      },
    ],
    needsRestart: false,
    verified: false,
    warning: '',
  },
  {
    id: 'edrx',
    kind: 'choice',
    label: 'eDRX',
    summary: 'Whether the modem listens to the network only every few seconds to save power (LTE-M).',
    read: { command: 'AT+CEDRXS?', parse: parseEdrx },
    choices: [
      { value: 'off', label: 'Off', command: 'AT+CEDRXS=0,4', warning: 'The modem listens all the time. Incoming data arrives faster, and it uses more power.' },
      { value: EDRX_DEFAULT, label: 'On, 20.48 s', command: `AT+CEDRXS=1,4,"${EDRX_DEFAULT}"`, warning: 'Incoming data can take up to 20 seconds to arrive.' },
    ],
    needsRestart: false,
    verified: false,
    warning: '',
  },
  {
    id: 'restart',
    kind: 'trigger',
    label: 'Restart',
    summary: 'Restarts the modem.',
    choices: [{ value: 'restart', label: 'Restart', command: 'AT+CFUN=1,1' }],
    needsRestart: false,
    verified: false,
    warning: 'The connection to the modem drops. Reconnect when it is back.',
    timeoutMs: SLOW_WRITE_MS,
  },
];
