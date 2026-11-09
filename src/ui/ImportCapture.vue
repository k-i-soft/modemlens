<script setup lang="ts">
import { ref } from 'vue';
import type { ScanReport } from '../scan/scanner';
import { CAPTURE_TOO_LARGE, importWebCapture, InvalidCaptureError, MAX_CAPTURE_BYTES } from '../web/importReport';

const emit = defineEmits<{ (e: 'imported', report: ScanReport): void }>();

const COULD_NOT_READ = 'This file could not be read. Nothing was imported.';

const error = ref('');

async function onChoose(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  error.value = '';
  if (file.size > MAX_CAPTURE_BYTES) {
    error.value = CAPTURE_TOO_LARGE;
    input.value = '';
    return;
  }
  try {
    emit('imported', importWebCapture(await file.text()));
  } catch (e) {
    error.value = e instanceof InvalidCaptureError ? e.message : COULD_NOT_READ;
  } finally {
    // So that choosing the same file again fires a change.
    input.value = '';
  }
}
</script>

<template>
  <div class="capture">
    <label class="import">
      <span class="name">Import a modem capture</span>
      <input type="file" accept=".json,application/json" @change="onChoose" />
    </label>
    <p v-if="error" class="import-error notice warn" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.capture { display: grid; gap: 0.5rem; min-width: 0; }
.import { display: grid; gap: 0.3rem; font-size: 0.85rem; color: var(--ink-2); }
.name { font-weight: 600; color: var(--ink); }
input { max-width: 100%; font-size: 0.82rem; }
</style>
