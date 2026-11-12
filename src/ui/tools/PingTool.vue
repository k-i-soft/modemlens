<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { PING_TARGETS, hostProblem, pingDialect, runPing } from '../../tools/ping';
import type { PingResult } from '../../tools/ping';
import type { ToolOutcome } from '../../tools/types';
import ToolResult from './ToolResult.vue';
import { BUSY, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();

const host = ref(PING_TARGETS[0]);
const busy = ref(false);
const problem = ref('');
const outcome = shallowRef<PingResult | ToolOutcome | null>(null);
const dialect = computed(() => pingDialect(props.profileId));
const times = computed(() => (outcome.value && 'times' in outcome.value ? outcome.value.times : []));

async function run(): Promise<void> {
  const d = dialect.value;
  const target = host.value.trim();
  problem.value = hostProblem(target) ?? '';
  if (!d || problem.value) return;
  busy.value = true;
  try {
    outcome.value = (await hold(props, () => runPing(props.io, d, target))) ?? { tone: 'bad', message: BUSY, answer: [] };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="ping">
    <div class="what">
      <h3>Ping</h3>
      <p class="summary">Whether the modem itself reaches the internet. It tells a mobile network problem from one on this computer.</p>
    </div>
    <form class="fields inline" @submit.prevent="run">
      <input v-model="host" type="text" aria-label="Host" list="ping-targets" autocomplete="off" spellcheck="false" maxlength="253" :disabled="!!blocked || busy" @input="problem = ''" />
      <datalist id="ping-targets"><option v-for="t in PING_TARGETS" :key="t" :value="t" /></datalist>
      <button type="submit" :disabled="!!blocked || busy || !host">{{ busy ? 'Pinging...' : 'Ping 4 times' }}</button>
    </form>
    <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
    <p class="hint">Sends four small packets through the modem's own data connection. Nothing is changed.</p>
    <p v-if="times.length" class="mono">{{ times.map((t) => `${t} ms`).join('  ') }}</p>
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="false" />
  </li>
</template>
