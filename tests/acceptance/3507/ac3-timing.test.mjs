// Criterion 3 of #3507 (#3507.dc916f1d), its timing: "… Past 1.1 a covered pixel, the change brings it to at most 1.05
// there and the geometry pass's p50 over five alternated rounds is no higher than the merge base's …"; the issue's
// `Runs on:` line: "The reference Mac, in rounds that alternate with the merge base within one run, for the timing".
//
// The clause times the pass only where a pass changed. Which branch the change took is the report's line `Geometry
// pass: …` (docs/evidence/3507/README.md), which ac3-report.test.mjs and ac3-branch.test.mjs hold to the count and to
// the merge base; where it says `unchanged` this file times nothing and says so.
//
// Where it names a way, a round is #3031's every-pass fixture drawn whole, its 300 frames at 5 a second and
// 3456 × 2234 under its own look, through `view3d` with `timings` and nothing captured, once by this checkout's
// `deep-gpu` and once by the merge base's (`DEEP_3507_BASE`; both debug builds, as the acceptance helpers build them),
// each in a process of its own, one right after the other. Which side draws first alternates from round to round.
// One round warms up and is dropped; then five. A side's reading of a round is the median over its 300 frames of
// `passes_ms["scene3d.geometry"]`, the GPU's own time for the pass. Each round gives this checkout's p50 over the
// merge base's, and the five are judged at a limit of 1 by the perf lane's `judgeLimit` (scripts/benchmark.mjs), the
// design's rule for a timing: PASS only on a reference Mac on mains power, Low Power Mode off, thermal state nominal,
// at a load under its cores, with all five within the limit; FAIL with all five over it by more than the margin;
// anything else INCONCLUSIVE, which is no pass. The lane's answer for this machine is asked first, so a machine that
// can't judge a time says so before it draws. The whole run holds the machine's GPU lease.
// Run: DEEP_3507_BASE=<built merge base> node --test tests/acceptance/3507/ac3-timing.test.mjs
import { join } from 'node:path';
import test from 'node:test';
import { REPO, REPORT, allow, everyPassView, gpuBinary, gpuRun, load, mergeBase, referenceMac, report, settle, tempDir, underLease } from './drive.mjs';
import { FRAMES, ROUNDS, UNCHANGED, reportOf, roundOf, timingProblems } from './judge.mjs';

allow(110);

test('AC3 #3507.dc916f1d where a pass changed, the geometry pass\'s p50 on the every-pass fixture, over five rounds that alternate with the merge base, is no higher than the merge base\'s', { timeout: 120 * 60_000 }, async (t) => {
  const stated = reportOf(report());
  settle(`AC3 #3507.dc916f1d (the report is ${REPORT})`, stated.way === null ? stated.problems : []);
  if (stated.way === UNCHANGED) {
    t.diagnostic('the report says the geometry pass is unchanged, so no time is judged: the criterion times the pass where one changed (ac3-report and ac3-branch hold the report\'s word to the count and to the merge base\'s frames)');
    return;
  }
  const machine = await referenceMac('the timing');
  const { judgeLimit } = await import(join(REPO, 'scripts', 'benchmark.mjs'));
  const now = load();
  const here = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: machine, loads: Array.from({ length: ROUNDS }, () => ({ start: now, end: now })) });
  if (here.status !== 'PASS') throw Error(`INCONCLUSIVE: this machine can't judge a timing now: ${here.reason}; nothing was drawn, and this is not a pass`);
  const base = mergeBase(['deep-gpu']);
  const sides = { change: gpuBinary(), base: join(base.debug, 'deep-gpu') };
  const call = everyPassView({ frames: FRAMES, timings: true });

  /** One side's p50 of the geometry pass over one round, in a process of its own. */
  async function side(which, k) {
    const what = `round ${k}, ${which === 'change' ? 'this checkout' : `the merge base (${base.commit.slice(0, 9)})`}`;
    const dir = tempDir('timing');
    try {
      const [reply] = await gpuRun(sides[which], dir.dir, [call], { what: `deep-gpu run (${what})` });
      const read = roundOf(reply, FRAMES, what);
      if (read.problem) throw Error(read.problem);
      return read.ms;
    } finally { dir.remove(); }
  }
  /** One round: both sides, `first` drawing first, with the load at its start and its end. */
  async function round(k) {
    const first = k % 2 === 1 ? 'change' : 'base';
    const second = first === 'change' ? 'base' : 'change';
    const start = load();
    const ms = { [first]: await side(first, k) };
    ms[second] = await side(second, k);
    return { change: ms.change, base: ms.base, first, load: { start, end: load() } };
  }

  const rounds = await underLease('the timing', async () => {
    await round(0);
    const taken = [];
    for (let k = 1; k <= ROUNDS; k++) taken.push(await round(k));
    return taken;
  });
  const judged = timingProblems(rounds, judgeLimit, machine);
  t.diagnostic(`${judged.shown ?? ''} → ${judged.verdict?.status ?? 'not judged'}; loads ${rounds.map((r) => `${r.load.start.toFixed(1)} to ${r.load.end.toFixed(1)}`).join(', ')}`);
  settle('AC3 #3507.dc916f1d', judged.problems);
});
