<script setup lang="ts">
import { COMPANY_CONTACT_URL, COMPANY_URL, DONATE_URL, REPOSITORY_URL, SWITCH_HELPER_URL } from '../config';
import DonateLink from './DonateLink.vue';
import { FAQ } from './landingCopy';

withDefaults(defineProps<{ sponsorUrl?: string | null }>(), { sponsorUrl: DONATE_URL });

const steps = [
  'Plug in your modem and click USB direct.',
  "Pick it in your browser's device list.",
  'ModemLens reads it, without changing anything.',
];
</script>

<template>
  <div class="landing-content">
    <section aria-labelledby="uses-heading">
      <h2 id="uses-heading">What ModemLens is for</h2>
      <ul class="uses">
        <li>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect x="9" y="9" width="14" height="14" rx="2" />
            <path d="M13 9V4M19 9V4M13 28v-5M19 28v-5M9 13H4M9 19H4M28 13h-5M28 19h-5" />
          </svg>
          <div>
            <h3>Know what you have</h3>
            <p>Model, firmware, SIM state, enabled LTE bands and USB mode, read from the modem itself.</p>
          </div>
        </li>
        <li>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M4 22h5l3-9 5 13 4-17 2 13h5" />
          </svg>
          <div>
            <h3>See why a connection is weak</h3>
            <p>Signal quality with plain ratings, the serving cell and its neighbours, and a live signal graph.</p>
          </div>
        </li>
        <li>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M5 10h13M24 10h3M5 22h3M14 22h13" />
            <circle cx="21" cy="10" r="3" />
            <circle cx="11" cy="22" r="3" />
          </svg>
          <div>
            <h3>Change settings on purpose</h3>
            <p>APN, USB mode, NAT and more on supported modems. Each change asks first and is read back afterwards.</p>
          </div>
        </li>
        <li>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 4 6 8v8c0 6 4 10 10 12 6-2 10-6 10-12V8z" />
            <path d="m11.5 16 3.2 3.2 5.8-6.4" />
          </svg>
          <div>
            <h3>Share a report safely</h3>
            <p>The default export masks IMEI, IMSI, phone numbers and addresses, so you can attach it to a support ticket.</p>
          </div>
        </li>
      </ul>
    </section>

    <section aria-labelledby="how-heading">
      <h2 id="how-heading">How it works</h2>
      <ol class="steps">
        <li v-for="(step, i) in steps" :key="i">
          <span class="number" aria-hidden="true">{{ i + 1 }}</span>
          <p>{{ step }}</p>
        </li>
      </ol>
    </section>

    <div class="notes">
      <section aria-labelledby="modems-heading" class="wide">
        <h2 id="modems-heading">Which modems work</h2>
        <p>
          Modems with an AT channel work directly. Tested on the Quectel EC200A and an ASR-based stick, and unknown
          modems get a best effort scan. Web-based sticks such as Huawei HiLink can be read with a small bookmark. A
          stick that first appears as a USB disk needs one switch into network mode, which a browser cannot do, so on
          macOS and Linux a <a :href="SWITCH_HELPER_URL" target="_blank" rel="noopener">small helper script</a> does
          it. On Windows, USB direct needs a WinUSB driver on the modem's AT interface.
        </p>
      </section>
      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Your data stays with you</h2>
        <p>
          ModemLens runs entirely in your browser. What it reads from your modem is not sent anywhere. Page downloads
          appear in the server logs, as on any website, and K-I-Soft evaluates those logs for visitor statistics.
        </p>
      </section>
      <section aria-labelledby="source-heading">
        <h2 id="source-heading">Open source</h2>
        <p>ModemLens is free and MIT licensed.</p>
        <p><a :href="REPOSITORY_URL" target="_blank" rel="noopener">Source code on GitHub</a></p>
        <p v-if="sponsorUrl"><DonateLink :url="sponsorUrl" /></p>
      </section>
    </div>

    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading">Questions and answers</h2>
      <div class="faq">
        <div v-for="f in FAQ" :key="f.question">
          <h3>{{ f.question }}</h3>
          <p>{{ f.answer }}</p>
        </div>
      </div>
    </section>

    <section class="display about" aria-labelledby="about-heading">
      <h2 id="about-heading">Built by K-I-Soft</h2>
      <p class="pitch">
        K-I-Soft is a small Swiss software company near Bern. We build and run customer portals for Swiss SMEs, hosted
        in Zurich, and we built ModemLens because we needed it ourselves.
      </p>
      <div class="links">
        <a class="cta" :href="COMPANY_URL" target="_blank" rel="noopener">Visit k-i-soft.ch</a>
        <a :href="COMPANY_CONTACT_URL" target="_blank" rel="noopener">Have a project in mind? Talk to us.</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-content { display: flex; flex-direction: column; gap: clamp(2.25rem, 5vw, 3.5rem); max-width: 62rem; padding-top: 1.25rem; }
h2 { font-size: clamp(1.3rem, 2.6vw, 1.6rem); font-weight: 650; letter-spacing: -0.02em; line-height: 1.2; }
h3 { font-size: 1.02rem; font-weight: 600; letter-spacing: -0.01em; }
p { color: var(--ink-2); overflow-wrap: anywhere; }

.uses { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.6rem clamp(1.5rem, 4vw, 3.5rem); margin: 1.15rem 0 0; padding: 0; list-style: none; }
.uses li { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr); gap: 0.85rem; align-items: start; }
.uses svg { width: 2.25rem; height: 2.25rem; fill: none; stroke: var(--accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.uses p { margin-top: 0.15rem; font-size: 0.95rem; }

.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 1.15rem 0 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.steps li { padding: 0.9rem 1.25rem 0 0; }
.number { display: block; font-size: 2.1rem; font-weight: 700; line-height: 1; letter-spacing: -0.03em; color: var(--accent); }
.steps p { margin-top: 0.45rem; color: var(--ink); }

.notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.75rem clamp(1.5rem, 4vw, 3.5rem); }
.notes .wide { grid-column: 1 / -1; }
.notes h2 { font-size: 1.15rem; }
.notes p { margin-top: 0.4rem; font-size: 0.95rem; }

.faq { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.6rem clamp(1.5rem, 4vw, 3.5rem); margin-top: 1.15rem; }
.faq p { margin-top: 0.3rem; font-size: 0.95rem; }

.about { padding: clamp(1.5rem, 4vw, 2.75rem); }
.about h2 { font-size: clamp(1.7rem, 4.5vw, 2.5rem); font-weight: 700; letter-spacing: -0.03em; }
.pitch { max-width: 42rem; margin-top: 0.75rem; font-size: clamp(1.02rem, 2vw, 1.18rem); line-height: 1.45; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.5rem; margin-top: 1.4rem; }
.cta { padding: 0.55rem 1.1rem; font-weight: 600; color: var(--accent-ink); background: var(--accent); border-radius: var(--radius-s); text-decoration: none; }
.cta:hover { filter: brightness(1.08); }
.about a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (max-width: 640px) {
  .uses, .steps, .notes, .faq { grid-template-columns: minmax(0, 1fr); }
  .steps li { padding-right: 0; }
}
</style>
