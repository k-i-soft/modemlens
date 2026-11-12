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
  test('the build that made a report travels with it, also in the shared variant', () => {
    const withApp: ScanReport = { ...full, app: '0.1.0 (6e4bf7b)' };
    expect(redactReport(withApp).app).toBe('0.1.0 (6e4bf7b)');
    expect(toMarkdown(withApp)).toContain('- ModemLens: 0.1.0 (6e4bf7b)');
    expect(toMarkdown(redactReport(withApp))).toContain('- ModemLens: 0.1.0 (6e4bf7b)');
    expect(toMarkdown(full)).not.toContain('- ModemLens:');
  });

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

  describe('markdown planted in modem text stays inert', () => {
    const CRAFTED = '[click](https://evil.example/x) ![img](http://evil.example/i) @attacker a@evil.example *bold* _em_ ~gone~ www.evil.example `code` a|b';
    const crafted: ScanReport = {
      startedAt: CRAFTED,
      usb: CRAFTED,
      items: [
        { id: 'ati', command: `AT${CRAFTED}`, category: 'identity', state: 'done', parser: 'identity',
          response: { command: 'ATI', status: 'ok', lines: [CRAFTED, CRAFTED], durationMs: 1 } },
        { id: 'csq', command: 'AT+CSQ', category: 'signal', state: 'done', parser: 'csq',
          response: { command: 'AT+CSQ', status: 'ok', lines: [`+CSQ: 21,99 ${CRAFTED}`], durationMs: 1 } },
      ],
      commandList: ['# Injected heading', CRAFTED],
    };

    test.each([
      ['full', () => toMarkdown(crafted)],
      ['shared', () => toMarkdown({ ...redactReport(crafted), startedAt: CRAFTED, usb: CRAFTED, commandList: ['# Injected heading', CRAFTED] })],
    ])('%s report', (_, render) => {
      const md = render();
      expect(md).toContain('click');
      expect(md).not.toMatch(/(?<!\\)[[\]*_~`|]/);
      expect(md).not.toMatch(/https?:\/\//);
      expect(md).not.toMatch(/\bwww\./i);
      expect(md).not.toMatch(/@[a-z0-9]/i);
      expect(md).not.toMatch(/^# Injected/m);
    });

    test('a masked value reads as plain text once rendered', () => {
      expect(toMarkdown(redactReport(full))).toContain('\\[redacted\\]');
    });
  });

  test('full export is unmasked and marked', () => {
    const out = toJson(full);
    expect(out).toContain('123456789012345');
    expect(JSON.parse(out).redacted).toBeUndefined();
    expect(JSON.parse(toJson(redactReport(full))).redacted).toBe(true);
  });
});
