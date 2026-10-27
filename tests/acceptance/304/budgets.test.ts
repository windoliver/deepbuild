// #304 AC8: budgets, on the reference Mac in the local preflight, compared with the merge base. Matching every
// installed entry adds under 2 ms at p95 to the hook path, inside deep-hook's hook overhead budget of 10 ms at p95 on
// top of process start (#17); checking one entry's planted call and twin at install runs the check mode twice, each
// inside that budget. The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json):
// a task naming #304, valid against the merge base's budgets, that runs. The issue's numbers are judged here by the
// timing rule of #315's suite (five runs; PASS when all are within the limit, FAIL when all are over it by more than
// the margin, otherwise INCONCLUSIVE). Before any number is read, the measured calls are proven to be the ones the
// criterion names. The numbers are always measured and printed; they count only on a reference Mac in a fit state
// and not loaded past its core count, and anywhere else the test is skipped as INCONCLUSIVE with the reading.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  AC8, bashCall, buildDeepHook, buildNoop, check, checked, childEnv, cleanup, decision, environmentProblem, guardAdd,
  guardFile, holds, hook, judge, makeHome, must, newSession, p95, preToolUse, readRules, REPO, rootOf, seedDefaults,
  shown, startHub, stopHub, testEntry, type Guard, type Proof,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RUNS = 5;
const CALLS = 400;
const MATCH_LIMIT_MS = 2;
const OVERHEAD_LIMIT_MS = 10;
const ENTRIES = 20;

interface Task { id: string; command: string[]; initialReason?: string; changeReason?: string }

describe(`AC8 ${AC8} budgets on the reference Mac in the local preflight, compared with the merge base`, () => {
  it('AC8 the perf lane has a task naming #304, valid against the merge base\'s budgets, and it runs', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#304\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    must(task !== undefined, 'benchmarks/budgets.json must have a task whose reason names issue #304, timing the hook path with every installed entry and the check mode');
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 900_000);

  it('AC8 matching every installed entry adds under 2 ms at p95 to the hook path, inside 10 ms over process start; check mode on a planted call and on its twin each run inside 10 ms', async (ctx: TestContext) => {
    const [bin, noop] = await Promise.all([buildDeepHook({ release: true }), buildNoop()]);

    // Every installed entry: the shipped defaults and ENTRIES entries of yours, installed through the hub.
    const home = makeHome();
    seedDefaults(home);
    const mine: Record<string, { guard: Guard } & Proof> = {};
    for (let i = 0; i < ENTRIES; i++) {
      mine[`t-tool${i}`] = { guard: testEntry(`t-tool${i}`, { match: `run:tool${i} apply` }), planted: bashCall(`tool${i} apply`), twin: bashCall(`tool${i} plan`) };
    }
    const hub = await startHub(home);
    try {
      const added = await guardAdd(home, guardFile(mine));
      must(added.code === 0, `\`deep guard add\` must install the ${ENTRIES} entries the hook path is timed with: ${shown(added)}`);
      const rules = readRules(home);
      const missing = Object.entries(mine).filter(([n, e]) => !holds(rules, n, e.guard)).map(([n]) => n);
      must(!missing.length, `rules.json must hold every installed entry; missing ${missing.join(', ')}`);

      // The check mode the install runs, proven on one entry's planted call and twin before it is timed.
      const one = mine['t-tool0']!;
      const planted = await check(home, one.guard, one.planted, { binary: bin });
      const twin = await check(home, one.guard, one.twin, { binary: bin });
      must(checked(planted) === true, `\`deep-hook check\` must say t-tool0 matches its planted call \`tool0 apply\`, printing {"matched":true}: ${shown(planted)}`);
      must(checked(twin) === false, `\`deep-hook check\` must say t-tool0 doesn't match its twin \`tool0 plan\`, printing {"matched":false}: ${shown(twin)}`);

      // The same call with no entry: a home whose rules.json is empty and whose address is this hub.
      const bare = makeHome();
      mkdirSync(rootOf(bare), { recursive: true, mode: 0o700 });
      writeFileSync(join(rootOf(bare), 'rules.json'), '{"v":1,"entries":{}}\n');
      writeFileSync(join(rootOf(bare), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
      const s = newSession(home);
      const body = JSON.stringify(preToolUse(s, bashCall('ls')));
      const withAll = await hook(home, JSON.parse(body), { binary: bin });
      const withNone = await hook(bare, JSON.parse(body), { binary: bin });
      must(decision(withAll) === 'allow' && decision(withNone) === 'allow', `the timed call, ls, is allowed with every entry and with none: ${shown(withAll)} / ${shown(withNone)}`);

      // RUNS runs of CALLS calls each, interleaved: the floor, the hook path with every entry and with none, and check mode twice.
      const timed = (command: string, args: string[], env: NodeJS.ProcessEnv, input: string): number => {
        const t0 = performance.now();
        spawnSync(command, args, { cwd: s.cwd, env, input, stdio: ['pipe', 'ignore', 'ignore'] });
        return performance.now() - t0;
      };
      const envAll = childEnv(home);
      const envNone = childEnv(bare);
      const plantedIn = JSON.stringify({ entry: one.guard, call: one.planted });
      const twinIn = JSON.stringify({ entry: one.guard, call: one.twin });
      const runs = { match: [] as number[], hook: [] as number[], checkPlanted: [] as number[], checkTwin: [] as number[] };
      for (let r = 0; r < RUNS; r++) {
        const t = { floor: [] as number[], all: [] as number[], none: [] as number[], planted: [] as number[], twin: [] as number[] };
        for (let i = 0; i < CALLS; i++) {
          t.floor.push(timed(noop, [], envAll, ''));
          t.all.push(timed(bin, ['claude-code', 'PreToolUse'], envAll, body));
          t.none.push(timed(bin, ['claude-code', 'PreToolUse'], envNone, body));
          t.planted.push(timed(bin, ['check'], envAll, plantedIn));
          t.twin.push(timed(bin, ['check'], envAll, twinIn));
        }
        runs.match.push(p95(t.all) - p95(t.none));
        runs.hook.push(p95(t.all) - p95(t.floor));
        runs.checkPlanted.push(p95(t.planted) - p95(t.floor));
        runs.checkTwin.push(p95(t.twin) - p95(t.floor));
      }
      const readings = `matching every entry ${runs.match.map((x) => x.toFixed(2)).join(', ')} ms against ${MATCH_LIMIT_MS}; hook path over the floor ${runs.hook.map((x) => x.toFixed(2)).join(', ')} ms, check planted ${runs.checkPlanted.map((x) => x.toFixed(2)).join(', ')} ms, check twin ${runs.checkTwin.map((x) => x.toFixed(2)).join(', ')} ms, each against ${OVERHEAD_LIMIT_MS}`;
      console.log(`AC8 p95 readings per run: ${readings}`);
      const problem = environmentProblem();
      if (problem) {
        ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${readings}`);
        return;
      }
      judge(ctx, 'AC8 matching every installed entry, p95 added to the hook path, ms', runs.match, MATCH_LIMIT_MS);
      judge(ctx, 'AC8 the hook path with every entry, p95 over a native no-op, ms', runs.hook, OVERHEAD_LIMIT_MS);
      judge(ctx, 'AC8 check mode on the planted call, p95 over a native no-op, ms', runs.checkPlanted, OVERHEAD_LIMIT_MS);
      judge(ctx, 'AC8 check mode on the twin, p95 over a native no-op, ms', runs.checkTwin, OVERHEAD_LIMIT_MS);
    } finally {
      await stopHub(hub);
    }
  }, 1_800_000);
});
