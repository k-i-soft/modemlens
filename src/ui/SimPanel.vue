<script setup lang="ts">
import { computed } from 'vue';
import type { Dashboard } from './dashboard';
import type { GlossaryTerm } from './glossary';
import HelpTip from './HelpTip.vue';

const props = defineProps<{ sim: Dashboard['sim'] }>();

const PIN_MAX = 3;
const PUK_MAX = 10;

function dots(left: number, max: number): boolean[] {
  return Array.from({ length: Math.max(left, max) }, (_, i) => i < left);
}
const attempts = computed(() => {
  const out: Array<{ name: string; term: GlossaryTerm; left: number; dots: boolean[] }> = [];
  if (props.sim.pinLeft !== undefined) out.push({ name: 'PIN', term: 'PIN attempts', left: props.sim.pinLeft, dots: dots(props.sim.pinLeft, PIN_MAX) });
  if (props.sim.pukLeft !== undefined) out.push({ name: 'PUK', term: 'PUK attempts', left: props.sim.pukLeft, dots: dots(props.sim.pukLeft, PUK_MAX) });
  return out;
});
/** A status to read, not a switch: this page cannot change it. */
const pinLock = computed(() => {
  if (props.sim.lock === 'enabled') return { word: 'PIN on', tone: 'ok' };
  if (props.sim.lock === 'disabled') return { word: 'PIN off', tone: 'neutral' };
  return undefined;
});
</script>

<template>
  <section class="panel" aria-label="SIM">
    <span class="label">SIM</span>
    <p v-if="sim.state" class="state">
      {{ sim.state }}<span v-if="pinLock" class="pin-lock" :data-tone="pinLock.tone"><span class="dot" aria-hidden="true" />{{ pinLock.word }}</span>
    </p>
    <ul v-if="attempts.length" class="attempts">
      <li v-for="a in attempts" :key="a.name">
        <span class="name">{{ a.name }}<HelpTip :term="a.term" /></span>
        <span class="dots" role="img" :aria-label="`${a.name}: ${a.left} attempts left`"><i v-for="(on, i) in a.dots" :key="i" :class="{ on }" /></span>
        <span class="count">{{ a.left }} left</span>
      </li>
    </ul>
    <dl v-if="sim.iccid || sim.imsi || sim.msisdn">
      <template v-if="sim.iccid"><dt>ICCID<HelpTip term="ICCID" /></dt><dd class="mono">{{ sim.iccid }}</dd></template>
      <template v-if="sim.imsi"><dt>IMSI<HelpTip term="IMSI" /></dt><dd class="mono">{{ sim.imsi }}</dd></template>
      <template v-if="sim.msisdn"><dt>Number</dt><dd class="mono">{{ sim.msisdn }}</dd></template>
    </dl>
  </section>
</template>

<style scoped>
.state { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.015em; line-height: 1.2; }
.pin-lock { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: 0.6rem; padding: 0.05rem 0.55rem; font-size: 0.78rem; font-weight: 500; letter-spacing: 0; color: var(--ink-2); vertical-align: middle; border: 1px solid var(--line); border-radius: 999px; }
.pin-lock .dot { width: 8px; height: 8px; background: var(--tone); border-radius: 50%; }
.attempts { display: grid; gap: 0.5rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.attempts li { display: grid; grid-template-columns: 3.4rem 1fr auto; align-items: center; gap: 0.5rem; }
.name { font-size: 0.8rem; font-weight: 600; color: var(--ink-2); }
.count { font-size: 0.8rem; color: var(--ink-3); }
.dots { display: flex; flex-wrap: wrap; gap: 5px; }
.dots i { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ink-3); opacity: 0.6; }
.dots i.on { background: var(--accent); box-shadow: none; opacity: 1; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1rem; margin: 1.1rem 0 0; }
dt { font-size: 0.8rem; color: var(--ink-3); align-self: center; }
dd { margin: 0; font-size: 0.86rem; overflow-wrap: anywhere; }
</style>
