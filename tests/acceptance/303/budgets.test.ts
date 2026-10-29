// #303 AC11: budgets, on the reference Mac in the local preflight, compared with the merge base: turning a message into
// a task adds under 5 ms to the prompt hook. A local-preflight timing check, two parts, after #304's and #24's suites:
//   1. The perf lane (scripts/benchmark.mjs, benchmarks/budgets.json) has a task naming #303 that times the prompt hook,
//      valid against the merge base's budgets, and it runs: the lane's own merge-base comparison.
//   2. Here: the merge base is built from `git archive` of the merge base with origin/main into a temp folder (this
//      checkout's node_modules linked in, its own workspace packages built), and its hub and this checkout's hub each
//      start on a temp home. The same deep-hook binary (this checkout's) fires UserPromptSubmit for prompts that ask for
//      a change, alternating between the two hubs, RUNS runs of PROMPTS prompts each after a warm-up. Before any number
//      is read, the timed prompt is proven to become a task on this checkout's hub. A run's added time is the median
//      prompt hook on this checkout's hub less the median on the merge base's. PASS when every run is under 5 ms, FAIL
//      when every run is over it by more than the margin (the larger of 5% and the runs' spread), otherwise
//      INCONCLUSIVE. The numbers are always measured and printed; they count only on a reference Mac not loaded past
//      its core count, and anywhere else, or when the merge base can't be built, the test is skipped as INCONCLUSIVE
//      with the reading, never passed. Mains power is not required.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  AC11, BEHAVIOR, CLI, NODE, REPO, askNamed, childEnv, cleanup, expectTask, makeWorld, must, own, parseObject, Session,
  settle, sleep, tempDir, type Hub, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LIMIT_MS = 5;
const RUNS = 5;
const PROMPTS = 20;
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];

interface Task { id: string; command: string[]; initialReason?: string; changeReason?: string }
const mergeBase = (): string => execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();

describe(`${AC11} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC11} the perf lane has a task naming #303, timing the prompt hook, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${mergeBase()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#303\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    must(task !== undefined, `${AC11} benchmarks/budgets.json must have a task whose reason names issue #303, timing the prompt hook that turns a message into a task`);
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 900_000);

  it(`${AC11} turning a message into a task adds under 5 ms to the prompt hook, against the merge base's build`, async (ctx: TestContext) => {
    // The timed call is the one the criterion names: on this checkout's hub, the prompt becomes a task.
    const head = makeWorld({ drafts: [] });
    const headHub = await hubOf(head, CLI);
    const proven = new Session(head);
    await proven.start();
    await proven.typed(BEHAVIOR);
    const events = await settle(headHub, (all) => askNamed(all, proven, BEHAVIOR) !== undefined && all.some((e) => e.kind === 'task.created'));
    expectTask(events, proven, BEHAVIOR, AC11);

    const base = buildMergeBase();
    if (typeof base === 'string') {
      ctx.skip(`INCONCLUSIVE (nothing to compare with): ${base}`);
      return;
    }
    const old = makeWorld({ drafts: [] });
    await hubOf(old, join(base.dir, 'packages/cli/dist/main.js'));
    const sessions = { head: proven, base: new Session(old) };
    await sessions.base.start();

    const prompt = (n: string) => `${BEHAVIOR} in the ${n} handler`;
    for (let i = 0; i < 5; i++) for (const side of ['head', 'base'] as const) await sessions[side].typed(prompt(`warm${i}`));
    const added: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const ms = { head: [] as number[], base: [] as number[] };
      for (let i = 0; i < PROMPTS; i++) {
        for (const side of (i % 2 ? ['base', 'head'] : ['head', 'base']) as ('head' | 'base')[]) {
          const ran = await sessions[side].typed(prompt(`r${r}p${i}`));
          ms[side].push(ran.ms);
        }
      }
      added.push(median(ms.head) - median(ms.base));
    }
    const reading = `prompt hook added over the merge base ${base.commit.slice(0, 8)}, per run: ${added.map((x) => x.toFixed(2)).join(', ')} ms against ${LIMIT_MS}; ${machine()}`;
    console.log(`AC11 ${reading}`);
    const problem = environmentProblem();
    if (problem) {
      ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${reading}`);
      return;
    }
    const spread = (Math.max(...added) - Math.min(...added)) / Math.max(Math.abs(Math.min(...added)), 1e-9);
    const margin = Math.max(0.05, spread);
    if (added.every((x) => x < LIMIT_MS)) return;
    must(!added.every((x) => x > LIMIT_MS * (1 + margin)), `${AC11} FAIL turning a message into a task adds over 5 ms to the prompt hook in every run: ${reading}`);
    ctx.skip(`INCONCLUSIVE the runs are neither all under ${LIMIT_MS} ms nor all over it by more than the ${(margin * 100).toFixed(0)}% margin: ${reading}`);
  }, 2_400_000);
});

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
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
 * that can't be built leaves nothing to compare with: the reason, read as INCONCLUSIVE.
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

/** `deep hub run` from the given CLI on the world's home, with the world's test settings. */
async function hubOf(w: World, cli: string): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work });
  const child = spawn(NODE, [cli, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<ReturnType<typeof parseObject>>((resolve) => child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); })),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub from ${cli} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => err };
}
