<script setup lang="ts">
import type { ToolOutcome } from '../../tools/types';
import { HIDDEN } from './props';

defineProps<{ outcome: ToolOutcome; hideIdentifiers: boolean }>();
</script>

<template>
  <div class="result" :data-tone="outcome.tone" role="status">
    <slot><p>{{ outcome.message }}</p></slot>
    <details v-if="outcome.answer.length" class="raw">
      <summary>Raw answer</summary>
      <pre>{{ hideIdentifiers ? HIDDEN : [outcome.shown, ...outcome.answer].filter(Boolean).join('\n') }}</pre>
    </details>
  </div>
</template>
