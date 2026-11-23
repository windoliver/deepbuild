// #1881's third criterion, "#85's suites pass unchanged" (README). The criterion names its own check: #85's suites, as
// the base holds them, pass on this program. "Unchanged" is held first, on the bytes: every test file, helper and
// tsconfig under tests/acceptance/85/ has the SHA-256 the base 8b9f8d6c7 gives it. Then the checkout's own vitest runs
// every #85 test file, one at a time, with the longest test timeout #85's READMEs give (240 s), and every test in them
// must pass: none failed, skipped or left out, and each file reports its tests.
//
// #85's criterion 12 measurement (budgets.test.ts, "on the reference Mac, …") counts readings only on a reference Mac
// (Mac15,7 or Mac15,12) and skips as INCONCLUSIVE anywhere else, by its own rule. It is judged by the second test, which
// skips as INCONCLUSIVE (never a pass) wherever that test of #85's does, and fails on its failure; the first test judges
// the rest.
import { describe, expect, it } from 'vitest';
import { AC3, changed, runSuites, type Ran, type SuiteRun } from './helpers.ts';

/** #85's test files, helpers and tsconfigs, with their SHA-256 at the base. */
const PINS: Record<string, string> = {
  'tests/acceptance/85/budgets.test.ts': '2ab5c684fcb1961436d15855c16a719d7cdd32dff9ec9b3376199f2c2ae9db5b',
  'tests/acceptance/85/continue/counted.test.ts': 'afbc3e4c83c499de0bd310857ec1b93b3a6ad25653b20fa93cc095c04bbe3b53',
  'tests/acceptance/85/continue/plants.test.ts': 'bf9c4315f84746652be90248fa7dac4b5567127b9695ffbe33ea15d09da73a05',
  'tests/acceptance/85/continue/resume-skip.test.ts': '20f6f6937df679c144a94575f8478c6cbe4d8e398514096bc19e2069f58f6468',
  'tests/acceptance/85/continue/scenarios.ts': 'ad96cee0949219c96440c971ccfa867989b1627ae483ec62e0548c370e5812eb',
  'tests/acceptance/85/continue/tsconfig.json': '8a1085db12c7b56e8e90c8daf57fc93955adf03f9f8c4f09b78fd0467a156d47',
  'tests/acceptance/85/data.ts': '59104486b809f4d828bdbdf3b64f08fff350aced06512954a2c73b6a1b5a5b0f',
  'tests/acceptance/85/helpers.ts': '5a17999d7562d58e9b895c77a66a2aa942370a4a1bc9c2f7b04f28e0c478a833',
  'tests/acceptance/85/hub/cutoff.test.ts': 'bba5755ed9134f66a16da912a25cc014a74ee19201315c9c7bf4612a647f66d1',
  'tests/acceptance/85/hub/held.test.ts': '1f494139f23cbf0b0989bdbc8485e5131994b3c9ede356f03a828d258eab9fc9',
  'tests/acceptance/85/hub/helpers.ts': '17d758465104c35bcb9273132a0886607aa4f14eca41a791b6cb8a8adf8babd5',
  'tests/acceptance/85/hub/network.test.ts': 'c09285178c23ca632bca787b59f5dbd746dee77a61243ee8d69cd6a02e1587ab',
  'tests/acceptance/85/hub/thread.test.ts': '95abbd3da21b284c33ed8253b4b227d538edc61d38731da46b3b58a87c4540f0',
  'tests/acceptance/85/hub/tsconfig.json': 'ff3f1c635b90ea25d6361de24a1d3973b92606181c57b5df74932f71622ae43d',
  'tests/acceptance/85/late-stop.test.ts': 'ac402c8e983beed2197d72ec20c759aee822c882faac4aceaae3abb80eb77af2',
  'tests/acceptance/85/missing.test.ts': 'd43bfa567399d651fcfcb1a5a44e615378212ed7a112ccc599f3ccb0a87943f5',
  'tests/acceptance/85/plan-window.test.ts': '56076a54e3a49e18fa94b57b697fb86d5321b1a572903fa09ff023e1271da176',
  'tests/acceptance/85/plants.test.ts': '85fa570136640700e8ef3cbef7f4520412cd7263f9ec858a40f21c397a0d1f0e',
  'tests/acceptance/85/plants.ts': '63f3a014964dbb3f4df2731b1f43ac51cca5904745c2b99f66ba95d677b0b6a4',
  'tests/acceptance/85/refusal.test.ts': 'fbf00dc7291cae1c2ab9b2e7d297b22b9dbda60b373298bd08d1e0207ed656ad',
  'tests/acceptance/85/scenarios.ts': '2d022eca04d30f9adb0a87a531b1d09e7af94bf08f9b724562f9948ac55ddbc4',
  'tests/acceptance/85/shared.test.ts': 'f01799b1ba5cdcd0aa0faf5399064623ad362cc87443856ccf4137c5de8f1172',
  'tests/acceptance/85/signin.test.ts': '80323d5dac917ac18ee5f4bfaec7f8741ef61fe2246f8ff1c8e727bceb16659b',
  'tests/acceptance/85/thread.test.ts': 'bbca4760cd0afd64d262942070a60aa271ec1763687d3d996a3d3184ed0b06bf',
  'tests/acceptance/85/transient.test.ts': '9ca8fae9538c0a608afa68021574e484bd0b6695bf8d89005a0545b3272e3988',
  'tests/acceptance/85/tsconfig.json': 'c5b0031dc2191959d86202363d79087b03e941d881587792b08e308dc9e69c0a',
};
const SUITES = Object.keys(PINS).filter((f) => f.endsWith('.test.ts'));
/** #85's README gives 240 s to its longest tests (hub/cutoff.test.ts and hub/held.test.ts). */
const TEST_TIMEOUT = 240_000;
/** #85's criterion 12 measurement, which counts readings only on a reference Mac. */
const isMeasurement = (t: Ran): boolean => t.file === 'tests/acceptance/85/budgets.test.ts' && t.name.includes('on the reference Mac, a task closes within');

// One run of #85's files serves both tests.
let ran: SuiteRun | null = null;
const suites = (): SuiteRun => (ran ??= runSuites(SUITES, TEST_TIMEOUT));

const at = (t: Ran) => `${t.file} › ${t.name.slice(0, 160)}`;

describe(`${AC3} #85's suites pass unchanged`, () => {
  it(`${AC3} #85's suites pass unchanged: every test under tests/acceptance/85, as the base holds it, passes`, () => {
    expect(changed(PINS), "#85's test files, helpers and tsconfigs are the base's, byte for byte").toEqual([]);
    const run = suites();
    const judged = run.tests.filter((t) => !isMeasurement(t));
    const problems = [...run.missing.map((f) => `${f} did not run`), ...run.fileErrors];
    for (const f of SUITES) if (!judged.some((t) => t.file === f)) problems.push(`${f} reports no test`);
    for (const t of judged) {
      if (t.status === 'failed') problems.push(`${at(t)} fails: ${t.message.slice(0, 900)}`);
      else if (t.status !== 'passed') problems.push(`${at(t)} did not run (${t.status})`);
    }
    console.log(`${AC3}: ${judged.filter((t) => t.status === 'passed').length} of ${judged.length} judged tests passed in ${run.seconds} s`);
    expect(problems, `#85's suites, run unchanged:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 3_600_000);

  it(`${AC3} #85's suites pass unchanged: its criterion 12 budget measurement passes on a reference Mac`, (ctx) => {
    expect(changed(PINS), "#85's test files, helpers and tsconfigs are the base's, byte for byte").toEqual([]);
    const measured = suites().tests.filter(isMeasurement);
    expect(measured.length, 'budgets.test.ts reports its measurement once').toBe(1);
    const [t] = measured;
    expect(t!.status === 'failed' ? `${at(t!)} fails: ${t!.message.slice(0, 900)}` : '', "#85's budget measurement, run unchanged").toBe('');
    // #85's measurement skips as INCONCLUSIVE by its own rule off a reference Mac; this one skips with it, as #85 does (the lanes read a skip as INCONCLUSIVE, never PASS).
    if (t!.status === 'skipped') ctx.skip(`INCONCLUSIVE (not a reference Mac): #85's budget measurement skipped by its own rule (readings count only on a reference Mac, Mac15,7 or Mac15,12)`);
    expect(t!.status, "#85's budget measurement passed").toBe('passed');
  }, 3_600_000);
});
