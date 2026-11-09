import type { AtResponse } from '../at/engine';

export type ActionId = 'apn' | 'data' | 'data-context' | 'radio' | 'usb-mode' | 'nat' | 'network-mode' | 'roaming' | 'restart';

/** How an action is operated: pick from fixed values, type an APN, or just trigger it. */
export type ActionKind = 'choice' | 'apn' | 'trigger';

export interface ActionChoice {
  value: string;
  label: string;
  /** The complete command for this value, so that nothing else can be written for it. */
  command: string;
  /** Overrides the action's own `verified` for this value. */
  verified?: boolean;
  /** What happens, in plain words. Overrides the action's own warning. */
  warning?: string;
  /** Show the warning prominently: it changes how exposed the computer is. */
  strongWarning?: boolean;
  /** Added to the outcome once this value is confirmed. */
  afterSuccess?: string;
}

export interface ActionRead {
  /** A read form only. */
  command: string;
  /** The current value, or null when the answer cannot be understood. */
  parse: (response: AtResponse) => string | null;
}

export interface ActionDefinition {
  id: ActionId;
  kind: ActionKind;
  label: string;
  /** One line under the label. */
  summary: string;
  /** Absent when there is nothing to read, as for a restart. */
  read?: ActionRead;
  /** Empty for the APN, whose value is typed and validated. */
  choices: ActionChoice[];
  needsRestart: boolean;
  verified: boolean;
  warning: string;
  /** How long the write may take. The engine's default applies when absent. */
  timeoutMs?: number;
  /** Some settings show up in the read-back a moment after the write is accepted. */
  settle?: { attempts: number; delayMs: number };
  /** Off unless the SIM is ready. */
  needsSimReady?: boolean;
  /** Off while the radio is off. */
  needsRadioOn?: boolean;
  /** Only offered while the modem presents a network over USB. */
  needsNetworkUsbMode?: boolean;
  /** Said after a confirmed change, when there is a next step to take. */
  afterSuccess?: string;
}

/** Sends one command through the AT engine. */
export type ActionSend = (command: string, opts?: { timeoutMs?: number }) => Promise<AtResponse>;
