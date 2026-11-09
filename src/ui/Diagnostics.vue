<script setup lang="ts">
import type { ScanItem } from '../scan/scanner';
import ScanDetails from './ScanDetails.vue';

defineProps<{
  items: ScanItem[];
  canDeep: boolean;
  canNetworkScan: boolean;
  autoIncomplete: boolean;
  confirmDeep: boolean;
  hideIdentifiers: boolean;
  /** Why these scans cannot run at all for this report. */
  scansUnavailableReason?: string;
}>();
defineEmits<{ (e: 'ask-deep'): void; (e: 'cancel-deep'): void; (e: 'start-deep'): void; (e: 'network-scan'): void }>();
</script>

<template>
  <div class="diagnostics">
    <section class="panel controls" aria-label="Further scans">
      <div class="choice">
        <button type="button" :disabled="!canDeep" @click="$emit('ask-deep')">Deep scan…</button>
        <p class="hint">Queries commands this tool has no description for. Asks first.</p>
      </div>
      <div class="choice">
        <button type="button" :disabled="!canNetworkScan" @click="$emit('network-scan')">Network scan</button>
        <p class="hint">
          Lists the operators around you (<code>AT+COPS=?</code>). It can take minutes and may interrupt the connection.
        </p>
      </div>
      <p v-if="scansUnavailableReason" class="hint note">{{ scansUnavailableReason }}</p>
      <p v-if="autoIncomplete" class="hint note">Deep scan is unavailable because the automatic scan did not finish.</p>
      <div v-if="confirmDeep" class="notice warn alert" role="alertdialog" aria-label="Deep scan warning">
        <p>
          The deep scan queries unknown commands (ones this tool has no description for), taken from the modem's own
          command list. When the modem has no list of its own, it tries a built-in list of common command names instead.
          Only query forms are sent, but a faulty firmware could act on them, and the modem could restart. Stop it any time.
        </p>
        <div class="row">
          <button type="button" class="primary" :disabled="!canDeep" @click="$emit('start-deep')">Start deep scan</button>
          <button type="button" @click="$emit('cancel-deep')">Cancel</button>
        </div>
      </div>
    </section>
    <ScanDetails :items="items" :hide-identifiers="hideIdentifiers" />
  </div>
</template>

<style scoped>
.diagnostics { display: flex; flex-direction: column; gap: 1.25rem; }
.controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem 2rem; }
.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 0.45rem; }
.note, .alert { grid-column: 1 / -1; }
code { font-size: 0.82rem; }
</style>
