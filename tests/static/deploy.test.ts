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

  test('the service worker is left out of the bulk upload and goes up last', () => {
    const bulk = /s3 cp "\$DIST_DIR" [\s\S]*?--cache-control/.exec(code)![0];
    expect(bulk).toContain('--exclude "sw.js"');
    const uploads = [...code.matchAll(/aws_cmd s3 (?:cp|sync) "\$DIST_DIR[^"]*"/g)].map((m) => m[0]);
    expect(uploads.at(-1)).toContain('/sw.js"');
    expect(uploads.filter((u) => u.includes('/sw.js"'))).toHaveLength(1);
  });

  test('refuses to build from a dirty tree', () => {
    const check = /git -C "\$PROJECT_ROOT" status --porcelain/.exec(code);
    expect(check).not.toBeNull();
    expect(check!.index).toBeLessThan(code.indexOf('npm run build'));
    expect(code).toMatch(/uncommitted changes[\s\S]*?exit 1/);
  });

  test('refuses an origin of the default behaviour that is not S3', () => {
    expect(code.indexOf('is not an S3 origin')).toBeGreaterThan(code.indexOf('DefaultCacheBehavior.TargetOriginId'));
    expect(code.indexOf('is not an S3 origin')).toBeLessThan(code.indexOf('BUCKET_NAME='));
  });
});
