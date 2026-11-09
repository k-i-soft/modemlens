<script setup lang="ts">
import { computed } from 'vue';
import type { Dashboard } from './dashboard';

const props = defineProps<{ identity: Dashboard['identity']; network?: Dashboard['network']; chips: Dashboard['chips']; scanning: boolean }>();

const badge = computed(() => {
  const id = props.identity;
  if (id.verified === undefined) return { text: 'Generic commands only', verified: false };
  return { text: id.verified ? 'Verified profile' : 'Unverified profile', verified: id.verified };
});
</script>

<template>
  <section class="identity" aria-label="Modem">
    <p v-if="identity.manufacturer" class="maker">{{ identity.manufacturer }}</p>
    <h2 class="model" :class="{ pending: !identity.model }">
      {{ identity.model ?? (scanning ? 'Identifying' : 'Unknown model') }}
    </h2>
    <p v-if="identity.firmware" class="firmware mono">{{ identity.firmware }}</p>

    <div class="tags">
      <span class="badge" :class="{ verified: badge.verified }">
        {{ badge.text }}<span v-if="identity.profileId" class="mono profile">{{ identity.profileId }}</span>
      </span>
      <span v-if="identity.usb" class="tag mono">USB {{ identity.usb }}</span>
      <span v-if="identity.imei" class="tag mono">IMEI {{ identity.imei }}</span>
    </div>

    <div class="status">
      <p v-if="network" class="network" :data-tone="network.tone"><span class="dot" aria-hidden="true" />{{ network.word }}</p>
      <ul v-if="chips.length" class="chips">
        <li v-for="c in chips" :key="c.key" :data-tone="c.tone">
          <span class="k">{{ c.label }}</span><span class="v">{{ c.value }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.identity { display: flex; flex-direction: column; min-width: 0; padding-block: 0.25rem; }
.maker { font-size: 1.05rem; font-weight: 500; color: var(--ink-2); }
.model {
  font-size: clamp(3.1rem, 7.5vw, 5.4rem);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}
.model.pending { color: var(--ink-3); font-weight: 500; }
.firmware { margin-top: 0.7rem; font-size: 0.9rem; color: var(--ink-2); overflow-wrap: anywhere; }
.tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.9rem; margin-top: 1rem; }
.badge {
  padding: 0.16rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-2);
  border: 1px solid var(--line);
  border-radius: 999px;
}
.badge.verified { color: var(--accent); border-color: var(--accent); }
.profile { margin-left: 0.45rem; font-size: 0.72rem; font-weight: 400; color: var(--ink-3); }
.tag { font-size: 0.78rem; color: var(--ink-3); overflow-wrap: anywhere; }
.status { margin-top: auto; padding-top: 1.75rem; }
.network {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  font-size: clamp(1.35rem, 2.6vw, 1.75rem);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.2;
}
.dot { flex: none; width: 0.68em; height: 0.68em; background: var(--tone); border-radius: 50%; box-shadow: 0 0 0 0.22em color-mix(in srgb, var(--tone) 22%, transparent); }
.chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.75rem 1rem; margin: 1rem 0 0; padding: 0; list-style: none; }
.chips li { display: flex; flex-direction: column; min-width: 0; padding-left: 0.65rem; border-left: 2px solid var(--tone); }
.k { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.v { font-size: 0.95rem; font-weight: 500; overflow-wrap: anywhere; }
</style>
