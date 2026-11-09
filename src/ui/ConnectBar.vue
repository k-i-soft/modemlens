<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { PickerCancelledError } from '../transport/types';
import type { Connectors, Transport } from '../transport/types';
import { DEFAULT_BAUD_RATE, serialUsbId } from '../transport/webSerial';
import { NoAtChannelError, usbId } from '../transport/webUsb';
import type { UsbDeviceDescription } from '../transport/types';
import type { DeviceClassification } from '../profiles/known-devices';
import type { ScanReport } from '../scan/scanner';
import NoAtGuidance from './NoAtGuidance.vue';

const props = defineProps<{
  connectors: Connectors;
  /** Ends the previous session; a connector calls it between picking and opening a device. */
  beforeOpen?: () => Promise<void>;
  /** Overrides browser detection (demo mode). */
  forceSupported?: boolean;
  busy?: boolean;
  reconnect?: boolean;
  /** A slim row for use above the results, instead of the large choices of the start screen. */
  compact?: boolean;
  /** Counts imported reports: each one replaces what this bar was saying about the last attempt. */
  importCount?: number;
}>();
const emit = defineEmits<{ (e: 'connected', transport: Transport, via: 'serial' | 'usb'): void; (e: 'imported', report: ScanReport): void }>();

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const hasSerial = computed(() => props.forceSupported || 'serial' in navigator);
const hasUsb = computed(() => props.forceSupported || 'usb' in navigator);
const supported = computed(() => hasSerial.value || hasUsb.value);
const error = ref('');
const guidance = ref<{ classification?: DeviceClassification; device?: UsbDeviceDescription; reason: string } | null>(null);
const working = ref(false);
const baudRate = ref(DEFAULT_BAUD_RATE);
const probing = ref<number | null>(null);
const replugNeeded = ref(false);
const permittedPorts = shallowRef<SerialPort[]>([]);
const permittedDevices = shallowRef<USBDevice[]>([]);

const previous = computed(() => [
  ...permittedPorts.value.map((port, i) => ({
    key: `serial-${i}`,
    label: `Serial: ${serialUsbId(port) ?? `port ${i + 1}`}`,
    connect: () => connectSerial(port),
  })),
  ...permittedDevices.value.map((device, i) => ({
    key: `usb-${i}`,
    label: `USB: ${device.productName || usbId(device)}`,
    connect: () => connectUsb(device),
  })),
]);

async function connect(via: 'serial' | 'usb', open: (beforeOpen: () => Promise<void>) => Promise<Transport>): Promise<void> {
  error.value = '';
  guidance.value = null;
  working.value = true;
  try {
    const transport = await open(props.beforeOpen ?? (() => Promise.resolve()));
    replugNeeded.value = transport.hadPendingClaim === true;
    emit('connected', transport, via);
  } catch (e) {
    if (e instanceof PickerCancelledError) return;
    replugNeeded.value = e instanceof NoAtChannelError && e.hadPendingClaim;
    if (e instanceof NoAtChannelError && (e.classification || e.device)) {
      guidance.value = { classification: e.classification, device: e.device, reason: e.message };
    } else error.value = e instanceof Error ? e.message : String(e);
  } finally {
    working.value = false;
    probing.value = null;
    void refreshPermitted();
  }
}

function connectSerial(port?: SerialPort): Promise<void> {
  return connect('serial', (beforeOpen) => props.connectors.serial({ beforeOpen, baudRate: baudRate.value, ...(port ? { port } : {}) }));
}

function connectUsb(device?: USBDevice): Promise<void> {
  const onProbe = (i: number): void => {
    probing.value = i;
  };
  return connect('usb', (beforeOpen) => props.connectors.usb({ beforeOpen, onProbe, ...(device ? { device } : {}) }));
}

watch(() => props.importCount, () => {
  guidance.value = null;
  error.value = '';
});

/** Failures only mean there are no extra buttons. */
async function refreshPermitted(): Promise<void> {
  if (props.forceSupported) return;
  try {
    permittedPorts.value = (await navigator.serial?.getPorts?.()) ?? [];
  } catch {
    permittedPorts.value = [];
  }
  try {
    permittedDevices.value = (await navigator.usb?.getDevices?.()) ?? [];
  } catch {
    permittedDevices.value = [];
  }
}

// A replugged modem is a new object in the browser, so the old button would no longer work.
const onDeviceChange = (): void => void refreshPermitted();
const deviceEvents = ['connect', 'disconnect'] as const;

onMounted(() => {
  if (props.forceSupported) return;
  void refreshPermitted();
  for (const name of deviceEvents) {
    navigator.serial?.addEventListener?.(name, onDeviceChange);
    navigator.usb?.addEventListener?.(name, onDeviceChange);
  }
});

onBeforeUnmount(() => {
  if (props.forceSupported) return;
  for (const name of deviceEvents) {
    navigator.serial?.removeEventListener?.(name, onDeviceChange);
    navigator.usb?.removeEventListener?.(name, onDeviceChange);
  }
});
</script>

<template>
  <section class="connect" :class="{ compact }">
    <p v-if="!supported" class="notice warn" role="alert">
      This browser cannot talk to USB devices. ModemLens works only in Chrome or Edge (Chromium-based, desktop).
      Safari and Firefox are not supported.
    </p>

    <div class="choices">
      <button type="button" class="choice" :disabled="!hasUsb || working || busy" @click="connectUsb()">
        <svg v-if="!compact" class="icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 29V5" />
          <path d="M12.5 8 16 3.5 19.5 8" />
          <path d="M16 23 8 18v-5" />
          <circle cx="8" cy="10.5" r="2.5" />
          <path d="M16 19.5 24 15v-3" />
          <rect x="21.75" y="7.5" width="4.5" height="4.5" rx="0.6" />
          <circle cx="16" cy="27.5" r="1.8" fill="currentColor" stroke="none" />
        </svg>
        <span class="title">{{ reconnect ? 'Reconnect: USB direct' : 'USB direct' }}</span>
        <span v-if="!compact" class="desc">Talks to the modem itself. On Windows it needs a WinUSB driver.</span>
      </button>
      <button type="button" class="choice" :disabled="!hasSerial || working || busy" @click="connectSerial()">
        <svg v-if="!compact" class="icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 10.5h25l-2.2 11.5H5.7z" />
          <g fill="currentColor" stroke="none">
            <circle cx="9" cy="14.3" r="1.2" /><circle cx="13.5" cy="14.3" r="1.2" /><circle cx="18" cy="14.3" r="1.2" /><circle cx="22.5" cy="14.3" r="1.2" />
            <circle cx="11.2" cy="18.3" r="1.2" /><circle cx="16" cy="18.3" r="1.2" /><circle cx="20.8" cy="18.3" r="1.2" />
          </g>
        </svg>
        <span class="title">{{ reconnect ? 'Reconnect: Serial port' : 'Serial port' }}</span>
        <span v-if="!compact" class="desc">Uses a COM port the system already created for the modem.</span>
      </button>
    </div>

    <label class="speed">
      Serial speed
      <select v-model.number="baudRate" :disabled="!hasSerial || working || busy">
        <option v-for="rate in BAUD_RATES" :key="rate" :value="rate">{{ rate }}</option>
      </select>
      <span v-if="!compact" class="hint">Only matters for USB-to-serial adapters.</span>
    </label>

    <div v-if="previous.length" class="previous">
      <span class="label">Allowed before</span>
      <div class="row">
        <button v-for="p in previous" :key="p.key" type="button" :disabled="working || busy" @click="p.connect()">
          {{ p.label }}
        </button>
      </div>
    </div>

    <p v-if="!compact" class="hint">
      In the browser's device list the Quectel EC200A appears as "Android" on a Mac, and possibly with no name on
      Windows without WinUSB.
    </p>

    <p v-if="probing !== null" class="notice" role="status">
      This modem has no known AT channel, so ModemLens is trying its channels with a plain AT: now USB interface
      {{ probing }}.
    </p>
    <NoAtGuidance v-if="guidance" :classification="guidance.classification" :device="guidance.device" :reason="guidance.reason" @imported="emit('imported', $event)" />
    <p v-if="error" class="notice warn" role="alert">{{ error }}</p>
    <p v-if="replugNeeded" class="notice warn" role="alert">
      One of the modem's interfaces did not respond and the browser is still waiting for it. Unplug and replug the
      modem before the next connection.
    </p>
  </section>
</template>

<style scoped>
.connect { display: flex; flex-direction: column; gap: 1.1rem; }
.choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: clamp(1.25rem, 3vw, 1.9rem);
  text-align: left;
  background: var(--surface);
  border-radius: var(--radius-m);
}
.choice:hover:not(:disabled) { color: var(--ink); box-shadow: inset 0 0 0 1px var(--accent); }
.icon { width: 2.5rem; height: 2.5rem; margin-bottom: 0.65rem; color: var(--accent); }
.title { font-size: clamp(1.25rem, 2.5vw, 1.55rem); font-weight: 600; letter-spacing: -0.02em; }
.desc { font-size: 0.9rem; font-weight: 400; color: var(--ink-2); }
.speed { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--ink-2); }
.previous { display: grid; gap: 0.45rem; }

.compact { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; }
.compact .choices { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.compact .choice { display: inline-block; padding: 0.3rem 0.75rem; background: transparent; border-radius: var(--radius-s); }
.compact .title { font-size: 0.85rem; font-weight: 500; letter-spacing: 0; }
.compact .previous { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; }
.compact .notice, .compact > :deep(.seen) { flex-basis: 100%; }
@media (max-width: 560px) {
  .connect:not(.compact) .choices { grid-template-columns: minmax(0, 1fr); }
}
</style>
