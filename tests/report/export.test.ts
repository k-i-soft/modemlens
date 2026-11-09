import { describe, expect, test } from 'vitest';
import type { ScanReport } from '../../src/scan/scanner';
import { redactReport } from '../../src/report/redact';
import { toJson, toMarkdown } from '../../src/report/export';

const full: ScanReport = {
  startedAt: '2026-01-01T00:00:00Z',
  items: [
    { id: 'cgsn', command: 'AT+CGSN', category: 'identity', state: 'done', parser: 'cgsn',
      response: { command: 'AT+CGSN', status: 'ok', lines: ['123456789012345'], durationMs: 1 } },
    { id: 'deep:+QXYZ', command: 'AT+QXYZ?', category: 'discovery', state: 'done',
      response: { command: 'AT+QXYZ?', status: 'ok', lines: ['<img src=x onerror=1> 228011234567890'], durationMs: 1 } },
  ],
  commandList: ['+CGSN'],
};

describe('export', () => {
  test('markdown has no secrets or raw HTML in shared variant', () => {
    const md = toMarkdown(redactReport(full));
    expect(md).not.toContain('123456789012345');
    expect(md).not.toContain('228011234567890');
    expect(md).not.toContain('<img');
    expect(md).toContain('redacted');
  });

  test('full markdown escapes HTML', () => {
    const md = toMarkdown(full);
    expect(md).toContain('123456789012345');
    expect(md).not.toContain('<img');
  });

  test('full export is unmasked and marked', () => {
    const out = toJson(full);
    expect(out).toContain('123456789012345');
    expect(JSON.parse(out).redacted).toBeUndefined();
    expect(JSON.parse(toJson(redactReport(full))).redacted).toBe(true);
  });
});
