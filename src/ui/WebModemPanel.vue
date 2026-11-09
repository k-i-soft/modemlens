<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ScanReport } from '../scan/scanner';
import { buildBookmarklet } from '../web/bookmarklets';
import { WEB_DIALECTS } from '../web/dialects';
import type { WebDialect } from '../web/dialects';
import ImportCapture from './ImportCapture.vue';

const props = defineProps<{ dialect?: WebDialect['id'] }>();
defineEmits<{ (e: 'imported', report: ScanReport): void }>();

const offers = computed(() =>
  WEB_DIALECTS.filter((d) => !props.dialect || d.id === props.dialect).map((d) => ({
    id: d.id,
    label: d.label,
    verified: d.verified,
    href: buildBookmarklet(d),
  })),
);

const copyResult = ref<{ id: string; text: string } | null>(null);

async function copy(id: string, href: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(href);
    copyResult.value = { id, text: 'Copied. Make a new bookmark and paste this as its address.' };
  } catch {
    copyResult.value = { id, text: 'This browser blocked copying. Right-click the link and copy its address instead.' };
  }
}
</script>

<template>
  <div class="web-modem">
    <div v-for="o in offers" :key="o.id" class="offer">
      <p class="name">
        {{ o.label }}
        <span v-if="!o.verified" class="unverified">Unverified: not yet tried on a real modem</span>
      </p>
      <div class="row">
        <!-- The script is meant for the modem's own page: here it must not run, so the click does nothing. -->
        <span class="drag">Drag this to your bookmarks bar:</span>
        <a class="bookmarklet" :href="o.href" @click.prevent>ModemLens capture</a>
        <button type="button" @click="copy(o.id, o.href)">Copy</button>
      </div>
      <p v-if="copyResult?.id === o.id" class="hint" role="status">{{ copyResult.text }}</p>
    </div>
    <p class="steps">Then open the stick's own web page, click the bookmark there, and import the file it saves.</p>
    <ImportCapture @imported="$emit('imported', $event)" />
  </div>
</template>

<style scoped>
.web-modem { display: grid; gap: 0.85rem; min-width: 0; }
.offer { display: grid; gap: 0.35rem; }
.name { font-size: 0.9rem; font-weight: 600; color: var(--ink); }
.unverified { margin-left: 0.5rem; font-size: 0.78rem; font-weight: 500; color: var(--r-fair); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.bookmarklet {
  padding: 0.35rem 0.8rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  background: var(--accent-soft);
  border: 1px dashed var(--accent);
  border-radius: var(--radius-s);
  cursor: grab;
}
.drag, .steps { font-size: 0.9rem; color: var(--ink-2); }
</style>
