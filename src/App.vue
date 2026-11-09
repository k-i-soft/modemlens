<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import type { Transport } from './transport/types';
import { AtEngine } from './at/engine';
import type { AtResponse } from './at/engine';
import { Scanner } from './scan/scanner';
import type { ScanItem, ScanReport } from './scan/scanner';
import { STANDARD_CATALOG } from './catalog/standard';
import { buildSummary } from './parse';
import { redactReport, toJson, toMarkdown } from './report/export';
import ConnectBar from './ui/ConnectBar.vue';
import SummaryCard from './ui/SummaryCard.vue';
import ScanDetails from './ui/ScanDetails.vue';
import TerminalPane from './ui/TerminalPane.vue';
import HelpNoModem from './ui/HelpNoModem.vue';
import DonateLink from './ui/DonateLink.vue';
import { createDemoTransport, DEMO_USB } from './ui/demo';
import { downloadText } from './ui/download';

const props = withDefaults(
  defineProps<{
    demo?: boolean;
    demoDelayMs?: number;
    connectors?: { serial: () => Promise<Transport>; usb: () => Promise<Transport> };
    donateUrl?: string | null;
  }>(),
  { demo: false, demoDelayMs: 60, connectors: undefined, donateUrl: undefined },
);

const notYet = (): Promise<Transport> =>
  Promise.reject(new Error('This connection method is not available yet in this build.'));

const connectors = computed(() => {
  if (props.connectors) return props.connectors;
  if (props.demo) {
    const make = (): Promise<Transport> => Promise.resolve(createDemoTransport({ delayMs: props.demoDelayMs }));
    return { serial: make, usb: make };
  }
  return { serial: notYet, usb: notYet };
});

const COPS_SCAN = STANDARD_CATALOG.find((e) => e.command === 'AT+COPS=?')!;

type Phase = 'idle' | 'auto' | 'deep' | 'network' | 'finished';

const tab = ref<'results' | 'terminal'>('results');
const phase = ref<Phase>('idle');
const connected = ref(false);
const lostReason = ref('');
const autoDone = ref(false);
const items = ref<ScanItem[]>([]);
const reportMeta = ref<Pick<ScanReport, 'startedAt' | 'usb' | 'profile' | 'commandList' | 'interrupted'>>({
  startedAt: '',
  commandList: [],
});
const confirmDeep = ref(false);
const confirmFull = ref(false);
const label = ref('');

let engine: AtEngine | null = null;
let scanner: Scanner | null = null;
let transport: Transport | null = null;
let abort: AbortController | null = null;

function snapshot(): ScanReport {
  const r = scanner!.report;
  return { ...r, items: [...items.value], commandList: [...r.commandList] };
}

function syncMeta(): void {
  if (!scanner) return;
  const r = scanner.report;
  reportMeta.value = { startedAt: r.startedAt, usb: r.usb, profile: r.profile, commandList: [...r.commandList], interrupted: r.interrupted };
}

const summary = computed(() => (items.value.length ? buildSummary({ ...reportMeta.value, items: items.value }) : {}));
const hasResults = computed(() => items.value.length > 0);
const running = computed(() => phase.value !== 'idle' && phase.value !== 'finished');
const canDeep = computed(() => connected.value && autoDone.value && !running.value);

async function teardown(): Promise<void> {
  abort?.abort();
  engine?.dispose();
  try {
    await transport?.close();
  } catch {
    /* already gone */
  }
  engine = null;
  transport = null;
}

async function onConnected(t: Transport): Promise<void> {
  await teardown();
  transport = t;
  label.value = t.label;
  engine = new AtEngine(t);
  engine.onDisconnect((reason) => {
    connected.value = false;
    lostReason.value = reason;
    syncMeta();
    if (running.value) phase.value = 'finished';
  });
  scanner = new Scanner(engine, props.demo ? { usb: DEMO_USB } : {});
  scanner.onItem((item) => {
    items.value.push(item);
    syncMeta();
  });
  items.value = [];
  reportMeta.value = { startedAt: scanner.report.startedAt, usb: scanner.report.usb, commandList: [] };
  connected.value = true;
  lostReason.value = '';
  autoDone.value = false;
  confirmDeep.value = false;
  confirmFull.value = false;
  abort = new AbortController();
  phase.value = 'auto';
  const s = scanner;
  await s.runAuto(abort.signal);
  if (s !== scanner) return;
  syncMeta();
  autoDone.value = true;
  phase.value = 'finished';
}

function stop(): void {
  abort?.abort();
}

async function startDeep(): Promise<void> {
  confirmDeep.value = false;
  if (!scanner) return;
  const s = scanner;
  abort = new AbortController();
  phase.value = 'deep';
  await s.runDeep(abort.signal);
  syncMeta();
  if (s === scanner) phase.value = 'finished';
}

async function startNetworkScan(): Promise<void> {
  if (!scanner) return;
  const s = scanner;
  phase.value = 'network';
  await s.runManual(COPS_SCAN);
  syncMeta();
  if (s === scanner) phase.value = 'finished';
}

function terminalSend(command: string, body?: string): Promise<AtResponse> {
  if (!engine) return Promise.resolve({ command, status: 'disconnected', lines: [], durationMs: 0 });
  return engine.send(command, body === undefined ? { timeoutMs: 15000 } : { timeoutMs: 15000, body });
}

function exportShared(kind: 'json' | 'md'): void {
  if (!scanner) return;
  const shared = redactReport(snapshot());
  if (kind === 'json') downloadText('modemlens-report.json', toJson(shared), 'application/json');
  else downloadText('modemlens-report.md', toMarkdown(shared), 'text/markdown');
}

function exportFull(kind: 'json' | 'md'): void {
  if (!scanner) return;
  const full = snapshot();
  if (kind === 'json') downloadText('modemlens-report-FULL.json', toJson(full), 'application/json');
  else downloadText('modemlens-report-FULL.md', toMarkdown(full), 'text/markdown');
  confirmFull.value = false;
}

onBeforeUnmount(() => {
  void teardown();
});
</script>

<template>
  <main>
    <header class="top">
      <h1>ModemLens</h1>
      <p class="muted">
        Surveys a USB cellular modem in your browser. Chrome or Edge only. Everything stays on this page; nothing is
        uploaded.
      </p>
      <p v-if="demo" class="note">Demo mode: a made-up modem with fake identifiers. Nothing is connected.</p>
    </header>

    <ConnectBar
      :connectors="connectors"
      :force-supported="demo || undefined"
      :busy="connected && running"
      :reconnect="!connected && hasResults"
      @connected="onConnected"
    />

    <p v-if="connected" class="note">Connected: {{ label }}</p>
    <p v-if="lostReason" class="note warn" role="alert">
      Connection lost: {{ lostReason }}. The results below are kept. Use the buttons above to reconnect.
    </p>
    <p v-if="reportMeta.interrupted && connected === false && !lostReason" class="note warn">
      Scan interrupted: {{ reportMeta.interrupted }}
    </p>

    <template v-if="hasResults || connected">
      <nav class="tabs" aria-label="Views">
        <button type="button" :class="{ active: tab === 'results' }" @click="tab = 'results'">Results</button>
        <button type="button" :class="{ active: tab === 'terminal' }" @click="tab = 'terminal'">Terminal</button>
      </nav>

      <div v-show="tab === 'results'">
        <p v-if="running" class="note" role="status">
          Scanning ({{ phase === 'auto' ? 'automatic, read-only' : phase === 'deep' ? 'deep scan' : 'network scan' }}),
          {{ items.length }} results so far.
          <button v-if="phase !== 'network'" type="button" @click="stop">Stop</button>
        </p>
        <p v-else-if="autoDone && connected" class="note" role="status">Automatic scan finished.</p>

        <SummaryCard :summary="summary" :profile="reportMeta.profile" :usb="reportMeta.usb" />

        <section class="card actions">
          <h2>More</h2>
          <div class="row">
            <button type="button" :disabled="!canDeep" @click="confirmDeep = true">Deep scan…</button>
            <button type="button" :disabled="!canDeep" @click="startNetworkScan">Network scan</button>
          </div>
          <p class="hint">
            Network scan lists the operators around you (AT+COPS=?). It can take minutes and may interrupt the
            connection.
          </p>
          <div v-if="confirmDeep" class="note warn" role="alertdialog" aria-label="Deep scan warning">
            <p>
              The deep scan queries unknown commands (ones this tool has no description for), taken from the modem's own command list. Only
              query forms are sent, but a faulty firmware could act on them, and the modem could restart. Stop it any
              time.
            </p>
            <div class="row">
              <button type="button" @click="startDeep">Start deep scan</button>
              <button type="button" @click="confirmDeep = false">Cancel</button>
            </div>
          </div>
        </section>

        <ScanDetails :items="items" />

        <section class="card actions">
          <h2>Export</h2>
          <p class="hint">Default exports hide IMEI, serial numbers, IMSI, ICCID, IP addresses and similar identifiers.</p>
          <div class="row">
            <button type="button" :disabled="!hasResults" @click="exportShared('json')">Export JSON</button>
            <button type="button" :disabled="!hasResults" @click="exportShared('md')">Export Markdown</button>
            <button type="button" :disabled="!hasResults" @click="confirmFull = true">Full export…</button>
          </div>
          <div v-if="confirmFull" class="note warn" role="alertdialog" aria-label="Full export warning">
            <p>
              The full export contains identifiers (IMEI, serial number, IMSI, ICCID, IP addresses, cell ids) and the
              raw responses. Review and edit the file yourself before you share it with anyone.
            </p>
            <div class="row">
              <button type="button" @click="exportFull('json')">Download full JSON</button>
              <button type="button" @click="exportFull('md')">Download full Markdown</button>
              <button type="button" @click="confirmFull = false">Cancel</button>
            </div>
          </div>
        </section>

        <p v-if="phase === 'finished' && autoDone" class="donate-row">
          Useful? <DonateLink :url="donateUrl" />
        </p>
      </div>

      <TerminalPane v-show="tab === 'terminal'" :send="terminalSend" :disabled="!connected" />
    </template>

    <HelpNoModem />

    <footer>
      <span>ModemLens. Runs only in Chrome or Edge. No tracking, no third-party scripts.</span>
      <DonateLink :url="donateUrl" />
    </footer>
  </main>
</template>

<style>
:root {
  --bg: #f6f7f9;
  --fg: #1d2127;
  --muted: #5b6470;
  --card: #ffffff;
  --border: #d5dae1;
  --code: #eef1f5;
  --accent: #1f6feb;
  --warn: #b25e00;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171b;
    --fg: #e4e7eb;
    --muted: #9aa4b0;
    --card: #1c2025;
    --border: #343a42;
    --code: #252a31;
    --accent: #6ea8ff;
    --warn: #f0a04b;
  }
}
html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.45;
  overflow-x: hidden;
}
main {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1rem;
  box-sizing: border-box;
}
h1 {
  margin: 0;
  font-size: 1.4rem;
}
a {
  color: var(--accent);
}
button {
  padding: 0.4rem 0.8rem;
  font: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.card {
  margin: 0.75rem 0;
  padding: 0.75rem 1rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}
.note {
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
}
.note.warn {
  border-color: var(--warn);
}
.note p {
  margin: 0 0 0.5rem;
}
.muted,
.hint {
  color: var(--muted);
  font-size: 0.9rem;
}
.hint {
  margin: 0.5rem 0 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.tabs {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.tabs button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.help {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
  margin-top: 1.5rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.donate-row {
  color: var(--muted);
  font-size: 0.9rem;
}
</style>
