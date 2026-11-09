import { EC200A_PROFILE_ID, NETWORK_USB_MODES, RADIO_ON, RNDIS_USB_MODE } from './ec200a';
import type { ActionDefinition } from './types';

export interface ActionsState {
  connected: boolean;
  imported: boolean;
  /** The profile the scan matched. Undefined until it has. */
  profileId?: string;
  scanning: boolean;
  /** Another action, or the read of the current values, is under way. */
  busy: boolean;
  /** Current values: null when they could not be read. */
  sim: string | null;
  radio: string | null;
  usbMode: string | null;
}

export interface Availability {
  enabled: boolean;
  hidden: boolean;
  reason?: string;
}

const REQUIRES_SIM = new Set(['apn', 'data']);
const REQUIRES_NETWORK_USB = new Set(['nat', 'data']);
const RNDIS_ON_MAC = 'RNDIS is not offered on a Mac: macOS has no driver for it, so the modem would not become a network adapter.';

const blocked = (reason: string): Availability => ({ enabled: false, hidden: false, reason });
const hidden = (reason: string): Availability => ({ enabled: false, hidden: true, reason });

/** Why this modem cannot use actions at all right now, or undefined when it can. */
export function sessionBlock(state: ActionsState): string | undefined {
  if (state.imported) return 'This report was imported from a file, so there is no modem to change.';
  if (!state.connected) return 'Actions need a connected modem.';
  if (state.profileId === undefined && state.scanning) return 'Waiting for the automatic scan to identify the modem.';
  if (state.profileId !== EC200A_PROFILE_ID) return 'Actions are only available on a Quectel EC200A.';
  if (state.scanning) return 'A scan is running. Actions wait for it, so that no command lands between the scan commands.';
  return undefined;
}

/**
 * Whether an action can be used, and why not. An action whose condition cannot be read is
 * disabled, because nothing shows that the condition holds. Pass `value` to ask about one
 * allowed value rather than about the action as a whole.
 */
export function availability(action: ActionDefinition, state: ActionsState, platform: string, value?: string): Availability {
  const block = sessionBlock(state);
  if (block) return blocked(block);
  if (action.id === 'usb-mode' && value === RNDIS_USB_MODE && /mac/i.test(platform)) return hidden(RNDIS_ON_MAC);
  if (REQUIRES_NETWORK_USB.has(action.id)) {
    if (state.usbMode === null) return blocked('The USB mode could not be read, so this stays off.');
    if (!NETWORK_USB_MODES.includes(state.usbMode)) return hidden('Only offered in a network USB mode (ECM or RNDIS).');
  }
  if (state.busy) return blocked('One action at a time: another one is running.');
  if (REQUIRES_SIM.has(action.id)) {
    if (state.sim === null) return blocked('The SIM state could not be read, so this stays off.');
    if (state.sim !== 'READY') return blocked(`This needs a ready SIM. The SIM is ${state.sim}.`);
  }
  if (action.id === 'data') {
    if (state.radio === null) return blocked('The radio state could not be read, so this stays off.');
    if (state.radio !== RADIO_ON) return blocked('The radio is off. Switch it on first.');
  }
  return { enabled: true, hidden: false };
}
