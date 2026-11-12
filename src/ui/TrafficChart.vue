<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatMbps } from '../tools/speed';
import { rates } from '../tools/traffic';
import type { Rate, Sample } from '../tools/traffic';
import { TRAFFIC_WINDOW_MS } from './trafficMonitor';

/** The current speed and the last minute of it, from readings of the modem's data counter. */
const props = defineProps<{
  /** Readings in order; null where one is missing, so the line breaks there. */
  samples: Array<Sample | null>;
  /** Readings are coming in, so an empty chart is waiting rather than idle. */
  waiting: boolean;
}>();

const WINDOW_MS = TRAFFIC_WINDOW_MS;
const WIDTH = 600;
const HEIGHT = 110;
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const hover = ref<number | null>(null);

/** Rates of each unbroken run of readings. */
const series = computed(() => {
  const runs: Rate[][] = [];
  let run: Sample[] = [];
  for (const s of props.samples) {
    if (s) {
      run.push(s);
    } else {
      if (run.length > 1) runs.push(rates(run));
      run = [];
    }
  }
  if (run.length > 1) runs.push(rates(run));
  return runs.filter((r) => r.length > 0);
});
const allRates = computed(() => series.value.flat());
const latest = computed(() => allRates.value.at(-1) ?? null);
const lastAt = computed(() => [...props.samples].reverse().find((s) => s !== null)?.at ?? 0);
const top = computed(() => {
  const peak = Math.max(0, ...allRates.value.map((r) => Math.max(r.downMbps, r.upMbps)));
  return STEPS.find((s) => s >= peak * 1.1) ?? Math.ceil(peak);
});
const xOf = (at: number) => WIDTH - ((lastAt.value - at) / WINDOW_MS) * WIDTH;
const yOf = (mbps: number) => HEIGHT - (mbps / top.value) * HEIGHT;
const path = (run: Rate[], key: 'downMbps' | 'upMbps') =>
  run.map((r, i) => `${i === 0 ? 'M' : 'L'}${xOf(r.at).toFixed(1)} ${yOf(r[key]).toFixed(1)}`).join(' ');
const lines = computed(() => series.value.map((run, i) => ({ key: i, down: path(run, 'downMbps'), up: path(run, 'upMbps') })));
const topText = computed(() => { const f = formatMbps(top.value); return `${f.value.replace(/\.0$/, '')} ${f.unit}`; });

const speed = (v: number) => { const f = formatMbps(v); return `${f.value} ${f.unit}`; };
const ago = (at: number) => { const s = Math.round((lastAt.value - at) / 1000); return s === 0 ? 'now' : `${s} s ago`; };

function onMove(e: PointerEvent): void {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (box.width === 0 || allRates.value.length === 0) return;
  const at = lastAt.value - (1 - (e.clientX - box.left) / box.width) * WINDOW_MS;
  let best = 0;
  allRates.value.forEach((r, i) => { if (Math.abs(r.at - at) < Math.abs(allRates.value[best].at - at)) best = i; });
  hover.value = best;
}
const hovered = computed(() => {
  const r = hover.value === null ? undefined : allRates.value[hover.value];
  if (!r) return null;
  const left = (xOf(r.at) / WIDTH) * 100;
  return { r, style: { left: `${left}%` }, tipStyle: left > 60 ? { right: `${100 - left}%` } : { left: `${left}%` } };
});

const description = computed(() =>
  latest.value ? `Data speed over the last minute, now ${speed(latest.value.downMbps)} down and ${speed(latest.value.upMbps)} up` : 'Data speed over the last minute, no reading yet',
);
const recent = computed(() => allRates.value.slice(-10).reverse());
</script>

<template>
    <div class="traffic-live">
      <div class="traffic-now">
        <span class="traffic-pair"><span class="traffic-key" data-series="down"><span class="swatch" />Download</span><span class="traffic-num">{{ latest ? speed(latest.downMbps) : '...' }}</span></span>
        <span class="traffic-pair"><span class="traffic-key" data-series="up"><span class="swatch" />Upload</span><span class="traffic-num">{{ latest ? speed(latest.upMbps) : '...' }}</span></span>
      </div>
      <div class="traffic-plot" role="img" :aria-label="description" @pointermove="onMove" @pointerleave="hover = null">
        <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" :x2="WIDTH" y1="0" y2="0" class="grid" vector-effect="non-scaling-stroke" />
          <line x1="0" :x2="WIDTH" :y1="HEIGHT / 2" :y2="HEIGHT / 2" class="grid" vector-effect="non-scaling-stroke" />
          <line x1="0" :x2="WIDTH" :y1="HEIGHT" :y2="HEIGHT" class="base" vector-effect="non-scaling-stroke" />
          <template v-for="l in lines" :key="l.key">
            <path :d="l.up" class="trace" data-series="up" vector-effect="non-scaling-stroke" />
            <path :d="l.down" class="trace" data-series="down" vector-effect="non-scaling-stroke" />
          </template>
        </svg>
        <span class="tick" aria-hidden="true">{{ topText }}</span>
        <span class="axis-left" aria-hidden="true">60 s ago</span>
        <span class="axis-right" aria-hidden="true">now</span>
        <template v-if="hovered">
          <span class="cross" :style="hovered.style" aria-hidden="true" />
          <span class="tip" :style="hovered.tipStyle" aria-hidden="true">
            <span>{{ ago(hovered.r.at) }}</span>
            <span data-series="down"><span class="swatch" />{{ speed(hovered.r.downMbps) }}</span>
            <span data-series="up"><span class="swatch" />{{ speed(hovered.r.upMbps) }}</span>
          </span>
        </template>
        <p v-if="waiting && allRates.length === 0" class="empty">Waiting for the second reading...</p>
      </div>
      <details v-if="recent.length" class="raw">
        <summary>Readings</summary>
        <table class="traffic-table">
          <thead><tr><th scope="col">When</th><th scope="col">Download</th><th scope="col">Upload</th></tr></thead>
          <tbody>
            <tr v-for="r in recent" :key="r.at"><td>{{ ago(r.at) }}</td><td class="mono">{{ speed(r.downMbps) }}</td><td class="mono">{{ speed(r.upMbps) }}</td></tr>
          </tbody>
        </table>
      </details>
    </div>
</template>

<style scoped>
.traffic-live { display: grid; gap: 0.6rem; }
.traffic-now { display: flex; flex-wrap: wrap; gap: 0.3rem 1.6rem; }
.traffic-pair { display: inline-flex; align-items: baseline; gap: 0.6rem; white-space: nowrap; }
.traffic-key { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--ink-3); }
.traffic-num { font-size: 1.35rem; font-weight: 600; letter-spacing: -0.01em; }
[data-series='down'] { --series: var(--series-down); }
[data-series='up'] { --series: var(--series-up); }
.swatch { display: inline-block; width: 0.9rem; height: 2px; background: var(--series); border-radius: 1px; }
.traffic-plot { position: relative; height: 110px; margin: 0.9rem 8px 1.3rem 0; touch-action: none; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 4; }
.base { stroke: var(--line); stroke-width: 1; }
.trace { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.tick, .axis-left, .axis-right { position: absolute; font-family: var(--font-mono); font-size: 0.64rem; color: var(--ink-3); }
.tick { top: 0; left: 0; transform: translateY(-115%); }
.axis-left { left: 0; bottom: -1.2rem; }
.axis-right { right: 0; bottom: -1.2rem; }
.cross { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--ink-3); pointer-events: none; }
.tip {
  position: absolute;
  top: 0.3rem;
  display: grid;
  gap: 0.15rem;
  margin-inline: 0.5rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.78rem;
  white-space: nowrap;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
  pointer-events: none;
}
.tip [data-series] { display: inline-flex; align-items: center; gap: 0.4rem; font-family: var(--font-mono); }
.empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 0.85rem; color: var(--ink-3); }
.traffic-table { border-collapse: collapse; font-size: 0.82rem; }
.traffic-table th, .traffic-table td { padding: 0.15rem 1.2rem 0.15rem 0; text-align: left; }
.traffic-table th { font-weight: 600; color: var(--ink-3); }
</style>
