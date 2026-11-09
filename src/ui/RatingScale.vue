<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber, METRICS, rate } from './dashboard';
import type { Rating, SignalValue } from './dashboard';

const props = defineProps<{ reading: SignalValue }>();

const spec = computed(() => METRICS[props.reading.metric]);
const percent = (v: number): number => ((v - spec.value.min) / (spec.value.max - spec.value.min)) * 100;
const clamped = computed(() => Math.min(spec.value.max, Math.max(spec.value.min, props.reading.value)));

const zones = computed(() => {
  const s = spec.value;
  const limits: Array<[Rating, number, number]> = [
    ['poor', s.min, s.fair],
    ['fair', s.fair, s.good],
    ['good', s.good, s.excellent],
    ['excellent', s.excellent, s.max],
  ];
  return limits.map(([rating, from, to]) => ({
    rating,
    current: rating === props.reading.rating,
    style: { left: `${percent(from)}%`, width: `${percent(to) - percent(from)}%` },
  }));
});

const ticks = computed(() => {
  const s = spec.value;
  return [s.fair, s.good, s.excellent].map((v) => ({ v, text: formatNumber(v), style: { left: `${percent(v)}%` } }));
});

const markerStyle = computed(() => ({ left: `${percent(clamped.value)}%` }));
const rating = computed(() => rate(props.reading.metric, props.reading.value));
</script>

<template>
  <div class="scale" :data-rating="rating">
    <div class="head">
      <span class="name">{{ reading.label }}</span>
      <span class="reading">
        <span class="num">{{ formatNumber(reading.value) }}</span><span class="unit">{{ reading.unit }}</span>
        <span class="word">{{ reading.word }}</span>
      </span>
    </div>
    <div
      class="track"
      role="meter"
      :aria-label="reading.label"
      :aria-valuemin="spec.min"
      :aria-valuemax="spec.max"
      :aria-valuenow="clamped"
      :aria-valuetext="`${reading.value} ${reading.unit}, ${reading.word.toLowerCase()}`"
    >
      <span
        v-for="z in zones"
        :key="z.rating"
        class="zone"
        :class="{ current: z.current }"
        :data-rating="z.rating"
        :style="z.style"
      />
      <span class="marker" :style="markerStyle" />
    </div>
    <div class="ticks" aria-hidden="true">
      <span v-for="t in ticks" :key="t.v" :style="t.style">{{ t.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.name { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.05em; color: var(--ink-2); }
.num { font-size: 1.3rem; font-weight: 600; letter-spacing: -0.01em; }
.word { margin-left: 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--rating); }
.track { position: relative; height: 8px; margin-top: 0.45rem; }
.zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--rating-fill);
  opacity: 0.3;
  box-shadow: inset 1px 0 0 var(--display-bg), inset -1px 0 0 var(--display-bg);
  transition: opacity 0.25s ease;
}
.zone:first-of-type { border-radius: 4px 0 0 4px; }
.zone:nth-of-type(4) { border-radius: 0 4px 4px 0; }
.zone.current { opacity: 1; }
.marker {
  position: absolute;
  top: -5px;
  width: 4px;
  height: 18px;
  margin-left: -2px;
  background: var(--ink);
  border-radius: 2px;
  box-shadow: 0 0 0 2px var(--display-bg);
  transition: left 0.45s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.ticks {
  position: relative;
  height: 1rem;
  margin-top: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--ink-3);
}
.ticks span { position: absolute; transform: translateX(-50%); }
</style>
