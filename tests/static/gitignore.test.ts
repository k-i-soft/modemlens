import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the comments in .gitignore say nothing about what the patterns hide', () => {
  const comments = readFileSync('.gitignore', 'utf8').split('\n').filter((l) => l.startsWith('#'));
  for (const c of comments) expect(c).not.toMatch(/internal|publish|private|confidential|secret/i);
});
