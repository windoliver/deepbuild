// AC14 #184.8ba629a5: "The clean maze passes, and the 240 Hz twin fails at the same step, on the reference Mac and on a
// Linux replica alike; with no Linux replica host configured, the Linux leg is INCONCLUSIVE by design in this PR,
// unblocked by #71 (Hosts), and does not hold the PR open, with the checks process run at background priority; measured
// step times appear only as readings"
//
// The Mac leg, on this Mac: the clean maze's playtest (both bots, 2 runs each, 120 s) passes, and the 240 Hz twin's
// (2 runs each, 240 steps) fails every run with playtest.over_budget at step 0, the step its fuel alone names. It does
// both twice, on two sets of fresh replica processes: the outcomes and every failure's words are the same, though the
// step times each replica measured differ from set to set, so no outcome rests on a time; each replica process runs
// at background priority once it has played (a nice value above 0, as macOS's background QoS and nice both show).
// The Linux leg is its own test: with no Linux replica host configured (#71), it fails INCONCLUSIVE, never a pass or a
// skip, and leaves the Mac leg's result to stand.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, canon, driveBin, failureOf, inconclusive, macOnly, none, openHub, playInput, putPiece, runPlaytest, runsOf, shown, word,
  type CheckResult,
} from './helpers.ts';
import { POLICY, heavyMaze, mazePiece, mazeProgram, routeBot, routeBotProgram } from './programs.ts';

describe(`${AC[14]} the clean maze passes and the 240 Hz twin fails at the same step, on every host alike`, () => {
  it(`${AC[14]} Mac leg: the same outcomes on two sets of replicas at background priority, step times only readings`, async () => {
    macOnly();
    const bot = routeBot(routeBotProgram());
    const clean = playInput(putPiece(DOC.clean, mazePiece(mazeProgram('clean'))), [bot, POLICY], { runs: 2 });
    const heavy = playInput(putPiece(DOC.heavy, mazePiece(heavyMaze().program, { hz: 240, fuel: 10_000_000 })), [bot, POLICY], { runs: 2, span: { steps: 240 } });
    const sets: { clean: CheckResult; heavy: CheckResult; times: string }[] = [];
    for (let n = 0; n < 2; n++) {
      const pool = await Pool.open([{ bin: driveBin('debug') }, { bin: driveBin('debug') }]);
      const hub = await openHub({ pool, playtest: 'loaded' });
      const a = await runPlaytest(hub, clean);
      const b = await runPlaytest(hub, heavy);
      expect(a.outcome, `set ${n}: the clean maze passes: ${shown(a)}`).toBe('passed');
      expect(b.outcome, `set ${n}: the 240 Hz twin fails: ${shown(b)}`).toBe('failed');
      const gaps: string[] = [];
      for (const r of runsOf(pool.log, heavy)) {
        const f = failureOf(b, `bot ${r.b} run ${r.i}`, 'playtest.over_budget');
        if (!f || !word('step 0').test(f.message)) gaps.push(`set ${n}: bot ${r.b} run ${r.i} doesn't fail over budget at step 0: ${f?.message ?? '(no failure)'}`);
      }
      const times = pool.log.map((p) => p.reply['step_times'] as unknown[]);
      if (times.some((t) => !Array.isArray(t) || !t.length || t.some((x) => typeof x !== 'number' || !(x >= 0)))) gaps.push(`set ${n}: a play's step_times aren't one non-negative reading a step`);
      for (const r of pool.replicas) {
        const ps = spawnSync('ps', ['-o', 'nice=', '-p', String(r.pid)], { encoding: 'utf8' });
        const nice = Number(ps.stdout.trim());
        if (!(nice > 0)) gaps.push(`set ${n}: replica process ${r.pid} plays at nice ${ps.stdout.trim() || '(unread)'}, not background priority`);
      }
      none(gaps, `the Mac leg, set ${n}`);
      sets.push({ clean: a, heavy: b, times: canon(times) });
    }
    const words = (r: CheckResult): string => canon([r.outcome, r.testsRun, r.failures.map((f) => [f.test, f.message]).sort()]);
    expect(words(sets[1]!.clean), 'the clean maze\'s result is the same on both sets').toBe(words(sets[0]!.clean));
    expect(words(sets[1]!.heavy), 'the 240 Hz twin\'s failures are word for word the same on both sets').toBe(words(sets[0]!.heavy));
    expect(sets[1]!.times, 'the sets measured their own step times (readings, never deciding an outcome)').not.toBe(sets[0]!.times);
  }, TIMEOUT);

  it(`${AC[14]} Linux leg: INCONCLUSIVE by design, no Linux replica host configured (#71)`, () => {
    inconclusive('the Linux leg plays the clean maze and the 240 Hz twin on a Linux replica host, and none is configured until #71 (Hosts); by design in this PR');
  });
});
