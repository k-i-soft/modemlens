<script setup lang="ts">
import type { Dashboard } from './dashboard';
import HelpTip from './HelpTip.vue';

defineProps<{ bands: Dashboard['bands'] }>();
</script>

<template>
  <section v-if="bands.items.length || bands.otherActive" class="bands" aria-label="LTE bands">
    <span class="label">LTE bands<HelpTip term="LTE bands" /></span>
    <ul>
      <li v-for="b in bands.items" :key="b.band" class="mono" :class="{ active: b.active }">
        B{{ b.band }}<span v-if="b.active" class="on">active</span><HelpTip v-if="b.active" term="Active band" />
      </li>
      <li v-if="bands.otherActive" class="mono active">{{ bands.otherActive }}<span class="on">active</span><HelpTip term="Active band" /></li>
    </ul>
  </section>
</template>

<style scoped>
.bands {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1.25rem;
  padding-block: 1rem;
  border-block: 1px solid var(--line);
  animation: panel-in 0.28s ease-out both;
}
ul { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
li {
  padding: 0.2rem 0.6rem;
  font-size: 0.85rem;
  color: var(--ink-2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
  border-radius: 6px;
}
li.active { color: var(--accent-ink); background: var(--accent); box-shadow: none; font-weight: 600; }
.on { margin-left: 0.45rem; font-family: var(--font-sans); font-size: 0.72rem; font-weight: 500; }
.active :deep(.help-q) { color: inherit; border-color: currentColor; }
</style>
