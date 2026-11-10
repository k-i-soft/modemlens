import { describe, expect, test, vi } from 'vitest';
import { WEB_DIALECTS } from '../../src/web/dialects';
import type { WebDialect } from '../../src/web/dialects';
import { buildBookmarklet, captureFileName } from '../../src/web/bookmarklets';
import { KNOWN_PARSERS } from '../../src/parse';

const hilink = WEB_DIALECTS.find((d) => d.id === 'hilink')!;
const zte = WEB_DIALECTS.find((d) => d.id === 'zte')!;
const script = (d: WebDialect): string => buildBookmarklet(d).replace(/^javascript:/, '');

type Answer = { status: number; body: string } | Error;

/** Runs the real bookmarklet code against stand-ins for what a browser page provides. */
async function run(dialect: WebDialect, answer: (path: string) => Answer) {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const alerts: string[] = [];
  const blobs: Array<{ parts: string[] }> = [];
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const fakeFetch = async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    const a = answer(path);
    if (a instanceof Error) throw a;
    return { status: a.status, text: async () => a.body };
  };
  class FakeBlob {
    constructor(readonly parts: string[]) {}
  }
  const fakeUrl = { createObjectURL: (b: { parts: string[] }) => { blobs.push(b); return 'blob:fake'; } };
  const fakeDocument = { createElement: () => anchor, body: { appendChild: () => undefined } };
  const fn = new Function('fetch', 'alert', 'document', 'URL', 'Blob', `return ${script(dialect)}`);
  await fn(fakeFetch, (m: string) => alerts.push(m), fakeDocument, fakeUrl, FakeBlob);
  return { requests, alerts, blobs, anchor };
}

const xml = { status: 200, body: '<?xml version="1.0"?><response><a>1</a></response>' };

describe('dialects', () => {
  test('hilink endpoints exactly the agreed three', () => {
    expect(hilink.endpoints.map((e) => [e.id, e.path])).toEqual([
      ['information', '/api/device/information'],
      ['signal', '/api/device/signal'],
      ['current-plmn', '/api/net/current-plmn'],
    ]);
    expect(hilink.verified).toBe(true);
  });

  test('zte is confirmed on a real stick and only reads', () => {
    expect(zte.verified).toBe(true);
    expect(zte.endpoints).toHaveLength(1);
    expect(zte.endpoints[0].path).toMatch(/^\/goform\/goform_get_cmd_process\?/);
    expect(zte.endpoints[0].path).not.toMatch(/set_cmd|goformId/i);
  });

  test('every endpoint names a parser that exists', () => {
    for (const d of WEB_DIALECTS) for (const e of d.endpoints) expect(KNOWN_PARSERS).toContain(e.parser);
  });
});

describe.each(WEB_DIALECTS.map((d) => [d.id, d] as const))('bookmarklet %s', (_id, dialect) => {
  test('bookmarklet only uses GET', async () => {
    expect(buildBookmarklet(dialect)).not.toMatch(/POST|PUT|DELETE|PATCH|method|\/api\/user|token|password|login/i);
    const { requests } = await run(dialect, () => ({ status: 404, body: '' }));
    for (const r of requests) expect(r.init?.method).toBeUndefined();
  });

  test('bookmarklet sends nothing to other hosts', async () => {
    const code = buildBookmarklet(dialect);
    expect(code).not.toMatch(/https?:|\/\/|XMLHttpRequest|sendBeacon|WebSocket|\.src\b/i);
    const { requests } = await run(dialect, () => ({ status: 404, body: '' }));
    expect(requests.map((r) => r.path)).toEqual(dialect.endpoints.map((e) => e.path));
    for (const r of requests) {
      expect(r.path.startsWith('/')).toBe(true);
      expect(r.init?.redirect).toBe('error');
    }
  });

  test('survives being stored as a URL', () => {
    expect(buildBookmarklet(dialect).startsWith('javascript:(async()=>{')).toBe(true);
    expect(buildBookmarklet(dialect)).not.toMatch(/[#%"\n\r\\]/);
  });

  test('on the wrong tab it says so and downloads nothing', async () => {
    for (const answer of [
      { status: 200, body: '<!doctype html><html><body>Some other site</body></html>' },
      { status: 404, body: '<html>Not found</html>' },
      new TypeError('Failed to fetch'),
    ]) {
      const { alerts, blobs, anchor } = await run(dialect, () => answer);
      expect(blobs).toEqual([]);
      expect(anchor.click).not.toHaveBeenCalled();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatch(/open the web page of the stick/i);
    }
  });
});

describe('a bookmarklet run on the right page', () => {
  test('saves all the answers and names the file in a short warning', async () => {
    const { alerts, blobs, anchor } = await run(hilink, (path) =>
      path.endsWith('signal') ? new TypeError('Failed to fetch') : path.endsWith('plmn') ? { status: 500, body: 'oops' } : xml);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe(captureFileName(hilink));
    const capture = JSON.parse(blobs[0].parts[0]);
    expect(capture).toMatchObject({ format: 'modemlens-web-capture', version: 1, dialect: 'hilink' });
    expect(Number.isNaN(Date.parse(capture.capturedAt))).toBe(false);
    expect(capture.responses).toEqual([
      { id: 'information', status: 200, body: xml.body },
      { id: 'signal', status: 0, body: '' },
      { id: 'current-plmn', status: 500, body: 'oops' },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(captureFileName(hilink));
    expect(alerts[0]).toMatch(/identifiers/);
    expect(alerts[0]).toMatch(/private/);
    expect(alerts[0]).toMatch(/ModemLens/);
  });

  test('an error document in XML is not an answer', async () => {
    const { blobs } = await run(hilink, () => ({ status: 200, body: '<error><code>125002</code></error>' }));
    expect(blobs).toEqual([]);
  });

  test('zte answers are JSON', async () => {
    const { blobs } = await run(zte, () => ({ status: 200, body: '{"imei":"123456789012345"}' }));
    expect(blobs).toHaveLength(1);
  });
});
