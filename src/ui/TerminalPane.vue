<script setup lang="ts">
import { ref } from 'vue';
import type { AtResponse } from '../at/engine';
import { classifyTerminalCommand } from '../catalog/safety';

const props = defineProps<{
  send: (command: string, body?: string) => Promise<AtResponse>;
  disabled?: boolean;
  /** Why sending is disabled right now, if that needs explaining. */
  disabledReason?: string;
}>();

interface Entry { command: string; text: string }

const command = ref('');
const body = ref('');
const log = ref<Entry[]>([]);
const warnFor = ref<string | null>(null);
const sending = ref(false);

async function dispatch(cmd: string): Promise<void> {
  sending.value = true;
  warnFor.value = null;
  try {
    const b = body.value;
    const r = await props.send(cmd, b === '' ? undefined : b);
    const detail = r.errorDetail ? ` ${r.errorDetail}` : '';
    log.value.push({ command: cmd, text: [...r.lines, `[${r.status}${detail}]`].join('\n') });
    command.value = '';
    body.value = '';
  } finally {
    sending.value = false;
  }
}

async function submit(): Promise<void> {
  const cmd = command.value.trim();
  if (!cmd || sending.value || props.disabled) return;
  if (classifyTerminalCommand(cmd) === 'write' && warnFor.value !== cmd) {
    warnFor.value = cmd;
    return;
  }
  await dispatch(cmd);
}
</script>

<template>
  <section class="card terminal">
    <p class="muted">
      Free command input. What you type is sent to the modem as is. Terminal traffic is never part of a report
      or export.
    </p>
    <p v-if="disabledReason" class="note" role="status">{{ disabledReason }}</p>
    <form @submit.prevent="submit">
      <input v-model="command" type="text" placeholder="AT+CSQ" autocomplete="off" spellcheck="false" aria-label="AT command" :disabled="disabled" @input="warnFor = null" />
      <input v-model="body" type="text" placeholder="Optional text for the > prompt (sent followed by Ctrl+Z)" autocomplete="off" aria-label="Body for the prompt" :disabled="disabled" />
      <button type="submit" :disabled="disabled || sending || !command.trim()">
        {{ warnFor ? 'Send anyway' : 'Send' }}
      </button>
    </form>
    <p v-if="warnFor" class="note warn" role="alert">
      {{ warnFor }} does not look like a read-only query. It may change settings or state in the modem. Click "Send
      anyway" to send it.
    </p>
    <div class="log">
      <div v-for="(e, i) in log" :key="i" class="entry">
        <code>&gt; {{ e.command }}</code>
        <pre>{{ e.text }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
form {
  display: grid;
  gap: 0.5rem;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem;
  font: inherit;
  color: inherit;
  background: var(--code);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.muted {
  margin-top: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
code,
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
pre {
  margin: 0.2rem 0 0.6rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.log {
  margin-top: 0.75rem;
}
</style>
