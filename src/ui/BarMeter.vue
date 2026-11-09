<script setup lang="ts">
import { computed } from 'vue';
import type { Rating } from './dashboard';

const props = defineProps<{ bars?: number; rating?: Rating; word?: string }>();

const BARS = [1, 2, 3, 4, 5];
const WIDTH = 18;
const STEP = 26;
const FLOOR = 100;
const height = (n: number): number => 20 + (n - 1) * 20;

const description = computed(() =>
  props.bars === undefined ? 'Signal strength not known' : `${props.bars} of 5 bars, ${props.word?.toLowerCase()}`,
);
</script>

<template>
  <svg class="meter" viewBox="0 0 122 100" role="img" :aria-label="description" :data-rating="rating">
    <rect
      v-for="n in BARS"
      :key="n"
      :x="(n - 1) * STEP"
      :y="FLOOR - height(n)"
      :width="WIDTH"
      :height="height(n)"
      rx="3"
      :class="bars !== undefined && n <= bars ? 'on' : 'off'"
    />
  </svg>
</template>

<style scoped>
.meter { display: block; width: clamp(6rem, 20vw, 8rem); height: auto; }
.on { fill: var(--rating-fill, var(--ink)); transition: fill 0.25s ease; }
.off { fill: var(--surface-2); }
</style>
