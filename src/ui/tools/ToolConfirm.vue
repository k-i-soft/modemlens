<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  label: string;
  /** The command as it may be shown, with codes masked. */
  sends: string;
  warning?: string;
  strong?: boolean;
  unverified: boolean;
  /** A second click with this text even on a tested model: the step cannot be undone or costs money. */
  second?: string;
  busy?: boolean;
}>(), { warning: '', strong: false, second: '', busy: false });

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

/** A held or double-pressed key must not send before the warning can be read. */
const GUARD_MS = 600;
const stage = ref<'first' | 'second'>('first');
let armedAt = 0;

function confirm(): void {
  if (stage.value === 'first' && (props.unverified || props.second)) {
    stage.value = 'second';
    armedAt = Date.now();
    return;
  }
  if (stage.value === 'second' && Date.now() - armedAt < GUARD_MS) return;
  emit('confirm');
}
</script>

<template>
  <div class="confirm" role="group" :aria-label="`Confirm ${label}`">
    <dl><dt>Sends</dt><dd class="mono">{{ sends }}</dd></dl>
    <p v-if="warning" :class="{ strong }">{{ warning }}</p>
    <template v-if="stage === 'second'">
      <p v-if="second" class="strong" role="alert">{{ second }}</p>
      <p v-if="unverified" class="strong" role="alert">This has not been tested on this modem model. Send it only if you can recover the modem without this tool.</p>
    </template>
    <div class="row">
      <button :key="stage" type="button" class="primary" :disabled="busy" @click="confirm">{{ stage === 'first' ? 'Confirm' : 'Send anyway' }}</button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>
