<script setup lang="ts">
import { DONATE_URL } from '../config';

withDefaults(defineProps<{ url?: string | null }>(), { url: DONATE_URL });
</script>

<template>
  <a v-if="url" class="donate" :href="url" target="_blank" rel="noopener">Support ModemLens</a>
</template>

<style scoped>
.donate {
  font-size: 0.85rem;
}
</style>
