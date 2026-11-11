// AC3: "A one-field reply is under 1 KB and answers in under 100 ms at p95 on the reference Mac, #412's budget"
//
// asserts: structure first, on any machine: for every field of the full build's `deep-show kinds --dump`, the reply to
// deep_kinds `{op: "field", path}` on `deep-show run` answers one line (a one-field reply, not a refusal) and is under
// 1 KB, 1,024 bytes of its JSON (helpers.ts, replySizeFailures). Then, on a reference Mac fit to judge (#412's gate:
// Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, a 1-minute load at most the core count; mains power
// never gates), five runs after a warm-up, each in a `deep-show run` kept open and fed one scenario per line: twenty
// one-field calls, rotating over twenty of the dump's fields, each timed as its scenario's wall time less the median of
// twenty twins with no call; each run's p95 is held to 100 ms by #412's judge (PASS all within, FAIL all past it by more
// than the margin, else INCONCLUSIVE). Elsewhere, or between the limit and the margin, the timing skips as INCONCLUSIVE
// after the structural check; it never passes by skipping.

import { afterAll, describe, expect, it } from 'vitest';
import {
  BUDGET_MS, Streamed, cleanup, dumpOf, environmentProblem, fieldCall, judgeRuns, linesOf, median, none, p95, replySizeFailures, run, settle, tempDir,
  useFullBuild, type DumpField,
} from './helpers.ts';

const build = useFullBuild();
afterAll(cleanup, 60_000);
const ROUNDS = 20;
const RUNS = 5;

/** Twenty of the dump's fields, spread across it. */
const spread = (fields: readonly DumpField[]): DumpField[] => Array.from({ length: ROUNDS }, (_, k) => fields[Math.floor((k * fields.length) / ROUNDS)]!);

/** One run in its own kept-open process: ROUNDS one-field calls, each less the median of ROUNDS empty twins; their p95 in ms. */
async function oneRun(bin: string, paths: readonly string[]): Promise<number> {
  const s = Streamed.open(bin);
  try {
    const ev = tempDir('ev');
    await s.send(ev, [fieldCall(paths[0]!)]);
    const bare: number[] = [];
    const timed: number[] = [];
    for (let k = 0; k < ROUNDS; k++) {
      bare.push((await s.send(ev, [])).ms);
      const r = await s.send(ev, [fieldCall(paths[k % paths.length]!)]);
      const lines = linesOf(r.replies[0] ?? {});
      expect(Array.isArray(lines) && lines.length === 1, `${paths[k % paths.length]}: a timed call answers one line: ${JSON.stringify(r.replies[0]).slice(0, 600)}`).toBe(true);
      timed.push(r.ms);
    }
    const floor = median(bare);
    return p95(timed.map((t) => Math.max(0, t - floor)));
  } finally {
    s.close();
  }
}

describe('AC3 a one-field reply is under 1 KB and answers within #412\'s budget', () => {
  it('AC3 a one-field reply is under 1 KB and answers in under 100 ms at p95 on the reference Mac', async (ctx) => {
    const bin = build();
    const d = dumpOf(bin);
    expect(d.fields.length, 'the full build\'s dump lists fields').toBeGreaterThan(0);
    none(replySizeFailures(d.fields, run(bin, d.fields.map((f) => fieldCall(f.path)))), `the one-field replies to the ${d.fields.length} fields of the dump`);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const paths = spread(d.fields).map((f) => f.path);
    const runs: number[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(await oneRun(bin, paths));
    settle(ctx, [judgeRuns(`AC3 op: field, p95 over ${ROUNDS} one-field calls (ms)`, runs, BUDGET_MS)]);
  }, 3_600_000);
});
