<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { COUNTER_RESET, formatBytes, resetCounter } from '../../tools/traffic';
import type { Counter, ResetOutcome } from '../../tools/traffic';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps & {
  /** Reads the counter without taking the modem; null while a scan runs or when it does not answer. */
  read: () => Promise<Counter | null>;
}>();

const totals = shallowRef<Counter | null>(null);
const confirming = ref(false);
const resetting = ref(false);
const outcome = shallowRef<ResetOutcome | ToolOutcome | null>(null);

onMounted(async () => {
  // Right after the tools are found the modem may still be busy for a moment.
  for (let i = 0; i < 5; i++) {
    const c = await props.read();
    if (c) {
      totals.value = c;
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
});

async function reset(): Promise<void> {
  confirming.value = false;
  resetting.value = true;
  try {
    const out = (await hold(props, () => resetCounter(props.io))) ?? { tone: 'bad' as const, message: BUSY, answer: [] };
    outcome.value = out;
    if ('counter' in out && out.counter) totals.value = out.counter;
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="traffic">
    <div class="head">
      <div class="what">
        <h3>Data counter</h3>
        <p class="summary">The modem counts the data it sends and receives. The totals and the live speed are on the Overview.</p>
      </div>
      <span v-if="totals" class="value mono">{{ formatBytes(totals.received + totals.sent) }}</span>
    </div>
    <div class="row">
      <button type="button" :disabled="!!blocked || resetting || confirming" @click="confirming = true">Reset counter</button>
    </div>
    <ToolConfirm
      v-if="confirming"
      label="Reset the data counter"
      :sends="COUNTER_RESET"
      warning="Sets the modem's count of sent and received data to zero, for example at the start of a billing month. Nothing else changes."
      second="The old count cannot be brought back."
      :unverified="unverified"
      @confirm="reset"
      @cancel="confirming = false"
    />
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="false" />
  </li>
</template>
