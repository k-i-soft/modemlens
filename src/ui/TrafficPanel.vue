<script setup lang="ts">
import { formatBytes } from '../tools/traffic';
import type { Counter, Sample } from '../tools/traffic';
import HelpTip from './HelpTip.vue';
import TrafficChart from './TrafficChart.vue';

defineProps<{
  totals: Counter | null;
  samples: Array<Sample | null>;
  running: boolean;
  paused: boolean;
}>();
</script>

<template>
  <section class="panel traffic-panel" aria-label="Data traffic">
    <div class="bar">
      <span class="label">Data traffic<HelpTip term="Data traffic" /></span>
      <span class="status">{{ paused ? 'Paused while a scan runs.' : running ? 'Reads AT+QGDCNT? every second. Never part of a report.' : 'Needs a connected modem.' }}</span>
    </div>
    <dl v-if="totals" class="totals">
      <div><dt>Received</dt><dd class="mono">{{ formatBytes(totals.received) }}</dd></div>
      <div><dt>Sent</dt><dd class="mono">{{ formatBytes(totals.sent) }}</dd></div>
      <div><dt>Together</dt><dd class="mono">{{ formatBytes(totals.received + totals.sent) }}</dd></div>
    </dl>
    <p class="hint">Since the modem's counter was last reset. Reset it under Actions.</p>
    <TrafficChart :samples="samples" :waiting="running && !paused" />
  </section>
</template>

<style scoped>
.traffic-panel { display: grid; gap: 0.75rem; }
.bar { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.2rem 1rem; }
.status { font-size: 0.8rem; color: var(--ink-3); }
.totals { display: flex; flex-wrap: wrap; gap: 0.4rem 2rem; margin: 0; }
.totals div { display: grid; gap: 0.1rem; }
dt { font-size: 0.78rem; color: var(--ink-3); }
dd { margin: 0; font-size: 1.15rem; font-weight: 600; }
.hint { font-size: 0.8rem; color: var(--ink-3); }
</style>
