import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CANDIDATE_COMMANDS } from '../../src/catalog/candidates';
import { isDiscoverable } from '../../src/catalog/safety';

describe('CANDIDATE_COMMANDS', () => {
  test('has a useful size and no duplicates', () => {
    expect(CANDIDATE_COMMANDS.length).toBeGreaterThanOrEqual(150);
    expect(CANDIDATE_COMMANDS.length).toBeLessThanOrEqual(350);
    expect(new Set(CANDIDATE_COMMANDS).size).toBe(CANDIDATE_COMMANDS.length);
  });

  test('every candidate has the name shape of an extended command', () => {
    for (const n of CANDIDATE_COMMANDS) expect(n, n).toMatch(/^[+$^#!%*][A-Z0-9_]+$/);
  });

  test('no candidate is a name the safety rules reject', () => {
    for (const n of CANDIDATE_COMMANDS) expect(isDiscoverable(n), n).toBe(true);
  });

  test('the source has no joined groups or comments trailing a list', () => {
    const lines = readFileSync('src/catalog/candidates.ts', 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const where = `line ${i + 1}`;
      expect(line, where).not.toMatch(/\s$/);
      expect(line, where).not.toMatch(/',\s{2,}'/);
      if (line.includes('//')) expect(line.trim().startsWith('//'), where).toBe(true);
    }
  });
});
