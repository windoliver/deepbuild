// #1015 AC8: budgets, on the reference Mac in the local preflight, compared with the merge base. Matching adds under
// 1 ms at p95 to a PreToolUse call; with the hub stopped, a matched command runs as written within deep-hook's
// fail-open time (under 50 ms from the hook's start, design: Budgets), and its session's row reads "ran unleased".
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #237's and
// #1097's budgets read it, and here the release deep-hook against the pinned merge base's, by the timing rule of
// #1097's suite (five runs; PASS when all are within the limit, FAIL when all are over it by more than the margin,
// otherwise INCONCLUSIVE). A timing on a machine that isn't a fit reference Mac, as one loaded past its cores, reads
// INCONCLUSIVE, never PASS or FAIL; the 1 ms comparison isn't even built there, to spare the shared machine.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { environmentProblem, judge, p95 } from '../1097/helpers.ts';
import { asWritten, CARGO_TEST, claudeCall, NODE, REPO, rpc, sampleRepo, Session, shownHook, sleep, until, World, AC8, type Line } from './helpers.ts';

/** The merge base this suite was written on, pinned, so the comparison stays with the pre-#1015 deep-hook after it merges. */
const BASE = '2ea0fb7750755dd4bc8cfbb3433f394daf9418b3';
const FAIL_OPEN_MS = 50;
const LIMIT_MS = 1;
const RUNS = 5;
const CALLS = 200;

/** The session's rows, `deep status`'s and the sessions table's, as JSON text. */
async function rowsOf(w: World, s: Session): Promise<string[]> {
  const status = ((await rpc(w.hub!, 'status.read')).rows ?? []) as Line[];
  const sessions = ((await rpc(w.hub!, 'sessions.read')).sessions ?? []) as Line[];
  return [...status, ...sessions].filter((r) => Object.values(r).some((v) => v === s.id)).map((r) => JSON.stringify(r));
}

function cargo(args: string[], cwd: string): void {
  // A shared Cargo target directory would misplace the binaries (scripts/preflight.mjs).
  const env = { ...process.env };
  delete env.CARGO_TARGET_DIR;
  const r = spawnSync('cargo', args, { cwd, encoding: 'utf8', timeout: 1_800_000, env });
  if (r.status !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} exited ${r.status}: ${String(r.stderr).slice(-2000)}`);
}
/** The release deep-hook at the merge base: crates/deep-hook and crates/deep-contracts from BASE (git archive), built offline in a workspace of their own under target/base-1015. */
function baseDeepHook(): string {
  const dir = join(REPO, 'target', 'base-1015', BASE.slice(0, 12));
  const binary = join(dir, 'target', 'release', 'deep-hook');
  if (existsSync(binary)) return binary;
  const src = join(dir, 'src');
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  execFileSync('tar', ['-x', '-C', src], { input: execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'crates/deep-hook', 'crates/deep-contracts'], { maxBuffer: 1 << 28 }) });
  writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
  cargo(['build', '--offline', '--release', '-q', '-p', 'deep-hook', '--manifest-path', join(src, 'Cargo.toml'), '--target-dir', join(dir, 'target')], src);
  return binary;
}

describe(`${AC8} matching stays within deep-hook's budget, and with the hub stopped a matched command runs as written`, () => {
  it(`${AC8} with the hub stopped, \`${CARGO_TEST}\` runs as written within deep-hook's fail-open time, and its session's row reads "ran unleased"`, async (ctx: TestContext) => {
    const w = new World();
    await w.startHub();
    const { worktrees } = sampleRepo(w, 1);
    const s = new Session(w, 'claude', worktrees[0]!);
    try {
      await s.begin();
      await sleep(1000);
      await w.stopHub();
      w.go(s.label);
      const call = await claudeCall(s, CARGO_TEST);
      const ran = await Promise.race([call.after, sleep(120_000).then(() => undefined)]);
      console.log(`AC8 hub stopped: PreToolUse took ${call.pre.hooked.ms.toFixed(1)} ms (deep-hook's fail-open time is ${FAIL_OPEN_MS} ms), ${shownHook(call.pre.hooked)}`);
      expect(asWritten(call.pre.decision, CARGO_TEST), `with the hub stopped, the matched \`${CARGO_TEST}\` runs as written: ${shownHook(call.pre.hooked)}`).toBe(true);
      expect(ran?.code, `with the hub stopped, \`${CARGO_TEST}\` runs to its end as written`).toBe(0);
      expect(w.ended(s.label), 'the stand-in cargo ran').toBeDefined();

      // The hub again: it replays what deep-hook spooled, and the session's row says the command ran unleased.
      await w.startHub();
      let rows: string[] = [];
      const said = await until(async () => { rows = await rowsOf(w, s); return rows.some((r) => r.includes('ran unleased')); }, 90_000, 1000);
      console.log(`AC8 the session's rows after the hub came back: ${rows.join(' | ').slice(0, 1500)}`);
      expect(said, `the session's row must read "ran unleased" for \`${CARGO_TEST}\`, which ran while the hub was stopped: ${rows.join(' | ').slice(0, 1500)}`).toBe(true);

      if (call.pre.hooked.ms > FAIL_OPEN_MS) {
        const problem = environmentProblem();
        if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${problem}): PreToolUse took ${call.pre.hooked.ms.toFixed(1)} ms against ${FAIL_OPEN_MS}`);
        expect.fail(`with the hub stopped, the matched call must be decided within deep-hook's fail-open time of ${FAIL_OPEN_MS} ms; it took ${call.pre.hooked.ms.toFixed(1)} ms`);
      }
    } finally {
      s.stop();
      await w.stopHub();
    }
  }, 600_000);

  it(`${AC8} the perf lane has a task naming #1015, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string; changeReason?: string }[] };
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${BASE}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#1015\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    expect(task, 'benchmarks/budgets.json must have a task whose reason names issue #1015, timing a matched PreToolUse against the merge base').toBeDefined();
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 1_200_000);

  it(`${AC8} matching \`${CARGO_TEST}\` adds under ${LIMIT_MS} ms at p95 to a PreToolUse call, compared with the merge base's deep-hook`, async (ctx: TestContext) => {
    const problem = environmentProblem();
    if (problem) {
      console.log(`AC8 p95 added by matching: not measured: ${problem}`);
      ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
    }
    cargo(['build', '--locked', '--release', '-q', '-p', 'deep-hook'], REPO);
    const current = join(REPO, 'target', 'release', 'deep-hook');
    const base = baseDeepHook();
    // A home whose hub ran once and is stopped: each call is decided by deep-hook alone, as with no hub.
    const w = new World();
    await w.startHub();
    const s = new Session(w, 'claude', sampleRepo(w, 1).worktrees[0]!);
    try {
      await s.begin();
      await w.stopHub();
      const body = JSON.stringify({ session_id: s.id, transcript_path: join(w.home, 'none.jsonl'), cwd: s.cwd, permission_mode: 'bypassPermissions', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: CARGO_TEST }, tool_use_id: 'toolu_timed' });
      const env = s.env();
      const timed = (bin: string): number => {
        const t0 = performance.now();
        spawnSync(bin, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env, input: body, stdio: ['pipe', 'ignore', 'ignore'] });
        return performance.now() - t0;
      };
      const runs: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const now: number[] = [];
        const then: number[] = [];
        for (let c = 0; c < CALLS; c++) { now.push(timed(current)); then.push(timed(base)); }
        runs.push(p95(now) - p95(then));
      }
      console.log(`AC8 p95 added by matching, per run, against ${LIMIT_MS} ms: ${runs.map((x) => x.toFixed(3)).join(', ')} ms`);
      const late = environmentProblem();
      if (late) ctx.skip(`INCONCLUSIVE (reading only: ${late}): ${runs.map((x) => x.toFixed(3)).join(', ')} ms`);
      judge(ctx, `AC8 matching \`${CARGO_TEST}\`, p95 added to PreToolUse, ms`, runs, LIMIT_MS);
    } finally {
      s.stop();
      await w.stopHub();
    }
  }, 3_600_000);
});
