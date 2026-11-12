<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { PLANS, SPEED_HOST, ASN_HOST, formatMbps, matchesOperator, planMegabytes, runSpeedTest } from '../../tools/speed';
import type { SpeedEnv, SpeedPhase, SpeedResult, SpeedSize } from '../../tools/speed';
import { MODEM_SIZES, MODEM_SPEED_URL, modemSpeedDialect, runModemSpeed } from '../../tools/modemSpeed';
import type { ModemSpeedResult } from '../../tools/modemSpeed';
import type { ToolOutcome } from '../../tools/types';
import ToolConfirm from './ToolConfirm.vue';
import ToolResult from './ToolResult.vue';
import { BUSY, hold } from './props';
import type { ToolProps } from './props';

const props = defineProps<ToolProps & {
  /** The modem can run its own download test. */
  modemSpeed: boolean;
  /** The operator the modem is registered with, to compare with the network the test went out through. */
  operator?: string;
  env: SpeedEnv;
}>();

const size = ref<SpeedSize>('light');
/** The size the shown result was measured with. */
const testedSize = ref<SpeedSize>('light');
const pending = ref<'browser' | 'modem' | null>(null);
const running = ref<'browser' | 'modem' | null>(null);
const phase = ref<SpeedPhase | null>(null);
const live = ref<number | undefined>(undefined);
const browser = shallowRef<SpeedResult | null>(null);
const modem = shallowRef<ModemSpeedResult | ToolOutcome | null>(null);
let controller: AbortController | null = null;

const dialect = computed(() => modemSpeedDialect(props.profileId));
const modemMb = computed(() => (dialect.value ? MODEM_SIZES[dialect.value][size.value] / 1_000_000 : 0));
const PHASE: Record<SpeedPhase, string> = { latency: 'Measuring latency', download: 'Downloading', upload: 'Uploading', network: 'Looking up the network' };
const phaseText = computed(() => (phase.value ? PHASE[phase.value] : 'Starting'));
const browserHosts = `${SPEED_HOST.replace('https://', '')}, ${ASN_HOST.replace('https://', '')}`;
const modemHost = MODEM_SPEED_URL.replace('http://', '');
const transfers = computed(() => ({ down: PLANS[testedSize.value].down.length, up: PLANS[testedSize.value].up.length }));

/** Mobile speeds: below 2 Mbit/s is slow, 50 and more is excellent. The bar runs on a log scale up to 1 Gbit/s. */
function grade(v: number): string {
  if (v >= 50) return 'excellent';
  if (v >= 10) return 'good';
  if (v >= 2) return 'fair';
  return 'poor';
}
const meter = (v: number) => Math.max(3, Math.min(100, ((Math.log10(Math.max(v, 0.1)) + 1) / 4) * 100));

const tiles = computed(() => {
  const r = browser.value;
  if (!r) return [];
  const t: Array<{ key: string; label: string; value: string; unit: string; grade?: string; meter?: number; note?: string }> = [];
  for (const [key, label, v] of [['down', 'Download', r.downMbps], ['up', 'Upload', r.upMbps]] as const) {
    if (v === undefined) continue;
    const f = formatMbps(v);
    t.push({ key, label, value: f.value, unit: f.unit, grade: grade(v), meter: meter(v) });
  }
  if (r.latencyMs !== undefined) t.push({ key: 'lat', label: 'Latency', value: String(r.latencyMs), unit: 'ms', note: r.jitterMs !== undefined ? `jitter ${r.jitterMs} ms` : undefined });
  return t;
});
const match = computed(() => matchesOperator(browser.value?.network.holder, props.operator));
const usedMb = computed(() => (browser.value ? ((browser.value.bytesDown + browser.value.bytesUp) / 1_000_000).toFixed(1) : '0'));
const modemTile = computed(() => {
  const m = modem.value;
  if (!m || !('downMbps' in m) || m.downMbps === undefined) return null;
  const f = formatMbps(m.downMbps);
  return { value: f.value, unit: f.unit, grade: grade(m.downMbps), meter: meter(m.downMbps) };
});

async function runBrowser(): Promise<void> {
  pending.value = null;
  running.value = 'browser';
  browser.value = null;
  testedSize.value = size.value;
  live.value = undefined;
  controller = new AbortController();
  try {
    browser.value = await runSpeedTest(props.env, size.value, (p, v) => { phase.value = p; live.value = v; }, controller.signal);
  } finally {
    running.value = null;
    phase.value = null;
    controller = null;
  }
}

async function runModem(): Promise<void> {
  const d = dialect.value;
  pending.value = null;
  if (!d) return;
  running.value = 'modem';
  modem.value = null;
  try {
    modem.value = (await hold(props, () => runModemSpeed(props.io, d, size.value, props.env.now))) ?? { tone: 'bad', message: BUSY, answer: [] };
  } finally {
    running.value = null;
  }
}

function stop(): void {
  controller?.abort();
}

onBeforeUnmount(stop);
</script>

<template>
  <li class="tool" data-tool="speed">
    <div class="what">
      <h3>Speed test</h3>
      <p class="summary">How fast data moves over the mobile network: through this computer, or measured inside the modem.</p>
    </div>
    <div class="row" role="radiogroup" aria-label="Test size">
      <label class="choice-radio"><input v-model="size" type="radio" value="light" :disabled="!!running" /> Light, up to {{ planMegabytes('light') }} MB</label>
      <label class="choice-radio"><input v-model="size" type="radio" value="full" :disabled="!!running" /> Full, up to {{ planMegabytes('full') }} MB</label>
    </div>
    <div class="row">
      <button type="button" :disabled="!!running || !!pending" @click="pending = 'browser'">Test through this computer</button>
      <button v-if="modemSpeed" type="button" :disabled="!!blocked || !!running || !!pending" @click="pending = 'modem'">Test inside the modem</button>
      <button v-if="running === 'browser'" type="button" @click="stop">Stop</button>
    </div>

    <ToolConfirm
      v-if="pending === 'browser'"
      label="Speed test through this computer"
      :sends="browserHosts"
      :warning="`Downloads and uploads up to ${planMegabytes(size)} MB with Cloudflare's speed test service, then asks RIPE which network the test left through. Both see this computer's IP address. Nothing read from the modem is sent. The test runs through whatever connection this computer uses: switch off Wi-Fi, unplug network cables and stop VPNs to measure the modem. On a metered plan this uses data volume.`"
      :unverified="false"
      @confirm="runBrowser"
      @cancel="pending = null"
    />
    <ToolConfirm
      v-if="pending === 'modem'"
      label="Speed test inside the modem"
      :sends="`${modemHost}, up to ${modemMb} MB`"
      :warning="`The modem downloads up to ${modemMb} MB from Cloudflare with its own data connection${dialect === 'quectel' ? ', stores it in its own memory for a moment and deletes it again' : ''}. Download only. On a metered plan this uses data volume.`"
      :unverified="unverified"
      @confirm="runModem"
      @cancel="pending = null"
    />

    <div v-if="running" class="speed-live" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{{ running === 'modem' ? 'The modem is downloading...' : phaseText }}</span>
      <span v-if="running === 'browser' && live !== undefined" class="mono">{{ formatMbps(live).value }} {{ formatMbps(live).unit }}</span>
    </div>

    <div v-if="browser" class="result speed-result" :data-tone="browser.error && !tiles.length ? 'bad' : match === false || !browser.network.asn ? 'warn' : 'ok'" role="status">
      <p class="speed-caption">Through this computer</p>
      <div v-if="tiles.length" class="speed-tiles">
        <div v-for="t in tiles" :key="t.key" class="speed-tile" :data-grade="t.grade">
          <span class="speed-label">{{ t.label }}</span>
          <span class="speed-value"><span class="num">{{ t.value }}</span> {{ t.unit }}</span>
          <span v-if="t.meter !== undefined" class="speed-meter"><span :style="{ width: `${t.meter}%` }" /></span>
          <span v-if="t.note" class="speed-note">{{ t.note }}</span>
        </div>
      </div>
      <p v-if="browser.error" :class="tiles.length ? 'reason' : ''">{{ browser.error }}</p>
      <p v-if="browser.network.asn" class="speed-net">
        Went out through <strong>{{ browser.network.holder ?? `AS${browser.network.asn}` }}</strong>
        <span class="mono"> AS{{ browser.network.asn }}{{ browser.network.country ? `, ${browser.network.country}` : '' }}</span>
      </p>
      <p v-else-if="!browser.error" class="speed-match warn">Could not tell which network the test went through, so it may not have used the modem.</p>
      <p v-if="match === true" class="speed-match ok">This matches the modem's operator, {{ operator }}.</p>
      <p v-else-if="match === false" class="speed-match warn">This does not look like the modem's operator ({{ operator }}). The test probably went through another connection, such as Wi-Fi or a network cable. Switch that off and test again.</p>
      <p class="reason">Used about {{ usedMb }} MB. Measured with {{ transfers.down }} downloads and {{ transfers.up }} uploads of growing size.</p>
    </div>

    <ToolResult v-if="modem" :outcome="modem" :hide-identifiers="false">
      <p class="speed-caption">Inside the modem</p>
      <div v-if="modemTile" class="speed-tiles">
        <div class="speed-tile" :data-grade="modemTile.grade">
          <span class="speed-label">Download</span>
          <span class="speed-value"><span class="num">{{ modemTile.value }}</span> {{ modemTile.unit }}</span>
          <span class="speed-meter"><span :style="{ width: `${modemTile.meter}%` }" /></span>
        </div>
      </div>
      <p :class="modemTile ? 'reason' : ''">{{ modem.message }}<template v-if="modemTile"> The modem's own HTTP client is slower than the connection itself, so this is a lower bound.</template></p>
    </ToolResult>
  </li>
</template>

<style scoped>
.choice-radio { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.88rem; color: var(--ink-2); }
.speed-live { display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; }
.spinner { width: 0.9rem; height: 0.9rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.speed-result { display: grid; gap: 0.6rem; }
.speed-caption { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.speed-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.6rem; }
.speed-tile { display: grid; gap: 0.3rem; padding: 0.7rem 0.8rem; background: var(--surface-2); border-radius: 8px; }
.speed-label { font-size: 0.78rem; color: var(--ink-3); }
.speed-value { font-size: 0.85rem; color: var(--ink-3); }
.speed-value .num { font-size: 1.7rem; font-weight: 600; letter-spacing: -0.02em; color: var(--ink); }
.speed-meter { height: 0.35rem; background: color-mix(in srgb, var(--ink) 8%, transparent); border-radius: 999px; overflow: hidden; }
.speed-meter span { display: block; height: 100%; border-radius: 999px; background: var(--g, var(--accent)); animation: grow 0.5s ease-out both; transform-origin: left; }
.speed-note { font-size: 0.78rem; color: var(--ink-3); }
.speed-net { font-size: 0.9rem; }
.speed-match { font-size: 0.85rem; font-weight: 600; }
.speed-match.ok { color: var(--r-excellent); }
.speed-match.warn { color: var(--r-fair); }
[data-grade='excellent'] { --g: var(--f-excellent); }
[data-grade='good'] { --g: var(--f-good); }
[data-grade='fair'] { --g: var(--f-fair); }
[data-grade='poor'] { --g: var(--f-poor); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes grow { from { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .spinner, .speed-meter span { animation: none; } }
</style>
