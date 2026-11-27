// Criterion 6 of #3611 (#3611.3b726ffd): "Budget, on the reference Mac in the local preflight, compared with the merge
// base: a fresh canvas core with the shipped packs and a filled store answers its first call in under 500 ms (drafted),
// and its memory after that reply reads within its margin"
//
// The criterion's time; ac6-task.test.mjs holds what reads no clock. This file is timed: its result counts only on a
// reference Mac at rest (the implementer lists it in scripts/lanes.mjs `timed`). Run anywhere else, or on a dev build,
// it takes the readings and ends INCONCLUSIVE with them, never a pass and never a fail for the time.
//   1. A fresh core is given one test pack: it must keep that check's result, or there is no filled store to time a
//      first reply on. The merge base fails here, in seconds.
//   2. The core timed is this checkout's release build, `target/release/deep-show`, when there is one whose source
//      digest (the `fingerprint` call's) is that of the build the suite drives; else the build the suite drives, a
//      dev build, whose times are readings (the design: a budget's result is never a dev build's).
//   3. One core of it fills a store with the release's packs: its first reply, the one that runs every check, is a
//      reading printed beside the others.
//   4. Six fresh cores in turn start on that store, the first a warm-up. Each is written its world and a `packs` call
//      at once; its first reply's time runs from the process's start to that call's answer. Each must have run no part
//      of a pack check (its `counts` all 0), or what was timed is no core that takes its results. After each reply the
//      core's memory is read as its physical footprint (benchmarks/process-reader.mjs), and the one-minute load is
//      read at each run's start and end.
//   5. The five runs are judged against 500 ms by the perf lane's own judge (scripts/benchmark.mjs `judgeLimit`, in a
//      child process): PASS when all five are within it, FAIL when all five are over it by more than the margin, else
//      INCONCLUSIVE; off a reference Mac, on battery, in Low Power Mode, not thermally nominal or with a load above
//      the cores, INCONCLUSIVE (judge.mjs `judgeFirstReply`).
// The memory is a reading here: "within its margin" compares it with the merge base's, which the budget window does
// through the task ac6-task.test.mjs holds.
// Wrong programs it fails on: the merge base (no check's result kept); a core that checks again on a filled store.
// Run: node --test tests/acceptance/3611/ac6-first-reply.test.mjs
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANSWER_MS, REPO, SHOW_BIN, blocked, brief, buildOf, inconclusive, isObject, must, none, openCore, packsOnce, removeRoot, showBinary, startCore, tempRoot, worldOf } from './core.mjs';
import { COUNTS, FIRST_REPLY_MS, countsProblem, judgeFirstCore, judgeFirstReply } from './judge.mjs';
import { shippedPacks, testPack } from './packs.mjs';
import { fileAt, there } from './store.mjs';

const RELEASE_BIN = join(REPO, 'target', 'release', 'deep-show');

/** A fresh core of `bin`, written its world and a `packs` call at once: the core, its first reply, and that reply's time from the process's start. */
async function firstReply(bin, world, what) {
  const core = startCore(bin);
  try {
    const [set, first] = await Promise.all([core.timed({ world }, `the world of ${what}`, ANSWER_MS), core.timed({ call: { call: 'packs' } }, `the first call of ${what}`, ANSWER_MS)]);
    if (set.value.ok !== true) throw blocked(`${what}: deep-show canvas doesn't take the world: ${brief(set.value, 800)}`);
    const reply = first.value.reply;
    if (first.value.ok !== true || !isObject(reply) || !Array.isArray(reply.packs)) throw blocked(`${what}: the core gave no rows to its first call: ${brief(first.value, 800)}`);
    return { core, ms: first.at - core.at, packs: { rows: reply.packs, counts: reply.counts } };
  } catch (error) {
    await core.close();
    throw error;
  }
}

/** A core's memory now, as its physical footprint in bytes; null where this host can't read it (never 0). */
async function footprint(pid) {
  try {
    const reader = await import(pathToFileURL(join(REPO, 'benchmarks', 'process-reader.mjs')).href);
    const own = reader.readSinceStart(pid).processes.find((p) => p.pid === pid)?.footprintBytes ?? null;
    return typeof own === 'number' && own > 0 ? own : null;
  } catch {
    return null;
  }
}

/** The perf lane's own judge of five runs against a limit, with each run's load and this machine's fingerprint. */
function laneJudge(limit, runs, loads) {
  const script = `import { readFileSync } from 'node:fs';\nimport * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify(b.judgeLimit({ ...input, fingerprint: b.fingerprint() })));`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', input: JSON.stringify({ limit, runs, loads }), timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (ran.status !== 0) throw blocked(`scripts/benchmark.mjs didn't judge the runs: ${(ran.stderr ?? '').slice(-2000)}`);
  return JSON.parse(ran.stdout);
}

test('AC6 #3611.3b726ffd on a reference Mac at rest, a fresh canvas core with the shipped packs and a filled store answers its first call in under 500 ms in five runs after a warm-up, its memory after each reply read', { timeout: 19 * 60_000 }, async (t) => {
  showBinary();
  const refs = shippedPacks();
  const probe = tempRoot();
  const at = tempRoot();
  try {
    // 1. Does this build keep a check's result at all?
    const one = testPack(probe, 'kept3611timed');
    const kept = await packsOnce(worldOf(probe, [one.offer]), 'a core given one test pack');
    must(there(probe.checked, one.ref) && !countsProblem(kept.counts), `AC6 #3611.3b726ffd: a core given a store and one pack kept no result of its check (${there(probe.checked, one.ref) ? `its \`packs\` reply ${countsProblem(kept.counts)}` : `no row for ${one.ref} under <root>/packs/checked/`}): this build has no filled store, so there is no first reply on one to time; every fresh core runs every check`);

    // 2. The build to time.
    const digest = async (bin, what) => { const core = await openCore(worldOf(probe, []), what, bin); try { return await buildOf(core, what); } finally { await core.close(); } };
    const release = existsSync(RELEASE_BIN) && await digest(RELEASE_BIN, 'the release build') === await digest(SHOW_BIN, 'the build the suite drives');
    const bin = release ? RELEASE_BIN : SHOW_BIN;
    const profile = release ? 'release' : 'dev';

    // 3. The store, filled by the first core.
    const world = worldOf(at, refs.map((pack) => pack.offer));
    const filling = await firstReply(bin, world, 'the core that fills the store');
    await filling.core.close();
    none(judgeFirstCore({ refs, packs: filling.packs, files: new Map(refs.map(({ ref }) => [ref, fileAt(at.checked, ref)])), store: '<root>/packs/checked/' }), 'AC6 #3611.3b726ffd: the core that fills the store with the shipped packs');

    // 4. Six fresh cores on it, the first a warm-up.
    const runs = [], loads = [], ran = [], memory = [];
    for (let run = 0; run < 6; run++) {
      const start = loadavg()[0];
      const timed = await firstReply(bin, world, `timed core ${run}`);
      let bytes;
      try { bytes = await footprint(timed.core.pid); } finally { await timed.core.close(); }
      const end = loadavg()[0];
      const bad = countsProblem(timed.packs.counts);
      must(!bad, `AC6 #3611.3b726ffd: timed core ${run}'s first reply ${bad}`);
      if (run === 0) continue;
      runs.push(timed.ms); loads.push({ start, end }); memory.push(bytes);
      ran.push(COUNTS.reduce((sum, name) => sum + timed.packs.counts[name], 0) + timed.packs.rows.filter((row) => row.checks !== 0).length);
    }

    // 5. The verdict.
    const verdict = judgeFirstReply({ profile, runs, loads, verdict: laneJudge(FIRST_REPLY_MS, runs, loads), ran, memory, first: filling.ms });
    t.diagnostic(`${verdict.state}: ${verdict.text}`);
    must(verdict.state !== 'FAIL', `AC6 #3611.3b726ffd: ${verdict.text}`);
    if (verdict.state !== 'PASS') throw inconclusive(`AC6 #3611.3b726ffd: ${verdict.text}; this is not a pass`);
  } finally {
    removeRoot(probe);
    removeRoot(at);
  }
});
