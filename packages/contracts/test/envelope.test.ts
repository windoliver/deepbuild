// A package's version is a semantic version as semver 2.0.0 writes it (#314): no leading zeros, every pre-release
// identifier non-empty and without leading zeros when numeric, and build metadata allowed.
import { describe, expect, it } from 'vitest';
import { fixtures, validate } from '../src/index.js';

const envelope = (version: string): unknown => ({ ...(fixtures('package.envelope@1')[0] as object), version });

describe('package.envelope@1 versions', () => {
  it('accepts semver 2.0.0 versions, with pre-release and build metadata', () => {
    for (const version of ['0.0.0', '1.2.3', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-0.3.7', '1.0.0-x-y-z.--', '1.2.3+build.7', '1.0.0-beta+exp.sha.5114f85'])
      expect(validate('package.envelope@1', envelope(version)).ok, version).toBe(true);
  });
  it('refuses what semver 2.0.0 does', () => {
    for (const version of ['1.2', '01.2.3', '1.02.3', '1.2.3-', '1.2.3-.', '1.2.3-alpha..1', '1.2.3-01', '1.2.3+', '1.2.3+a..b', 'v1.2.3', '1.2.3 ']) {
      const held = validate('package.envelope@1', envelope(version));
      expect(held.ok, version).toBe(false);
      if (!held.ok) expect(held.issues.map((i) => i.path)).toContain('/version');
    }
  });
});
