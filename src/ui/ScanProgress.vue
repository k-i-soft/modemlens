<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ title: string; done: number; total?: number; command?: string; canStop: boolean; slowNote?: string }>();
defineEmits<{ (e: 'stop'): void }>();

const fraction = computed(() => (props.total ? Math.min(1, props.done / props.total) : undefined));
const fillStyle = computed(() => ({ width: `${(fraction.value ?? 0) * 100}%` }));
</script>

<template>
  <div class="progress" role="status">
    <div class="line">
      <strong>{{ title }}</strong>
      <span class="count">{{ done }}<template v-if="total"> of {{ total }}</template> done</span>
      <code v-if="command" class="now">{{ command }}</code>
      <span v-if="slowNote" class="count">{{ slowNote }}</span>
      <button v-if="canStop" type="button" class="stop" @click="$emit('stop')">Stop</button>
    </div>
    <div
      class="bar"
      :class="{ open: fraction === undefined }"
      role="progressbar"
      :aria-valuenow="total ? done : undefined"
      :aria-valuemin="total ? 0 : undefined"
      :aria-valuemax="total"
      aria-label="Scan progress"
    >
      <span :style="fraction === undefined ? undefined : fillStyle" />
    </div>
  </div>
</template>

<style scoped>
.progress { display: grid; gap: 0.55rem; }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.9rem; font-size: 0.92rem; }
.count { color: var(--ink-3); font-size: 0.85rem; }
.now { font-size: 0.82rem; color: var(--accent); overflow-wrap: anywhere; min-width: 0; }
.stop { margin-left: auto; padding: 0.2rem 0.7rem; }
.bar { position: relative; height: 3px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); transition: width 0.2s ease; }
.bar.open span { width: 30%; animation: sweep 1.6s ease-in-out infinite alternate; }
@keyframes sweep { from { transform: translateX(-10%); } to { transform: translateX(245%); } }
</style>
