// AC1 #2085.a93c4567 and AC3 #2085.688e488c.
//
// AC1: #387's perturbation suite and #855's hash suite take every fixture the full build's `fixtures` call lists
// and present each one with deep_show (#387 README, Fixtures: "Every fixture is presented by `deep_show` in the
// build that lists it"). Those files are AC1's proof and the implementer runs them unchanged; this test is the
// fastest faithful check of what they fail on: the `fixtures` call of `full`, then every fixture it lists shown
// by deep_show in that build. The wrong program is the base, whose listing holds #429's planted documents, each
// refused by the check (the first, effects/same-machine-check, with not_exact); and a listing that leaves out
// more than the planted documents (the effects module's own fixture shadowed-box, whose sidecar names no code).
//
// AC3: the seven cases of those two files that fail on main for this reason are listed in
// scripts/known-failures.json, naming #2085, until they pass; once every listed fixture presents, nothing of the
// two files is listed (README: Readings).
import { describe, expect, it } from 'vitest';
import { AC1, AC3, fixtureName, knownFailures, listAndShow, unpresented, useEvidence, useFull, type Fixture, type Shown } from './helpers.ts';

const full = useFull();
const evidence = useEvidence();

/** The two files AC1 names, as scripts/affected.mjs names their cases (`<file> › <describe> › <test>`). */
const PERTURB = 'tests/acceptance/387/perturb.test.ts';
const HASH = 'tests/acceptance/855/hash.test.ts';
const PERTURB_DESCRIBE = '#387.f46de50b for every shipped operator a change outside its read set leaves its key and result byte-identical; equal keys always give byte-identical results; a planted static accent reader fails naming the operator and the role; an undeclared read fails a test build';
const HASH_DESCRIBE = '#855.6df0cf9c content keys and result digests with hash@2 key equal documents equally on two machines, and a cache written under hash@1 still hits after the migration\'s single rekey';
/** The seven cases the issue counts: the five of #387's seven that read the fixtures, and the two of #855's four. */
const SEVEN = [
  `${PERTURB} › ${PERTURB_DESCRIBE} › #387.f46de50b every fixture of the full build is presented and evaluated, and every operator the registry lists has a node in some fixture`,
  `${PERTURB} › ${PERTURB_DESCRIBE} › #387.f46de50b each fixture session lists its perturbation targets: the six view inputs, the seed, its look tokens with accent among them, and every array its nodes write`,
  `${PERTURB} › ${PERTURB_DESCRIBE} › #387.f46de50b a change to any one array, table, view input, look token, seed or asset outside an operator's read set leaves its key and result byte-identical, for every node of every fixture`,
  `${PERTURB} › ${PERTURB_DESCRIBE} › #387.f46de50b equal keys always give byte-identical results over fuzzed sequences of edits, views and times on the fixtures (fast-check seed 3870001, 40 sequences of up to 25 clean evaluations)`,
  `${PERTURB} › ${PERTURB_DESCRIBE} › #387.f46de50b in a test build every access every shipped operator makes on every fixture is one of its declared reads (or a contribution to one)`,
  `${HASH} › ${HASH_DESCRIBE} › #855.6df0cf9c equal documents get equal keys and result digests on two machines: the debug build here, and the release build in another time zone, locale, home and thread count, on the documents spelled otherwise`,
  `${HASH} › ${HASH_DESCRIBE} › #855.6df0cf9c equal documents get equal keys and result digests on a machine of another architecture: the x86_64 build under Rosetta (INCONCLUSIVE where this Mac can't build or run it)`,
] as const;

/** One listing and one showing per file run, shared by both criteria. */
let cache: { fixtures: Fixture[]; shown: Shown[] } | undefined;
function listed(): { fixtures: Fixture[]; shown: Shown[] } {
  cache ??= listAndShow(full(), evidence());
  return cache;
}

describe(`${AC1} every fixture the full build's fixtures call lists is presented by deep_show in that build, as #387's and #855's suites take them`, () => {
  it(`${AC1} the fixtures call of full lists fixtures, the effects module's own shadowed-box among them, and deep_show presents every one it lists`, () => {
    const { fixtures, shown } = listed();
    expect(fixtures.length, 'the full build lists fixtures').toBeGreaterThan(0);
    expect(shown.length, 'every listed fixture was shown').toBe(fixtures.length);
    const failures = unpresented(shown);
    expect(failures, `every fixture the fixtures call lists is presented by deep_show in the build that lists it (#387 README, Fixtures); ${failures.length} of ${fixtures.length} aren't, each with its outcome and the codes it raised`).toEqual([]);
    // The planted documents leave the listing, not the module's own fixture: its sidecar names no code.
    const own = shown.find((s) => fixtureName(s.fixture) === 'effects/shadowed-box');
    expect(own, `the effects module's own fixture shadowed-box is still listed: ${JSON.stringify(fixtures.map(fixtureName))}`).toBeDefined();
    expect(own!.reply['outcome'], 'and presented').toBe('presented');
  }, 3_600_000);
});

describe(`${AC3} until #387's and #855's seven cases pass, scripts/known-failures.json lists them with #2085`, () => {
  it(`${AC3} while a fixture the full build lists isn't presented, each of the seven cases is listed naming #2085; once every one is, nothing of ${PERTURB} or ${HASH} is listed`, () => {
    const { fixtures, shown } = listed();
    const failing = fixtures.length === 0 || unpresented(shown).length > 0;
    const known = knownFailures();
    if (failing) {
      const unlisted = SEVEN.filter((id) => !(id in known));
      const why = fixtures.length === 0 ? 'the full build lists no fixture' : `${unpresented(shown).length} fixtures the full build lists aren't presented: ${unpresented(shown).join('; ')}`;
      expect(unlisted, `${why}; so #387's and #855's seven cases fail, and each is listed in scripts/known-failures.json`).toEqual([]);
      const without = SEVEN.filter((id) => !/#2085\b/.test(known[id]!)).map((id) => `${id}: ${known[id]}`);
      expect(without, 'each of the seven names this issue, #2085').toEqual([]);
    } else {
      const stale = Object.keys(known).filter((id) => id.startsWith(`${PERTURB} › `) || id.startsWith(`${HASH} › `)).map((id) => `${id}: ${known[id]}`);
      expect(stale, `every fixture the full build lists is presented, so the seven pass and nothing of the two files is listed (a listed case that passes hides its next failure)`).toEqual([]);
    }
  }, 3_600_000);
});
