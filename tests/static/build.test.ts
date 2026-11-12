import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Needs `npm run build` first; skipped when dist/ is missing so a plain `vitest run` still passes.
describe.skipIf(!existsSync('dist/index.html'))('built output', () => {
  const html = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8') : '';
  // A canonical link names this page's own address and loads nothing.
  test('no external scripts or styles', () => expect(html).not.toMatch(/<(script|link(?![^>]*rel="canonical"))[^>]+(src|href)="https?:/));
  // Structured data is a data block: it is never executed, so a strict CSP does not touch it.
  test('no inline scripts', () => expect(html).not.toMatch(/<script(?![^>]*(src=|type="application\/ld\+json"))[^>]*>\s*\S/));

  describe('what a crawler without JavaScript reads', () => {
    const decode = (s: string): string => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const text = decode(html.replace(/<head>[\s\S]*?<\/head>/, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

    test('the landing page is in the delivered HTML', () => {
      expect(text.split(' ').length).toBeGreaterThan(400);
      expect(html).toMatch(/<h1>ModemLens<\/h1>/);
      expect(text).toContain('What ModemLens is for');
      expect(text).toContain('Built by K-I-Soft');
      expect(html).not.toMatch(/ data-v-/);
    });
    test('every FAQ entry in the structured data is visible text', () => {
      expect(graphs).toHaveLength(1);
      const faq = (JSON.parse(graphs[0][1])['@graph'] as { '@type': string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[]).find((n) => n['@type'] === 'FAQPage');
      expect(faq?.mainEntity?.length).toBeGreaterThan(4);
      for (const q of faq!.mainEntity!) {
        expect(text).toContain(q.name);
        expect(text).toContain(q.acceptedAnswer.text);
      }
    });
    test('no node that search engines reject without ratings', () => expect(graphs[0][1]).not.toMatch(/"@type":"(Product|SoftwareApplication|WebApplication)"/));
    test('title and description are in the agreed length', () => {
      const title = /<title>([^<]*)<\/title>/.exec(html)![1];
      const description = /<meta name="description" content="([^"]*)"/.exec(html)![1];
      expect(title.length).toBeGreaterThanOrEqual(40);
      expect(title.length).toBeLessThanOrEqual(70);
      expect(description.length).toBeGreaterThanOrEqual(110);
      expect(description.length).toBeLessThanOrEqual(165);
    });
    test('social preview points at a file that ships', () => {
      expect(html).toContain('<meta property="og:image" content="https://modemlens.k-i-soft.ch/og-image.png"');
      expect(existsSync('dist/og-image.png')).toBe(true);
    });
    test('crawler files ship', () => {
      expect(readFileSync('dist/robots.txt', 'utf8')).toContain('Sitemap: https://modemlens.k-i-soft.ch/sitemap.xml');
      expect(readFileSync('dist/sitemap.xml', 'utf8')).toContain('<loc>https://modemlens.k-i-soft.ch/</loc>');
      expect(readFileSync('dist/llms.txt', 'utf8')).toMatch(/^# ModemLens/);
    });
  });

  test('no inline style blocks', () => expect(html).not.toMatch(/<style[\s>]/));
  test('404 page exists and has no inline script or style', () => {
    expect(existsSync('dist/404.html')).toBe(true);
    const nf = readFileSync('dist/404.html', 'utf8');
    expect(nf).not.toMatch(/<style[\s>]/);
    expect(nf).not.toMatch(/<script/);
    expect(nf).toContain('href="/"');
  });
  test('service worker is emitted', () => expect(existsSync('dist/sw.js')).toBe(true));
  test('manifest is emitted and names the app', () => {
    const m = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
    expect(m.name).toBe('ModemLens');
    expect(existsSync('dist/icon.svg')).toBe(true);
  });
  test('service worker has no runtime caching of other origins', () => {
    const sw = readFileSync('dist/sw.js', 'utf8');
    expect(sw).not.toMatch(/https?:\/\//);
    expect(sw).not.toMatch(/CacheFirst|StaleWhileRevalidate/);
  });
  test('version.json names the build, and the worker leaves it to the network', () => {
    const v = JSON.parse(readFileSync('dist/version.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(v.build).toMatch(new RegExp(`^${pkg.version.replace(/\./g, '\\.')} \\(([0-9a-f]{7,}|unknown)\\)$`));
    expect(readFileSync('dist/sw.js', 'utf8')).not.toContain('version.json');
  });
  // A page load from the cache kept people on an old build after a deploy (2026-11-12).
  test('the page itself loads network first, and the cached copy is only the offline fallback', () => {
    const sw = readFileSync('dist/sw.js', 'utf8');
    expect(sw).toMatch(/NetworkFirst/);
    expect(sw).toMatch(/"navigate"===\w+\.mode&&"\/"===\w+\.pathname|\w+\.mode==="navigate"&&\w+\.pathname==="\/"/);
    expect(sw).toMatch(/PrecacheFallbackPlugin\(\{fallbackURL:"index\.html"\}\)/);
    expect(sw).toMatch(/directoryIndex:null/);
    expect(sw).not.toMatch(/createHandlerBoundToURL|NavigationRoute/);
  });
});
