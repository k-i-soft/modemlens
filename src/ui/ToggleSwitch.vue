<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>();
defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>

<template>
  <label class="switch" :class="{ off: disabled }">
    <input
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="track" aria-hidden="true"><span class="thumb" /></span>
    <span class="text">{{ label }}</span>
  </label>
</template>

<style scoped>
.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.switch.off { opacity: 0.5; cursor: not-allowed; }
input { position: absolute; opacity: 0; width: 2.1rem; height: 1.2rem; margin: 0; cursor: inherit; }
.track {
  flex: none;
  width: 2.1rem;
  height: 1.2rem;
  padding: 2px;
  background: var(--surface-2);
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--line);
  transition: background-color 0.15s ease;
}
.thumb {
  display: block;
  width: calc(1.2rem - 4px);
  height: calc(1.2rem - 4px);
  background: var(--ink-2);
  border-radius: 50%;
  transition: transform 0.15s ease, background-color 0.15s ease;
}
input:checked + .track { background: var(--accent); }
input:checked + .track .thumb { transform: translateX(0.9rem); background: var(--accent-ink); }
input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
