// The wrong programs the criteria name, where a run's record can express them: each takes what the real command
// check kind returned and bends the one thing the criterion says the wrong program gets wrong, so a `(wrong
// program)` test feeds it to the same assertion the real record passes and expects that assertion to fail. The
// wrong programs a record can't express (a runner that judges only the exit code, reads only a test's last
// attempt, or clears the environment without DO_NOT_TRACK) are the surface's own plants (README, Wrong programs).
// Only types come from @deepbuild/checks-command here, so this file loads at the base.

import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { CommandRun } from '../../../packages/checks-command/src/index.ts';
import { filesIn } from './helpers.ts';

/**
 * AC14: a scrub of every passed value, short and plain ones included, over everything the run keeps: its output,
 * and each failure's file, message and stack (so its place reads `src/cart.[redacted].ts:30` too).
 */
export function scrubsEveryPassedValue(r: CommandRun, passed: Record<string, string>): CommandRun {
  const scrub = (text: string): string => Object.values(passed).reduce((t, v) => t.split(v).join('[redacted]'), text);
  return {
    ...r,
    output: { ...r.output, stdout: scrub(r.output.stdout), stderr: scrub(r.output.stderr) },
    failures: r.failures.map((f) => ({ ...f, file: scrub(f.file), message: scrub(f.message), stack: f.stack === null ? null : scrub(f.stack) })),
  };
}

/** AC11: a runner that records only the declared paths as read (each declared glob's files in the checkout). */
export function readsDeclaredOnly(r: CommandRun, checkout: string, declared: string[]): CommandRun {
  const prefixes = declared.map((g) => g.replace(/\*\*.*$/, ''));
  return { ...r, read: filesIn(checkout).filter((p) => prefixes.some((pre) => p.startsWith(pre))) };
}

/** AC11: a runner that lists every file in the checkout as read. */
export function readsEveryFile(r: CommandRun, checkout: string): CommandRun {
  return { ...r, read: filesIn(checkout) };
}

/** AC16: a runner that marks every failure inside a test file an assertion failure. */
export function everyTestFileFailureAnAssertion(r: CommandRun): CommandRun {
  return { ...r, failures: r.failures.map((f) => (/(\.test\.|\.spec\.|_test\.|(^|\/)test_)/.test(f.file) ? { ...f, assertion: true } : f)) };
}

/** AC8: a rule that marks every seeded table a stand-in. */
export function everySeededTableAStandIn(r: CommandRun): CommandRun {
  return { ...r, seeded: r.seeded.map((s) => ({ ...s, standIn: true })) };
}

/** AC19: a runner that reads the compared counts from the test's printed output. */
export function countsFromPrintedOutput(r: CommandRun): CommandRun {
  const printed = new Map<string, number>();
  for (const m of `${r.output.stdout}\n${r.output.stderr}`.matchAll(/compared (\d+) of \d+ elements of (\w+)/g)) printed.set(m[2]!, Number(m[1]));
  return { ...r, contract: r.contract?.map((c) => ({ ...c, compared: printed.get(c.output) ?? c.compared })) ?? null };
}

/** AC19: a runner that takes a silent report as complete. */
export function silentReportAsComplete(r: CommandRun): CommandRun {
  return { ...r, contract: r.contract?.map((c) => ({ ...c, compared: c.compared ?? c.size, largest_error: c.largest_error ?? 0 })) ?? null };
}

/**
 * AC4: check.kind@1's four planted runners, each built from the command check kind the way the kit builds them
 * from its reference (packages/conformance/src/slots/check-kind.ts, plantedFills): one that reads "0 failed" from
 * a suite that crashed before running and returns passed with 12 tests, one that reports passed after its
 * deadline, one that drops a crashed run's output, one that reports a TypeError thrown before the first
 * assertion as an assertion failure.
 */
export type Bend = 'crashed-suite' | 'past-deadline' | 'dropped-output' | 'type-error-as-assertion';
export const BENDS: Bend[] = ['crashed-suite', 'past-deadline', 'dropped-output', 'type-error-as-assertion'];
export function bent(fill: CheckRunnerFill, bend: Bend): CheckRunnerFill {
  const run = async (s: CheckSpec, ctx: CheckContext): Promise<CheckResult> => fill.run(s, ctx);
  const bends: Record<Bend, (s: CheckSpec, ctx: CheckContext) => Promise<CheckResult>> = {
    'crashed-suite': async (s, ctx) => {
      const r = await run(s, ctx);
      return r.testsRun === 0 && r.failures.some((f) => !f.assertion) ? { ...r, outcome: 'passed', testsRun: 12, failures: [] } : r;
    },
    'past-deadline': (s, ctx) => run(s, { ...ctx, deadline: 3_600_000 }),
    'dropped-output': async (s, ctx) => ({ ...(await run(s, ctx)), failures: [] }),
    'type-error-as-assertion': async (s, ctx) => {
      const r = await run(s, ctx);
      return { ...r, failures: r.failures.map((f) => ({ ...f, assertion: true })) };
    },
  };
  return { ...fill, run: bends[bend] };
}

/** The same fill, answering a case it already ran (same spec, checkout and deadline) from that run. */
export function remembering(fill: CheckRunnerFill): CheckRunnerFill {
  const runs = new Map<string, Promise<CheckResult>>();
  return {
    ...fill,
    run: (s, ctx) => {
      const key = JSON.stringify([s, ctx.checkout, ctx.deadline]);
      let had = runs.get(key);
      if (!had) {
        had = Promise.resolve(fill.run(s, ctx));
        runs.set(key, had);
      }
      return had.then((r) => structuredClone(r));
    },
  };
}
