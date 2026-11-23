// AC10: budgets, on the reference Mac in the local preflight, compared with the merge base. One world, a real hub's
// record: a taste ask whose manifest lists twenty 120 × 80 pictures, all drawn at once. The replica draws only the
// frames a real window would (`launch.frames: "dirty"`, #1546), and each frame's report (#1482) says whether it drew,
// what it notified and, in a release build with `frame-clocks`, its main thread's CPU time.
// - Idle: once the card armed, ten seconds of the virtual clock with no input. Tracking what was drawn adds no wakeup:
//   no frame drawn and none notified there. A count above zero is compared with the merge base's own (README,
//   Readings 6); the counts name no time, so they run on any Mac.
// - The frame: the CPU time of a frame that draws the twenty pictures, forced 60 times (`refresh`), in this checkout's
//   release replica and the merge base's, five runs each, by #1097's timing rule (PASS when every run's difference is
//   within 0.1 ms, FAIL when every one is over it past the margin, else INCONCLUSIVE). Off a fit reference Mac, as on one
//   loaded past its cores, it reads INCONCLUSIVE before anything is built, sparing the shared machine.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { environmentProblem } from '../1097/helpers.ts';
import {
  ARM_AFTER_MS, askOf, cleanup, drawnIn, GIT_ENV, ID, inconclusive, makeWorld, MIN, optionOf, ACCEPT, isArmed, REPO, replicaOf, said, sha256,
  Trace, openOn, waitFor, blocked, msOf, type Line, type Replica, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
/** The merge base this suite was written on, pinned, so the comparison stays with the app before #3234 after it merges. */
const BASE = 'f8c6cff822b5b960d35312d75d44769616a95516';
const LIMIT_MS = 0.1;
const RUNS = 5;
const FRAMES = 60;
const IDLE_MS = 10_000;
let world: World;
beforeAll(async () => {
  world = await makeWorld([{ key: 'grid', title: 'Icon grid', asks: [{ key: 'twenty', question: 'Do the twenty icons look right?', pictures: Array.from({ length: 20 }, (): [number, number] => [120, 80]) }] }]);
}, 30 * MIN);

/** The replica on the twenty pictures, its card armed and every picture shown; `bin` another deep-drive than this checkout's debug one. */
async function settled(bin?: string): Promise<{ r: Replica; drawn: number; origin: number }> {
  const ask = askOf(world, 'twenty');
  const r = await replicaOf(world, { dirty: true, ...(bin ? { bin } : {}) });
  // What the views' clock read at the replica's launch, near enough: the record's clock then (README, Readings 6).
  const origin = Date.now() - msOf(r);
  const trace = new Trace(ask.pictures);
  await openOn(r, ask.handle, trace);
  await r.wait(3 * ARM_AFTER_MS);
  const x = await waitFor(r, (s) => isArmed(optionOf(s, ACCEPT)), 2000);
  return { r, drawn: [...drawnIn(x.s, ask.pictures).values()].filter((d) => d.whole).length, origin };
}
/** Ten idle seconds that cross no whole minute of the views' clock, where a page's "3 min ago" may rightly redraw. */
async function idle(r: Replica, origin: number): Promise<number> {
  const left = 60_000 - ((origin + msOf(r)) % 60_000);
  if (left < IDLE_MS + 2000) await r.wait(left + 1000);
  const from = r.t;
  await r.wait(IDLE_MS);
  return from;
}
/** The frames' report `close` gives a replica launched with `frames: "dirty"` (#1482): every frame of the clock, drawn or not. */
async function framesOf(r: Replica): Promise<Line[]> {
  const closed = await r.must('close', { call: 'close' });
  const list = closed.frames?.list;
  return Array.isArray(list) ? (list as Line[]) : blocked(`close gave no frames report: ${said(closed.frames ?? closed, 400)}`);
}
/** Wakeups in the idle stretch: frames of the clock after `from` that drew or notified anything. */
const wakeups = (frames: readonly Line[], from: number): Line[] => frames.filter((f) => Number(f.t) > from && (f.drawn === true || (Array.isArray(f.notified) && f.notified.length > 0)));

// ---- Builds for the timed half: release replicas with `frame-clocks`, this checkout's and the merge base's, each in a
// grant of the build throttle and a target folder of its own, so the debug target the other files use is untouched.

const OWN = join(tmpdir(), `dd3234-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
function throttled(script: string, what: string, cwd = REPO): void {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/throttle.mjs'), 'build', '--wait', '720', '--', '/bin/sh', '-c', script], { cwd, encoding: 'utf8', env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeout: 720 * MIN });
  if (r.status !== 0) blocked(`the release build of ${what} failed (exit ${r.status}): ${String(r.stderr || r.stdout).slice(-1500)}`);
}
function releaseDrive(at: string, target: string, what: string): string {
  const bin = join(target, 'release', 'deep-drive');
  throttled(`cargo build --locked -q --release -p deep-replica --bin deep-drive --features frame-clocks --target-dir '${target}'`, what, at);
  return bin;
}
/** The merge base's tree from `git archive` (no worktree is added, no .git copied), built in a folder of its own. */
function baseDrive(): string {
  const dir = join(OWN, `base-${BASE.slice(0, 12)}`);
  const src = join(dir, 'src');
  if (!existsSync(join(src, 'Cargo.toml'))) {
    mkdirSync(src, { recursive: true });
    execFileSync('tar', ['-x', '-C', src], { input: execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE], { maxBuffer: 2 ** 32, env: GIT_ENV(dir) }), maxBuffer: 2 ** 28 });
  }
  return releaseDrive(src, join(dir, 'target'), `deep-drive at ${BASE.slice(0, 12)}`);
}
/** The median CPU time of the frames that drew, across `FRAMES` forced frames of the settled page. */
async function frameCost(bin: string): Promise<number> {
  const { r, drawn } = await settled(bin);
  try {
    const from = r.t;
    for (let i = 0; i < FRAMES; i++) await r.must('a forced frame', { call: 'refresh' });
    const costs = (await framesOf(r)).filter((f) => Number(f.t) >= from && f.drawn === true && typeof f.cpu_ms === 'number').map((f) => Number(f.cpu_ms)).sort((a, b) => a - b);
    if (costs.length < FRAMES / 2) blocked(`only ${costs.length} of ${FRAMES} forced frames reported a CPU time (drew ${drawn} pictures)`);
    return costs[Math.floor(costs.length / 2)]!;
  } finally {
    await r.stop();
  }
}

describe(`AC10 ${ID.budgets} tracking what was drawn stays within its budgets`, () => {
  it(`AC10 ${ID.budgets}: tracking what was drawn adds no timer and no wakeup to an idle window`, async () => {
    const { r, drawn, origin } = await settled();
    let woke: Line[];
    try {
      expect(drawn, 'the page draws all twenty pictures whole at once').toBe(20);
      const from = await idle(r, origin);
      woke = wakeups(await framesOf(r), from);
    } finally {
      await r.stop();
    }
    console.log(`AC10 idle: ${woke.length} wakeups in ${IDLE_MS / 1000} s of the virtual clock once the card armed: ${said(woke.map((f) => ({ t: f.t, drawn: f.drawn, notified: f.notified })), 600)}`);
    if (woke.length === 0) return;
    // A count above zero is judged against the merge base's own idle window over the same record.
    const base = await settled(baseDrive());
    let before: Line[];
    try {
      const from = await idle(base.r, base.origin);
      before = wakeups(await framesOf(base.r), from);
    } finally {
      await base.r.stop();
    }
    expect(woke.length, `the idle window wakes ${woke.length} times where the merge base's wakes ${before.length}: ${said(woke, 600)}`).toBeLessThanOrEqual(before.length);
  }, 120 * MIN);

  it(`AC10 ${ID.budgets}: tracking what was drawn adds under 0.1 ms to a frame that draws 20 pictures, against the merge base, on the reference Mac (a target, measured)`, async () => {
    const problem = environmentProblem();
    if (problem) inconclusive(`AC10's frame timing is a reading only here (${problem}); nothing was built or timed`);
    const ours = releaseDrive(REPO, join(OWN, 'release'), 'deep-drive');
    const theirs = baseDrive();
    const deltas: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const [a, b] = [await frameCost(ours), await frameCost(theirs)];
      console.log(`AC10 run ${i + 1}: a frame drawing 20 pictures costs ${a.toFixed(4)} ms here, ${b.toFixed(4)} ms at ${BASE.slice(0, 12)}`);
      deltas.push(a - b);
    }
    const again = environmentProblem();
    if (again) inconclusive(`the machine changed during the timing (${again}); differences ${deltas.map((d) => d.toFixed(4)).join(', ')} ms`);
    const spread = (Math.max(...deltas) - Math.min(...deltas)) / Math.max(Math.abs(Math.min(...deltas)), 1e-9);
    const margin = Math.max(0.05, spread);
    const text = `differences ${deltas.map((d) => d.toFixed(4)).join(', ')} ms against ${LIMIT_MS} ms (margin ${(margin * 100).toFixed(0)}%)`;
    console.log(`AC10 frame: ${text}`);
    if (deltas.every((d) => d <= LIMIT_MS)) return;
    expect(deltas.every((d) => d > LIMIT_MS * (1 + margin)), `FAIL ${text}`).toBe(false);
    inconclusive(text);
  }, 720 * MIN);
});
