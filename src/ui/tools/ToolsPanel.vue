<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { probeTools, toolBlock, toolVerified } from '../../tools/support';
import type { ToolId, ToolIo } from '../../tools/types';
import OperatorTool from './OperatorTool.vue';
import PinTool from './PinTool.vue';
import PingTool from './PingTool.vue';
import SmsTool from './SmsTool.vue';
import UssdTool from './UssdTool.vue';
import { holdWhenFree } from './props';

const props = withDefaults(defineProps<{
  active: boolean;
  connected: boolean;
  imported: boolean;
  scanning: boolean;
  profileId?: string;
  hideIdentifiers?: boolean;
  io: ToolIo;
  begin: () => boolean;
  end: () => void;
}>(), { profileId: undefined, hideIdentifiers: false });

const emit = defineEmits<{ (e: 'changed'): void }>();

const ORDER: ToolId[] = ['pin', 'ping', 'ussd', 'operator', 'sms'];
const supported = shallowRef<Set<ToolId> | null>(null);
const probing = ref(false);
const block = computed(() => toolBlock(props));
const shown = computed(() => ORDER.filter((t) => supported.value?.has(t)));

async function probe(): Promise<void> {
  if (probing.value) return;
  probing.value = true;
  try {
    const found = await holdWhenFree(props, () => probeTools(props.io, props.profileId));
    if (found) supported.value = found;
  } finally {
    probing.value = false;
  }
}

watch(() => props.active && !block.value && supported.value === null, (go) => { if (go) void probe(); }, { immediate: true });
// Another modem, or the same one after a restart: what it supports is asked again.
watch(() => [props.connected, props.profileId], () => { supported.value = null; });

const common = computed(() => ({
  io: props.io,
  begin: props.begin,
  end: props.end,
  blocked: block.value,
  profileId: props.profileId,
  hideIdentifiers: props.hideIdentifiers,
}));
</script>

<template>
  <section v-if="!imported && connected" class="panel tools-view" aria-label="Tools">
    <span class="label">Tools</span>
    <p v-if="block" class="reason">{{ block }}</p>
    <p v-else-if="probing && !supported" class="reason">Asking the modem which tools it knows...</p>
    <p v-else-if="supported && shown.length === 0" class="reason">This modem answers none of the tool commands.</p>
    <ul v-if="supported" class="rows">
      <template v-for="t in shown" :key="t">
        <PinTool v-if="t === 'pin'" v-bind="common" :unverified="!toolVerified('pin', profileId)" @changed="emit('changed')" />
        <PingTool v-else-if="t === 'ping'" v-bind="common" :unverified="!toolVerified('ping', profileId)" />
        <UssdTool v-else-if="t === 'ussd'" v-bind="common" :unverified="!toolVerified('ussd', profileId)" />
        <OperatorTool v-else-if="t === 'operator'" v-bind="common" :unverified="!toolVerified('operator', profileId)" @changed="emit('changed')" />
        <SmsTool v-else-if="t === 'sms'" v-bind="common" :unverified="!toolVerified('sms', profileId)" />
      </template>
    </ul>
  </section>
</template>

<style>
.tools-view .rows { display: grid; margin: 0; padding: 0; list-style: none; }
.tools-view .tool { display: grid; gap: 0.55rem; padding-block: 0.9rem; border-top: 1px solid var(--line); }
.tools-view .tool:first-child { border-top: 0; padding-top: 0; }
.tools-view .head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.15rem 1.5rem; }
.tools-view h3 { font-size: 0.98rem; font-weight: 600; }
.tools-view .summary, .tools-view .reason { font-size: 0.82rem; color: var(--ink-3); }
.tools-view .value { font-size: 0.9rem; }
.tools-view .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.tools-view .fields { display: grid; gap: 0.5rem; max-width: 26rem; }
.tools-view .fields.inline { display: flex; flex-wrap: wrap; max-width: none; }
.tools-view label { display: grid; gap: 0.2rem; font-size: 0.82rem; color: var(--ink-3); }
.tools-view input, .tools-view textarea {
  padding: 0.4rem 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.88rem;
  color: var(--ink);
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: 6px;
}
.tools-view .fields.inline input { flex: 1 1 10rem; max-width: 18rem; }
.tools-view textarea { font-family: inherit; resize: vertical; }
.tools-view .problem { font-size: 0.85rem; color: var(--r-poor); }
.tools-view .strong { font-weight: 600; color: var(--r-poor); }
.tools-view .confirm, .tools-view .result { display: grid; gap: 0.55rem; padding: 0.75rem 0.9rem; font-size: 0.9rem; border: 1px solid var(--line); border-radius: var(--radius-s); }
.tools-view .confirm { background: var(--accent-soft); border-color: var(--accent); }
.tools-view .result { border-color: var(--tone); }
.tools-view dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.2rem 1rem; margin: 0; font-size: 0.9rem; }
.tools-view dt { font-size: 0.8rem; color: var(--ink-3); align-self: center; }
.tools-view dd { margin: 0; overflow-wrap: anywhere; }
.tools-view details.raw summary { cursor: pointer; font-size: 0.8rem; color: var(--ink-3); width: max-content; }
.tools-view details.raw[open] summary { margin-bottom: 0.4rem; }
.tools-view pre { margin: 0; font-size: 0.82rem; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.tools-view pre.answer { padding: 0.6rem 0.75rem; font-size: 0.9rem; color: var(--ink); background: var(--surface-2); border-radius: 6px; }
.tools-view .networks, .tools-view .messages { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.tools-view .networks li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; }
.tools-view .messages li { display: grid; gap: 0.35rem; padding: 0.6rem 0.75rem; background: var(--surface-2); border-radius: 6px; justify-items: start; }
.tools-view .meta { display: flex; flex-wrap: wrap; gap: 0.25rem 0.9rem; font-size: 0.8rem; color: var(--ink-3); }
.tools-view .badge { padding: 0 0.4rem; border: 1px solid var(--line); border-radius: 999px; }
.tools-view .text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
