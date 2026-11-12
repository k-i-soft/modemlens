<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  OPERATION_LABEL, SPENDS, attemptWarning, buildPinCommand, exhausted, inputProblem, maskCommand, operationsFor, readPinStatus, runPin,
} from '../../tools/pin';
import type { PinOperation, PinStatus } from '../../tools/pin';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, hold, holdWhenFree } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();
const emit = defineEmits<{ (e: 'changed'): void }>();

/** The SIM needs a moment after an unlock before it reads as ready. */
const SETTLE_MS = 2500;

const status = shallowRef<PinStatus | null>(null);
const busy = ref(false);
const op = ref<PinOperation | null>(null);
const code = ref('');
const codeAgain = ref('');
const newPin = ref('');
const newPinAgain = ref('');
const problem = ref('');
const reviewing = ref(false);
const outcome = shallowRef<ToolOutcome | null>(null);

const STATE_LABEL: Record<string, string> = { READY: 'Ready, no code needed now', 'SIM PIN': 'Waiting for the PIN', 'SIM PUK': 'Blocked, waiting for the PUK' };
const stateText = computed(() => {
  const s = status.value?.state;
  if (s === undefined) return 'Not read yet';
  return s === null ? 'Could not be read' : STATE_LABEL[s] ?? s;
});
const lockText = computed(() => {
  const l = status.value?.lockOn;
  return l === null || l === undefined ? 'unknown' : l ? 'on' : 'off';
});
const left = (n: number | null | undefined) => (n === null || n === undefined ? 'unknown' : String(n));
const operations = computed(() => (status.value ? operationsFor(status.value).filter((o) => !exhausted(o, status.value!)) : []));
const warning = computed(() => (op.value && status.value ? attemptWarning(op.value, status.value) : { text: '', strong: false }));
/** On the last attempt, the code has to be typed twice. */
const lastAttempt = computed(() => warning.value.strong && op.value !== null && (SPENDS[op.value] === 'pin' ? status.value?.pinLeft : status.value?.pukLeft) === 1);
const needsNew = computed(() => op.value === 'puk' || op.value === 'change');
const codeName = computed(() => (op.value === 'puk' ? 'PUK' : op.value === 'change' ? 'Current PIN' : 'PIN'));
const shownCommand = computed(() => {
  if (!op.value) return '';
  const c = buildPinCommand(op.value, { code: code.value, newPin: needsNew.value ? newPin.value : undefined });
  return c ? maskCommand(c) : '';
});

function clearCodes(): void {
  code.value = '';
  codeAgain.value = '';
  newPin.value = '';
  newPinAgain.value = '';
}

function close(): void {
  clearCodes();
  op.value = null;
  reviewing.value = false;
  problem.value = '';
}

async function read(waitTurn = false): Promise<void> {
  busy.value = true;
  try {
    const s = await (waitTurn ? holdWhenFree : hold)(props, () => readPinStatus(props.io, props.profileId));
    if (s) status.value = s;
    else outcome.value = { tone: 'bad', message: BUSY, answer: [] };
  } finally {
    busy.value = false;
  }
}

function start(o: PinOperation): void {
  close();
  outcome.value = null;
  op.value = o;
}

function review(): void {
  if (!op.value) return;
  const p = inputProblem(op.value, { code: code.value, newPin: needsNew.value ? newPin.value : undefined }, needsNew.value ? newPinAgain.value : undefined)
    ?? (lastAttempt.value && codeAgain.value !== code.value ? `The ${codeName.value} and its repetition differ.` : undefined);
  problem.value = p ?? '';
  reviewing.value = p === undefined;
}

async function send(): Promise<void> {
  const o = op.value;
  if (!o) return;
  const input = { code: code.value, newPin: needsNew.value ? newPin.value : undefined };
  // The codes leave this component with the command, and nowhere else.
  close();
  busy.value = true;
  try {
    const result = await hold(props, async () => {
      const r = await runPin(props.io, o, input);
      if (r.tone === 'ok' && (o === 'unlock' || o === 'puk')) await new Promise((res) => setTimeout(res, SETTLE_MS));
      status.value = await readPinStatus(props.io, props.profileId);
      return r;
    });
    outcome.value = result ?? { tone: 'bad', message: BUSY, answer: [] };
    if (result?.tone === 'ok') emit('changed');
  } finally {
    input.code = '';
    input.newPin = '';
    busy.value = false;
  }
}

watch(() => props.blocked, (b) => {
  if (b) close();
  else if (!status.value) void read(true);
}, { immediate: true });
onBeforeUnmount(clearCodes);
</script>

<template>
  <li class="tool" data-tool="pin">
    <div class="head">
      <div class="what">
        <h3>SIM PIN</h3>
        <p class="summary">Unlock the SIM, change its PIN, or decide whether it asks for one.</p>
      </div>
      <button type="button" :disabled="!!blocked || busy" @click="read()">Read again</button>
    </div>
    <dl v-if="status">
      <dt>SIM</dt><dd>{{ stateText }}</dd>
      <dt>PIN request</dt><dd>{{ lockText }}</dd>
      <dt>Attempts left</dt><dd>PIN {{ left(status.pinLeft) }}, PUK {{ left(status.pukLeft) }}</dd>
    </dl>
    <div v-if="operations.length" class="row">
      <button v-for="o in operations" :key="o" type="button" :aria-pressed="op === o" :disabled="!!blocked || busy" @click="start(o)">{{ OPERATION_LABEL[o] }}</button>
    </div>
    <p v-else-if="status && status.state === 'READY' && status.lockOn === null" class="reason">The modem does not say whether the SIM asks for a PIN, so nothing is offered.</p>

    <form v-if="op && !reviewing" class="fields" autocomplete="off" @submit.prevent="review">
      <label>{{ codeName }}<input v-model="code" type="password" inputmode="numeric" autocomplete="off" :maxlength="op === 'puk' ? 8 : 8" @input="problem = ''" /></label>
      <label v-if="lastAttempt">{{ codeName }} again<input v-model="codeAgain" type="password" inputmode="numeric" autocomplete="off" maxlength="8" /></label>
      <template v-if="needsNew">
        <label>New PIN<input v-model="newPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" /></label>
        <label>New PIN again<input v-model="newPinAgain" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" /></label>
      </template>
      <div class="row">
        <button type="submit" :disabled="!code">Review</button>
        <button type="button" @click="close">Cancel</button>
      </div>
      <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
    </form>
    <ToolConfirm
      v-if="op && reviewing"
      :label="OPERATION_LABEL[op]"
      :sends="shownCommand"
      :warning="warning.text"
      :strong="warning.strong"
      :unverified="unverified"
      :busy="busy"
      @confirm="send"
      @cancel="close"
    />
    <p class="hint">Each code is sent once and never repeated by this tool. It is not stored and never part of a report.</p>
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="false" />
  </li>
</template>
