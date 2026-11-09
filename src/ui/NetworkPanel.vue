<script setup lang="ts">
import type { Row } from './dashboard';
import type { GlossaryTerm } from './glossary';
import HelpTip from './HelpTip.vue';

defineProps<{ rows: Row[] }>();

/** By the dashboard's own row keys, never by anything the modem said. */
const HELP = new Map<string, GlossaryTerm>([
  ['plmn', 'PLMN'], ['earfcn', 'EARFCN'], ['cell_id', 'Cell ID'], ['pci', 'PCI'], ['tac', 'TAC'], ['state', 'RRC state'], ['duplex', 'Duplex'],
]);
</script>

<template>
  <section class="panel" aria-label="Network and cell">
    <span class="label">Network and cell</span>
    <dl>
      <div v-for="r in rows" :key="r.key">
        <dt>{{ r.label }}<HelpTip v-if="HELP.has(r.key)" :term="HELP.get(r.key)!" /></dt>
        <dd class="mono">{{ r.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 1.1rem 1.5rem; margin: 0; }
dt { font-size: 0.8rem; color: var(--ink-3); }
dd { margin: 0.1rem 0 0; font-size: 1.15rem; font-weight: 500; letter-spacing: -0.01em; overflow-wrap: anywhere; }
</style>
