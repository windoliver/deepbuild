// The planted runners AC13 names, each built from the journey check kind the way check.kind@1's kit builds them
// from its reference (packages/conformance/src/slots/check-kind.ts, plantedFills): one that reports passed after its
// deadline, one that drops a crashed run's output (a suite that crashed before its first assertion reported passed
// with 12 tests), and one that reports a TypeError thrown before the first assertion as an assertion failure. Each
// must fail the kit with its own message. The other wrong programs the criteria name are the surface's own plants
// (README, Wrong programs). Only types come from @deepbuild/conformance here, so this file loads at the base.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '../../../packages/conformance/src/index.ts';

export type Bend = 'past-deadline' | 'crashed-suite' | 'type-error-as-assertion';
export const BENDS: Bend[] = ['past-deadline', 'crashed-suite', 'type-error-as-assertion'];
export function bent(fill: CheckRunnerFill, bend: Bend): CheckRunnerFill {
  const run = async (s: CheckSpec, ctx: CheckContext): Promise<CheckResult> => fill.run(s, ctx);
  const bends: Record<Bend, (s: CheckSpec, ctx: CheckContext) => Promise<CheckResult>> = {
    'past-deadline': (s, ctx) => run(s, { ...ctx, deadline: 3_600_000 }),
    'crashed-suite': async (s, ctx) => {
      const r = await run(s, ctx);
      return r.testsRun === 0 && r.failures.some((f) => !f.assertion) ? { ...r, outcome: 'passed', testsRun: 12, failures: [] } : r;
    },
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
