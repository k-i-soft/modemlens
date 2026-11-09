<script setup lang="ts">
import { formatNumber, METRICS } from './dashboard';
import type { Neighbour } from './dashboard';
import HelpTip from './HelpTip.vue';

defineProps<{ neighbours: Neighbour[] }>();

const { min, max } = METRICS.rsrp;
const width = (rsrp: number) => ({ width: `${Math.max(2, Math.min(100, ((rsrp - min) / (max - min)) * 100))}%` });
</script>

<template>
  <section class="panel" aria-label="Neighbour cells">
    <span class="label">Neighbour cells, RSRP<HelpTip term="RSRP" /></span>
    <ul>
      <li v-for="(n, i) in neighbours" :key="i" :data-rating="n.rating">
        <span class="who mono"><template v-if="n.pci">PCI {{ n.pci }}</template><span v-if="n.earfcn" class="quiet"> EARFCN {{ n.earfcn }}</span><span v-if="n.kind" class="kind">{{ n.kind }}</span></span>
        <span class="track" aria-hidden="true"><span class="fill" :style="width(n.rsrp)" /></span>
        <span class="value"><span class="num">{{ formatNumber(n.rsrp) }}</span><span class="unit">dBm</span><span class="word">{{ n.word }}</span></span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
ul { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.25rem 1rem; align-items: baseline; }
.who { font-size: 0.8rem; color: var(--ink); overflow-wrap: anywhere; }
.kind { margin-left: 0.5rem; font-family: var(--font-sans); font-size: 0.72rem; color: var(--ink-3); }
.value { text-align: right; white-space: nowrap; }
.num { font-weight: 600; }
.word { margin-left: 0.5rem; font-size: 0.75rem; font-weight: 600; color: var(--rating); }
.track { grid-column: 1 / -1; grid-row: 2; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--rating-fill); border-radius: 4px; transition: width 0.3s ease; }
</style>
