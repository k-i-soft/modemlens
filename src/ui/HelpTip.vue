<script lang="ts">
/** Closes whichever bubble is open: there is only ever one. */
let closeOpenTip: (() => void) | null = null;
let lastId = 0;
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { GLOSSARY } from './glossary';
import type { GlossaryTerm } from './glossary';

const props = defineProps<{ term: GlossaryTerm }>();

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 400;
/** Distance from the icon, and the least distance from the edge of the window. */
const GAP_PX = 8;
const MARGIN_PX = 8;

const id = `help-${++lastId}`;
const open = ref(false);
const placement = ref<'above' | 'below'>('above');
const position = ref<{ top: string; left: string }>({ top: '0', left: '0' });
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLElement | null>(null);
const bubble = ref<HTMLElement | null>(null);

let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/** A click keeps a bubble it opened; a second click closes it again. */
let openedByClick = false;

function clearTimers(): void {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
}

function place(): void {
  const icon = button.value?.getBoundingClientRect();
  const box = bubble.value?.getBoundingClientRect();
  if (!icon || !box) return;
  const above = icon.top - box.height - GAP_PX;
  const fitsAbove = above >= MARGIN_PX;
  placement.value = fitsAbove ? 'above' : 'below';
  const widest = document.documentElement.clientWidth - box.width - MARGIN_PX;
  const left = Math.max(MARGIN_PX, Math.min(widest, icon.left + icon.width / 2 - box.width / 2));
  position.value = { top: `${fitsAbove ? above : icon.bottom + GAP_PX}px`, left: `${left}px` };
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') hide();
}

function onOutsidePress(e: Event): void {
  const target = e.target as Node;
  if (!root.value?.contains(target) && !bubble.value?.contains(target)) hide();
}

function listen(on: boolean): void {
  const method = on ? 'addEventListener' : 'removeEventListener';
  document[method]('keydown', onKey as EventListener);
  document[method]('pointerdown', onOutsidePress);
  // A fixed bubble would drift away from its icon.
  window[method]('scroll', hide, true);
  window[method]('resize', hide);
}

function show(): void {
  clearTimers();
  if (open.value) return;
  closeOpenTip?.();
  closeOpenTip = hide;
  open.value = true;
  listen(true);
  void nextTick(place);
}

function hide(): void {
  clearTimers();
  openedByClick = false;
  if (!open.value) return;
  open.value = false;
  listen(false);
  if (closeOpenTip === hide) closeOpenTip = null;
}

function pointerIn(): void {
  clearTimers();
  if (!open.value) openTimer = setTimeout(show, OPEN_DELAY_MS);
}

function pointerOut(): void {
  clearTimers();
  if (open.value) closeTimer = setTimeout(hide, CLOSE_DELAY_MS);
}

function onClick(): void {
  if (open.value && openedByClick) {
    hide();
    return;
  }
  show();
  openedByClick = true;
}

onBeforeUnmount(hide);
</script>

<template>
  <span ref="root" class="help" @mouseenter="pointerIn" @mouseleave="pointerOut">
    <button ref="button" type="button" class="help-q" :aria-label="`What does ${props.term} mean?`" :aria-describedby="id" @click.stop="onClick">?</button>
    <Teleport to="body">
      <span
        v-show="open"
        :id="id"
        ref="bubble"
        role="tooltip"
        class="help-bubble"
        :data-placement="placement"
        :style="position"
        @mouseenter="pointerIn"
        @mouseleave="pointerOut"
      >{{ GLOSSARY[props.term] }}</span>
    </Teleport>
  </span>
</template>

<style scoped>
.help { display: inline-flex; vertical-align: 0.08em; margin-left: 0.3em; }
.help-q {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1;
  text-transform: none;
  color: var(--ink-3);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 50%;
}
/* A larger target for a finger than the icon shows. */
.help-q::after { content: ''; position: absolute; inset: -0.4rem; }
.help-bubble {
  position: fixed;
  z-index: 50;
  width: max-content;
  max-width: min(20rem, calc(100vw - 16px));
  padding: 0.5rem 0.7rem;
  font-size: 0.82rem;
  font-weight: 400;
  line-height: 1.4;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-s);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
}
</style>
