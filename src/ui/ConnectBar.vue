<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { PickerCancelledError } from '../transport/types';
import type { Connectors, Transport } from '../transport/types';
import { DEFAULT_BAUD_RATE, serialUsbId } from '../transport/webSerial';
import { NoAtChannelError, usbId } from '../transport/webUsb';

const props = defineProps<{
  connectors: Connectors;
  /** Ends the previous session; a connector calls it between picking and opening a device. */
  beforeOpen?: () => Promise<void>;
  /** Overrides browser detection (demo mode). */
  forceSupported?: boolean;
  busy?: boolean;
  reconnect?: boolean;
}>();
const emit = defineEmits<{ (e: 'connected', transport: Transport, via: 'serial' | 'usb'): void }>();

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const hasSerial = computed(() => props.forceSupported || 'serial' in navigator);
const hasUsb = computed(() => props.forceSupported || 'usb' in navigator);
const supported = computed(() => hasSerial.value || hasUsb.value);
const error = ref('');
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
  working.value = true;
  try {
    const transport = await open(props.beforeOpen ?? (() => Promise.resolve()));
    replugNeeded.value = transport.hadPendingClaim === true;
    emit('connected', transport, via);
  } catch (e) {
    if (e instanceof PickerCancelledError) return;
    replugNeeded.value = e instanceof NoAtChannelError && e.hadPendingClaim;
    error.value = e instanceof Error ? e.message : String(e);
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
  <section class="connect">
    <p v-if="!supported" class="note warn" role="alert">
      This browser cannot talk to USB devices. ModemLens works only in Chrome or Edge (Chromium-based, desktop).
      Safari and Firefox are not supported.
    </p>
    <div class="buttons">
      <button type="button" :disabled="!hasSerial || working || busy" @click="connectSerial()">
        {{ reconnect ? 'Reconnect: Serial port' : 'Serial port' }}
      </button>
      <button type="button" :disabled="!hasUsb || working || busy" @click="connectUsb()">
        {{ reconnect ? 'Reconnect: USB direct' : 'USB direct' }}
      </button>
      <label class="speed">
        Serial speed
        <select v-model.number="baudRate" :disabled="!hasSerial || working || busy">
          <option v-for="rate in BAUD_RATES" :key="rate" :value="rate">{{ rate }}</option>
        </select>
      </label>
    </div>
    <div v-if="previous.length" class="buttons previous">
      <span class="hint">Allowed before:</span>
      <button v-for="p in previous" :key="p.key" type="button" :disabled="working || busy" @click="p.connect()">
        {{ p.label }}
      </button>
    </div>
    <p class="hint">
      Serial port uses a COM port the system already created for the modem. USB direct talks to the modem itself
      and needs a WinUSB driver on Windows. The speed only matters for USB-to-serial adapters.
    </p>
    <p class="hint">
      In the browser's device list the Quectel EC200A appears as "Android" on a Mac, and possibly with no name on
      Windows without WinUSB.
    </p>
    <p v-if="probing !== null" class="note" role="status">
      This modem has no known AT channel, so ModemLens is trying its channels with a plain AT: now USB interface
      {{ probing }}.
    </p>
    <p v-if="error" class="note warn" role="alert">{{ error }}</p>
    <p v-if="replugNeeded" class="note warn" role="alert">
      One of the modem's interfaces did not respond and the browser is still waiting for it. Unplug and replug the
      modem before the next connection.
    </p>
  </section>
</template>

<style scoped>
.buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.previous {
  margin-top: 0.5rem;
}
.previous .hint {
  margin: 0;
}
.speed {
  font-size: 0.85rem;
  color: var(--muted);
}
.hint {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
</style>
