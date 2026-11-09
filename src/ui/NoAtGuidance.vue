<script setup lang="ts">
import { computed } from 'vue';
import type { DeviceClassification } from '../profiles/known-devices';

const props = defineProps<{ classification: DeviceClassification }>();

const name = computed(() => props.classification.label ?? 'This USB device');
/** The address comes from the built-in table of measured devices, never from the device itself. */
const href = computed(() => (props.classification.webAddress ? `http://${props.classification.webAddress}` : ''));
</script>

<template>
  <section class="guidance" role="status" aria-label="This device has no AT channel">
    <template v-if="classification.kind === 'storage'">
      <p>
        {{ name }} ({{ classification.usb }}) looks like a USB disk. Many modems start in this storage mode and
        switch to modem mode afterwards. It has no AT channel in this mode.
      </p>
      <ul>
        <li>Eject the disk in your system, then wait a few seconds and connect again.</li>
        <li>
          The vendor's installer on that disk also switches the modem. Run it only on a machine where installing
          vendor software is acceptable.
        </li>
        <li>On Linux, <code>usb_modeswitch</code> does the same.</li>
      </ul>
    </template>
    <template v-else-if="classification.kind === 'transient'">
      <p>
        {{ name }} ({{ classification.usb }}) is in a short-lived state while it switches its mode.
      </p>
      <p>Wait a few seconds and connect again.</p>
    </template>
    <template v-else>
      <p>
        {{ name }} ({{ classification.usb }}) works as a network adapter with its own web page. It has no AT channel,
        so ModemLens cannot read it directly.
      </p>
      <p v-if="href">
        Its web page is at <a :href="href" target="_blank" rel="noopener">{{ classification.webAddress }}</a>.
      </p>
      <p v-else>The address of its web page is the gateway shown in the settings of the new network adapter.</p>
      <p>A browser bookmark tool for reading these modems is planned.</p>
    </template>
  </section>
</template>

<style scoped>
.guidance {
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--card);
}
p {
  margin: 0 0 0.5rem;
}
ul {
  margin: 0.2rem 0;
  padding-left: 1.2rem;
}
</style>
