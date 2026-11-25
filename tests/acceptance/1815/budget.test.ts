// AC4: the first match shows within 100 ms on a 10,000-line page, on the reference Mac. The page's only match is one
// character in the line before its last, so one key is the whole of what is typed and nothing matches before it.
// - On any machine, the debug replica: that key shows "1 of 1" with its line inside the lane.
// - On a fit reference Mac only (#1097's gate; elsewhere INCONCLUSIVE before anything is built): a release replica with
//   `frame-clocks`, five runs after one warm-up, each a fresh process. A run gives two readings: the wall time from
//   sending the key until the window that shows the match is drawn, which holds the replica's own reading of the window
//   too, so it can only be too long; and the main thread's CPU time over the frames it drew, which leaves out anything off
//   that thread, so it can only be too short. scripts/benchmark.mjs's judgeLimit passes the first or fails the second;
//   anything between, as a loaded Mac's reading, is INCONCLUSIVE, never PASS.
import { spawnSync } from 'node:child_process';
import { loadavg, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { environmentProblem } from '../1097/helpers.ts';
import {
  BIG, blocked, cleanup, FAR, field, find, ID, inconclusive, inLane, look, MIN, NO_FIELD, on, open, openPage, placeOf, REPO, rest, said, sha256, SHORT, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const LIMIT_MS = 100;
const RUNS = 5;
const FAR_LINE = BIG.match[0]!;
interface Reading { place: string | null; inLane: boolean; wall: number; cpu: number | null }

/** One key typed in the field on the 10,000-line page, until its match shows or a second of the replica's clock has passed. */
async function firstMatch(bin?: string): Promise<Reading> {
  return on([BIG, SHORT], bin ? { bin } : { every: true }, async (r) => {
    // ⌘F first where a frame is cheap: with no field there, nothing is asked of the big page.
    await openPage(r, SHORT);
    if (!field(await find(r))) expect.fail(NO_FIELD(SHORT));
    await r.press('escape');
    const start = await open(r, BIG.address, (x) => inLane(x.s, BIG.lines[0]!));
    if (!inLane(start.s, BIG.lines[0]!)) blocked(`the fixture's premise doesn't hold: ${BIG.address} opens on ${String(start.address)} without its first line`);
    if (!field(await find(r))) expect.fail(NO_FIELD(BIG));
    // An empty field, whatever the one on the other page held.
    await r.press('cmd-a');
    await r.press('backspace');
    // At rest, so the frames drawn from here are the key's.
    await rest(r, 100);
    const from = r.t;
    let wall = 0;
    const timed = async (call: Line): Promise<void> => { const t = performance.now(); await r.must(String(call.call), call); wall += performance.now() - t; };
    await timed({ call: 'act', act: { kind: 'type', text: FAR } });
    let x = await look(r);
    for (let frame = 0; frame < 60 && !(placeOf(x) === '1 of 1' && inLane(x.s, FAR_LINE)); frame++) {
      await timed({ call: 'wait_for', wait_for: { t: r.t + 1 }, timeout: 1000 });
      x = await look(r);
    }
    const got = { place: placeOf(x), inLane: inLane(x.s, FAR_LINE) };
    const frames = ((await r.must('close', { call: 'close' })).frames?.list ?? []) as Line[];
    const costs = frames.filter((f) => f.drawn === true && Number(f.t) >= from && typeof f.cpu_ms === 'number').map((f) => Number(f.cpu_ms));
    return { ...got, wall, cpu: costs.length ? costs.reduce((a, c) => a + c, 0) : null };
  });
}

/** The release replica with `frame-clocks`, in a grant of the build throttle and a target folder of its own. */
function releaseDrive(): string {
  const target = join(tmpdir(), `dd1815-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
  const script = `cargo build --locked -q --release -p deep-replica --bin deep-drive --features frame-clocks --target-dir '${target}'`;
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/throttle.mjs'), 'build', '--wait', '720', '--', '/bin/sh', '-c', script], { cwd: REPO, encoding: 'utf8', env: { ...process.env, CARGO_INCREMENTAL: '0' }, timeout: 720 * MIN });
  if (r.status !== 0) blocked(`the release build of deep-drive failed (exit ${String(r.status)}): ${String(r.stderr || r.stdout).slice(-1500)}`);
  return join(target, 'release', 'deep-drive');
}
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(o: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): Verdict }

describe(`AC4 ${ID.budget} the first match within its budget`, () => {
  it(`AC4 ${ID.budget}: the first match shows within ${LIMIT_MS} ms on a 10,000-line page, on the reference Mac`, async () => {
    const any = await firstMatch();
    expect({ place: any.place, inLane: any.inLane }, `⌘F "${FAR}" on ${BIG.address} shows its one match, "${FAR_LINE}", in the lane`).toEqual({ place: '1 of 1', inLane: true });
    console.log(`AC4 on this machine's debug replica: ${any.wall.toFixed(1)} ms, no budget result`);
    const problem = environmentProblem();
    if (problem) inconclusive(`AC4's budget is a reading only here (${problem}); nothing was built or timed for release`);
    const bin = releaseDrive();
    await firstMatch(bin);
    const [walls, cpus, loads]: [number[], number[], { start: number; end: number }[]] = [[], [], []];
    for (let i = 0; i < RUNS; i++) {
      const start = loadavg()[0]!;
      const run = await firstMatch(bin);
      if (run.place !== '1 of 1' || !run.inLane || run.cpu === null) blocked(`run ${i + 1} of the release replica gave ${said(run)}`);
      walls.push(run.wall);
      cpus.push(run.cpu!);
      loads.push({ start, end: loadavg()[0]! });
      console.log(`AC4 run ${i + 1}: ${run.wall.toFixed(1)} ms of wall time, ${run.cpu!.toFixed(1)} ms of the main thread's CPU`);
    }
    const { judgeLimit, fingerprint } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as Benchmark;
    const machine = fingerprint();
    const atMost = judgeLimit({ limit: LIMIT_MS, runs: walls, fingerprint: machine, loads });
    const atLeast = judgeLimit({ limit: LIMIT_MS, runs: cpus, fingerprint: machine, loads });
    if (atMost.status === 'PASS') return;
    expect(atLeast.status, `the main thread alone takes longer: ${cpus.map((c) => c.toFixed(1)).join(', ')} ms: ${atLeast.reason ?? ''}`).not.toBe('FAIL');
    inconclusive(`AC4: ${walls.map((w) => w.toFixed(1)).join(', ')} ms of wall time with the replica's own reading in it, ${cpus.map((c) => c.toFixed(1)).join(', ')} ms of CPU: ${atMost.reason ?? atMost.status}`);
  }, 720 * MIN);
});
