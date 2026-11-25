// #3229 AC8: budgets, on the reference Mac in the local preflight, compared with the merge base. Off a fit reference Mac
// (another machine, battery, Low Power Mode, a thermal warning, a load past its cores) the test skips as INCONCLUSIVE with
// why, before anything is built or run; it never passes by skipping. On one:
// - The read entry: the real deep-hook, run with a counter inserted (fixtures/count.c), opens no more files and starts no
//   more processes for a tool call under the shipped entries than under the merge base's read entry.
// - Sealing and unsealing: the hub's own time around a variant's run (its definition's lock; from the visible run's end
//   to the variant's start, where it is unsealed; from the variant's end to the verdict), by this build and by the merge
//   base's, built from the pinned commit. Five runs, each the p50 of SAMPLES interleaved claims a side, this build's less
//   the merge base's: PASS when all five are under 5 ms, FAIL when all are over it by more than the margin, otherwise
//   INCONCLUSIVE (the design's rule for timing results).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { AC, CHECK, childEnv, claim, cleanup, cut, DEEP_HOOK, draft, filesHolding, FIXED, FIXTURE, Log, makeWorld, NODE, open, PROMPT, REPO, shownClaim, startHub, tempDir, variant, type Line, type World } from './helpers.ts';

afterEach(cleanup, 300_000);

/** The merge base this suite was written on, pinned, so the comparison stays with the hub before #3229 after it merges. */
const BASE = 'a5fc47436906b7f6caa7c5414e584a1ce9160d5d';
const LIMIT_MS = 5;
const RUNS = 5;
const SAMPLES = 10;
const TRIES = 10;

// ---- The gate and the judge, from tests/acceptance/3219/helpers.ts (#1097's rule). Same repo, same license.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
const read = (cmd: string, ...args: string[]): string => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  return r.stdout.trim();
};
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  return load > cpus().length ? `load ${load.toFixed(1)} is past the ${cpus().length} cores` : null;
}
const p50 = (samples: readonly number[]): number => [...samples].sort((a, b) => a - b)[Math.floor((samples.length - 1) / 2)]!;
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(text);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${text}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${text}`);
}

// ---- The read entry: what a tool call's hook opens and starts.
interface Rules { entries: { [name: string]: { match: string } } }
/** The merge base's read entries, as hook.test.ts makes them. */
function without(rules: Rules): Rules {
  const entries = Object.entries(rules.entries).flatMap(([name, e]): [string, { match: string }][] => {
    const reads = /^read:(.*)$/.exec(e.match);
    if (!reads) return [[name, e]];
    const paths = reads[1]!.split(' ').filter((p) => !/^!?~\/\.deepbuild\/checkouts(\/|$)/.test(p));
    return paths.length ? [[name, { ...e, match: `read:${paths.join(' ')}` }]] : [];
  });
  return { ...rules, entries: Object.fromEntries(entries) };
}
/** What one PreToolUse of deep-hook's own process opened and started, with no hub: one line each, its home written as ~. */
function once(lib: string, rules: Rules, tool_name: string, tool_input: Line): string[] {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  const transcript = join(home, '.claude/projects/w/s.jsonl');
  for (const dir of [join(home, '.deepbuild'), join(home, '.claude/projects/w'), cwd]) mkdirSync(dir, { recursive: true });
  writeFileSync(transcript, '');
  writeFileSync(join(home, '.deepbuild', 'rules.json'), JSON.stringify(rules));
  const body = { session_id: '0709570c-f8a4-46f1-a5f3-0dfecde282ec', transcript_path: transcript, cwd, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name, tool_input, tool_use_id: 'toolu_3229' };
  const count = join(tmp, 'count');
  const r = spawnSync(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd, input: JSON.stringify(body), env: childEnv(home, { DYLD_INSERT_LIBRARIES: lib, DH3229_COUNT: count }), encoding: 'utf8', timeout: 60_000 });
  const lines = existsSync(count) ? readFileSync(count, 'utf8').split('\n') : [];
  const own = lines.filter((l) => l.startsWith(`${r.pid} `)).map((l) => l.slice(String(r.pid).length + 1).replaceAll(home, '~'));
  if (!own.some((l) => l.endsWith('rules.json'))) throw Error(`BLOCKED: the counter saw no open of rules.json by deep-hook (exit ${r.status}): ${cut(lines.join('; '))}`);
  return own.sort();
}
/** The most of TRIES calls: past its 50 ms budget a loaded deep-hook stops short, so a count is only ever too low. */
function counted(lib: string, rules: Rules, tool: string, input: Line): { open: string[]; spawn: string[] } {
  const most = { open: [] as string[], spawn: [] as string[] };
  for (let i = 0; i < TRIES; i++) {
    const lines = once(lib, rules, tool, input);
    for (const kind of ['open', 'spawn'] as const) {
      const of = lines.filter((l) => l.startsWith(`${kind} `));
      if (of.length > most[kind].length) most[kind] = of;
    }
  }
  return most;
}

// ---- Sealing and unsealing: the hub's own time around a variant's run.
/** The merge base's built tree, from `git archive` of BASE (never a copy of .git), with this checkout's installs cloned in. */
function baseTree(): string {
  const dir = join(REPO, 'target', 'base-3229', BASE.slice(0, 12));
  const cli = join(dir, 'packages/cli/dist/main.js');
  const whole = join(dir, 'built');
  if (existsSync(whole)) return cli;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const env = childEnv(process.env.HOME ?? dir);
  const unpacked = spawnSync('/bin/sh', ['-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'sh', REPO, BASE, dir], { env, encoding: 'utf8', timeout: 1_800_000 });
  if (unpacked.status !== 0) throw Error(`BLOCKED: git archive of the merge base ${BASE} failed: ${unpacked.stderr.slice(-2000)}`);
  const cloned = spawnSync('cp', ['-cR', join(REPO, 'node_modules'), join(dir, 'node_modules')], { encoding: 'utf8', timeout: 1_800_000 });
  if (cloned.status !== 0) throw Error(`BLOCKED: cloning node_modules failed: ${cloned.stderr.slice(-2000)}`);
  const built = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: dir, env, encoding: 'utf8', timeout: 3_600_000 });
  if (built.status !== 0 || !existsSync(cli)) throw Error(`BLOCKED: the merge base's workspaces didn't build: ${String(built.stdout).slice(-2000)} ${String(built.stderr).slice(-2000)}`);
  cpSync(DEEP_HOOK, join(dir, 'target/debug/deep-hook'));
  writeFileSync(whole, '');
  return cli;
}
interface Side { w: World; r: Log; marker: string }
async function side(cli?: string): Promise<Side> {
  const v = variant();
  const w = makeWorld([draft(PROMPT, [v])]);
  return { w, r: await Log.open(await startHub(w, undefined, cli)), marker: v.marker };
}
let turns = 0;
/** One claim of the honest fix by a session of its own, and what the hub itself took around its variant's run, in ms. */
async function around(s: Side): Promise<number> {
  const k = await open(s.w, s.r);
  const c = await claim(k, s.r, FIXED(++turns), { runs: 2 });
  const [visible, unseen] = c.runs.filter((x) => x.check === CHECK);
  const created = s.r.events.find((e) => e.kind === 'task.created' && e.data.task_ref === k.task);
  const verdict = c.verdicts.at(-1);
  if (!visible?.finished || !unseen?.finished || !created || !verdict) throw Error(`BLOCKED: a sample needs its task, its two runs and its verdict: ${shownClaim(c)}`);
  await k.s.end();
  await k.s.agent.stop();
  return (k.locked.ts - created.ts) + (unseen.started.ts - visible.finished.ts) + (verdict.ts - unseen.finished.ts);
}

describe(`${AC[8]} Budgets, on the reference Mac in the local preflight, compared with the merge base`, () => {
  it(`${AC[8]} sealing and unsealing add under ${LIMIT_MS} ms to a variant's run, and the read entry adds no process and no file read to a tool call's hook`, async (ctx) => {
    const problem = environmentProblem();
    if (problem) {
      console.log(`AC8 not measured: ${problem}`);
      ctx.skip(`INCONCLUSIVE (not measured: ${problem}): a budget counts only on a fit reference Mac`);
    }
    // The read entry.
    const shipped = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as Rules;
    expect(JSON.stringify(without(shipped)) === JSON.stringify(shipped), 'the shipped read entry covers ~/.deepbuild/checkouts, so there is an entry to count').toBe(false);
    const lib = join(tempDir(), 'count.dylib');
    const cc = spawnSync('cc', ['-dynamiclib', '-o', lib, join(REPO, 'tests/acceptance/3229/fixtures/count.c')], { encoding: 'utf8' });
    if (cc.status !== 0) throw Error(`BLOCKED: the counter didn't build: ${cc.stderr}`);
    for (const [tool, input] of [['Bash', { command: `cat ${FIXTURE}` }], ['Read', { file_path: `/tmp/${FIXTURE}` }]] as [string, Line][]) {
      const now = counted(lib, shipped, tool, input);
      const then = counted(lib, without(shipped), tool, input);
      console.log(`AC8 a ${tool} call's hook: ${now.open.length} opens and ${now.spawn.length} starts with the entry, ${then.open.length} and ${then.spawn.length} at the merge base`);
      for (const kind of ['open', 'spawn'] as const) {
        expect(now[kind].length, `a ${tool} call's hook does no more \`${kind}\` than under the merge base's read entry: here ${now[kind].join('; ')}; there ${then[kind].join('; ')}`).toBeLessThanOrEqual(then[kind].length);
      }
    }
    // Sealing and unsealing.
    const base = await side(baseTree());
    const here = await side();
    await around(base); // a warm-up each
    await around(here);
    const clear = filesHolding(join(here.w.root, 'evidence'), here.marker);
    expect(clear.length, `the variant is sealed in the store, so there is sealing to time, yet it is in the clear in ${clear.join(', ')}`).toBe(0);
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const now: number[] = [];
      const then: number[] = [];
      for (let n = 0; n < SAMPLES; n++) { now.push(await around(here)); then.push(await around(base)); }
      runs.push(p50(now) - p50(then));
      console.log(`AC8 run ${i + 1}: p50 ${p50(now)} ms here, ${p50(then)} ms at the merge base (${NODE}, load ${loadavg()[0]!.toFixed(1)})`);
    }
    const late = environmentProblem();
    if (late) ctx.skip(`INCONCLUSIVE (reading only: ${late}): ${runs.map((x) => x.toFixed(2)).join(', ')} ms`);
    judge(ctx, "AC8 what sealing and unsealing add to the hub's own time around a variant's run, p50, ms", runs, LIMIT_MS);
  }, 14_400_000);
});
