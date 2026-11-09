<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Transport } from '../transport/types';

const props = defineProps<{
  connectors: { serial: () => Promise<Transport>; usb: () => Promise<Transport> };
  /** Overrides browser detection (demo mode). */
  forceSupported?: boolean;
  busy?: boolean;
  reconnect?: boolean;
}>();
const emit = defineEmits<{ (e: 'connected', transport: Transport, via: 'serial' | 'usb'): void }>();

const hasSerial = computed(() => props.forceSupported || 'serial' in navigator);
const hasUsb = computed(() => props.forceSupported || 'usb' in navigator);
const supported = computed(() => hasSerial.value || hasUsb.value);
const error = ref('');
const working = ref(false);

async function connect(via: 'serial' | 'usb'): Promise<void> {
  error.value = '';
  working.value = true;
  try {
    emit('connected', await props.connectors[via](), via);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <section class="connect">
    <p v-if="!supported" class="note warn" role="alert">
      This browser cannot talk to USB devices. ModemLens works only in Chrome or Edge (Chromium-based, desktop).
      Safari and Firefox are not supported.
    </p>
    <div class="buttons">
      <button type="button" :disabled="!hasSerial || working || busy" @click="connect('serial')">
        {{ reconnect ? 'Reconnect: Serial port' : 'Serial port' }}
      </button>
      <button type="button" :disabled="!hasUsb || working || busy" @click="connect('usb')">
        {{ reconnect ? 'Reconnect: USB direct' : 'USB direct' }}
      </button>
    </div>
    <p class="hint">
      Serial port uses a COM port the system already created for the modem. USB direct talks to the modem itself
      and needs a WinUSB driver on Windows.
    </p>
    <p v-if="error" class="note warn" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.hint {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
</style>
