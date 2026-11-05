// #1097 AC5: budgets, on the reference Mac in the local preflight, compared with the merge base. Matching with
// unknowns stays inside the guard engine's budget (#304): under 2 ms at p95 added to the hook path. The merge-base
// comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json): a task naming #1097, valid against
// the merge base's budgets, that runs. The 2 ms is judged here by #304's timing rule (five runs; PASS when all are
// within the limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE), on the release build,
// for AC1's `$(printf git)` push and AC2's 13-deep line, each first proven to be read as an unknown (denied). The numbers are always measured
// and printed; they count only on a reference Mac in a fit state and not loaded past its core count, and anywhere
// else the test is skipped as INCONCLUSIVE with the reading.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  AC5, bashCall, buildDeepHook, childEnv, cleanup, decision, environmentProblem, guardAdd, guardFile, hook, judge,
  makeHome, must, nested, newSession, p95, preToolUse, REPO, rootOf, seedDefaults, shown, startHub, stopHub, testEntry,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RUNS = 5;
const CALLS = 200;
const LIMIT_MS = 2;
const LINES = ['"$(printf git)" push origin main', nested('pkill node', 13)];

interface Task { id: string; command: string[]; initialReason?: string; changeReason?: string }

describe(`AC5 ${AC5} matching with unknowns stays under 2 ms at p95 on the hook path, compared with the merge base`, () => {
  it('AC5 the perf lane has a task naming #1097, valid against the merge base\'s budgets, and it runs', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#1097\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    must(task !== undefined, 'benchmarks/budgets.json must have a task whose reason names issue #1097, timing the hook path on calls with unknowns');
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 900_000);

  it('AC5 matching the computed push and the 13-deep nesting against every installed entry adds under 2 ms at p95 to the hook path', async (ctx: TestContext) => {
    const bin = await buildDeepHook({ release: true });
    const home = makeHome();
    seedDefaults(home);
    const hub = await startHub(home);
    try {
      const guard = testEntry('t-push', { match: 'effect:push', mode: 'block', fail_closed: true });
      const added = await guardAdd(home, guardFile({ 't-push': { guard, planted: bashCall('git push origin main'), twin: bashCall("echo 'git push origin main'") } }));
      must(added.code === 0, `\`deep guard add\` must install t-push, the push entry the hook path is timed with: ${shown(added)}`);

      // The same calls with no entry: a home whose rules.json is empty and whose address is this hub.
      const bare = makeHome();
      mkdirSync(rootOf(bare), { recursive: true, mode: 0o700 });
      writeFileSync(join(rootOf(bare), 'rules.json'), '{"v":1,"entries":{}}\n');
      writeFileSync(join(rootOf(bare), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
      const s = newSession(home);
      const bodies = LINES.map((line) => JSON.stringify(preToolUse(s, bashCall(line))));
      // The timed calls are read as unknowns: each is denied with every entry.
      for (const [i, body] of bodies.entries()) {
        const r = await hook(home, JSON.parse(body), bin);
        must(decision(r) === 'deny', `the timed call \`${LINES[i]}\` must be read as an unknown and denied with every entry installed: ${shown(r)}`);
      }

      const timed = (env: NodeJS.ProcessEnv, input: string): number => {
        const t0 = performance.now();
        spawnSync(bin, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env, input, stdio: ['pipe', 'ignore', 'ignore'] });
        return performance.now() - t0;
      };
      const envAll = childEnv(home);
      const envNone = childEnv(bare);
      const runs = LINES.map(() => [] as number[]);
      for (let r = 0; r < RUNS; r++) {
        bodies.forEach((body, i) => {
          const all: number[] = [];
          const none: number[] = [];
          for (let c = 0; c < CALLS; c++) {
            all.push(timed(envAll, body));
            none.push(timed(envNone, body));
          }
          runs[i]!.push(p95(all) - p95(none));
        });
      }
      const readings = LINES.map((line, i) => `${line.length > 40 ? 'sh -c 13 deep around pkill node' : line}: ${runs[i]!.map((x) => x.toFixed(2)).join(', ')} ms`).join('; ');
      console.log(`AC5 p95 added by matching, per run, against ${LIMIT_MS} ms: ${readings}`);
      const problem = environmentProblem();
      if (problem) {
        ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${readings}`);
        return;
      }
      LINES.forEach((line, i) => judge(ctx, `AC5 matching \`${line.slice(0, 40)}\` with unknowns, p95 added to the hook path, ms`, runs[i]!, LIMIT_MS));
    } finally {
      await stopHub(hub);
    }
  }, 1_800_000);
});
