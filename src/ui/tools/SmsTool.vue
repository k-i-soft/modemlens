<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { MAX_PARTS, NUMBER_PATTERN, planSubmit } from '../../tools/pdu';
import type { StoredSms } from '../../tools/pdu';
import { deleteSms, listSms, sendSms } from '../../tools/sms';
import type { SmsStorage } from '../../tools/sms';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, HIDDEN, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();

const messages = shallowRef<StoredSms[] | null>(null);
const storage = shallowRef<SmsStorage | null>(null);
const busy = ref(false);
const outcome = shallowRef<ToolOutcome | null>(null);
const deleting = shallowRef<StoredSms | null>(null);
const number = ref('');
const text = ref('');
const sending = ref(false);
const problem = ref('');

const STATUS: Record<StoredSms['status'], string> = { unread: 'new', read: 'read', unsent: 'draft', sent: 'sent' };
const plan = computed(() => planSubmit(text.value));
const planText = computed(() => {
  if (!text.value) return '';
  const p = plan.value;
  const kind = p.alphabet === 'gsm7' ? 'standard characters' : 'special characters, so fewer fit';
  return `${p.parts} part${p.parts === 1 ? '' : 's'}, ${p.left} characters left in the last one (${kind}).`;
});

async function list(): Promise<void> {
  busy.value = true;
  try {
    const r = await hold(props, () => listSms(props.io));
    if (!r) { outcome.value = { tone: 'bad', message: BUSY, answer: [] }; return; }
    messages.value = r.messages;
    storage.value = r.storage;
    outcome.value = r.tone === 'ok' ? null : r;
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  const m = deleting.value;
  if (!m) return;
  deleting.value = null;
  busy.value = true;
  try {
    const r = await hold(props, async () => {
      const out = await deleteSms(props.io, m.indexes);
      const after = await listSms(props.io);
      messages.value = after.messages;
      storage.value = after.storage;
      return out;
    });
    outcome.value = r ?? { tone: 'bad', message: BUSY, answer: [] };
  } finally {
    busy.value = false;
  }
}

function review(): void {
  const n = number.value.replace(/[\s()-]/g, '');
  if (!NUMBER_PATTERN.test(n)) problem.value = 'A phone number is 3 to 15 digits, with + in front for an international one.';
  else if (!text.value) problem.value = 'The text is empty.';
  else if (plan.value.parts > MAX_PARTS) problem.value = `At most ${MAX_PARTS} parts.`;
  else problem.value = '';
  sending.value = problem.value === '';
  if (sending.value) number.value = n;
}

async function send(): Promise<void> {
  sending.value = false;
  busy.value = true;
  try {
    const r = await hold(props, () => sendSms(props.io, number.value, text.value));
    outcome.value = r ?? { tone: 'bad', message: BUSY, answer: [] };
    if (r?.tone === 'ok') text.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="sms">
    <div class="head">
      <div class="what">
        <h3>Text messages</h3>
        <p class="summary">Read and delete the messages stored on the SIM, and send one.</p>
      </div>
      <p v-if="storage" class="value">{{ storage.used }} of {{ storage.total }} used</p>
    </div>
    <div class="row">
      <button type="button" :disabled="!!blocked || busy" @click="list">{{ messages ? 'Read again' : 'Read messages' }}</button>
    </div>
    <p class="hint">Reading marks new messages as read on the SIM. Messages are never part of a report.</p>
    <p v-if="storage && storage.used >= storage.total" class="strong">The storage is full: new messages cannot arrive until one is deleted.</p>

    <ul v-if="messages && messages.length" class="messages">
      <li v-for="m in messages" :key="m.indexes.join('-')">
        <p class="meta">
          <span>{{ m.kind === 'received' ? 'From' : 'To' }} <span class="mono">{{ hideIdentifiers ? '••••' : m.number }}</span></span>
          <span v-if="m.time">{{ m.time }}</span>
          <span class="badge">{{ STATUS[m.status] }}</span>
          <span v-if="m.incomplete" class="reason">parts missing</span>
        </p>
        <p class="text">{{ hideIdentifiers ? HIDDEN : m.text }}</p>
        <button type="button" :disabled="!!blocked || busy" @click="deleting = m">Delete</button>
        <ToolConfirm
          v-if="deleting === m"
          label="Delete message"
          :sends="m.indexes.map((i) => `AT+CMGD=${i}`).join(', ')"
          :unverified="unverified"
          second="A deleted message cannot be brought back."
          :busy="busy"
          @confirm="remove"
          @cancel="deleting = null"
        />
      </li>
    </ul>
    <p v-else-if="messages" class="reason">No messages are stored.</p>

    <form class="fields" @submit.prevent="review">
      <label>To<input v-model="number" type="tel" autocomplete="off" placeholder="+41..." maxlength="20" :disabled="!!blocked || busy" @input="problem = ''; sending = false" /></label>
      <label>Text<textarea v-model="text" rows="3" maxlength="1000" :disabled="!!blocked || busy" @input="problem = ''; sending = false" /></label>
      <p v-if="planText" class="hint">{{ planText }}</p>
      <div class="row"><button type="submit" :disabled="!!blocked || busy || !number || !text">Review</button></div>
      <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
    </form>
    <ToolConfirm
      v-if="sending"
      label="Send message"
      :sends="`AT+CMGS, ${plan.parts} part${plan.parts === 1 ? '' : 's'} to ${hideIdentifiers ? '••••' : number}`"
      warning="Each part is a separate message and may cost money, depending on the SIM contract."
      :strong="plan.parts > 1"
      :unverified="unverified"
      second="Once sent, a message cannot be taken back."
      :busy="busy"
      @confirm="send"
      @cancel="sending = false"
    />
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="hideIdentifiers" />
  </li>
</template>
