<script setup lang="ts">
import type { Row } from './dashboard';

defineProps<{ rows: Row[] }>();
</script>

<template>
  <section class="panel" aria-label="Network and cell">
    <span class="label">Network and cell</span>
    <dl>
      <div v-for="r in rows" :key="r.key">
        <dt>{{ r.label }}</dt>
        <dd class="mono">{{ r.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 1.1rem 1.5rem; margin: 0; }
dt { font-size: 0.8rem; color: var(--ink-3); }
dd { margin: 0.1rem 0 0; font-size: 1.15rem; font-weight: 500; letter-spacing: -0.01em; overflow-wrap: anywhere; }
</style>
