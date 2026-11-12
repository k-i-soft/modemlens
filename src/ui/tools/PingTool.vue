<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { PING_TARGETS, hostProblem, pingDialect, runPing } from '../../tools/ping';
import type { PingResult } from '../../tools/ping';
import type { ToolOutcome } from '../../tools/types';
import ToolResult from './ToolResult.vue';
import { BUSY, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps>();

const host = ref(PING_TARGETS[0]);
const busy = ref(false);
const problem = ref('');
const outcome = shallowRef<PingResult | ToolOutcome | null>(null);
const dialect = computed(() => pingDialect(props.profileId));
const ping = computed(() => (outcome.value && 'replies' in outcome.value && outcome.value.replies.length ? outcome.value : null));

/** Round trips over mobile networks: below 50 ms is very good, above 250 ms is slow. */
function grade(ms: number): { tone: string; word: string } {
  if (ms <= 50) return { tone: 'excellent', word: 'Excellent' };
  if (ms <= 100) return { tone: 'good', word: 'Good' };
  if (ms <= 250) return { tone: 'fair', word: 'Fair' };
  return { tone: 'poor', word: 'Slow' };
}

const stats = computed(() => {
  const p = ping.value;
  if (!p || p.times.length === 0) return null;
  const avg = Math.round(p.times.reduce((a, b) => a + b, 0) / p.times.length);
  return { min: Math.min(...p.times), avg, max: Math.max(...p.times), loss: Math.round((1 - p.received / p.sent) * 100), grade: grade(avg) };
});
/** The longest bar fills the track, but a fast run is not stretched into looking slow. */
const scale = computed(() => Math.max(100, ...(ping.value?.times ?? [])));
const bars = computed(() =>
  (ping.value?.replies ?? []).map((ms, i) => ({
    n: i + 1,
    ms,
    width: ms === null ? 100 : Math.max(2, (ms / scale.value) * 100),
    tone: ms === null ? 'lost' : grade(ms).tone,
  })),
);

async function run(): Promise<void> {
  const d = dialect.value;
  const target = host.value.trim();
  problem.value = hostProblem(target) ?? '';
  if (!d || problem.value) return;
  busy.value = true;
  try {
    outcome.value = (await hold(props, () => runPing(props.io, d, target))) ?? { tone: 'bad', message: BUSY, answer: [] };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li class="tool" data-tool="ping">
    <div class="what">
      <h3>Ping</h3>
      <p class="summary">Whether the modem itself reaches the internet. It tells a mobile network problem from one on this computer.</p>
    </div>
    <form class="fields inline" @submit.prevent="run">
      <input v-model="host" type="text" aria-label="Host" list="ping-targets" autocomplete="off" spellcheck="false" maxlength="253" :disabled="!!blocked || busy" @input="problem = ''" />
      <datalist id="ping-targets"><option v-for="t in PING_TARGETS" :key="t" :value="t" /></datalist>
      <button type="submit" :disabled="!!blocked || busy || !host">{{ busy ? 'Pinging...' : 'Ping 4 times' }}</button>
    </form>
    <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
    <p class="hint">Sends four small packets through the modem's own data connection. Nothing is changed.</p>
    <ToolResult v-if="outcome" :outcome="outcome" :hide-identifiers="false">
      <div v-if="ping" class="ping-view">
        <div v-if="stats" class="ping-head">
          <span class="ping-grade" :data-grade="stats.grade.tone">{{ stats.grade.word }}</span>
          <span class="ping-avg"><span class="num">{{ stats.avg }}</span> ms average</span>
        </div>
        <p v-else>{{ outcome.message }}</p>
        <ol class="ping-bars" aria-label="Round trip per packet">
          <li v-for="b in bars" :key="b.n">
            <span class="ping-n">{{ b.n }}</span>
            <span class="ping-track"><span class="ping-bar" :data-grade="b.tone" :style="{ width: `${b.width}%` }" /></span>
            <span class="ping-ms">{{ b.ms === null ? 'lost' : `${b.ms} ms` }}</span>
          </li>
        </ol>
        <dl v-if="stats" class="ping-stats">
          <div><dt>Answered</dt><dd>{{ ping.received }} of {{ ping.sent }}</dd></div>
          <div><dt>Lost</dt><dd>{{ stats.loss }} %</dd></div>
          <div><dt>Fastest</dt><dd>{{ stats.min }} ms</dd></div>
          <div><dt>Slowest</dt><dd>{{ stats.max }} ms</dd></div>
          <div v-if="ping.ttl !== undefined"><dt>TTL</dt><dd>{{ ping.ttl }}</dd></div>
        </dl>
        <p v-if="stats && ping.received < ping.sent" class="reason">{{ outcome.message }}</p>
      </div>
      <p v-else>{{ outcome.message }}</p>
    </ToolResult>
  </li>
</template>

<style scoped>
.ping-view { display: grid; gap: 0.75rem; }
.ping-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem 0.9rem; }
.ping-grade { padding: 0.1rem 0.55rem; font-size: 0.8rem; font-weight: 600; border-radius: 999px; color: var(--g); background: color-mix(in srgb, var(--g) 14%, transparent); }
.ping-avg { color: var(--ink-3); font-size: 0.9rem; }
.ping-avg .num { font-size: 1.5rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.ping-bars { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.ping-bars li { display: grid; grid-template-columns: 1.2rem minmax(0, 1fr) 4.5rem; align-items: center; gap: 0.6rem; }
.ping-n { font-size: 0.78rem; color: var(--ink-3); text-align: right; }
.ping-track { height: 0.6rem; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.ping-bar { display: block; height: 100%; border-radius: 999px; background: var(--g); animation: grow 0.35s ease-out both; transform-origin: left; }
.ping-bar[data-grade='lost'] { background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--f-poor) 45%, transparent) 4px 7px); }
.ping-ms { font-family: var(--font-mono); font-size: 0.85rem; text-align: right; }
.ping-stats { display: flex; flex-wrap: wrap; gap: 0.5rem 1.6rem; margin: 0; }
.ping-stats div { display: grid; gap: 0.1rem; }
.ping-stats dt { font-size: 0.75rem; color: var(--ink-3); }
.ping-stats dd { margin: 0; font-size: 0.95rem; font-weight: 600; }
[data-grade='excellent'] { --g: var(--f-excellent); }
[data-grade='good'] { --g: var(--f-good); }
[data-grade='fair'] { --g: var(--f-fair); }
[data-grade='poor'], [data-grade='lost'] { --g: var(--f-poor); }
.ping-grade[data-grade] { color: color-mix(in srgb, var(--g) 70%, var(--ink)); }
@keyframes grow { from { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .ping-bar { animation: none; } }
</style>
