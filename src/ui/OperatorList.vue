<script setup lang="ts">
import type { Operator } from './dashboard';

defineProps<{ operators: Operator[] }>();
</script>

<template>
  <section class="panel" aria-label="Operators">
    <span class="label">Operators in range</span>
    <ul>
      <li v-for="o in operators" :key="o.plmn + (o.technology ?? '')" :class="{ current: o.current }">
        <span class="name">{{ o.name }}</span>
        <span class="plmn mono">{{ o.technology ? `${o.plmn} ${o.technology}` : o.plmn }}</span>
        <span class="status">{{ o.current ? 'Current' : o.status }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
ul { margin: 0; padding: 0; list-style: none; }
li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 0.75rem; padding-block: 0.55rem; border-top: 1px solid var(--line); }
li:first-child { border-top: 0; padding-top: 0; }
li:last-child { padding-bottom: 0; }
.name { font-weight: 500; overflow-wrap: anywhere; }
.plmn { grid-column: 1; font-size: 0.78rem; color: var(--ink-3); }
.status { grid-column: 2; grid-row: 1; font-size: 0.8rem; color: var(--ink-3); }
.current .status { color: var(--accent); font-weight: 600; }
.current .name::after { content: ''; display: inline-block; width: 7px; height: 7px; margin-left: 0.45rem; background: var(--accent); border-radius: 50%; vertical-align: 0.1em; }
</style>
