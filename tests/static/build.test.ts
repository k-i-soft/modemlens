import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Needs `npm run build` first; skipped when dist/ is missing so a plain `vitest run` still passes.
describe.skipIf(!existsSync('dist/index.html'))('built output', () => {
  const html = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8') : '';
  test('no external scripts or styles', () => expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/));
  test('no inline scripts', () => expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>\s*\S/));
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
    expect(sw).not.toMatch(/CacheFirst|StaleWhileRevalidate|NetworkFirst/);
  });
});
