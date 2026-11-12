<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { formatMbps } from '../../tools/speed';
import { COUNTER_RESET, formatBytes, rates, resetCounter } from '../../tools/traffic';
import type { Counter, Rate, ResetOutcome, Sample } from '../../tools/traffic';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps & {
  /** The Actions tab is open. Watching stops when it closes. */
  active: boolean;
  /** Reads the counter without taking the modem; null while a scan runs or when it does not answer. */
  read: () => Promise<Counter | null>;
}>();

const INTERVAL_MS = 1000;
const WINDOW_MS = 60_000;
/** Nobody watches a chart for longer, and a forgotten tab should not ask the modem forever. */
const MAX_WATCH_MS = 10 * 60_000;
const WIDTH = 600;
const HEIGHT = 110;
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

const totals = shallowRef<Counter | null>(null);
const unread = ref(false);
const watching = ref(false);
const note = ref('');
/** Readings in order; null marks one that did not come, so the line breaks there. */
const samples = shallowRef<Array<Sample | null>>([]);
const confirming = ref(false);
const resetting = ref(false);
const outcome = shallowRef<ResetOutcome | ToolOutcome | null>(null);
const hover = ref<number | null>(null);

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let startedAt = 0;

async function readOnce(): Promise<Counter | null> {
  const c = await props.read();
  if (c) {
    totals.value = c;
    unread.value = false;
  }
  return c;
}

async function tick(): Promise<void> {
  if (inFlight) return;
  if (performance.now() - startedAt > MAX_WATCH_MS) {
    stop('Stopped after 10 minutes. Start it again to keep watching.');
    return;
  }
  inFlight = true;
  try {
    const c = await readOnce();
    const at = performance.now();
    const next = [...samples.value, c ? { at, ...c } : null];
    const firstKept = next.findIndex((s) => s !== null && at - s.at <= WINDOW_MS + INTERVAL_MS);
    samples.value = firstKept > 0 ? next.slice(firstKept) : next;
  } finally {
    inFlight = false;
  }
}

function start(): void {
  if (watching.value) return;
  note.value = '';
  samples.value = [];
  watching.value = true;
  startedAt = performance.now();
  void tick();
  timer = setInterval(() => void tick(), INTERVAL_MS);
}

function stop(reason = ''): void {
  clearInterval(timer);
  timer = undefined;
  watching.value = false;
  hover.value = null;
  note.value = reason;
}

watch(() => props.active && !props.blocked, (ok) => { if (!ok && watching.value) stop(); });
onMounted(async () => {
  // Right after the tools are found the modem may still be busy for a moment.
  for (let i = 0; i < 5 && !(await readOnce()); i++) await new Promise((r) => setTimeout(r, 400));
  unread.value = totals.value === null;
});
onBeforeUnmount(() => stop());

/** Rates of each unbroken run of readings. */
const series = computed(() => {
  const runs: Rate[][] = [];
  let run: Sample[] = [];
  for (const s of samples.value) {
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
const lastAt = computed(() => [...samples.value].reverse().find((s) => s !== null)?.at ?? 0);
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

async function reset(): Promise<void> {
  confirming.value = false;
  resetting.value = true;
  try {
    const out = (await hold(props, () => resetCounter(props.io))) ?? { tone: 'bad' as const, message: BUSY, answer: [] };
    outcome.value = out;
    if ('counter' in out && out.counter) totals.value = out.counter;
    // The speed before and after a reset cannot be compared.
    if (watching.value) samples.value = [...samples.value, null];
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="traffic">
    <div class="what">
      <h3>Data traffic</h3>
      <p class="summary">How much data went over the mobile network, and how fast it moves right now, as the modem counts it.</p>
    </div>

    <dl v-if="totals" class="traffic-totals">
      <dt>Received</dt><dd class="mono">{{ formatBytes(totals.received) }}</dd>
      <dt>Sent</dt><dd class="mono">{{ formatBytes(totals.sent) }}</dd>
      <dt>Together</dt><dd class="mono">{{ formatBytes(totals.received + totals.sent) }}</dd>
    </dl>
    <p v-else-if="unread" class="reason">The modem did not give its counter just now.</p>
    <p class="hint">Counted by the modem since its counter was last reset, including its own traffic such as the speed test inside it.</p>

    <div class="row">
      <button v-if="!watching" type="button" :disabled="!!blocked" @click="start">Watch live</button>
      <button v-else type="button" @click="stop()">Stop</button>
      <button type="button" :disabled="!!blocked || resetting || confirming" @click="confirming = true">Reset counter</button>
      <span class="reason">{{ watching ? 'Reads AT+QGDCNT? every second while this tab is open.' : note }}</span>
    </div>

    <ToolConfirm
      v-if="confirming"
      label="Reset the data counter"
      :sends="COUNTER_RESET"
      warning="Sets the modem's count of sent and received data to zero. Nothing else changes."
      second="The old count cannot be brought back."
      :unverified="unverified"
      @confirm="reset"
      @cancel="confirming = false"
    />
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="false" />

    <div v-if="watching || allRates.length" class="traffic-live">
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
        <p v-if="watching && allRates.length === 0" class="empty">Waiting for the second reading...</p>
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
  </li>
</template>

<style scoped>
.traffic-totals { grid-template-columns: repeat(3, max-content minmax(0, auto)); gap: 0.2rem 0.7rem; }
.traffic-totals dd { margin-right: 1rem; font-size: 1rem; font-weight: 600; }
@media (max-width: 520px) { .traffic-totals { grid-template-columns: max-content minmax(0, 1fr); } }
.hint { font-size: 0.8rem; color: var(--ink-3); }
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
