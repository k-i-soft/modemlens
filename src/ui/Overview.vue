<script setup lang="ts">
import { computed } from 'vue';
import type { Dashboard } from './dashboard';
import type { LiveSample } from './liveSignal';
import IdentityHero from './IdentityHero.vue';
import SignalHero from './SignalHero.vue';
import BandStrip from './BandStrip.vue';
import NetworkPanel from './NetworkPanel.vue';
import SimPanel from './SimPanel.vue';
import DataPanel from './DataPanel.vue';
import DevicePanel from './DevicePanel.vue';
import NeighbourBars from './NeighbourBars.vue';
import OperatorList from './OperatorList.vue';

const props = defineProps<{
  dashboard: Dashboard;
  scanning: boolean;
  liveEnabled: boolean;
  livePaused: boolean;
  liveSamples: LiveSample[];
  liveAvailable: boolean;
}>();
defineEmits<{ (e: 'live', on: boolean): void }>();

const hasSim = computed(() => Object.keys(props.dashboard.sim).length > 0);
const hasDevice = computed(() => Object.keys(props.dashboard.device).length > 0);
</script>

<template>
  <div class="overview">
    <div class="hero">
      <IdentityHero :identity="dashboard.identity" :network="dashboard.network" :chips="dashboard.chips" :scanning="scanning" />
      <SignalHero
        :signal="dashboard.signal"
        :scanning="scanning"
        :live-enabled="liveEnabled"
        :live-paused="livePaused"
        :live-samples="liveSamples"
        :live-available="liveAvailable"
        @live="$emit('live', $event)"
      />
    </div>

    <BandStrip :bands="dashboard.bands" />

    <div class="columns">
      <div class="column wide">
        <NetworkPanel v-if="dashboard.cell.length" :rows="dashboard.cell" />
        <DataPanel v-if="dashboard.data.length" :contexts="dashboard.data" />
        <NeighbourBars v-if="dashboard.neighbours.length" :neighbours="dashboard.neighbours" />
      </div>
      <div class="column">
        <SimPanel v-if="hasSim" :sim="dashboard.sim" />
        <DevicePanel v-if="hasDevice" :device="dashboard.device" />
        <OperatorList v-if="dashboard.operators.length" :operators="dashboard.operators" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 1.5rem; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: clamp(1.5rem, 4vw, 3.5rem);
  padding-block: clamp(0.75rem, 2vw, 1.5rem) 0;
}
.columns { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 1rem; align-items: start; }
.column { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
@media (max-width: 860px) {
  .hero, .columns { grid-template-columns: minmax(0, 1fr); }
}
</style>
