<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from './dashboard';
import type { Dashboard } from './dashboard';
import type { GlossaryTerm } from './glossary';
import HelpTip from './HelpTip.vue';

const props = defineProps<{ device: Dashboard['device'] }>();

const GAUGE_MIN = 0;
const GAUGE_MAX = 100;
const fill = computed(() => {
  const t = props.device.temperature ?? GAUGE_MIN;
  return Math.max(0, Math.min(100, ((t - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100));
});
/** By this panel's own row names, never by anything the modem said. */
const HELP = new Map<string, GlossaryTerm>([['USB mode', 'USB mode'], ['NAT', 'NAT']]);
const rows = computed(() => {
  const d = props.device;
  return [
    ['USB mode', d.usbMode],
    ['NAT', d.nat],
    ['Function', d.functionMode],
    ['Modem time', d.time],
    ...(d.details ?? []).map((r) => [r.label, r.value]),
  ].filter((r): r is [string, string] => r[1] !== undefined);
});
</script>

<template>
  <section class="panel" aria-label="Device">
    <span class="label">Device</span>
    <div class="body">
      <div v-if="device.temperature !== undefined" class="gauge" role="img" :aria-label="`Temperature ${device.temperature} degrees Celsius`">
        <svg viewBox="0 0 120 68" aria-hidden="true">
          <path class="rail" d="M10 62 A50 50 0 0 1 110 62" fill="none" pathLength="100" />
          <path class="value" d="M10 62 A50 50 0 0 1 110 62" fill="none" pathLength="100" :stroke-dasharray="`${fill} 100`" />
        </svg>
        <p class="reading"><span class="num">{{ formatNumber(device.temperature) }}</span><span class="unit">°C</span></p>
      </div>
      <dl v-if="rows.length">
        <template v-for="[k, v] in rows" :key="k"><dt>{{ k }}<HelpTip v-if="HELP.has(k)" :term="HELP.get(k)!" /></dt><dd>{{ v }}</dd></template>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.body { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.5rem; }
.gauge { position: relative; flex: none; width: 7.25rem; }
svg { display: block; width: 100%; height: auto; }
.rail { stroke: var(--surface-2); stroke-width: 9; stroke-linecap: round; }
.value { stroke: var(--accent); stroke-width: 9; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
.reading { position: absolute; left: 0; right: 0; bottom: -0.1rem; text-align: center; }
.num { font-size: 1.4rem; font-weight: 600; letter-spacing: -0.01em; }
dl { flex: 1 1 11rem; min-width: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.25rem 1rem; margin: 0; }
dt { font-size: 0.82rem; color: var(--ink-3); }
dd { margin: 0; font-size: 0.9rem; overflow-wrap: anywhere; }
</style>
