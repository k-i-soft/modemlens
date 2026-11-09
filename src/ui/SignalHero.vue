<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from './dashboard';
import type { Dashboard } from './dashboard';
import type { LiveSample } from './liveSignal';
import BarMeter from './BarMeter.vue';
import RatingScale from './RatingScale.vue';
import LiveSignal from './LiveSignal.vue';

const props = defineProps<{
  signal: Dashboard['signal'];
  scanning: boolean;
  liveEnabled: boolean;
  livePaused: boolean;
  liveSamples: LiveSample[];
  liveAvailable: boolean;
  liveUnavailableReason?: string;
}>();
defineEmits<{ (e: 'live', on: boolean): void }>();

const basis = computed(() => props.signal.values.find((v) => v.metric === props.signal.basis));
</script>

<template>
  <section class="display signal" aria-label="Signal">
    <div class="headline">
      <BarMeter :bars="signal.bars" :rating="signal.rating" :word="signal.word" />
      <div v-if="basis" class="verdict" :data-rating="signal.rating">
        <p class="word">{{ signal.word }}</p>
        <p class="figure">
          <span class="num">{{ formatNumber(basis.value) }}</span><span class="unit">{{ basis.unit }}</span>
          <span class="of">{{ basis.label }}, {{ signal.bars }} of 5 bars</span>
        </p>
      </div>
      <div v-else class="verdict">
        <template v-if="signal.radioOff">
          <p class="word muted">Radio off</p>
          <p class="of">The radio is off, so there is no signal to measure.</p>
        </template>
        <template v-else>
          <p class="word muted">{{ scanning ? 'Measuring' : 'No reading' }}</p>
          <p class="of">{{ scanning ? 'Waiting for the first signal reading.' : 'The modem did not report a signal value.' }}</p>
        </template>
      </div>
    </div>
    <div v-if="signal.values.length" class="scales">
      <RatingScale v-for="v in signal.values" :key="v.metric" :reading="v" />
    </div>
    <LiveSignal
      :enabled="liveEnabled"
      :paused="livePaused"
      :samples="liveSamples"
      :available="liveAvailable"
      :unavailable-reason="liveUnavailableReason"
      @toggle="$emit('live', $event)"
    />
  </section>
</template>

<style scoped>
.signal {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  padding: clamp(1.25rem, 3vw, 2.1rem);
  min-width: 0;
}
.headline { display: flex; align-items: flex-end; gap: clamp(1.1rem, 3vw, 2rem); }
.verdict { min-width: 0; }
.word {
  font-size: clamp(2.5rem, 6vw, 3.6rem);
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--rating);
}
.word.muted { color: var(--ink-2); }
.figure { margin-top: 0.5rem; }
.num { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; }
.of { margin-left: 0.55rem; font-size: 0.82rem; color: var(--ink-3); }
.figure + .of, p.of { margin: 0.5rem 0 0; }
.scales { display: grid; grid-template-columns: repeat(auto-fit, minmax(14.5rem, 1fr)); gap: 1rem 2.25rem; }
</style>
