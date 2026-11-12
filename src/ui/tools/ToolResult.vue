<script setup lang="ts">
import type { ToolOutcome } from '../../tools/types';
import { HIDDEN } from './props';

defineProps<{ outcome: ToolOutcome; hideIdentifiers: boolean }>();
</script>

<template>
  <div class="result" :data-tone="outcome.tone" role="status">
    <p>{{ outcome.message }}</p>
    <pre v-if="outcome.answer.length">{{ hideIdentifiers ? HIDDEN : [outcome.shown, ...outcome.answer].filter(Boolean).join('\n') }}</pre>
  </div>
</template>
