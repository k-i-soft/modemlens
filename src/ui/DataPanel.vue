<script setup lang="ts">
import type { DataContext } from './dashboard';

defineProps<{ contexts: DataContext[] }>();
</script>

<template>
  <section class="panel" aria-label="Data connections">
    <span class="label">Data connections</span>
    <ul>
      <li v-for="c in contexts" :key="c.cid" :class="{ idle: c.active === false }">
        <span class="cid mono">{{ c.cid }}</span>
        <div class="body">
          <p class="apn mono">{{ c.apn ?? 'No APN' }}<span v-if="c.type" class="type">{{ c.type }}</span></p>
          <p v-if="c.addresses.length" class="addresses mono">
            <span v-for="(a, i) in c.addresses" :key="i">{{ a }}</span>
          </p>
        </div>
        <span v-if="c.active !== undefined" class="state" :data-tone="c.active ? 'ok' : 'neutral'">
          <span class="dot" aria-hidden="true" />{{ c.active ? 'Active' : 'Inactive' }}
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
ul { margin: 0; padding: 0; list-style: none; }
li { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr) auto; align-items: baseline; gap: 0.75rem; padding-block: 0.65rem; border-top: 1px solid var(--line); }
li:first-child { border-top: 0; padding-top: 0; }
li:last-child { padding-bottom: 0; }
.cid { font-size: 0.82rem; color: var(--ink-3); }
.apn { font-size: 1.02rem; font-weight: 500; overflow-wrap: anywhere; }
.idle .apn { color: var(--ink-2); font-weight: 400; }
.type { margin-left: 0.6rem; font-family: var(--font-sans); font-size: 0.75rem; font-weight: 400; color: var(--ink-3); }
.addresses { display: flex; flex-wrap: wrap; gap: 0.1rem 1rem; margin-top: 0.15rem; font-size: 0.8rem; color: var(--ink-2); overflow-wrap: anywhere; }
.addresses span { min-width: 0; }
.state { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; font-weight: 500; color: var(--ink-2); }
.dot { width: 7px; height: 7px; background: var(--tone); border-radius: 50%; }
</style>
