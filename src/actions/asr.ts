import { SLOW_WRITE_MS, capture, parseApn } from './ec200a';
import type { ActionDefinition } from './types';

export const ASR_PROFILE_ID = 'asr-1286-4e3c';

/** Whether data context 1 is active on the mobile network. */
function parseContext(r: Parameters<typeof capture>[0]): string | null {
  const state = capture(r, /^\+CGACT:\s*1\s*,\s*(\d+)/i);
  if (state === '1') return 'on';
  return state === '0' ? 'off' : null;
}

/** No write has run on this model yet, so every action here takes the second confirmation. */
export const ASR_ACTIONS: ActionDefinition[] = [
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
    afterSuccess: 'Restart the data connection for the new APN to be used.',
  },
  {
    id: 'data-context',
    kind: 'choice',
    label: 'Data connection',
    summary: 'Whether data context 1 is active on the mobile network.',
    read: { command: 'AT+CGACT?', parse: parseContext },
    choices: [
      { value: 'on', label: 'On', command: 'AT+CGACT=1,1', warning: 'The modem activates data context 1.' },
      { value: 'off', label: 'Off', command: 'AT+CGACT=0,1', warning: 'This modem connects by itself, so it may turn data back on after you switch it off.', afterSuccess: 'This modem may reconnect by itself shortly.' },
    ],
    needsRestart: false,
    verified: false,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
    needsSimReady: true,
    needsRadioOn: true,
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
    verified: false,
    warning: '',
    timeoutMs: SLOW_WRITE_MS,
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
