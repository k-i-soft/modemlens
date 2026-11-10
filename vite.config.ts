import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Puts the landing page and its structured data into index.html, see src/ui/prerender.ts. */
function prerenderLanding(): Plugin {
  return {
    name: 'modemlens-prerender-landing',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const server = await createServer({
          configFile: false,
          logLevel: 'silent',
          appType: 'custom',
          server: { middlewareMode: true, hmr: false, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
          plugins: [vue()],
        });
        try {
          const { landingHtml, structuredData } = await server.ssrLoadModule('/src/ui/prerender.ts');
          return html
            .replace('<div id="app"></div>', `<div id="app">${await landingHtml()}</div>`)
            .replace('</head>', `<script type="application/ld+json">${structuredData()}</script></head>`);
        } finally {
          await server.close();
        }
      },
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  plugins: [
    vue(),
    prerenderLanding(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      // A registration script file, never an inline script, so a strict CSP works.
      injectRegister: 'script',
      // The manifest lives in public/ and is linked from index.html.
      manifest: false,
      workbox: {
        // Precache the app shell only. No runtime caching, so the worker never
        // touches other origins; workbox routes only same-origin GET requests.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/404\.html$/, /^\/[^/]+\.txt$/, /^\/sitemap\.xml$/, /^\/og-image\.png$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});
