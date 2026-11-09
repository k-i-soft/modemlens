<script setup lang="ts">
import { computed } from 'vue';
import type { DeviceClassification } from '../profiles/known-devices';
import type { UsbDeviceDescription } from '../transport/types';
import { interfaceCode, interfaceLabel, operatingSystemLimit } from './usbInterfaces';

const props = defineProps<{ classification?: DeviceClassification; device?: UsbDeviceDescription; reason: string }>();

const name = computed(() => props.classification?.label ?? 'This USB device');
const usb = computed(() => props.device?.usb ?? props.classification?.usb);
const kind = computed(() => props.classification?.kind);
/** The address comes from the built-in table of measured devices, never from the device itself. */
const href = computed(() => (props.classification?.webAddress ? `http://${props.classification.webAddress}` : ''));
const interfaces = computed(() =>
  (props.device?.interfaces ?? []).map((i) => ({ number: i.number, label: interfaceLabel(i), code: interfaceCode(i) })),
);
const osLimit = computed(() => operatingSystemLimit(props.device, navigator.platform));
</script>

<template>
  <section class="seen panel" role="status" aria-label="What ModemLens can see on this device">
    <span class="label">What I can see</span>
    <h2>{{ name }}</h2>
    <p class="id mono">
      <span v-if="usb">{{ usb }}</span><span v-if="device?.productName" class="product">{{ device.productName }}</span>
    </p>

    <ol v-if="interfaces.length" class="diagram" aria-label="USB interfaces">
      <li v-for="i in interfaces" :key="i.number">
        <span class="num mono">{{ i.number }}</span>
        <strong>{{ i.label }}</strong>
        <code>{{ i.code }}</code>
      </li>
    </ol>

    <div class="text">
      <div>
        <h3>Why there is no more data</h3>
        <template v-if="kind === 'storage'">
          <p>It looks like a USB disk. Many modems start in this storage mode and switch to modem mode afterwards. It has no AT channel in this mode.</p>
        </template>
        <template v-else-if="kind === 'transient'">
          <p>It is in a short-lived state while it switches its mode.</p>
        </template>
        <template v-else-if="kind === 'network-web'">
          <p>It works as a network adapter with its own web page. It has no AT channel, so ModemLens cannot read it directly.</p>
        </template>
        <p v-else>{{ reason }}</p>
        <p v-if="osLimit" class="limit">{{ osLimit }}</p>
      </div>

      <div v-if="kind === 'storage' || kind === 'transient' || kind === 'network-web'">
        <h3>What to do</h3>
        <ul v-if="kind === 'storage'">
          <li>Eject the disk in your system, then wait a few seconds and connect again.</li>
          <li>The vendor's installer on that disk also switches the modem. Run it only on a machine where installing vendor software is acceptable.</li>
          <li>On Linux, <code>usb_modeswitch</code> does the same.</li>
        </ul>
        <p v-else-if="kind === 'transient'">Wait a few seconds and connect again.</p>
        <template v-else>
          <p v-if="href">Its web page is at <a :href="href" target="_blank" rel="noopener">{{ classification?.webAddress }}</a>.</p>
          <p v-else-if="osLimit">On Windows or Linux, the address of its web page is the gateway shown in the settings of the new network adapter.</p>
          <p v-else>The address of its web page is the gateway shown in the settings of the new network adapter.</p>
          <p>A browser bookmark tool for reading these modems is planned.</p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
h2 { font-size: clamp(1.5rem, 3.5vw, 2.1rem); font-weight: 650; letter-spacing: -0.025em; line-height: 1.15; }
.id { display: flex; flex-wrap: wrap; gap: 0.1rem 0.9rem; margin-top: 0.25rem; font-size: 0.88rem; color: var(--ink-2); }
.product { color: var(--ink-3); }
.diagram { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 1.25rem 0 0; padding: 0; list-style: none; }
.diagram li {
  position: relative;
  flex: 1 1 8.5rem;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 0.6rem;
  align-items: baseline;
  padding: 0.7rem 0.8rem;
  background: var(--surface-2);
  border-top: 3px solid var(--accent);
  border-radius: 3px 3px var(--radius-s) var(--radius-s);
}
.num { grid-row: span 2; font-size: 1.15rem; font-weight: 600; color: var(--accent); }
strong { font-size: 0.92rem; font-weight: 600; }
.diagram code { font-size: 0.75rem; color: var(--ink-3); }
.text { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem 2rem; margin-top: 1.25rem; }
h3 { margin-bottom: 0.3rem; font-size: 0.95rem; font-weight: 600; }
.text p, .text ul { font-size: 0.93rem; color: var(--ink-2); }
.text p + p { margin-top: 0.45rem; }
.text ul { margin: 0; padding-left: 1.1rem; }
.limit { font-weight: 500; color: var(--ink); }
</style>
