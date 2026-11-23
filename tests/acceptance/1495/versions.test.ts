// AC1 #1495.2599b24d One crate left at the old version refuses the tag, naming the file and both versions.
//
// Issue, Scope: "One source of truth moves every manifest, the app bundle, the hook binary and pack `requires.core`
// together"; "`scripts/release.mjs` has two steps: bump and commit only those files, then, after the release preflight
// passes on that exact commit, tag." Design, Cutting a release: "One command moves every manifest, the app bundle, the
// hook binary and each pack's `requires.core` together from one source, and tags only after the release preflight passes
// on that exact commit."
//
// Surfaces (README, The contract 1, 2, 4, 6, 7 and 8): `bump --repo --version`, `notes`, `tag`; the version sources of
// a fixture release in the real repo's layout, with the root package.json's version as the one source of truth.
// Wrong programs: the base (no scripts/release.mjs); a tag step that refuses whatever the versions (the twin passes
// only when the tag goes through); a bump that leaves a source behind, moves a third-party pin or a pack's own version,
// or commits another file (the twin's bump checks).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bump, cleanup, commitAll, git, initRepo, named, notes, npmArchive, othersIn, preflight, published, refusal, shown, tag, tagged,
  THIRD_PARTY, VERSION_FILES, versionsIn, world, writeOut,
} from './helpers.ts';

afterAll(cleanup);

describe(`${named(1)} One crate left at the old version refuses the tag, naming the file and both versions`, () => {
  it(`${named(1)} the twin: bump moves every version source from 1.2.0 to 1.3.0 in one commit holding only those files, and with every version agreeing the tag goes through`, () => {
    const w = world();
    const before = initRepo(w, '1.2.0');
    const r = bump(w, '1.3.0');
    expect(r.code, `release.mjs bump --version 1.3.0 exits 0:\n${shown(r)}`).toBe(0);

    const head = git(w, 'rev-parse', 'HEAD');
    expect(head, 'bump makes a commit').not.toBe(before);
    expect(git(w, 'rev-parse', 'HEAD^'), 'one commit, on the one before').toBe(before);
    expect(git(w, 'status', '--porcelain', '--untracked-files=all'), 'bump leaves nothing it changed uncommitted').toBe('');
    const changed = git(w, 'diff', '--name-only', before, head).split('\n').filter(Boolean).sort();
    expect(changed, 'the bump commit holds every version source and nothing else').toEqual(VERSION_FILES);

    const behind = versionsIn(w.repo).filter((f) => f.version !== '1.3.0');
    expect(behind, 'every version source reads 1.3.0: each manifest and its @deepbuild pins, the lockfiles, each crate, the app bundle, each pack\'s requires.core').toEqual([]);
    const moved = othersIn(w.repo).filter((f) => f.version !== (f.field === 'version' ? '1.0.0' : THIRD_PARTY));
    expect(moved, `third-party pins stay at ${THIRD_PARTY} and each pack keeps its own version 1.0.0`).toEqual([]);

    const hook = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
    writeOut(w, head, [hook]);
    const report = preflight(w, head);
    const n = notes(w, head, report);
    expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);
    const t = tag(w, head, report);
    expect(t.code, `with every version at 1.3.0, the tag goes through:\n${shown(t)}`).toBe(0);
    expect(tagged(w, '1.3.0'), 'release/1.3.0 names the bump commit').toBe(head);
    expect(published(w)).toEqual([hook.file]);
  }, 300_000);

  it(`${named(1)} one crate left at 1.2.0 refuses the tag, naming crates/deep-show/Cargo.toml, 1.2.0 and 1.3.0; nothing is tagged or published`, () => {
    const w = world();
    initRepo(w, '1.2.0');
    const r = bump(w, '1.3.0');
    expect(r.code, `release.mjs bump --version 1.3.0 exits 0:\n${shown(r)}`).toBe(0);
    // One crate left behind, by hand, and committed: the tree is clean, so only the version can refuse it.
    const file = join(w.repo, 'crates/deep-show/Cargo.toml');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(/(\[package\][^[]*?\nversion\s*=\s*)"1\.3\.0"/, '$1"1.2.0"'));
    const head = commitAll(w, 'Leave deep-show at 1.2.0');
    expect(versionsIn(w.repo).filter((f) => f.version !== '1.3.0'), 'the fixture: one crate, and only it, at the old version')
      .toEqual([{ file: 'crates/deep-show/Cargo.toml', field: 'package.version', version: '1.2.0' }]);

    const hook = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
    writeOut(w, head, [hook]);
    const report = preflight(w, head);
    const n = notes(w, head, report);
    expect(n.code, `release.mjs notes exits 0 (it judges nothing; refusing is the tag step's):\n${shown(n)}`).toBe(0);
    const t = tag(w, head, report);
    expect(refusal(w, t, '1.3.0', ['crates/deep-show/Cargo.toml', '1.2.0', '1.3.0']), shown(t)).toEqual([]);
  }, 300_000);
});
