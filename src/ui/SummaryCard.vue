<script setup lang="ts">
import { computed } from 'vue';
import type { Summary } from '../parse';
import type { Profile } from '../catalog/types';

const props = defineProps<{ summary: Summary; profile?: Profile; usb?: string }>();

const rows = computed(
  (): Array<[string, string | undefined]> => [
    ['Model', props.summary.model],
    ['Firmware', props.summary.firmware],
    ['SIM', props.summary.simState],
    ['Registration', props.summary.registration],
    ['Operator', props.summary.operator],
    ['Technology', props.summary.rat],
    ['Signal', props.summary.signal],
  ],
);
</script>

<template>
  <section class="card">
    <h2>
      Summary
      <span v-if="profile" class="badge" :class="{ unverified: !profile.verified }">
        {{ profile.label }}{{ profile.verified ? '' : ' (unverified profile)' }}
      </span>
      <span v-else class="badge">Generic commands only</span>
    </h2>
    <p v-if="usb" class="muted">USB id {{ usb }}</p>
    <dl>
      <template v-for="[label, value] in rows" :key="label">
        <dt>{{ label }}</dt>
        <dd>{{ value ?? 'not determined' }}</dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.2rem 1rem;
  margin: 0;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.muted {
  margin: 0 0 0.5rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.badge {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.75rem;
  font-weight: 400;
}
.badge.unverified {
  border-color: var(--warn);
  color: var(--warn);
}
</style>
