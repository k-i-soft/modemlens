<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  disabled: boolean;
  /** A new value (a new session) closes the menu and withdraws a pending confirmation. */
  session: string;
}>();
const emit = defineEmits<{ (e: 'shared', kind: 'json' | 'md'): void; (e: 'full', kind: 'json' | 'md'): void }>();

const open = ref(false);
const confirmFull = ref(false);
const root = ref<HTMLElement>();

function close(): void {
  open.value = false;
  confirmFull.value = false;
}
function shared(kind: 'json' | 'md'): void {
  emit('shared', kind);
  close();
}
function full(kind: 'json' | 'md'): void {
  emit('full', kind);
  close();
}

watch(() => props.session, close);

const onPointer = (e: Event): void => {
  if (open.value && !root.value?.contains(e.target as Node)) close();
};
const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') close();
};
onMounted(() => {
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointer);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="export">
    <button type="button" :disabled="disabled" aria-haspopup="true" :aria-expanded="open" @click="open ? close() : (open = true)">
      Export
    </button>
    <div v-show="open" class="menu">
      <p class="hint">Default exports hide IMEI, serial numbers, IMSI, ICCID, IP addresses and similar identifiers.</p>
      <div class="row">
        <button type="button" :disabled="disabled" @click="shared('json')">Export JSON</button>
        <button type="button" :disabled="disabled" @click="shared('md')">Export Markdown</button>
      </div>
      <button type="button" class="full" :disabled="disabled" @click="confirmFull = true">Full export…</button>
      <div v-if="confirmFull" class="notice warn" role="alertdialog" aria-label="Full export warning">
        <p>
          The full export contains identifiers (IMEI, serial number, IMSI, ICCID, IP addresses, cell ids) and the raw
          responses. Review and edit the file yourself before you share it with anyone.
        </p>
        <div class="row">
          <button type="button" @click="full('json')">Download full JSON</button>
          <button type="button" @click="full('md')">Download full Markdown</button>
          <button type="button" @click="confirmFull = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.export { position: relative; }
.menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 20;
  display: grid;
  gap: 0.7rem;
  width: min(23rem, calc(100vw - 2rem));
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
}
.full { justify-self: start; }
</style>
