// #1662 AC3 (README, Criterion 3): #124's UI check still fails on both planted rows once the plant comes through
// deep-replica's plant feature. The proof is #124's own two planted tests in tests/acceptance/124/ac7-ui-check.test.ts,
// run here as they are (their helper builds deep-drive with --features env-plants) and read back from vitest's JSON
// report; they are not written again. The replica renders on macOS only, so off macOS this is skipped as
// INCONCLUSIVE, never passed.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, REPO, redact, run } from './helpers.ts';

/** The two #124 tests that set a row plant and expect the UI check to fail naming it. */
const PLANTED = [
  { plant: 'RowLabelPastFrame', env: 'row-label-past-frame', title: 'a planted label drawn past its frame fails, naming the label\'s row in each of the four' },
  { plant: 'RowBranchCutOff', env: 'row-branch-cut-off', title: 'a planted cut-off branch name whose accessibility name lacks the full name fails, naming it in each of the four' },
] as const;
const SUITE = 'tests/acceptance/124';
const FILE = 'ac7-ui-check.test.ts';
const ARGS = ['node_modules/.bin/vitest', 'run', '--root', SUITE, '--no-file-parallelism', FILE, '-t', 'planted', '--reporter=json'] as const;
const RUN_MS = 45 * 60_000;

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface Report { numTotalTests?: number; testResults?: { assertionResults?: Assertion[] }[] }

describe(`${AC3} #124's UI check still fails on both planted rows (RowLabelPastFrame, RowBranchCutOff) when built with the plant feature`, () => {
  it(`${AC3} tests/acceptance/124/ac7-ui-check.test.ts's two planted tests pass against deep-drive built with --features env-plants (macOS)`, async (ctx) => {
    if (process.platform !== 'darwin') {
      ctx.skip(`INCONCLUSIVE: the replica renders with GPUI's offscreen Metal renderer, on macOS only (${process.platform} here); #124's planted tests did not run, and this is not a pass`);
    }
    const out = join(REPO, 'target', 'acceptance-1662', 'ac3');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const report = join(out, 'ac7-planted.json');
    const r = await run(process.execPath, [...ARGS, `--outputFile=${report}`], { timeoutMs: RUN_MS });
    if (r.timedOut) throw Error(`INCONCLUSIVE: ${ARGS.join(' ')} didn't finish in ${RUN_MS / 60_000} minutes; this is not a pass`);
    if (!existsSync(report)) throw Error(`BLOCKED: ${ARGS.join(' ')} wrote no JSON report (exit ${r.code}): ${redact(r.stderr.slice(-1500))}`);
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as Report;
    const results = (parsed.testResults ?? []).flatMap((f) => f.assertionResults ?? []);
    for (const { plant, env, title } of PLANTED) {
      const found = results.filter((a) => a.fullName.includes(title));
      expect(found.length, `#124's test for ${plant} (DEEP_DRIVE_PLANT=${env}) ran: ${JSON.stringify(results.map((a) => a.fullName)).slice(0, 800)}`).toBe(1);
      const [a] = found as [Assertion];
      expect(a.status, `the UI check fails on ${plant} as #124 expects; its test says: ${redact((a.failureMessages ?? []).join('\n').slice(0, 1200))}`).toBe('passed');
    }
    expect(results.length, 'and nothing else matched "planted" in that file').toBe(PLANTED.length);
  }, RUN_MS + 60_000);
});
