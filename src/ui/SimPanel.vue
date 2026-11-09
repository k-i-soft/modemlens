<script setup lang="ts">
import { computed } from 'vue';
import type { Dashboard } from './dashboard';

const props = defineProps<{ sim: Dashboard['sim'] }>();

const PIN_MAX = 3;
const PUK_MAX = 10;

function dots(left: number, max: number): boolean[] {
  return Array.from({ length: Math.max(left, max) }, (_, i) => i < left);
}
const attempts = computed(() => {
  const out: Array<{ name: string; left: number; dots: boolean[] }> = [];
  if (props.sim.pinLeft !== undefined) out.push({ name: 'PIN', left: props.sim.pinLeft, dots: dots(props.sim.pinLeft, PIN_MAX) });
  if (props.sim.pukLeft !== undefined) out.push({ name: 'PUK', left: props.sim.pukLeft, dots: dots(props.sim.pukLeft, PUK_MAX) });
  return out;
});
</script>

<template>
  <section class="panel" aria-label="SIM">
    <span class="label">SIM</span>
    <p v-if="sim.state" class="state">
      {{ sim.state }}<span v-if="sim.lock" class="lock">PIN lock {{ sim.lock }}</span>
    </p>
    <ul v-if="attempts.length" class="attempts">
      <li v-for="a in attempts" :key="a.name" role="img" :aria-label="`${a.name}: ${a.left} attempts left`">
        <span class="name">{{ a.name }}</span>
        <span class="dots" aria-hidden="true"><i v-for="(on, i) in a.dots" :key="i" :class="{ on }" /></span>
        <span class="count">{{ a.left }} left</span>
      </li>
    </ul>
    <dl v-if="sim.iccid || sim.imsi || sim.msisdn">
      <template v-if="sim.iccid"><dt>ICCID</dt><dd class="mono">{{ sim.iccid }}</dd></template>
      <template v-if="sim.imsi"><dt>IMSI</dt><dd class="mono">{{ sim.imsi }}</dd></template>
      <template v-if="sim.msisdn"><dt>Number</dt><dd class="mono">{{ sim.msisdn }}</dd></template>
    </dl>
  </section>
</template>

<style scoped>
.state { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.015em; line-height: 1.2; }
.lock { margin-left: 0.6rem; font-size: 0.82rem; font-weight: 400; letter-spacing: 0; color: var(--ink-3); }
.attempts { display: grid; gap: 0.5rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.attempts li { display: grid; grid-template-columns: 2.5rem 1fr auto; align-items: center; gap: 0.5rem; }
.name { font-size: 0.8rem; font-weight: 600; color: var(--ink-2); }
.count { font-size: 0.8rem; color: var(--ink-3); }
.dots { display: flex; flex-wrap: wrap; gap: 5px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ink-3); opacity: 0.6; }
.dots i.on { background: var(--accent); box-shadow: none; opacity: 1; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1rem; margin: 1.1rem 0 0; }
dt { font-size: 0.8rem; color: var(--ink-3); align-self: center; }
dd { margin: 0; font-size: 0.86rem; overflow-wrap: anywhere; }
</style>
