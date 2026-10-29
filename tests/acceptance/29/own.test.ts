// #29 AC21, AC22: whose checks count. An approved check whose read files, or the package script, Makefile or justfile target it
// runs, the claim's diff changed counts for that claim as the agent's own check: it can send the claim back, never pass it.
// Real git repositories; `verdict()` is #28's engine as it ships at base.
import { describe, expect, it } from 'vitest';
import { checkSource } from '../../../packages/gate/src/index.ts';
import type { ApprovedCheck } from '../../../packages/gate/src/index.ts';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { Result } from '../../../packages/verdicts/src/index.ts';
import { check, claim, commitOf, passed, requirement } from './h-a.ts';
import { commitFiles, makeRepo, mustFail } from './helpers.ts';

type Opts = NonNullable<Parameters<typeof checkSource>[2]>;
const BASE_FILES = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }, null, 2),
  'Makefile': 'test:\n\tvitest run\n\nlint:\n\teslint .\n',
  'justfile': 'test:\n  vitest run\n\nlint:\n  eslint .\n',
  'src/cart.ts': 'export const total = (a: number[]) => a.reduce((x, y) => x + y, 0);\n',
  'test/cart.test.ts': "import { total } from '../src/cart';\ntest('adds', () => expect(total([1, 2])).toBe(3));\n",
  'test/__snapshots__/cart.snap': 'exports[`cart`] = `3`;\n',
  'docs/readme.md': '# shop\n',
};
const NPM_TEST: ApprovedCheck = {
  check: 'npm test',
  reads: ['src/cart.ts', 'test/cart.test.ts'],
  declares: { tests: ['test/**/*.test.ts'], fixtures: ['test/__snapshots__/**'], script: { file: 'package.json', target: 'test' } },
};
/** A repo and the diff that changes `files`: its base and the new commit. */
function diffOf(files: Record<string, string | null>): { repo: string; from: string; to: string } {
  const { dir, commit } = makeRepo(BASE_FILES);
  const to = commitFiles(dir, files, 'change');
  return { repo: dir, from: commit, to };
}
const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts }, null, 2);

/** The claim's verdict when `c` is the only check covering its requirement and ran green on the claim's commit. */
function outcomeWith(source: 'approved' | 'own'): Result {
  const c = check('npm test', { source });
  const C = commitOf('C');
  return verdict(claim({ commit: C, requirements: [requirement(1)], checks: [c], runs: [passed(c, C)] })).outcome;
}
function sourceOutcome(files: Record<string, string | null>, c: ApprovedCheck, opts?: Opts): { source: string; outcome: Result } {
  const source = checkSource(c, diffOf(files), opts);
  return { source, outcome: outcomeWith(source) };
}

describe('AC21 an approved check the diff changed counts as the agent\'s own: it can send the claim back, never pass it', () => {
  const FIXTURE = { 'src/cart.ts': 'export const total = (a: number[]) => a.reduce((x, y) => x + y, 0) + 0;\n' };
  const ASSERTION = { 'test/cart.test.ts': "import { total } from '../src/cart';\ntest('adds', () => expect(total([1, 2])).toBe(4));\n" };
  const both = (opts?: Opts) => {
    const edited = sourceOutcome(ASSERTION, NPM_TEST, opts);
    expect(edited.source, 'the diff edits only the assertion the check reads').toBe('own');
    expect(edited.outcome, 'an own check never reaches PASS').not.toBe('PASS');
    const twin = sourceOutcome(FIXTURE, NPM_TEST, opts);
    expect(twin.source, 'the clean twin changes only the code under test').toBe('approved');
    expect(twin.outcome, 'the clean twin reaches PASS').toBe('PASS');
  };
  it('AC21 the fixture editing only the assertion never reaches PASS, and its clean twin does', () => both());
  it('AC21 an own check can send the claim back: a failed run is FAIL', () => {
    const c = check('npm test', { source: checkSource(NPM_TEST, diffOf(ASSERTION)) });
    const C = commitOf('C');
    const failed = passed(c, C, { outcome: 'failed', failures: [{ test: 'cart.test.ts › adds', message: 'x', cause: 'c', frames: [{ file: 'src/cart.ts', line: 1 }], covers: [], case: null }] });
    expect(verdict(claim({ commit: C, checks: [c], runs: [failed] })).outcome).toBe('FAIL');
  });
  it('AC21 a changed package script target, Makefile target or justfile target the check runs makes it own', () => {
    const own = (files: Record<string, string | null>, c: ApprovedCheck, opts?: Opts) => sourceOutcome(files, c, opts);
    const targets: [string, ApprovedCheck, Record<string, string | null>, Record<string, string | null>][] = [
      ['package.json script', NPM_TEST, { 'package.json': pkg({ test: 'vitest run || true', lint: 'eslint .' }) }, { 'package.json': pkg({ test: 'vitest run', lint: 'eslint . --max-warnings 0' }) }],
      ['Makefile target', { check: 'make test', reads: [], declares: { script: { file: 'Makefile', target: 'test' } } }, { 'Makefile': 'test:\n\tvitest run --bail\n\nlint:\n\teslint .\n' }, { 'Makefile': 'test:\n\tvitest run\n\nlint:\n\teslint . --fix\n' }],
      ['justfile target', { check: 'just test', reads: [], declares: { script: { file: 'justfile', target: 'test' } } }, { 'justfile': 'test:\n  vitest run --bail\n\nlint:\n  eslint .\n' }, { 'justfile': 'test:\n  vitest run\n\nlint:\n  eslint . --fix\n' }],
    ];
    for (const [what, c, changesTarget, changesOther] of targets) {
      expect(own(changesTarget, c).source, `${what}: the target the check runs changed`).toBe('own');
      expect(own(changesTarget, c).outcome, `${what}: never PASS`).not.toBe('PASS');
      expect(own(changesOther, c).source, `${what}: another target of the same file changed`).toBe('approved');
    }
  });
  it('AC21 a diff touching nothing the check reads or runs leaves it approved', () => {
    expect(sourceOutcome({ 'docs/readme.md': '# shop 2\n' }, NPM_TEST)).toEqual({ source: 'approved', outcome: 'PASS' });
  });
  it('AC21 a check that reads a test file its declaration does not list is still own when that file changed', () => {
    const undeclared: ApprovedCheck = { check: 'npm test', reads: ['test/cart.test.ts'], declares: {} };
    expect(checkSource(undeclared, diffOf(ASSERTION))).toBe('own');
  });
  it('AC21 planted twins fail: declared-only misses an undeclared read test, ignores-script-target misses a changed script', async () => {
    const undeclared: ApprovedCheck = { check: 'npm test', reads: ['test/cart.test.ts'], declares: {} };
    await mustFail('declared-only', () => expect(checkSource(undeclared, diffOf(ASSERTION), { plant: 'declared-only' })).toBe('own'), ['own']);
    await mustFail('ignores-script-target', () => expect(checkSource(NPM_TEST, diffOf({ 'package.json': pkg({ test: 'vitest run || true', lint: 'eslint .' }) }), { plant: 'ignores-script-target' })).toBe('own'), ['own']);
    await mustFail('every-read-file-is-own', () => both({ plant: 'every-read-file-is-own' }), ['approved']);
  });
});

describe('AC22 the approved check `npm test` reading src/cart.ts and test/cart.test.ts', () => {
  const run = (files: Record<string, string | null>, opts?: Opts) => sourceOutcome(files, NPM_TEST, opts);
  const CODE = { 'src/cart.ts': 'export const total = (a: number[]) => a.reduce((x, y) => x + y, 0) + 0;\n' };
  const whole = (opts?: Opts) => {
    expect(run(CODE, opts), 'a diff changing only src/cart.ts keeps the check counted and can PASS').toEqual({ source: 'approved', outcome: 'PASS' });
    const withTest = run({ ...CODE, 'test/cart.test.ts': "import { total } from '../src/cart';\ntest('adds', () => expect(total([1, 2])).toBe(5));\n" }, opts);
    expect(withTest.source, 'a diff that also changes test/cart.test.ts makes it the agent\'s own').toBe('own');
    expect(withTest.outcome).not.toBe('PASS');
    const withSnap = run({ ...CODE, 'test/__snapshots__/cart.snap': 'exports[`cart`] = `5`;\n' }, opts);
    expect(withSnap.source, 'a diff that also changes test/__snapshots__/cart.snap makes it the agent\'s own').toBe('own');
    expect(withSnap.outcome).not.toBe('PASS');
  };
  it('AC22 src/cart.ts alone: counted, PASS; plus test/cart.test.ts or the snapshot: own, not PASS', () => whole());
  it('AC22 each of the test file and the snapshot alone makes it own', () => {
    expect(run({ 'test/cart.test.ts': "test('x', () => {});\n" }).source).toBe('own');
    expect(run({ 'test/__snapshots__/cart.snap': 'exports[`cart`] = `9`;\n' }).source).toBe('own');
  });
  it('AC22 a rule that treats every read file as the check\'s own leaves the first INCONCLUSIVE and fails', async () => {
    await mustFail('every-read-file-is-own', () => whole({ plant: 'every-read-file-is-own' }), ['changing only src/cart.ts']);
    const planted = run(CODE, { plant: 'every-read-file-is-own' });
    expect(planted.outcome, 'the planted rule\'s result is INCONCLUSIVE, as the criterion says').toBe('INCONCLUSIVE');
  });
});
