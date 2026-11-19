// AC4 #1495.7d91f999 A planted lane reading BLOCKED appears in `Known limits`, and removing it by hand fails the release
// check, naming the lane.
//
// Issue, Scope: "A `Known limits` list in the README is generated from open "known limit" items and each lane BLOCKED or
// INCONCLUSIVE in the release report." Design, Cutting a release: "a generated Known limits list names each open known
// limit and each lane the release report left BLOCKED or INCONCLUSIVE."
//
// Surfaces (README, The contract 6, 7 and 10): the release report's lanes are the preflight report's `lanes`; `notes`
// writes the release's README, `<out>/README.md`, with its `Known limits` section; the release check is the tag step,
// which reads that README as it stands. Open known-limit items come from DEEP_KNOWN_LIMITS, an empty list here.
// Wrong programs: the base (no scripts/release.mjs); a list that leaves the BLOCKED lane out, or lists the lanes that
// passed; a tag step that never reads the README (the hand edit goes through), or refuses whatever it holds (the twin).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, initRepo, knownLimits, named, notes, npmArchive, PASSING, preflight, published, refusal, removeLines, shown, tag, tagged, world, writeOut } from './helpers.ts';

afterAll(cleanup);

/** The planted lane: the release report reads it BLOCKED. */
const LANE = 'planted lane 1495';

describe(`${named(4)} A planted lane reading BLOCKED appears in Known limits, and removing it by hand fails the release check, naming the lane`, () => {
  it(`${named(4)} the BLOCKED lane is in the release README's Known limits and no lane that passed is; with its line removed by hand the tag is refused, naming it; with the README as written the tag goes through`, () => {
    const w = world();
    const commit = initRepo(w, '1.3.0');
    const report = preflight(w, commit, [...PASSING, { name: LANE, state: 'BLOCKED', reason: 'no outside renderer is installed on this machine' }]);
    const hook = npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' });
    writeOut(w, commit, [hook]);
    const n = notes(w, commit, report);
    expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);

    const readme = join(w.out, 'README.md');
    const items = knownLimits(readFileSync(readme, 'utf8'));
    expect(items, `${readme} has a Known limits section`).not.toBeNull();
    expect(items!.filter((i) => i.includes(LANE) && i.includes('BLOCKED')), `Known limits lists "${LANE}" as BLOCKED: ${JSON.stringify(items)}`).toHaveLength(1);
    for (const lane of PASSING) expect(items!.filter((i) => i.includes(lane.name)), `a lane that passed, ${lane.name}, is no known limit`).toEqual([]);

    const written = removeLines(readme, LANE);
    const refused = tag(w, commit, report);
    expect(refusal(w, refused, '1.3.0', [LANE]), shown(refused)).toEqual([]);

    writeFileSync(readme, written);
    const through = tag(w, commit, report);
    expect(through.code, `with the README as the release wrote it, the tag goes through:\n${shown(through)}`).toBe(0);
    expect(tagged(w, '1.3.0')).toBe(commit);
    expect(published(w)).toEqual([hook.file]);
  }, 300_000);
});
