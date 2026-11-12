<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { SELECT_AUTOMATIC, buildSelect, parseMode, scanNetworks, select } from '../../tools/operator';
import type { Network } from '../../tools/operator';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, hold, holdWhenFree } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const MODE: Record<string, string> = { '0': 'Automatic', '1': 'Manual', '4': 'Manual, automatic as fallback' };
const mode = ref<string | null>(null);
const networks = shallowRef<Network[]>([]);
const busy = ref(false);
const scanning = ref(false);
const pending = shallowRef<{ command: string; label: string } | null>(null);
const outcome = shallowRef<ToolOutcome | null>(null);

async function readMode(): Promise<void> {
  const r = await holdWhenFree(props, () => props.io.send('AT+COPS?'));
  if (r) mode.value = parseMode(r);
}

async function scan(): Promise<void> {
  busy.value = true;
  scanning.value = true;
  try {
    const r = await hold(props, () => scanNetworks(props.io));
    if (!r) { outcome.value = { tone: 'bad', message: BUSY, answer: [] }; return; }
    networks.value = r.networks;
    outcome.value = r;
  } finally {
    busy.value = false;
    scanning.value = false;
  }
}

function choose(n: Network): void {
  const command = buildSelect(n.plmn, n.act);
  if (command) pending.value = { command, label: `${n.name} (${n.plmn})${n.tech ? ` ${n.tech}` : ''}` };
}

function automatic(): void {
  pending.value = { command: SELECT_AUTOMATIC, label: 'Automatic' };
}

async function send(): Promise<void> {
  const p = pending.value;
  if (!p) return;
  pending.value = null;
  busy.value = true;
  try {
    const r = await hold(props, async () => {
      const out = await select(props.io, p.command);
      mode.value = parseMode(await props.io.send('AT+COPS?'));
      return out;
    });
    outcome.value = r ?? { tone: 'bad', message: BUSY, answer: [] };
    if (r) emit('changed');
  } finally {
    busy.value = false;
  }
}

void readMode();
</script>

<template>
  <li class="tool" data-tool="operator">
    <div class="head">
      <div class="what">
        <h3>Network operator</h3>
        <p class="summary">Choose a network by hand, for example abroad or to test one operator, or let the modem choose.</p>
      </div>
      <p class="value">{{ mode === null ? 'unknown' : MODE[mode] ?? `Mode ${mode}` }}</p>
    </div>
    <div class="row">
      <button type="button" :disabled="!!blocked || busy" @click="scan">{{ scanning ? 'Searching...' : 'Search networks' }}</button>
      <button type="button" :disabled="!!blocked || busy || mode === '0'" @click="automatic">Automatic</button>
    </div>
    <p v-if="scanning" class="hint">The search takes up to three minutes. Mobile data can pause meanwhile.</p>
    <ul v-if="networks.length" class="networks">
      <li v-for="n in networks" :key="`${n.plmn}-${n.act}`">
        <span>{{ n.name }} <span class="mono">{{ n.plmn }}</span> {{ n.tech }}</span>
        <span class="reason">{{ n.status }}</span>
        <button type="button" :disabled="!!blocked || busy || n.status === 'forbidden' || (n.status === 'current' && mode === '1')" @click="choose(n)">Use</button>
      </li>
    </ul>
    <ToolConfirm
      v-if="pending"
      :label="`Network ${pending.label}`"
      :sends="pending.command"
      :warning="pending.command === SELECT_AUTOMATIC ? 'The modem picks the network by itself again. It may drop off briefly.' : 'The modem stays on this network. Where it is not available, the modem has no service until you choose Automatic.'"
      :unverified="unverified"
      :busy="busy"
      @confirm="send"
      @cancel="pending = null"
    />
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="hideIdentifiers" />
  </li>
</template>
