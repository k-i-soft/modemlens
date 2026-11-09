<script setup lang="ts">
import { computed } from 'vue';
import type { ScanItem } from '../scan/scanner';
import { parseResponse } from '../parse';
import type { Field } from '../parse';
import { MASK } from './dashboard';
import type { GlossaryTerm } from './glossary';
import HelpTip from './HelpTip.vue';

const props = defineProps<{ items: ScanItem[]; hideIdentifiers?: boolean }>();

/** By parser keys, and it only ever selects fixed text. */
const HELP = new Map<string, GlossaryTerm>([['smsc', 'SMS centre']]);

const TITLES: Record<string, string> = {
  identity: 'Identity', sim: 'SIM', network: 'Network', signal: 'Signal', bands: 'Bands',
  data: 'Data connection', usbmode: 'USB mode', voice: 'Voice', locks: 'Locks', other: 'Other',
  discovery: 'Discovered commands', web: 'Modem web page',
};

const groups = computed(() => {
  const map = new Map<string, ScanItem[]>();
  for (const item of props.items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return [...map.entries()].map(([category, items]) => ({ category, title: TITLES[category] ?? category, items }));
});

function fieldsOf(item: ScanItem): Field[] | null {
  if (!item.parser || !item.response) return null;
  return parseResponse(item.parser, item.response);
}

function shownValue(f: Field): string {
  return props.hideIdentifiers && f.sensitive !== 'none' ? MASK : f.value;
}

function stateText(item: ScanItem): string {
  switch (item.state) {
    case 'done': return 'answered';
    case 'skipped': return 'skipped (needs a usable SIM)';
    // An error can also come from the SIM or the network state, so do not claim the modem lacks the feature.
    case 'unsupported': return 'no answer / error';
    default: return 'failed (timeout or connection lost)';
  }
}

function rawText(item: ScanItem): string {
  // Raw text carries no marks, so nothing of it can be shown as safe.
  if (props.hideIdentifiers) return 'Hidden while "Hide identifiers" is on.';
  const r = item.response;
  if (!r) return '(nothing sent)';
  const detail = r.errorDetail ? ` ${r.errorDetail}` : '';
  return [...r.lines, `[${r.status}${detail}]`].join('\n');
}
</script>

<template>
  <div class="details">
    <p v-if="items.length === 0" class="hint">No results yet.</p>
    <section v-for="g in groups" :key="g.category" class="group">
      <h3 class="label">{{ g.title }}</h3>
      <div class="rows">
        <article v-for="(item, i) in g.items" :key="item.id + ':' + i" class="item" :data-state="item.state">
          <header>
            <code>{{ item.command }}</code>
            <span class="state" :class="item.state">{{ stateText(item) }}</span>
          </header>
          <dl v-if="fieldsOf(item)">
            <template v-for="f in fieldsOf(item)!" :key="f.key">
              <dt>{{ f.label }}<HelpTip v-if="HELP.has(f.key)" :term="HELP.get(f.key)!" /></dt>
              <dd>{{ shownValue(f) }}</dd>
            </template>
          </dl>
          <details v-if="item.response">
            <summary>Raw response</summary>
            <pre class="raw">{{ rawText(item) }}</pre>
          </details>
          <pre v-if="item.state === 'unsupported' && item.response" class="raw inline">{{ rawText(item) }}</pre>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.details { display: flex; flex-direction: column; gap: 1.75rem; }
.group { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 0.5rem 1.5rem; animation: panel-in 0.28s ease-out both; }
.group > .label { margin: 0.8rem 0 0; }
.rows { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-m); padding-inline: 1.1rem; }
.item { padding-block: 0.75rem; border-top: 1px solid var(--line); }
.item:first-child { border-top: 0; }
header { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; justify-content: space-between; align-items: baseline; }
code { font-size: 0.86rem; font-weight: 500; overflow-wrap: anywhere; min-width: 0; }
.state { font-size: 0.78rem; color: var(--ink-3); }
.state.failed { color: var(--r-fair); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.15rem 1.25rem; margin: 0.5rem 0 0; font-size: 0.9rem; }
dt { color: var(--ink-3); }
dd { margin: 0; font-family: var(--font-mono); font-size: 0.85rem; overflow-wrap: anywhere; }
details { margin-top: 0.4rem; }
summary { cursor: pointer; font-size: 0.8rem; color: var(--ink-3); }
.raw {
  margin: 0.4rem 0 0;
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
  background: var(--surface-2);
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .group { grid-template-columns: minmax(0, 1fr); }
  .group > .label { margin: 0; }
}
</style>
