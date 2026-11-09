<script setup lang="ts">
import { computed } from 'vue';
import type { ScanItem } from '../scan/scanner';
import { parseResponse } from '../parse';
import type { Field } from '../parse';

const props = defineProps<{ items: ScanItem[] }>();

const TITLES: Record<string, string> = {
  identity: 'Identity', sim: 'SIM', network: 'Network', signal: 'Signal', bands: 'Bands',
  data: 'Data connection', usbmode: 'USB mode', voice: 'Voice', locks: 'Locks', other: 'Other',
  discovery: 'Discovered commands',
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
  const r = item.response;
  if (!r) return '(nothing sent)';
  const detail = r.errorDetail ? ` ${r.errorDetail}` : '';
  return [...r.lines, `[${r.status}${detail}]`].join('\n');
}
</script>

<template>
  <div class="details">
    <p v-if="items.length === 0" class="muted">No results yet.</p>
    <section v-for="g in groups" :key="g.category" class="card">
      <h3>{{ g.title }}</h3>
      <article v-for="(item, i) in g.items" :key="item.id + ':' + i" class="item" :data-state="item.state">
        <header>
          <code>{{ item.command }}</code>
          <span class="state" :class="item.state">{{ stateText(item) }}</span>
        </header>
        <dl v-if="fieldsOf(item)">
          <template v-for="f in fieldsOf(item)!" :key="f.key">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
        <details v-if="item.response">
          <summary>Raw response</summary>
          <pre class="raw">{{ rawText(item) }}</pre>
        </details>
        <pre v-if="item.state === 'unsupported' && item.response" class="raw inline">{{ rawText(item) }}</pre>
      </article>
    </section>
  </div>
</template>

<style scoped>
h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.item {
  padding: 0.4rem 0;
  border-top: 1px solid var(--border);
}
.item:first-of-type {
  border-top: 0;
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  justify-content: space-between;
}
code,
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
code {
  overflow-wrap: anywhere;
}
.state {
  font-size: 0.8rem;
  color: var(--muted);
}
.state.failed {
  color: var(--warn);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 1rem;
  margin: 0.3rem 0;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.raw {
  margin: 0.3rem 0 0;
  padding: 0.4rem;
  background: var(--code);
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.muted {
  color: var(--muted);
}
</style>
