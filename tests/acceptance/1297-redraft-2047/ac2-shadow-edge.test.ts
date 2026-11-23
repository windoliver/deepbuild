// AC2 #1297.b4935a37: A flat face keeps its shadow edge where #424 put it: #424's cutaway suites
// (`tests/acceptance/424/redraft/section.test.ts`, `cutaway.test.ts`, `shadow-catcher.test.ts`) and #422's cascade suites
// pass unchanged.
//
// The criterion names its own check: those suites, as the base holds them, pass on the change. #424's AC9 test
// (redraft/section.test.ts) is the one that sees a flat face's shadow edge: the inner floor of a cut box is sunlit
// exactly where the roof's cut edge, projected along the sun, says, to within 2 shadow-map texels. #422's cascade
// suites are the files of its criteria that name the cascades: cascade-cache.test.ts (AC3, a cached cascade equals a
// clean render), showpiece-fixture.test.ts (AC4, the cascaded sun shadows within the showpiece budget; seeking equals
// playing) and policy.test.ts (AC6, the cascade splits' closed form).
//
// "Unchanged" is held first: each of those files and the helpers they import has the bytes the base ed28a8dce gives it
// (SHA-256 below). Then the checkout's own vitest runs the six files, one at a time, as their suites run them, and every
// test in them must pass: none failed, skipped or left out, and each file reports its tests. A test of theirs that
// can't be judged here (its own INCONCLUSIVE: no Metal device, not a reference Mac) makes this one INCONCLUSIVE, never
// PASS; a failure anywhere is a FAIL, whatever else is INCONCLUSIVE. #422's AC4 budget test is the one these suites gate
// on a reference Mac (Mac15,7 or Mac15,12, its helpers say), so it is judged by the second test below, and the first
// can pass on any Mac with a Metal device.
// Wrong programs: a shadow lookup pushed along the surface normal by about 1.5 texels instead of toward the sun (the
// twin `normal-offset`: the floor's shadow edge moves about a texel and AC9 fails by a few pixels, as the issue says); a
// bias that leaves cut faces shadowed by a kept edge; one of these suites edited, skipped or weakened to pass.
import { describe, expect, it } from 'vitest';
import { AC2, inconclusive, none, requireMetal, runSuites, unchanged, type Ran, type SuiteRun } from './helpers.ts';

const SUITES = [
  'tests/acceptance/424/redraft/section.test.ts',
  'tests/acceptance/424/cutaway.test.ts',
  'tests/acceptance/424/shadow-catcher.test.ts',
  'tests/acceptance/422/cascade-cache.test.ts',
  'tests/acceptance/422/showpiece-fixture.test.ts',
  'tests/acceptance/422/policy.test.ts',
];
/** The six files and the helpers they import, as the base holds them. */
const PINS: Record<string, string> = {
  'tests/acceptance/424/redraft/section.test.ts': 'b075caf6c19700cc0b31f56a734164ad907c3d0a1caa69c26e60fbf9d7f910e0',
  'tests/acceptance/424/redraft/helpers.ts': 'a22a87bd66ec0a458eb098a2789762ee25b6a92e5cdfd06304cbd5b0d6dc9235',
  'tests/acceptance/424/cutaway.test.ts': 'c865e6fb580950bc029ffd8b049d6b8aa6bbc53b64c630a92b56ff1f8f7b5224',
  'tests/acceptance/424/shadow-catcher.test.ts': '7e7274aa3f6140ca7dd385ac87b52d7b1c6cfaed89efbf15c6192cf4d910fc2f',
  'tests/acceptance/424/helpers.ts': '8643061f49c3cb3126583a328979d4b87b632d37ad70e4da2072f1f1176f0e79',
  'tests/acceptance/422/cascade-cache.test.ts': '9d294b1b2de53639e8b9420249375e4bf5ab92de4f88be431a730ccfdcc27485',
  'tests/acceptance/422/showpiece-fixture.test.ts': '71fdf9697f096d7331f265f79b8ea346abd74a6a28a91933cc79a16b67cedce2',
  'tests/acceptance/422/policy.test.ts': 'a55b32037057738be8043a422606e17920512de1300f2f83d0d24c6cc9536b4a',
  'tests/acceptance/422/helpers.ts': 'ee252ec32e3225807f6c3d38684c095146f8128a896e33c1da2f919682d9fa87',
};
/** #422's AC4 budget test: full screen on a reference Mac, so judged apart. */
const isBudget = (t: Ran): boolean => t.file === 'tests/acceptance/422/showpiece-fixture.test.ts' && t.name.includes('full screen at internal scale 0.5');

// One run of the six files serves both tests.
let ran: SuiteRun | null = null;
const suites = (): SuiteRun => (ran ??= runSuites(SUITES));

/** Each test's outcome: failures, those that couldn't be judged here, and how many passed. */
function judge(tests: Ran[]): { failed: string[]; unjudged: string[]; passed: number } {
  const failed: string[] = []; const unjudged: string[] = []; let passed = 0;
  for (const t of tests) {
    const at = `${t.file} › ${t.name.slice(0, 160)}`;
    if (t.status === 'passed') passed++;
    else if (t.status === 'failed' && /^\S*Error: INCONCLUSIVE:/.test(t.message)) unjudged.push(`${at}: ${t.message.slice(0, 400)}`);
    else if (t.status === 'failed') failed.push(`${at} fails: ${t.message.slice(0, 900)}`);
    else failed.push(`${at} did not run (${t.status})`);
  }
  return { failed, unjudged, passed };
}

describe(`${AC2} a flat face keeps its shadow edge where #424 put it`, () => {
  it(`${AC2} #424's cutaway suites (redraft/section.test.ts, cutaway.test.ts, shadow-catcher.test.ts) and #422's cascade suites (cascade-cache, showpiece-fixture's seek, policy) pass unchanged`, () => {
    requireMetal();
    none(unchanged(PINS), 'the suites the criterion names, and their helpers, are the base\'s byte for byte');
    const run = suites();
    const judged = run.tests.filter((t) => !isBudget(t));
    const problems = [...run.missing.map((f) => `${f} did not run`), ...run.fileErrors];
    for (const f of SUITES) if (!judged.some((t) => t.file === f)) problems.push(`${f} reports no test`);
    const j = judge(judged);
    console.log(`${AC2}: ${j.passed} of ${judged.length} tests passed in ${run.seconds} s; ${j.failed.length} failed, ${j.unjudged.length} INCONCLUSIVE`);
    none([...problems, ...j.failed], 'the suites the criterion names, run unchanged');
    if (j.unjudged.length) inconclusive(`these tests could not be judged here:\n  ${j.unjudged.join('\n  ')}`);
    expect(j.passed, 'every judged test passed').toBe(judged.length);
  }, 4 * 3_600_000 + 600_000);

  it(`${AC2} #422's showpiece fixture, its cascaded sun shadows within the showpiece budget, passes unchanged on a reference Mac`, () => {
    requireMetal();
    none(unchanged(PINS), 'the suites the criterion names, and their helpers, are the base\'s byte for byte');
    const run = suites();
    const budget = run.tests.filter(isBudget);
    expect(budget.length, 'showpiece-fixture.test.ts reports its budget test once').toBe(1);
    const j = judge(budget);
    none(j.failed, 'the showpiece budget, run unchanged');
    if (j.unjudged.length) inconclusive(j.unjudged.join('; '));
    expect(j.passed, 'the showpiece budget test passed').toBe(1);
  }, 4 * 3_600_000 + 600_000);
});
