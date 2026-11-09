import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const PATH = 'scripts/deploy_frontend.sh';
const script = readFileSync(PATH, 'utf8');
const code = script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

// The script is only ever parsed here, never executed.
describe('deploy script', () => {
  test('parses', () => {
    expect(() => execFileSync('bash', ['-n', PATH], { stdio: 'pipe' })).not.toThrow();
  });

  test('takes the bucket from the origin the default behaviour serves', () => {
    expect(code).toContain('DefaultCacheBehavior.TargetOriginId');
    expect(code).toMatch(/Origins\.Items\[\?Id=='\$\w+'\]\.DomainName/);
    expect(code).not.toMatch(/contains\(DomainName/);
  });

  test('refuses an origin of the default behaviour that is not S3', () => {
    expect(code.indexOf('is not an S3 origin')).toBeGreaterThan(code.indexOf('DefaultCacheBehavior.TargetOriginId'));
    expect(code.indexOf('is not an S3 origin')).toBeLessThan(code.indexOf('BUCKET_NAME='));
  });
});
