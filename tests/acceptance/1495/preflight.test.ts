// AC2 #1495.33e806c7 A preflight record for another commit refuses the tag, naming both commits.
//
// Issue, Scope: "The tag step reuses the check `scripts/release-pack.mjs` already makes on the preflight report
// (`--preflight`, refused unless the report names this commit), and adds no second one"; "after the release preflight
// passes on that exact commit, tag". Runs on: "the tag needs the release preflight's record". Design, Cutting a release:
// "tags only after the release preflight passes on that exact commit".
//
// Surfaces (README, The contract 1, 5, 6 and 8): `tag --commit --preflight`, release-pack's own refusal, which names
// both full commits; a release folder already packed and signed for the release commit is not packed again, and the
// report is checked all the same.
// Wrong programs: the base (no scripts/release.mjs); a tag step that checks the report only when it packs, so a rerun
// over a packed folder takes any report (the second case); a tag step that refuses whatever the report (the twin).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, commitAll, initRepo, named, notes, npmArchive, preflight, published, put, refusal, shown, tag, tagged, world, writeOut } from './helpers.ts';

afterAll(cleanup);

describe(`${named(2)} A preflight record for another commit refuses the tag, naming both commits`, () => {
  it(`${named(2)} a PASS report on the commit before refuses the tag, naming both commits, on a first run and on a rerun over a packed folder; the report for the release commit lets it through`, () => {
    const w = world();
    const older = initRepo(w, '1.3.0');
    put(w.repo, { 'README.md': '# Fixture release\n\nOne more commit, after the one the preflight passed on.\n' });
    const head = commitAll(w, 'A commit after the preflight');
    const stale = preflight(w, older);
    const fresh = preflight(w, head);
    const n = notes(w, head, fresh);
    expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);

    // A first run: nothing packed yet.
    const first = tag(w, head, stale);
    expect(refusal(w, first, '1.3.0', [older, head]), `the report names ${older}, the release is ${head}:\n${shown(first)}`).toEqual([]);
    expect(existsSync(join(w.out, 'manifest.json')), 'nothing was packed for a release the report does not cover').toBe(false);

    // A rerun over a folder already packed and signed for the release commit: the report is checked all the same.
    const hook = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
    writeOut(w, head, [hook]);
    const again = tag(w, head, stale);
    expect(refusal(w, again, '1.3.0', [older, head]), `the rerun takes the same report, and is refused the same way:\n${shown(again)}`).toEqual([]);

    // The twin: the report for the release commit lets the same release through.
    const through = tag(w, head, fresh);
    expect(through.code, `with the report for ${head}, the tag goes through:\n${shown(through)}`).toBe(0);
    expect(tagged(w, '1.3.0')).toBe(head);
    expect(published(w)).toEqual([hook.file]);
  }, 300_000);
});
