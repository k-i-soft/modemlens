<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber, METRICS, RATING_WORDS, rate } from './dashboard';
import { LIVE_MAX_SAMPLES } from './liveSignal';
import type { LiveSample } from './liveSignal';
import ToggleSwitch from './ToggleSwitch.vue';
import HelpTip from './HelpTip.vue';

const props = defineProps<{
  enabled: boolean;
  paused: boolean;
  samples: LiveSample[];
  available: boolean;
  /** Why live readings cannot exist at all for this report. */
  unavailableReason?: string;
}>();
defineEmits<{ (e: 'toggle', on: boolean): void }>();

const WIDTH = 600;
const HEIGHT = 96;
/** The trace fills the width early on and then narrows to the full history. */
const MIN_SLOTS = 30;
const MIN_SPAN_DB = 20;
const MARGIN_DB = 4;

const readings = computed(() => props.samples.filter((s) => s.rsrp !== null).map((s) => s.rsrp as number));
const latest = computed(() => props.samples.at(-1)?.rsrp ?? null);
const latestRating = computed(() => (latest.value === null ? undefined : rate('rsrp', latest.value)));

const domain = computed(() => {
  if (readings.value.length === 0) return { low: METRICS.rsrp.fair, high: METRICS.rsrp.excellent };
  let low = Math.min(...readings.value) - MARGIN_DB;
  let high = Math.max(...readings.value) + MARGIN_DB;
  const missing = MIN_SPAN_DB - (high - low);
  if (missing > 0) {
    low -= missing / 2;
    high += missing / 2;
  }
  return { low, high };
});

const yOf = (rsrp: number): number => HEIGHT - ((rsrp - domain.value.low) / (domain.value.high - domain.value.low)) * HEIGHT;
const slots = computed(() => Math.min(LIVE_MAX_SAMPLES, Math.max(MIN_SLOTS, props.samples.length)));
const xOf = (i: number): number => WIDTH - (props.samples.length - 1 - i) * (WIDTH / (slots.value - 1));

/** A sample without a reading breaks the line instead of being drawn as a drop to zero. */
const segments = computed(() => {
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  props.samples.forEach((s, i) => {
    if (s.rsrp === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push([xOf(i), yOf(s.rsrp)]);
    }
  });
  if (run.length) runs.push(run);
  return runs.map((points) => {
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L${points.at(-1)![0].toFixed(1)} ${HEIGHT} L${points[0][0].toFixed(1)} ${HEIGHT} Z` };
  });
});

const thresholds = computed(() =>
  [METRICS.rsrp.excellent, METRICS.rsrp.good, METRICS.rsrp.fair]
    .filter((v) => v > domain.value.low && v < domain.value.high)
    .map((v) => ({ v, y: yOf(v), text: formatNumber(v), style: { top: `${(yOf(v) / HEIGHT) * 100}%` } })),
);

const nowStyle = computed(() => (latest.value === null ? undefined : { top: `${(yOf(latest.value) / HEIGHT) * 100}%` }));

const status = computed(() => {
  if (props.unavailableReason) return props.unavailableReason;
  if (props.paused) return 'Paused while a scan or an action runs.';
  if (!props.available && !props.enabled) return 'Needs a connected modem.';
  return 'Reads AT+CESQ every 2 s. Never part of a report.';
});

const description = computed(() =>
  latest.value === null
    ? 'RSRP over time, no reading yet'
    : `RSRP over time, now ${latest.value} dBm, ${RATING_WORDS[latestRating.value!].toLowerCase()}`,
);
</script>

<template>
  <div class="live">
    <div class="bar">
      <ToggleSwitch
        label="Live signal"
        :model-value="enabled"
        :disabled="!enabled && (!available || paused)"
        @update:model-value="$emit('toggle', $event)"
      />
      <HelpTip term="Live signal" />
      <span class="status">{{ status }}</span>
      <span v-if="enabled && latest !== null" class="now" :data-rating="latestRating">
        <span class="num">{{ formatNumber(latest) }}</span><span class="unit">dBm</span>
        <span class="word">{{ RATING_WORDS[latestRating!] }}</span>
      </span>
    </div>
    <div v-if="enabled" class="plot" role="img" :aria-label="description">
      <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" preserveAspectRatio="none" aria-hidden="true">
        <line v-for="t in thresholds" :key="t.v" x1="0" :x2="WIDTH" :y1="t.y" :y2="t.y" class="threshold" vector-effect="non-scaling-stroke" />
        <template v-for="(s, i) in segments" :key="i">
          <path :d="s.area" class="area" />
          <path :d="s.line" class="line" vector-effect="non-scaling-stroke" />
        </template>
      </svg>
      <span v-for="t in thresholds" :key="t.v" class="tick" :style="t.style" aria-hidden="true">{{ t.text }}</span>
      <span v-if="nowStyle" class="dot" :style="nowStyle" aria-hidden="true" />
      <p v-if="samples.length > 0 && readings.length === 0" class="empty">The modem answers, but reports no RSRP right now.</p>
    </div>
  </div>
</template>

<style scoped>
.live { padding-top: 1.1rem; border-top: 1px solid var(--line); }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.9rem; }
.status { font-size: 0.8rem; color: var(--ink-3); }
.now { margin-left: auto; }
.num { font-size: 1.15rem; font-weight: 600; }
.word { margin-left: 0.45rem; font-size: 0.8rem; font-weight: 600; color: var(--rating); }
.plot { position: relative; height: 96px; margin: 0.9rem 8px 0 0; animation: panel-in 0.25s ease-out both; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.threshold { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 4; }
.area { fill: var(--accent-soft); stroke: none; }
.line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.tick {
  position: absolute;
  left: 0;
  transform: translateY(-115%);
  font-family: var(--font-mono);
  font-size: 0.64rem;
  color: var(--ink-3);
}
.dot {
  position: absolute;
  right: -4px;
  width: 8px;
  height: 8px;
  margin-top: -4px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 0.85rem; color: var(--ink-3); }
</style>
