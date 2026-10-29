// #340 AC5: budgets, on the reference Mac in the local preflight, compared with the merge base: sending the open asks'
// requirement IDs again after a compaction keeps the SessionStart hook inside the hook overhead budget, under 10 ms at
// p95 on top of process start. A local-preflight timing check in three parts, after #303's and #315's suites:
//   1. The perf lane (scripts/benchmark.mjs, benchmarks/budgets.json) has a task naming #340 that times the SessionStart
//      hook after a compaction with open asks, valid against the merge base's budgets, and it runs.
//   2. Here: a session with three open asks whose definitions are locked (helpers.ts, OPEN_ASKS), on this checkout's
//      hub and on the merge base's (built from `git archive` into a temp folder). The same deep-hook binary, this
//      checkout's, fires each SessionStart(compact) as a child of the session's own process, and the floor, "process
//      start", is a native no-op binary (`fn main() {}`, rustc -O) started and timed by the same parent the same way.
//      Before any number is read, the compacted reply is proven to carry every open requirement ID on this checkout's
//      hub. RUNS runs after a warm-up, each SAMPLES SessionStarts and SAMPLES floor starts interleaved, alternating the
//      two hubs run by run. A run's overhead is its hooks' p95 less its floor's p95. PASS when every run is under
//      10 ms and the merge base comparison shows no regression; FAIL when every run is over 10 ms by more than the
//      margin (the larger of 5% and the runs' spread), or when every run's p50 hook time is more than 50% above the
//      merge base's and over it by more than 1 ms (the design's regression rule); otherwise INCONCLUSIVE. The numbers
//      are always measured and printed; they count only on a reference Mac (Mac15,7 M3 Pro 36 GiB or Mac15,12 M3
//      16 GiB) not loaded past its core count, and anywhere else, or when the merge base can't be built, the test is
//      skipped as INCONCLUSIVE with the readings, never passed.
//   3. The instrument on a wrong program, on any machine: a SessionStart reply held 25 ms on the hook's path
//      (DEEP_HUB_PLANT=slow-brief) reads over 10 ms in every run.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  AC5, CLI, NODE, REPO, cleanup, contextOf, makeWorld, must, OPEN_DRAFTS, OPEN_IDS, openAsks, run, Session, shown, sleep, startHub,
  tempDir,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LIMIT_MS = 10;
const RUNS = 5;
const SAMPLES = 20;
const WARM = 5;
const PAUSE_MS = 250;
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];

interface Task { id: string; command: string[]; initialReason?: string; changeReason?: string }
const mergeBase = (): string => execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
const percentile = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };

/** The floor: a native binary that does nothing, built by rustc at opt-level 3, its first (slow) exec done. */
async function buildNoop(): Promise<string> {
  const dir = join(tempDir(), 'noop');
  mkdirSync(dir);
  writeFileSync(join(dir, 'noop.rs'), 'fn main() {}\n');
  const binary = join(dir, 'noop');
  const r = await run('rustc', ['-C', 'opt-level=3', '-o', binary, join(dir, 'noop.rs')], { timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`BLOCKED: rustc failed to build the no-op floor: ${r.stderr.slice(-2000)}`);
  spawnSync(binary, [], { stdio: 'ignore', timeout: 30_000 });
  return binary;
}

/** A side ready to time: a hub from `cli`, a session with the three open asks, and its compacted reply proven. */
async function side(cli: string, plant?: string): Promise<{ s: Session; proof: string }> {
  const w = makeWorld({ drafts: OPEN_DRAFTS() });
  const hub = await startHub(w, { cli, plant });
  const s = new Session(w, 'terminal');
  await s.start();
  await openAsks(hub, s);
  const reply = await s.start('compact');
  const missing = OPEN_IDS.filter((id) => !new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(contextOf(reply)));
  return { s, proof: missing.length ? `the SessionStart after /compact sends none of ${missing.join(', ')}: ${shown(reply)}` : '' };
}

/**
 * One run on a side: SAMPLES SessionStart(compact) hooks and SAMPLES floor starts, interleaved. A compaction is rare in
 * a session, so each sample starts from a settled hub: a pause before each hook and each floor start lets the work a
 * session's start leaves the hub (tool lists, loads) end first, so neither reading carries the other's tail.
 */
async function oneRun(s: Session, noop: string): Promise<{ overhead: number; p50: number; p95: number; floor: number }> {
  const hooks: number[] = [];
  const floor: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    await sleep(PAUSE_MS);
    const r = await s.start('compact');
    hooks.push(r.ms);
    await sleep(PAUSE_MS);
    const f = await s.floor(noop);
    if (f.code !== 0) throw Error(`BLOCKED: the no-op floor exited ${f.code}: ${shown(f)}`);
    floor.push(f.ms);
  }
  return { overhead: percentile(hooks, 95) - percentile(floor, 95), p50: percentile(hooks, 50), p95: percentile(hooks, 95), floor: percentile(floor, 95) };
}

const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const machine = (): string => {
  try { return `${read('sysctl', '-n', 'hw.model')} / ${read('sysctl', '-n', 'machdep.cpu.brand_string')}, 1-minute load ${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores`; } catch { return `${process.platform}, load ${loadavg()[0]!.toFixed(1)}`; }
};
/** Why this machine's timings are a reading only, or null on a reference Mac not loaded past its cores. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = read('sysctl', '-n', 'hw.model');
  const chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
  const gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const load = loadavg()[0]!;
  if (load > cpus().length) return `load ${load.toFixed(1)} is past the ${cpus().length} cores`;
  return null;
}

/**
 * The merge base's build: `git archive` of it unpacked into a temp folder, this checkout's node_modules linked entry by
 * entry, its own workspace packages linked as npm links them, and `npm run build --workspaces` there. A merge base
 * that can't be built leaves nothing to compare with: the reason, read as INCONCLUSIVE. (After #303's budgets test.)
 */
function buildMergeBase(): { dir: string; commit: string } | string {
  const commit = mergeBase();
  const dir = join(tempDir(), 'base');
  mkdirSync(dir);
  const archive = spawnSync('git', ['archive', commit], { cwd: REPO, maxBuffer: 1 << 30 });
  const untar = spawnSync('tar', ['-mxf', '-', '-C', dir], { input: archive.stdout, maxBuffer: 1 << 30 });
  if (archive.status !== 0 || untar.status !== 0) return `the merge base ${commit} couldn't be unpacked: ${String(archive.stderr)}${String(untar.stderr)}`;
  const modules = join(dir, 'node_modules');
  mkdirSync(modules);
  for (const entry of readdirSync(join(REPO, 'node_modules'))) {
    if (entry === '@deepbuild' || entry.startsWith('.package-lock')) continue;
    symlinkSync(join(REPO, 'node_modules', entry), join(modules, entry));
  }
  mkdirSync(join(modules, '@deepbuild'));
  for (const entry of readdirSync(join(REPO, 'node_modules', '@deepbuild'))) {
    const at = join(REPO, 'node_modules', '@deepbuild', entry);
    if (lstatSync(at).isSymbolicLink()) symlinkSync(readlinkSync(at), join(modules, '@deepbuild', entry));
  }
  const built = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: dir, encoding: 'utf8', timeout: 1_200_000, env: { ...process.env, PATH: `${dirname(NODE)}:${process.env.PATH ?? ''}` } });
  if (built.status !== 0 || !existsSync(join(dir, 'packages/cli/dist/main.js'))) return `the merge base ${commit} didn't build: ${String(built.stderr).slice(-1500)}`;
  return { dir, commit };
}

describe(`${AC5} budgets, on the reference Mac in the local preflight, compared with the merge base: the SessionStart hook after a compaction stays under 10 ms at p95 on top of process start`, () => {
  it(`${AC5} the perf lane has a task naming #340, timing the SessionStart hook after a compaction, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${mergeBase()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#340\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    must(task !== undefined, `${AC5} benchmarks/budgets.json must have a task whose reason names issue #340, timing the SessionStart hook that sends the open asks' requirement IDs again after a compaction`);
    must(/SessionStart|compact/i.test(`${task!.initialReason ?? ''} ${task!.changeReason ?? ''}`), `${AC5} the #340 task must say it times the SessionStart hook after a compaction: ${JSON.stringify(task)}`);
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 900_000);

  it(`${AC5} sending the open asks' requirement IDs again after a compaction keeps the SessionStart hook under 10 ms at p95 on top of process start, against the merge base's build`, async (ctx: TestContext) => {
    const noop = await buildNoop();
    const head = await side(CLI);
    must(!head.proof, `${AC5} the timed hook is the criterion's: on this checkout's hub ${head.proof}`);
    const base = buildMergeBase();
    if (typeof base === 'string') {
      ctx.skip(`INCONCLUSIVE (nothing to compare with): ${base}`);
      return;
    }
    const old = await side(join(base.dir, 'packages/cli/dist/main.js'));
    for (let i = 0; i < WARM; i++) { await head.s.start('compact'); await old.s.start('compact'); }
    const runs: { head: Awaited<ReturnType<typeof oneRun>>; base: Awaited<ReturnType<typeof oneRun>> }[] = [];
    for (let r = 0; r < RUNS; r++) {
      if (r % 2) { const b = await oneRun(old.s, noop); runs.push({ base: b, head: await oneRun(head.s, noop) }); }
      else { const h = await oneRun(head.s, noop); runs.push({ head: h, base: await oneRun(old.s, noop) }); }
    }
    const overhead = runs.map((x) => x.head.overhead);
    const reading = `SessionStart(compact) p95 over process start, per run: ${overhead.map((x) => x.toFixed(2)).join(', ')} ms against ${LIMIT_MS} ms (hook p95 ${runs.map((x) => x.head.p95.toFixed(1)).join(', ')} ms, floor p95 ${runs.map((x) => x.head.floor.toFixed(1)).join(', ')} ms); p50 hook ${runs.map((x) => x.head.p50.toFixed(1)).join(', ')} ms against the merge base ${base.commit.slice(0, 8)}'s ${runs.map((x) => x.base.p50.toFixed(1)).join(', ')} ms (its p95 over process start ${runs.map((x) => x.base.overhead.toFixed(2)).join(', ')} ms)${old.proof ? `; the merge base ${old.proof.slice(0, 200)}` : ''}; ${machine()}`;
    console.log(`${AC5} ${reading}`);
    const problem = environmentProblem();
    if (problem) {
      ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${reading}`);
      return;
    }
    const spread = (Math.max(...overhead) - Math.min(...overhead)) / Math.max(Math.abs(Math.min(...overhead)), 1e-9);
    const margin = Math.max(0.05, spread);
    const regressed = runs.every((x) => x.head.p50 > x.base.p50 * 1.5 && x.head.p50 - x.base.p50 > 1);
    must(!regressed, `${AC5} FAIL the SessionStart hook after a compaction regressed against the merge base in every run (p50 more than 50% above it): ${reading}`);
    if (overhead.every((x) => x < LIMIT_MS)) return;
    must(!overhead.every((x) => x > LIMIT_MS * (1 + margin)), `${AC5} FAIL the SessionStart hook after a compaction is over 10 ms at p95 on top of process start in every run: ${reading}`);
    ctx.skip(`INCONCLUSIVE the runs are neither all under ${LIMIT_MS} ms nor all over it by more than the ${(margin * 100).toFixed(0)}% margin: ${reading}`);
  }, 2_400_000);

  it(`${AC5} (wrong program) a SessionStart reply held 25 ms on the hook's path (DEEP_HUB_PLANT=slow-brief) reads over 10 ms in every run`, async () => {
    const noop = await buildNoop();
    const slow = await side(CLI, 'slow-brief');
    must(!slow.proof, `${AC5} the planted hub still sends the IDs after a compaction: ${slow.proof}`);
    for (let i = 0; i < WARM; i++) await slow.s.start('compact');
    const overhead: number[] = [];
    for (let r = 0; r < RUNS; r++) overhead.push((await oneRun(slow.s, noop)).overhead);
    console.log(`${AC5} planted slow-brief: p95 over process start per run ${overhead.map((x) => x.toFixed(2)).join(', ')} ms; ${machine()}`);
    must(overhead.every((x) => x > LIMIT_MS), `${AC5} the instrument must read the planted 25 ms hold as over ${LIMIT_MS} ms in every run: ${overhead.map((x) => x.toFixed(2)).join(', ')} ms`);
  }, 900_000);
});
