// #1551 Scope: "`gpui-pre-macos` isn't vendored, so this adds a vendored crate and a row in #1426's table." The build
// takes `gpui-pre-macos` from a tree under vendor/, the carried-patch table (vendor/gpui-pre-apple/upstream/README.md)
// has a row for #1551 naming files in that tree, and #1426's lint (`node scripts/vendor-rebase.mjs check`) passes it.
// The wrong programs: the merge base (the crate from crates.io, no tree, no row); a tree the build doesn't use; a
// changed file with no row or no mark, which the lint fails.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { C1, C2, REPO, inconclusive } from './helpers.ts';

const TREE = 'vendor/gpui-pre-macos';

describe(`${C1} ${C2} scope: gpui-pre-macos is vendored, with a row in #1426's carried-patch table that its lint passes`, () => {
  it(`${C1} ${C2} the build takes gpui-pre-macos from ${TREE}, the table has a #1551 row naming its files, and vendor-rebase check passes`, () => {
    const lock = readFileSync(join(REPO, 'Cargo.lock'), 'utf8');
    const entries = lock.split('[[package]]').filter((p) => /^\s*name = "gpui-pre-macos"$/m.test(p));
    expect(entries.length, 'Cargo.lock resolves one gpui-pre-macos').toBe(1);
    expect(entries[0], 'Cargo.lock resolves gpui-pre-macos from a path, not a registry').not.toMatch(/^\s*source = /m);
    const version = /^\s*version = "([^"]+)"$/m.exec(entries[0]!)?.[1];
    const manifest = join(REPO, TREE, 'Cargo.toml');
    expect(existsSync(manifest), `${TREE}/Cargo.toml exists`).toBe(true);
    const text = readFileSync(manifest, 'utf8');
    expect(/^\[package\][^[]*?^name = "gpui-pre-macos"$/ms.test(text) && /^\[package\][^[]*?^version = "([^"]+)"$/ms.exec(text)?.[1] === version,
      `${TREE} is gpui-pre-macos at the version Cargo.lock resolves (${version})`).toBe(true);

    const table = readFileSync(join(REPO, 'vendor', 'gpui-pre-apple', 'upstream', 'README.md'), 'utf8').split('## Carried patches')[1]?.split('\n## ')[0] ?? '';
    const rows = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Behavior') && !l.startsWith('|---')).map((l) => l.split(' | '));
    const ours = rows.filter((cells) => cells[1]?.trim() === '#1551');
    expect(ours.length, 'the carried-patch table has a row for #1551').toBeGreaterThan(0);
    expect(ours.some((cells) => (cells[2] ?? '').includes(`\`${TREE}/`)), `a #1551 row names a file under ${TREE}: ${ours.map((c) => c.join(' | ')).join('\n')}`).toBe(true);

    const check = spawnSync(process.execPath, [join(REPO, 'scripts', 'vendor-rebase.mjs'), 'check'], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    const out = `${check.stdout ?? ''}${check.stderr ?? ''}`;
    const blocked = out.split('\n').filter((l) => l.startsWith('BLOCKED'));
    if (blocked.length && !out.split('\n').some((l) => l.startsWith('FAIL'))) inconclusive('vendor-rebase check had no pinned release to compare with (no network and no cache)', blocked);
    expect({ status: check.status, fails: out.split('\n').filter((l) => /^(FAIL|BLOCKED)/.test(l)) }, `vendor-rebase check passes the vendored tree: ${out.slice(-3000)}`).toEqual({ status: 0, fails: [] });
  }, 1_800_000);
});
