<script setup lang="ts">
import { computed } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';
import type { RefreshState } from './statusRefresh';

const props = defineProps<{ state: RefreshState; now: number }>();
defineEmits<{ (e: 'toggle', on: boolean): void; (e: 'resume'): void }>();

const updated = computed(() => {
  if (props.state.updatedAt === null) return '';
  const seconds = Math.max(0, Math.round((props.now - props.state.updatedAt) / 1000));
  return seconds < 120 ? `Updated ${seconds} s ago` : `Updated ${Math.round(seconds / 60)} min ago`;
});
</script>

<template>
  <div class="auto-refresh">
    <ToggleSwitch label="Auto refresh" :model-value="state.enabled" @update:model-value="$emit('toggle', $event)" />
    <p v-if="state.stalled" class="stalled" role="status">
      Auto refresh paused: the modem stopped answering.
      <button type="button" @click="$emit('resume')">Resume</button>
    </p>
    <p v-else-if="state.enabled" class="hint">{{ state.refreshing ? 'Refreshing' : updated }}</p>
  </div>
</template>

<style scoped>
.auto-refresh { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; font-size: 0.8rem; }
.auto-refresh :deep(.switch) { font-size: 0.8rem; }
.hint { font-size: 0.8rem; min-width: 7rem; }
.stalled { color: var(--r-fair); }
.stalled button { margin-left: 0.4rem; padding: 0.15rem 0.55rem; font-size: 0.8rem; }
</style>
