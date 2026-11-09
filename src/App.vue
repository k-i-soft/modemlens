<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Connector, Connectors, Transport } from './transport/types';
import './ui/theme.css';
import { AtEngine } from './at/engine';
import type { AtResponse, SendOptions } from './at/engine';
import { Scanner } from './scan/scanner';
import type { ScanItem, ScanReport } from './scan/scanner';
import { STANDARD_CATALOG } from './catalog/standard';
import { redactReport, toJson, toMarkdown } from './report/export';
import ConnectBar from './ui/ConnectBar.vue';
import Overview from './ui/Overview.vue';
import Diagnostics from './ui/Diagnostics.vue';
import ScanProgress from './ui/ScanProgress.vue';
import ExportMenu from './ui/ExportMenu.vue';
import ToggleSwitch from './ui/ToggleSwitch.vue';
import HelpTip from './ui/HelpTip.vue';
import TerminalPane from './ui/TerminalPane.vue';
import ActionsPanel from './ui/ActionsPanel.vue';
import AutoRefresh from './ui/AutoRefresh.vue';
import HelpNoModem from './ui/HelpNoModem.vue';
import DonateLink from './ui/DonateLink.vue';
import { connectSerial } from './transport/webSerial';
import { connectUsb } from './transport/webUsb';
import { createDemoSettings, createDemoTransport, demoHiLinkError, demoNoAtError, demoWebCapture, DEMO_USB } from './ui/demo';
import ImportCapture from './ui/ImportCapture.vue';
import { importWebCapture } from './web/importReport';
import { downloadText } from './ui/download';
import { buildDashboard } from './ui/dashboard';
import { DONATE_URL } from './config';
import { LiveSignal } from './ui/liveSignal';
import { StatusRefresher, mergeOverlay, refreshEntries } from './ui/statusRefresh';
import type { Overlay, RefreshState } from './ui/statusRefresh';

const appVersion = __APP_VERSION__;
const gitCommit = __GIT_COMMIT__;

const props = withDefaults(
  defineProps<{
    demo?: boolean;
    /** Demo of a stick without an AT channel. */
    demoNoAt?: boolean;
    /** Demo of a stick that is read through its own web page. */
    demoWeb?: boolean;
    demoDelayMs?: number;
    connectors?: Connectors;
    donateUrl?: string | null;
  }>(),
  { demo: false, demoNoAt: false, demoWeb: false, demoDelayMs: 60, connectors: undefined, donateUrl: undefined },
);

/** One simulated modem per page, so that demo settings survive a simulated restart. */
const demoSettings = createDemoSettings();

const connectors = computed<Connectors>(() => {
  if (props.connectors) return props.connectors;
  if (props.demo) {
    const make: Connector = async ({ beforeOpen }) => {
      await beforeOpen();
      if (props.demoNoAt) throw demoNoAtError();
      if (props.demoWeb) throw demoHiLinkError();
      return createDemoTransport({ delayMs: props.demoDelayMs, settings: demoSettings });
    };
    return { serial: make, usb: make };
  }
  return { serial: connectSerial, usb: connectUsb };
});

const COPS_SCAN = STANDARD_CATALOG.find((e) => e.command === 'AT+COPS=?')!;
/** Longer than the worst USB shutdown (two calls of 2000 ms), so a late close cannot hit the next session. */
const CLOSE_TIMEOUT_MS = 4500;

type Phase = 'idle' | 'auto' | 'deep' | 'network' | 'finished';
type ScanKind = 'auto' | 'deep' | 'network';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'actions', label: 'Actions' },
] as const;
const IMPORTED_TERMINAL = 'This report was imported from a file, so there is no modem to send commands to.';
const IMPORTED_SCANS = 'Deep scan and Network scan need a connected modem. This report was imported from a file.';
const IMPORTED_LIVE = 'Live signal needs a connected modem. This report was imported from a file.';
const IMPORTED_REFRESH = 'Refresh needs a connected modem. This report was imported from a file.';
const TERMINAL_DURING_SCAN = 'Sending is off while a scan is running, so that a typed command cannot land between the scan commands.';
const TERMINAL_DURING_ACTION = 'Sending is off while an action is running, so that a typed command cannot land between its steps.';
const SCAN_TITLES: Record<ScanKind, string> = {
  auto: 'Scanning (automatic, read-only)',
  deep: 'Scanning (deep scan)',
  network: 'Scanning (network scan)',
};
const FINISHED_TEXT: Record<ScanKind, string> = {
  auto: 'Automatic scan finished.',
  deep: 'Deep scan finished.',
  network: 'Network scan finished.',
};

const donate = computed(() => (props.donateUrl === undefined ? DONATE_URL : props.donateUrl));

const tab = ref<(typeof TABS)[number]['id']>('overview');
const phase = ref<Phase>('idle');
const connected = ref(false);
const lostReason = ref('');
/** The modem went away because of an action: that is not a lost connection. */
const restarting = ref(false);
/** An action, or the read of its current values, holds the modem. */
const actionBusy = ref(false);
const autoDone = ref(false);
/** The automatic scan ran to the end (not stopped, not silent, not cut off). */
const autoComplete = ref(false);
const items = ref<ScanItem[]>([]);
const reportMeta = ref<Pick<ScanReport, 'startedAt' | 'usb' | 'profile' | 'commandList' | 'interrupted'>>({
  startedAt: '',
  commandList: [],
});
const confirmDeep = ref(false);
const label = ref('');
const hideIdentifiers = ref(false);
/** Set only by a scan that ran to its end, so that "finished" can never follow a stopped one. */
const finished = ref<ScanKind | null>(null);
/** The report on screen came from a capture file: there is no modem behind it. */
const imported = ref<ScanReport | null>(null);
const importCount = ref(0);
/** Newer answers than the scan's. Only the Overview sees them: reports and exports keep the scan. */
const overlay = shallowRef<Overlay>({});
const refreshState = shallowRef<RefreshState>({ enabled: true, refreshing: false, stalled: false, updatedAt: null });
const terminalBusy = ref(0);
const pageHidden = ref(document.visibilityState === 'hidden');
const clock = ref(Date.now());
const currentCommand = ref('');
const progressBase = ref(0);
const progressTotal = ref<number | undefined>(undefined);

let engine: AtEngine | null = null;
let scanner: Scanner | null = null;
let transport: Transport | null = null;
let abort: AbortController | null = null;
/** Identifies the latest onConnected call; an older one closes its transport and gives up. */
let generation = 0;
/** The close in progress, so that a following connect can wait for it. */
let closing: Promise<void> = Promise.resolve();
/** The session an action started on: its later steps must never reach a newer one. */
let actionEngine: AtEngine | null = null;

function snapshot(): ScanReport | null {
  if (imported.value) return imported.value;
  if (!scanner) return null;
  const r = scanner.report;
  return { ...r, items: [...items.value], commandList: [...r.commandList] };
}

function syncMeta(): void {
  if (!scanner) return;
  const r = scanner.report;
  reportMeta.value = { startedAt: r.startedAt, usb: r.usb, profile: r.profile, commandList: [...r.commandList], interrupted: r.interrupted };
}

const dashboard = computed(() =>
  buildDashboard(mergeOverlay({ ...reportMeta.value, items: items.value }, overlay.value), { hideIdentifiers: hideIdentifiers.value }),
);
const hasResults = computed(() => items.value.length > 0);
const running = computed(() => phase.value !== 'idle' && phase.value !== 'finished');
const started = computed(() => hasResults.value || connected.value);
const canNetworkScan = computed(() => connected.value && autoDone.value && !running.value && !actionBusy.value);
const canDeep = computed(() => canNetworkScan.value && autoComplete.value);
const modemBusy = computed(() => running.value || actionBusy.value);
/** The serial number from the scan: it tells whether a reconnected modem is the same one. Never shown. */
const modemKey = computed(() => items.value.find((i) => i.parser === 'cgsn' && i.state === 'done')?.response?.lines.join('') || undefined);
const refreshBlocked = computed(() => {
  if (imported.value) return IMPORTED_REFRESH;
  if (!connected.value) return 'Refresh needs a connected modem.';
  if (running.value) return 'A scan is running.';
  return actionBusy.value ? 'An action is running.' : '';
});
const terminalReason = computed(() => {
  if (imported.value) return IMPORTED_TERMINAL;
  if (running.value) return TERMINAL_DURING_SCAN;
  return actionBusy.value ? TERMINAL_DURING_ACTION : '';
});
const interruptedText = computed(() =>
  reportMeta.value.interrupted === 'aborted'
    ? 'Scan stopped. The results so far are kept.'
    : `Scan interrupted: ${reportMeta.value.interrupted}`,
);

const live = new LiveSignal((command) => {
  if (!engine) return Promise.resolve({ command, status: 'disconnected', lines: [], durationMs: 0 });
  return engine.send(command);
});
const liveEnabled = live.enabled;
const livePaused = live.paused;
const liveSamples = live.samples;
// Synchronous, so that no poll can be issued between the start of a scan and its first command.
watch(modemBusy, (busy) => live.setPaused(busy), { flush: 'sync' });

const refresher = new StatusRefresher(
  (command, opts) => (engine ? engine.send(command, opts ?? {}) : Promise.resolve({ command, status: 'disconnected', lines: [], durationMs: 0 })),
  {
    onResults: (results) => {
      overlay.value = { ...overlay.value, ...Object.fromEntries(results.map((item) => [item.id, item])) };
    },
    onState: (state) => {
      refreshState.value = state;
    },
  },
);
const refreshHeld = computed(() => modemBusy.value || terminalBusy.value > 0 || pageHidden.value);
// Synchronous for the same reason as above.
watch(refreshHeld, (held) => refresher.setPaused(held), { flush: 'sync', immediate: true });

function onVisibilityChange(): void {
  pageHidden.value = document.visibilityState === 'hidden';
}
let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  clockTimer = setInterval(() => (clock.value = Date.now()), 1000);
});

function toggleLive(on: boolean): void {
  if (on && connected.value) live.start();
  else live.stop();
}

/** A close that hangs must not block the next connection. */
async function closeBounded(t: Transport): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([t.close(), new Promise<void>((r) => (timer = setTimeout(r, CLOSE_TIMEOUT_MS)))]);
  } catch {
    /* already gone */
  } finally {
    clearTimeout(timer);
  }
}

function teardown(): Promise<void> {
  // Detach synchronously: while the close is pending, nothing may reach the old session.
  const old = transport;
  live.stop();
  refresher.stop();
  abort?.abort();
  engine?.dispose();
  abort = null;
  engine = null;
  transport = null;
  connected.value = false;
  confirmDeep.value = false;
  if (running.value) phase.value = 'finished';
  if (old) closing = closeBounded(old);
  return closing;
}

async function runScan(s: Scanner, which: ScanKind, work: () => Promise<unknown>, controller?: AbortController): Promise<void> {
  phase.value = which;
  finished.value = null;
  currentCommand.value = '';
  progressBase.value = items.value.length;
  progressTotal.value = which === 'auto' ? s.plannedAutoCommands() : undefined;
  try {
    await work();
  } catch (e) {
    s.report.interrupted = e instanceof Error ? e.message : String(e);
  } finally {
    if (s === scanner) {
      // A stop that lands during the last command leaves nothing for the scanner to notice.
      if (controller?.signal.aborted && s.report.interrupted === undefined) s.report.interrupted = 'aborted';
      syncMeta();
      phase.value = 'finished';
      if (s.report.interrupted === undefined) finished.value = which;
    }
  }
}

/** A fresh report from the automatic scan, on the session that is already open. */
async function scanFromStart(): Promise<void> {
  refresher.stop();
  overlay.value = {};
  const usb = props.demo ? DEMO_USB : transport?.usbId;
  const s = new Scanner(engine!, usb ? { usb } : {});
  scanner = s;
  s.onItem((item) => {
    if (s !== scanner) return;
    items.value.push(item);
    syncMeta();
    if (phase.value === 'auto') progressTotal.value = s.plannedAutoCommands();
  });
  s.onCommand((command) => {
    if (s === scanner) currentCommand.value = command;
  });
  items.value = [];
  reportMeta.value = { startedAt: s.report.startedAt, usb: s.report.usb, commandList: [] };
  autoDone.value = false;
  autoComplete.value = false;
  confirmDeep.value = false;
  const controller = new AbortController();
  abort = controller;
  await runScan(s, 'auto', () => s.runAuto(controller.signal), controller);
  if (s === scanner) {
    autoDone.value = true;
    autoComplete.value = s.report.interrupted === undefined;
    if (autoComplete.value && connected.value) refresher.start(refreshEntries(s.report.profile));
  }
}

async function onConnected(t: Transport): Promise<void> {
  const current = ++generation;
  await teardown();
  if (current !== generation) {
    await closeBounded(t);
    return;
  }
  imported.value = null;
  transport = t;
  label.value = t.label;
  engine = new AtEngine(t);
  engine.onUrc(() => refresher.trigger());
  engine.onDisconnect((reason) => {
    live.stop();
    refresher.stop();
    connected.value = false;
    lostReason.value = reason;
    confirmDeep.value = false;
    syncMeta();
    if (running.value) phase.value = 'finished';
  });
  connected.value = true;
  lostReason.value = '';
  restarting.value = false;
  await scanFromStart();
}

function stop(): void {
  abort?.abort();
}

async function startDeep(): Promise<void> {
  confirmDeep.value = false;
  if (modemBusy.value || !scanner || !connected.value) return;
  const s = scanner;
  const controller = new AbortController();
  abort = controller;
  await runScan(s, 'deep', () => s.runDeep(controller.signal), controller);
}

async function startNetworkScan(): Promise<void> {
  confirmDeep.value = false;
  if (modemBusy.value || !scanner) return;
  const s = scanner;
  await runScan(s, 'network', () => s.runManual(COPS_SCAN));
}

async function terminalSend(command: string, body?: string): Promise<AtResponse> {
  if (!engine) return { command, status: 'disconnected', lines: [], durationMs: 0 };
  terminalBusy.value++;
  try {
    return await engine.send(command, { timeoutMs: 15000, cancelPromptOnTimeout: true, body });
  } finally {
    terminalBusy.value--;
  }
}

/** Takes the modem for an action. False when something else holds it, and then nothing may be sent. */
function beginAction(): boolean {
  if (modemBusy.value || !engine || !connected.value) return false;
  actionBusy.value = true;
  actionEngine = engine;
  return true;
}

function endAction(): void {
  actionBusy.value = false;
  actionEngine = null;
}

function actionSend(command: string, opts: SendOptions = {}): Promise<AtResponse> {
  if (!actionEngine) return Promise.resolve({ command, status: 'disconnected', lines: [], durationMs: 0 });
  return actionEngine.send(command, opts);
}

/** The modem is on its way down: the session ends here, and the reconnect buttons take over. */
function onRestarted(): void {
  restarting.value = true;
  lostReason.value = '';
  void teardown();
}

/** Runs whenever an action went through, so that the Overview never contradicts it. */
function refreshAfterAction(): void {
  if (connected.value) refresher.runNow(refreshEntries(reportMeta.value.profile));
}

function rescan(): void {
  if (modemBusy.value || !engine || !connected.value) return;
  void scanFromStart();
}

function onImported(report: ScanReport): void {
  // Ends whatever session there was: nothing of it may reach the imported report.
  generation++;
  void teardown();
  scanner = null;
  overlay.value = {};
  imported.value = report;
  importCount.value++;
  items.value = [...report.items];
  reportMeta.value = { startedAt: report.startedAt, profile: report.profile, commandList: [] };
  phase.value = 'idle';
  finished.value = null;
  lostReason.value = '';
  restarting.value = false;
  autoDone.value = false;
  autoComplete.value = false;
  tab.value = 'overview';
}

function loadDemoCapture(): void {
  onImported(importWebCapture(demoWebCapture()));
}

function exportShared(kind: 'json' | 'md'): void {
  const report = snapshot();
  if (!report) return;
  const shared = redactReport(report);
  if (kind === 'json') downloadText('modemlens-report.json', toJson(shared), 'application/json');
  else downloadText('modemlens-report.md', toMarkdown(shared), 'text/markdown');
}

function exportFull(kind: 'json' | 'md'): void {
  const full = snapshot();
  if (!full) return;
  if (kind === 'json') downloadText('modemlens-report-FULL.json', toJson(full), 'application/json');
  else downloadText('modemlens-report-FULL.md', toMarkdown(full), 'text/markdown');
}

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  clearInterval(clockTimer);
  void teardown();
});
</script>

<template>
  <header v-if="started" class="topbar">
    <div class="topbar-inner">
      <h1 class="brand">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="mark"><rect x="2" y="15" width="4" height="7" rx="1" /><rect x="10" y="9" width="4" height="13" rx="1" /><rect x="18" y="2" width="4" height="20" rx="1" /></svg>
        ModemLens
        <span v-if="demo" class="demo-tag" title="A made-up modem with fake identifiers. Nothing is connected.">Demo mode</span>
      </h1>
      <nav class="tabs" aria-label="Views">
        <button v-for="t in TABS" :key="t.id" type="button" :class="{ active: tab === t.id }" :aria-current="tab === t.id ? 'page' : undefined" @click="tab = t.id">
          {{ t.label }}
        </button>
      </nav>
      <div class="actions">
        <span class="switch-with-help"><ToggleSwitch v-model="hideIdentifiers" label="Hide identifiers" /><HelpTip term="Hide identifiers" /></span>
        <ExportMenu :disabled="!hasResults" :session="reportMeta.startedAt" @shared="exportShared" @full="exportFull" />
      </div>
    </div>
  </header>

  <main class="page">
    <p v-if="demo && !started" class="demo">Demo mode: a made-up modem with fake identifiers. Nothing is connected.</p>

    <div v-if="!started" class="landing">
      <svg viewBox="0 0 122 100" aria-hidden="true" class="landing-mark">
        <rect x="0" y="80" width="18" height="20" rx="3" /><rect x="26" y="60" width="18" height="40" rx="3" /><rect x="52" y="40" width="18" height="60" rx="3" /><rect x="78" y="20" width="18" height="80" rx="3" /><rect x="104" y="0" width="18" height="100" rx="3" />
      </svg>
      <h1>ModemLens</h1>
      <p class="lede">
        See what your USB cellular modem is, whether it is on the network and how good the signal is. It runs in Chrome
        or Edge, and nothing leaves this page.
      </p>
    </div>

    <div :class="started ? 'session' : 'start'">
      <div v-if="started" class="link">
        <p :data-tone="connected ? 'ok' : 'neutral'">
          <span class="dot" aria-hidden="true" />
          <template v-if="connected">Connected: <span class="mono">{{ label }}</span></template>
          <template v-else-if="imported">Imported capture: <span class="mono">{{ imported.profile?.label }}, {{ imported.startedAt }}</span></template>
          <template v-else>Not connected</template>
        </p>
        <p v-if="!running && !(reportMeta.interrupted && connected) && finished && connected" class="hint" role="status">{{ FINISHED_TEXT[finished] }}</p>
        <AutoRefresh
          v-if="connected && autoDone && autoComplete"
          :state="refreshState"
          :now="clock"
          @toggle="refresher.setEnabled($event)"
          @resume="refresher.resume()"
        />
      </div>
      <ConnectBar
        :connectors="connectors"
        :force-supported="demo || undefined"
        :busy="connected && modemBusy"
        :reconnect="!connected && hasResults && !imported"
        :compact="started"
        :before-open="teardown"
        :import-count="importCount"
        @connected="onConnected"
        @imported="onImported"
      />
      <div v-if="!started" class="import-row">
        <ImportCapture @imported="onImported" />
        <button v-if="demoWeb" type="button" @click="loadDemoCapture">Load the demo capture</button>
      </div>
    </div>

    <p v-if="lostReason" class="notice warn" role="alert">
      Connection lost: {{ lostReason }}. The results are kept. Use the buttons above to reconnect.
    </p>
    <p v-else-if="restarting" class="notice warn" role="status">
      The modem is restarting, reconnect when it is back. Use the buttons above. A new USB mode can change how the modem
      appears in the device list.
    </p>

    <template v-if="started">
      <ScanProgress
        v-if="running"
        :title="SCAN_TITLES[phase as ScanKind]"
        :done="items.length - progressBase"
        :total="progressTotal"
        :command="currentCommand"
        :can-stop="phase !== 'network'"
        :slow-note="phase === 'network' ? 'This can take minutes.' : undefined"
        @stop="stop"
      />
      <p v-else-if="reportMeta.interrupted && connected" class="notice warn" role="status">{{ interruptedText }}</p>

      <div v-if="tab === 'overview' || tab === 'diagnostics'" class="refresh-row">
        <button type="button" :disabled="refreshBlocked !== ''" @click="rescan">Refresh</button>
        <p v-if="refreshBlocked" class="hint">{{ refreshBlocked }}</p>
      </div>

      <Overview
        v-show="tab === 'overview'"
        :dashboard="dashboard"
        :scanning="running"
        :live-enabled="liveEnabled"
        :live-paused="livePaused"
        :live-samples="liveSamples"
        :live-available="connected && !modemBusy"
        :live-unavailable-reason="imported ? IMPORTED_LIVE : undefined"
        @live="toggleLive"
      />
      <Diagnostics
        v-show="tab === 'diagnostics'"
        :items="items"
        :can-deep="canDeep"
        :can-network-scan="canNetworkScan"
        :auto-incomplete="canNetworkScan && !autoComplete"
        :confirm-deep="confirmDeep"
        :hide-identifiers="hideIdentifiers"
        :scans-unavailable-reason="imported ? IMPORTED_SCANS : undefined"
        @ask-deep="confirmDeep = true"
        @cancel-deep="confirmDeep = false"
        @start-deep="startDeep"
        @network-scan="startNetworkScan"
      />
      <TerminalPane
        :key="importCount"
        v-show="tab === 'terminal'"
        :send="terminalSend"
        :disabled="!connected || modemBusy"
        :disabled-reason="terminalReason"
        :hide-identifiers="hideIdentifiers"
      />
      <ActionsPanel
        :key="`actions-${importCount}`"
        v-show="tab === 'actions'"
        :active="tab === 'actions'"
        :connected="connected"
        :imported="imported !== null"
        :profile-id="reportMeta.profile?.id"
        :scanning="running"
        :modem-key="modemKey"
        :hide-identifiers="hideIdentifiers"
        :send="actionSend"
        :begin="beginAction"
        :end="endAction"
        @restarted="onRestarted"
        @confirmed="refreshAfterAction"
      />
      <p v-if="donate && phase === 'finished' && autoDone" class="donate-row hint">Useful? <DonateLink :url="donate" /></p>
    </template>

    <HelpNoModem :class="{ narrow: !started }" @imported="onImported" />

    <footer>
      <span>ModemLens {{ appVersion }} ({{ gitCommit }}). Runs only in Chrome or Edge. No tracking, no third-party scripts.</span>
      <DonateLink :url="donate" />
    </footer>
  </main>
</template>

<style scoped>
.topbar { border-bottom: 1px solid var(--line); }
.topbar-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 1.75rem;
  max-width: 78rem;
  margin: 0 auto;
  padding: 0.6rem var(--gutter) 0;
}
.brand { display: flex; align-items: center; gap: 0.5rem; padding-bottom: 0.6rem; font-size: 1.02rem; font-weight: 650; letter-spacing: -0.015em; }
.mark { width: 1rem; height: 1rem; fill: var(--accent); }
.demo-tag { padding: 0.05rem 0.45rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0; color: var(--accent); background: var(--accent-soft); border-radius: 4px; }
.actions { display: flex; align-items: center; gap: 1rem; margin-left: auto; padding-bottom: 0.6rem; }
.switch-with-help { display: inline-flex; align-items: center; }
.refresh-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; }
.tabs { display: flex; gap: 1.5rem; order: 0; }
.tabs button {
  padding: 0.35rem 0 0.75rem;
  color: var(--ink-3);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
}
.tabs button:hover:not(:disabled) { color: var(--ink); }
.tabs button.active { color: var(--ink); border-bottom-color: var(--accent); }

.page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 78rem;
  margin: 0 auto;
  padding: 1rem var(--gutter) 2.5rem;
}
.demo { font-size: 0.82rem; color: var(--ink-3); }

.landing { max-width: 42rem; padding-top: clamp(1rem, 6vh, 4rem); }
.landing-mark { display: block; width: 3.4rem; height: auto; margin-bottom: 1.5rem; fill: var(--accent); }
.landing h1 { font-size: clamp(3.2rem, 9vw, 5.75rem); font-weight: 700; line-height: 0.98; letter-spacing: -0.045em; }
.lede { margin-top: 1rem; font-size: clamp(1.1rem, 2.2vw, 1.35rem); line-height: 1.4; color: var(--ink-2); }
.start { max-width: 46rem; margin-top: 0.75rem; }
.import-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.75rem 1.25rem; margin-top: 1.1rem; }
.narrow { max-width: 46rem; width: 100%; }

.session { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1.5rem; }
.link { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.1rem 1.25rem; min-width: 0; font-size: 0.85rem; color: var(--ink-2); overflow-wrap: anywhere; }
.link .mono { font-size: 0.8rem; }
.link .hint { font-size: 0.8rem; }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; margin-right: 0.45rem; background: var(--tone); border-radius: 50%; }

footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-top: 1rem;
  font-size: 0.82rem;
  color: var(--ink-3);
}

@media (max-width: 720px) {
  .tabs { order: 3; flex-basis: 100%; }
}
</style>
