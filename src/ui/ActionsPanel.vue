<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { ACTIONS, APN_TYPES, EC200A_PROFILE_ID, actionById, apnProblem, apnValue, buildWrite, isStrongWarning, isVerified, splitApnValue, valueLabel, warningFor } from '../actions/ec200a';
import { availability, sessionBlock } from '../actions/rules';
import type { ActionsState } from '../actions/rules';
import { emptyReadings, readCurrent, runAction } from '../actions/runner';
import type { ActionOutcome, Readings } from '../actions/runner';
import type { ActionDefinition, ActionId, ActionSend } from '../actions/types';
import type { GlossaryTerm } from './glossary';
import HelpTip from './HelpTip.vue';

const props = withDefaults(defineProps<{
  /** The tab is open. Current values are read then. */
  active: boolean;
  connected: boolean;
  imported: boolean;
  profileId?: string;
  scanning: boolean;
  /** Tells whether a reconnected modem is the same one, so that "Put it back" applies to it. */
  modemKey?: string;
  hideIdentifiers?: boolean;
  send: ActionSend;
  /** Takes the modem. False means something else holds it, and nothing may be sent. */
  begin: () => boolean;
  end: () => void;
  platform?: string;
}>(), { profileId: undefined, modemKey: undefined, hideIdentifiers: false, platform: () => navigator.platform });

const emit = defineEmits<{
  (e: 'restarted'): void;
  (e: 'confirmed'): void;
}>();

interface Pending {
  action: ActionDefinition;
  value: string;
  /** A write that was not tested on this firmware takes a second click. */
  stage: 'confirm' | 'unverified';
  /** When the second click became possible. */
  armedAt: number;
  restoring: boolean;
}

const ACTION_HELP: Record<ActionId, GlossaryTerm> = {
  apn: 'APN', data: 'Host connection', radio: 'Radio', 'usb-mode': 'USB mode', nat: 'NAT', 'network-mode': 'Network mode', roaming: 'Roaming', restart: 'Restart',
};
/** Allowed values that have an explanation of their own, by the action definitions' labels. */
const CHOICE_HELP = new Map<string, GlossaryTerm>([
  ['ECM', 'ECM'], ['RNDIS', 'RNDIS'], ['Modem does NAT', 'Modem does NAT'], ['Carrier address on the computer', 'Carrier address on the computer'],
]);
const HIDDEN_ANSWER = 'Hidden while "Hide identifiers" is on.';
/** A held or double-pressed key must not send an untested command before the warning can be read. */
const SECOND_CONFIRM_GUARD_MS = 600;

const readings = shallowRef<Readings>(emptyReadings());
const everRead = ref(false);
const reading = ref(false);
const acting = ref(false);
const pending = shallowRef<Pending | null>(null);
const last = shallowRef<{ actionId: ActionId; outcome: ActionOutcome } | null>(null);
/** The values to go back to, and the modem they belong to. */
const previous = shallowRef<{ owner: string; values: ReadonlyMap<ActionId, string> } | null>(null);
const apnType = ref<string>('IP');
const apnText = ref('');
const apnError = ref('');

const state = computed<ActionsState>(() => ({
  connected: props.connected,
  imported: props.imported,
  profileId: props.profileId,
  scanning: props.scanning,
  busy: reading.value || acting.value,
  sim: readings.value.sim,
  radio: readings.value.values.radio ?? null,
  usbMode: readings.value.values['usb-mode'] ?? null,
}));

const block = computed(() => sessionBlock(state.value));
const isTargetModem = computed(() => props.connected && !props.imported && props.profileId === EC200A_PROFILE_ID);
const current = (id: ActionId): string | null => readings.value.values[id] ?? null;

const rows = computed(() =>
  ACTIONS.map((action) => {
    const choices = action.choices.map((choice) => ({ ...choice, availability: availability(action, state.value, props.platform, choice.value) }));
    return {
      action,
      availability: availability(action, state.value, props.platform),
      choices: choices.filter((c) => !c.availability.hidden),
      note: choices.find((c) => c.availability.hidden)?.availability.reason,
      shownValue: !everRead.value && reading.value ? 'Reading...' : valueLabel(action, current(action.id)),
      current: current(action.id),
    };
  }),
);
const shownRows = computed(() => rows.value.filter((r) => !r.availability.hidden));
const hiddenRows = computed(() => rows.value.filter((r) => r.availability.hidden));

/** Only for the modem it was remembered on: without a serial number that cannot be shown. */
function previousValue(id: ActionId): string | undefined {
  const p = previous.value;
  return p && props.modemKey !== undefined && p.owner === props.modemKey ? p.values.get(id) : undefined;
}

function restoreOf(action: ActionDefinition): { value: string; label: string; enabled: boolean } | undefined {
  const value = previousValue(action.id);
  if (value === undefined || value === current(action.id) || buildWrite(action, value) === null) return undefined;
  const a = availability(action, state.value, props.platform, value);
  return a.hidden ? undefined : { value, label: valueLabel(action, value), enabled: a.enabled };
}

function cannotRestore(action: ActionDefinition): boolean {
  const value = previousValue(action.id);
  return value !== undefined && buildWrite(action, value) === null;
}

/** Current values are read each time this turns true: the tab was opened, or a scan ended. */
const canRead = computed(() => props.active && sessionBlock(state.value) === undefined);

async function loadCurrent(): Promise<void> {
  if (!props.begin()) return;
  reading.value = true;
  try {
    readings.value = await readCurrent(props.send);
    everRead.value = true;
    const type = splitApnValue(current('apn') ?? '').type;
    if ((APN_TYPES as readonly string[]).includes(type)) apnType.value = type;
  } finally {
    reading.value = false;
    props.end();
  }
}

watch(canRead, (can) => { if (can) void loadCurrent(); }, { immediate: true });

// A confirmation only counts in the flow it was opened in.
watch([block, () => props.active], ([blocked, active]) => {
  if (blocked || !active) pending.value = null;
});

let connectionWentAway = false;

watch(() => props.connected, (connected) => {
  readings.value = emptyReadings();
  everRead.value = false;
  if (!connected) connectionWentAway = true;
});

// What became of the last write stays readable until the next modem has been identified.
watch(() => props.connected && props.profileId !== undefined, (identified) => {
  if (!identified || !connectionWentAway) return;
  connectionWentAway = false;
  last.value = null;
});

function pick(action: ActionDefinition, value: string, restoring = false): void {
  if (!availability(action, state.value, props.platform, value).enabled) return;
  last.value = null;
  pending.value = { action, value, stage: 'confirm', armedAt: 0, restoring };
}

function pickApn(action: ActionDefinition): void {
  const problem = apnProblem(apnText.value);
  apnError.value = problem ?? '';
  if (!problem) pick(action, apnValue(apnType.value, apnText.value));
}

function pickRestart(): void {
  const restart = actionById('restart');
  if (restart) pick(restart, restart.choices[0].value);
}

function remember(p: Pending, before: string | null, outcome: ActionOutcome): void {
  if (outcome.kind === 'refused' || outcome.kind === 'invalid') return;
  const owner = props.modemKey;
  if (owner === undefined) return;
  const next = new Map(previous.value?.owner === owner ? previous.value.values : []);
  if (p.restoring) {
    if (outcome.kind !== 'confirmed') return;
    next.delete(p.action.id);
  } else {
    if (before === null || before === p.value) return;
    next.set(p.action.id, before);
  }
  previous.value = { owner, values: next };
}

/** The one place a write is sent from, and only ever from the confirm button. */
async function confirm(): Promise<void> {
  const p = pending.value;
  if (!p) return;
  if (p.stage === 'confirm' && !isVerified(p.action, p.value)) {
    pending.value = { ...p, stage: 'unverified', armedAt: Date.now() };
    return;
  }
  if (p.stage === 'unverified' && Date.now() - p.armedAt < SECOND_CONFIRM_GUARD_MS) return;
  // The state can have changed since the value was picked.
  if (!availability(p.action, state.value, props.platform, p.value).enabled || !props.begin()) {
    pending.value = null;
    return;
  }
  const before = current(p.action.id);
  pending.value = null;
  acting.value = true;
  let outcome: ActionOutcome | undefined;
  try {
    outcome = await runAction(props.send, p.action, p.value);
    remember(p, before, outcome);
    last.value = { actionId: p.action.id, outcome };
    const modemStillThere = outcome.kind !== 'lost' && outcome.kind !== 'restarting' && outcome.kind !== 'invalid';
    if (modemStillThere && p.action.kind !== 'trigger') readings.value = await readCurrent(props.send);
  } finally {
    acting.value = false;
    // Before the modem is released: nothing may be sent to one that is going down.
    if (outcome?.kind === 'restarting') emit('restarted');
    props.end();
    if (outcome?.kind === 'confirmed') emit('confirmed');
  }
}

function cancel(): void {
  pending.value = null;
}

function toneOf(outcome: ActionOutcome): string {
  if (outcome.kind === 'confirmed') return 'ok';
  return outcome.kind === 'restarting' ? 'warn' : 'bad';
}
</script>

<template>
  <section class="actions-view" aria-label="Actions">
    <p class="intro hint">Changes one setting at a time. Nothing is sent until you confirm, and a change only counts once the modem reads it back.</p>
    <p v-if="block" class="notice warn" role="status">{{ block }}</p>

    <div v-if="isTargetModem" class="panel">
      <span class="label">Settings</span>
      <ul class="rows">
        <li v-for="row in shownRows" :key="row.action.id" class="setting" :data-action="row.action.id">
          <div class="head">
            <div class="what">
              <h3>{{ row.action.label }}<HelpTip :term="ACTION_HELP[row.action.id]" /></h3>
              <p class="summary">{{ row.action.summary }}</p>
            </div>
            <p v-if="row.action.read" class="value mono">{{ row.shownValue }}</p>
          </div>

          <div v-if="row.action.kind === 'choice'" class="row">
            <span v-for="c in row.choices" :key="c.value" class="choice">
              <button
                type="button"
                :aria-pressed="c.value === row.current"
                :disabled="!c.availability.enabled || c.value === row.current"
                @click="pick(row.action, c.value)"
              >
                {{ c.label }}
              </button>
              <HelpTip v-if="CHOICE_HELP.has(c.label)" :term="CHOICE_HELP.get(c.label)!" />
            </span>
          </div>
          <form v-else-if="row.action.kind === 'apn'" class="apn" @submit.prevent="pickApn(row.action)">
            <select v-model="apnType" aria-label="Address type" :disabled="!row.availability.enabled">
              <option v-for="t in APN_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <input v-model="apnText" type="text" aria-label="New APN" placeholder="New APN" autocomplete="off" spellcheck="false" maxlength="64" :disabled="!row.availability.enabled" @input="apnError = ''" />
            <button type="submit" :disabled="!row.availability.enabled || !apnText">Review</button>
          </form>
          <div v-else class="row">
            <button type="button" :disabled="!row.availability.enabled" @click="pick(row.action, row.choices[0].value)">{{ row.action.label }}</button>
          </div>

          <p v-if="row.availability.reason && !block && everRead" class="reason">{{ row.availability.reason }}</p>
          <p v-if="row.note" class="reason">{{ row.note }}</p>
          <p v-if="row.action.kind === 'apn' && apnError" class="problem" role="alert">{{ apnError }}</p>

          <div v-if="restoreOf(row.action)" class="row">
            <button type="button" :disabled="!restoreOf(row.action)!.enabled" @click="pick(row.action, restoreOf(row.action)!.value, true)">
              Put it back: {{ restoreOf(row.action)!.label }}
            </button>
          </div>
          <p v-else-if="cannotRestore(row.action)" class="reason">The previous value cannot be put back from here.</p>

          <div v-if="pending && pending.action.id === row.action.id" class="confirm" role="group" :aria-label="`Confirm ${row.action.label}`">
            <dl>
              <template v-if="row.action.read"><dt>Current</dt><dd>{{ row.shownValue }}</dd></template>
              <dt>New</dt><dd>{{ valueLabel(pending.action, pending.value) }}</dd>
              <dt>Sends</dt><dd class="mono">{{ buildWrite(pending.action, pending.value) }}</dd>
            </dl>
            <p v-if="warningFor(pending.action, pending.value)" :class="{ strong: isStrongWarning(pending.action, pending.value) }">{{ warningFor(pending.action, pending.value) }}</p>
            <p v-if="pending.stage === 'unverified'" class="strong" role="alert">This has not been tested on this firmware. Send it only if you can recover the modem without this tool.</p>
            <div class="row">
              <button :key="pending.stage" type="button" class="primary" :disabled="reading || acting" @click="confirm">{{ pending.stage === 'confirm' ? 'Confirm' : 'Send anyway' }}</button>
              <button type="button" @click="cancel">Cancel</button>
            </div>
          </div>

          <div v-if="last && last.actionId === row.action.id" class="result" :data-tone="toneOf(last.outcome)" role="status">
            <p>{{ last.outcome.message }}</p>
            <pre v-if="last.outcome.command">{{ hideIdentifiers ? HIDDEN_ANSWER : last.outcome.answer.join('\n') }}</pre>
            <template v-if="last.outcome.kind === 'confirmed'">
              <p v-if="row.action.afterSuccess" class="hint">{{ row.action.afterSuccess }}</p>
              <p v-if="row.action.needsRestart" class="hint">This takes effect after a restart.</p>
              <div class="row">
                <button v-if="row.action.needsRestart" type="button" class="primary" :disabled="scanning || reading || acting" @click="pickRestart">Restart now</button>
              </div>
            </template>
          </div>
        </li>
      </ul>
      <p v-for="r in hiddenRows" :key="r.action.id" class="reason hidden-row">{{ r.action.label }}: {{ r.availability.reason }}</p>
    </div>

    <div v-if="last && !isTargetModem" class="result" :data-tone="toneOf(last.outcome)" role="status">
      <p>{{ actionById(last.actionId)?.label }}: {{ last.outcome.message }}</p>
      <pre v-if="last.outcome.command">{{ hideIdentifiers ? HIDDEN_ANSWER : last.outcome.answer.join('\n') }}</pre>
    </div>
  </section>
</template>

<style scoped>
.actions-view { display: flex; flex-direction: column; gap: 0.9rem; }
.rows { display: grid; margin: 0; padding: 0; list-style: none; }
.setting { display: grid; gap: 0.55rem; padding-block: 0.9rem; border-top: 1px solid var(--line); }
.setting:first-child { border-top: 0; padding-top: 0; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.15rem 1.5rem; }
h3 { font-size: 0.98rem; font-weight: 600; }
.summary { font-size: 0.82rem; color: var(--ink-3); }
.value { font-size: 0.9rem; overflow-wrap: anywhere; }
.choice { display: inline-flex; align-items: center; }
.apn { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.apn input {
  flex: 1 1 12rem;
  max-width: 22rem;
  padding: 0.4rem 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.88rem;
  color: var(--ink);
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: 6px;
}
.reason { font-size: 0.82rem; color: var(--ink-3); }
.hidden-row { padding-top: 0.45rem; }
.problem { font-size: 0.85rem; color: var(--r-poor); }
.confirm, .result { display: grid; gap: 0.55rem; padding: 0.75rem 0.9rem; font-size: 0.9rem; border: 1px solid var(--line); border-radius: var(--radius-s); }
.confirm { background: var(--accent-soft); border-color: var(--accent); animation: panel-in 0.2s ease-out both; }
.result { border-color: var(--tone); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.2rem 1rem; margin: 0; }
dt { font-size: 0.8rem; color: var(--ink-3); align-self: center; }
dd { margin: 0; overflow-wrap: anywhere; }
.strong { font-weight: 600; color: var(--r-poor); }
pre { margin: 0; font-size: 0.82rem; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
