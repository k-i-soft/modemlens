<script setup lang="ts">
import { ref } from 'vue';
import type { AtResponse } from '../at/engine';
import { classifyTerminalCommand } from '../catalog/safety';

const props = defineProps<{
  send: (command: string, body?: string) => Promise<AtResponse>;
  disabled?: boolean;
  /** Why sending is disabled right now, if that needs explaining. */
  disabledReason?: string;
  /** Terminal text carries no marks of what is sensitive, so answers and typed arguments are withheld. */
  hideIdentifiers?: boolean;
}>();

interface Entry { command: string; text: string }

const command = ref('');
const body = ref('');
const log = ref<Entry[]>([]);
const warnFor = ref<string | null>(null);
const sending = ref(false);

/** While identifiers are hidden, only the command name is shown: an argument can be a phone number or a PIN. */
function shownCommand(cmd: string): string {
  return props.hideIdentifiers ? cmd.split(/[=?]/, 1)[0] : cmd;
}

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
  <section class="display terminal" aria-label="Terminal">
    <p class="intro">
      Free command input. What you type is sent to the modem as is. Terminal traffic is never part of a report
      or export.
    </p>
    <p v-if="disabledReason" class="reason" role="status">{{ disabledReason }}</p>
    <form @submit.prevent="submit">
      <div class="prompt">
        <span aria-hidden="true">&gt;</span>
        <input v-model="command" type="text" placeholder="AT+CSQ" autocomplete="off" spellcheck="false" aria-label="AT command" :class="{ masked: hideIdentifiers }" :disabled="disabled" @input="warnFor = null" />
        <button type="submit" class="primary" :disabled="disabled || sending || !command.trim()">
          {{ warnFor ? 'Send anyway' : 'Send' }}
        </button>
      </div>
      <input v-model="body" class="body" :class="{ masked: hideIdentifiers }" type="text" placeholder="Optional text for the > prompt (sent followed by Ctrl+Z)" autocomplete="off" aria-label="Body for the prompt" :disabled="disabled" />
    </form>
    <p v-if="warnFor" class="alert" role="alert">
      {{ shownCommand(warnFor) }} does not look like a read-only query. It may change settings or state in the modem. Click "Send
      anyway" to send it.
    </p>
    <div class="log">
      <div v-for="(e, i) in log" :key="i" class="entry">
        <code>&gt; {{ shownCommand(e.command) }}</code>
        <pre>{{ hideIdentifiers ? 'Hidden while "Hide identifiers" is on.' : e.text }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.terminal { display: flex; flex-direction: column; gap: 0.9rem; padding: clamp(1.1rem, 3vw, 1.75rem); }
.intro, .reason { font-size: 0.85rem; color: var(--ink-3); }
.reason { color: var(--r-fair); }
form { display: grid; gap: 0.5rem; }
.prompt { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.6rem; font-family: var(--font-mono); color: var(--accent); }
input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  font-family: var(--font-mono);
  font-size: 0.9rem;
  color: var(--ink);
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: 6px;
}
input::placeholder { color: var(--ink-3); }
input:disabled { opacity: 0.6; }
input.masked { -webkit-text-security: disc; }
input.masked::placeholder { -webkit-text-security: none; }
.body { font-size: 0.82rem; }
.alert { padding: 0.55rem 0.75rem; font-size: 0.88rem; border: 1px solid var(--r-fair); border-radius: 6px; }
code, pre { font-size: 0.85rem; }
code { color: var(--accent); overflow-wrap: anywhere; }
pre { margin: 0.2rem 0 0.8rem; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.log:empty { display: none; }
</style>
