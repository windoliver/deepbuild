// AC1 #1457: no test, lane or script names a deleted mode, git grep proves it; a planted caller fails.
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { namesDeleted, REPO, TWINS } from './helpers.ts';

describe('#1457 AC1 the deleted modes have no caller', () => {
  it('git grep finds no --cursor-demo, --probe-synthetic, --probe-held, --post-forged or `mod trusted` in tests, lanes, scripts, crates, packages or benchmarks', () => {
    expect(namesDeleted(REPO, true)).toEqual([]);
  }, 60_000);

  it('wrong programs: a planted script caller and a planted lane entry are each found, naming the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'da1457-grep-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'tests'));
    cpSync(join(TWINS, 'caller.mjs'), join(root, 'scripts/probe.mjs'));
    cpSync(join(TWINS, 'caller.lane.txt'), join(root, 'tests/lane.ts'));
    const found = namesDeleted(root, false);
    expect(found.some((l) => l.startsWith('scripts/probe.mjs:'))).toBe(true);
    expect(found.some((l) => l.startsWith('tests/lane.ts:'))).toBe(true);
  });
});
