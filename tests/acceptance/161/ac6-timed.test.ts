// AC6 #161.729a03cd: Budgets, on the reference Mac in the local preflight, compared with the merge base: the pack checks
// in under 2 s, each operator compiles in under 20 ms off the UI thread, and a still canvas dispatches none.
//
// The criterion's two times; `ac6-budgets.test.ts` holds what reads no clock (the perf lane's task, the thread a
// compile runs on, the still canvas). This file is timed: it runs only on a reference Mac at rest (scripts/lanes.mjs:
// `timed`).
//
// Six runs, the first a warm-up. Each run starts two fresh processes, so nothing either holds from an earlier run is
// reused:
//   - `deep-show run` with `install_pack {id: "deepbuild/fx", dir: packs/fx-1.0.0}`: the pack's own check, which a
//     process runs once for a version. Its reply's `check_ms` is that check's wall time, from reading the folder to
//     its verdict. Limit: 2,000 ms.
//   - `deep-gpu run` with `check_operator` on each of the 70 graphs as `pack.json` holds it: each reply's
//     `timing.compile_ms` (#429) is that operator's compile, the process's first of it, on a thread that isn't the UI
//     thread. Limit: 20 ms, each operator judged on its own five runs.
// Both by the perf lane's judge (`judgeLimit`, scripts/benchmark.mjs, in a child process) with the one-minute load read
// at each run's start and end: PASS when all five are within the limit, FAIL when all five are over it by more than
// the margin, else INCONCLUSIVE; off a reference Mac, on battery, in Low Power Mode, not thermally nominal, or with a
// load above the core count, INCONCLUSIVE, never a pass. The machine is read by the same judge before anything is
// timed, so an unfit machine times nothing.
//
// Wrong programs: the base (17 operators; `install_pack` answers no `check_ms`); a pack check that compiles each
// graph's pipeline; a compile on the UI thread.
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, PACK_DIR, PACK_ID, TIMEOUT, buildLine, checkCall, inconclusive, isObject, judgeAll, listProblems, loadNow, packOperators, requireGpu, runGpu, runShow, settle, shown,
  timingProblem, useBin, useDir, type Load,
} from './helpers.ts';

const ID = AC[6];
const gpu = useBin('deep-gpu');
const show = useBin('deep-show');
const dir = useDir();
const LIMITS = { pack_check_ms: 2000, operator_compile_ms: 20 };

describe(`${ID} fx@1's two times`, () => {
  it(`${ID} on a reference Mac at rest, the pack's own check takes under 2 s and each of the 70 operators compiles in under 20 ms off the UI thread, in five runs after a warm-up`, () => {
    const operators = packOperators();
    expect(listProblems(operators), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect([show().error, gpu().error], `${buildLine('deep-show')}; ${buildLine('deep-gpu')}`).toEqual(['', '']);
    const problem = timingProblem();
    if (problem) inconclusive(`these times count only on a reference Mac at rest: ${problem}`);

    const packRuns: number[] = []; const compileRuns = new Map<string, number[]>(ALL.map((id) => [id, []])); const loads: Load[] = [];
    for (let run = 0; run < 6; run++) {
      const start = loadNow();
      const installed = runShow(show().bin, { evidence: dir(), packs: [], calls: [{ call: 'install_pack', id: PACK_ID, dir: PACK_DIR }] });
      const checked = runGpu(gpu().bin, dir(), ALL.map((id) => checkCall(operators[id]!)));
      const end = loadNow();
      expect([installed.problem, checked.problem], `run ${run}: both binaries answer`).toEqual(['', '']);
      const reply = installed.replies[0]!;
      expect(reply['outcome'], `run ${run}: the pack's own check admits it: ${shown(reply['issues'], 400)}`).toBe('installed');
      expect(typeof reply['check_ms'] === 'number' && reply['check_ms'] > 0, `run ${run}: install_pack answers the pack check's time, check_ms: ${shown(reply['check_ms'])}`).toBe(true);
      const times = ALL.map((id, i) => {
        const r = checked.replies[i]!; const t = isObject(r['timing']) ? r['timing'] : {};
        expect(r['outcome'], `run ${run}: ${id} passes the operator check`).toBe('accepted');
        expect(typeof t['compile_ms'], `run ${run}: ${id}: timing.compile_ms`).toBe('number');
        expect(t['thread'], `run ${run}: ${id} compiled off the UI thread`).not.toBe(t['ui_thread']);
        return t['compile_ms'] as number;
      });
      if (run === 0) continue;
      packRuns.push(reply['check_ms'] as number); loads.push({ start, end });
      ALL.forEach((id, i) => compileRuns.get(id)!.push(times[i]!));
    }
    settle(`${ID} the pack's own check, ms`, judgeAll(LIMITS.pack_check_ms, [{ name: 'the pack check', runs: packRuns }], loads));
    settle(`${ID} each operator's compile, ms`, judgeAll(LIMITS.operator_compile_ms, ALL.map((id) => ({ name: id, runs: compileRuns.get(id)! })), loads));
  }, TIMEOUT);
});
