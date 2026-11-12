<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { USSD_CANCEL, USSD_CODE, USSD_REPLY, buildUssd, buildUssdReply, runUssd } from '../../tools/ussd';
import type { UssdResult } from '../../tools/ussd';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, HIDDEN, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();

const code = ref('');
const reply = ref('');
const pending = ref<string | null>(null);
const busy = ref(false);
const result = shallowRef<UssdResult | ToolOutcome | null>(null);
const open = computed(() => !!result.value && 'open' in result.value && result.value.open);
const answerText = computed(() => (result.value && 'text' in result.value ? result.value.text : undefined));
const problem = ref('');

function review(): void {
  const command = open.value ? buildUssdReply(reply.value.trim()) : buildUssd(code.value.trim());
  problem.value = command ? '' : open.value ? 'A reply is digits, * or #.' : 'A code starts with * or # and holds only digits, * and #, for example *100#.';
  pending.value = command;
}

async function run(command: string): Promise<void> {
  pending.value = null;
  busy.value = true;
  try {
    const r = await hold(props, () => runUssd(props.io, command));
    result.value = r ?? { tone: 'bad', message: BUSY, answer: [] };
    if (r && !r.open) reply.value = '';
  } finally {
    busy.value = false;
  }
}

async function endSession(): Promise<void> {
  busy.value = true;
  try {
    await hold(props, () => props.io.send(USSD_CANCEL));
    result.value = { tone: 'ok', message: 'The session is closed.', answer: [] };
    reply.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="ussd">
    <div class="what">
      <h3>USSD</h3>
      <p class="summary">Codes such as *100# for the balance, an activation or a menu of the operator.</p>
    </div>
    <form v-if="!open" class="fields inline" @submit.prevent="review">
      <input v-model="code" type="text" aria-label="USSD code" placeholder="*100#" inputmode="tel" autocomplete="off" spellcheck="false" maxlength="32" :pattern="USSD_CODE.source" :disabled="!!blocked || busy" @input="problem = ''" />
      <button type="submit" :disabled="!!blocked || busy || !code">Review</button>
    </form>
    <form v-else class="fields inline" @submit.prevent="review">
      <input v-model="reply" type="text" aria-label="Reply" placeholder="1" inputmode="tel" autocomplete="off" maxlength="32" :pattern="USSD_REPLY.source" :disabled="!!blocked || busy" />
      <button type="submit" :disabled="!!blocked || busy || !reply">Reply</button>
      <button type="button" :disabled="!!blocked || busy" @click="endSession">End session</button>
    </form>
    <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
    <ToolConfirm
      v-if="pending"
      label="USSD"
      :sends="pending"
      warning="Some codes cost money or change a service of your subscription. Send only codes you know."
      :unverified="unverified"
      :busy="busy"
      @confirm="run(pending!)"
      @cancel="pending = null"
    />
    <p v-if="busy" class="hint">Waiting for the network, up to 30 seconds.</p>
    <pre v-if="answerText" class="answer" aria-label="Answer of the network">{{ hideIdentifiers ? HIDDEN : answerText }}</pre>
    <ToolResult v-if="result" :outcome="result" :hide-identifiers="hideIdentifiers" />
  </li>
</template>
