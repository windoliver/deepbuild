// #572 AC4 (README, Budgets): on the reference Mac in the local preflight, compared with the merge base, hook replies
// stay within the hook overhead budget (under 10 ms at p95 on top of process start, the design's Numbers) while
// `deep backup` copies a 1 GB record. The issue's number is judged here by the design's rule for timing results
// (five runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin,
// otherwise INCONCLUSIVE) and counts only on a reference Mac in a fit state; anywhere else the test is skipped with
// an INCONCLUSIVE reason, never passed. "Compared with the merge base" is the perf lane's, as #16's AC12 reads it: a
// task in benchmarks/budgets.json whose initialReason names #572, valid against the merge base's budgets.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  REPO, backup, backupFolder, bashCall, buildDeepHook, cleanup, decision, deep, environmentProblem, hook, installDefaultRules, judge,
  makeHome, newSession, p95, run, shown, startHub, stopHub, ulid, walk, type Home, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LIMIT_MS = 10;
const GIGABYTE = 1_000_000_000;
/** Hook calls timed per run, every one while a `deep backup` of the 1 GB record runs. */
const CALLS = 200;
const RELEASE_HOOK = join(REPO, 'target/release/deep-hook');
/** The floor: a native program that does nothing, so what's left is deep-hook's overhead on top of process start. */
const FLOOR = '/usr/bin/true';

/** The record grown past 1 GB through @deepbuild/record, with the hub stopped: one session's shell calls, ~7 KB each. */
async function seedGigabyte(h: Home): Promise<void> {
  const path = join(h.root, 'ledger.db');
  let now = Date.now() - 86_400_000;
  const record = await openRecord({ path, now: () => now });
  const session = ulid(now);
  const conn = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  const words = 'npm test -- src/cart/checkout.test.ts --reporter verbose --coverage ';
  const command = words.repeat(Math.floor(7000 / words.length));
  const size = () => ['ledger.db', 'ledger.db-wal'].reduce((n, f) => n + (existsSync(join(h.root, f)) ? statSync(join(h.root, f)).size : 0), 0);
  let n = 0;
  try {
    await record.append(conn, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } });
    while (size() < GIGABYTE) {
      const batch: Promise<unknown>[] = [];
      for (let i = 0; i < 2000; i++) {
        now += 5;
        batch.push(record.append(conn, { v: 1, id: ulid(now), kind: i % 2 ? 'tool.after' : 'tool.before', ts: now, seq: (BigInt(now) * 1_000_000n + BigInt(++n % 1_000_000)).toString(), data: { kind: 'shell', paths: [], command: `${command}${n}` } }));
      }
      await Promise.all(batch);
      await record.sync();
    }
  } finally {
    await record.close();
  }
}

describe('AC4 #572.3213724a budgets on the reference Mac in the local preflight, compared with the merge base: during a backup of a 1 GB record, hook replies stay within the hook overhead budget', () => {
  it('AC4 the perf lane has a #572 task, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    const baseBudgets = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })) as unknown;
    validateBudgets(current, baseBudgets);
    const ours = current.tasks.filter((t) => /#572\b/.test(String(t.initialReason ?? '')) || /#572\b/.test(String(t.reason ?? '')));
    expect(ours.map((t) => t.id), 'benchmarks/budgets.json has a task for hook replies during a backup, naming issue #572').not.toEqual([]);
  });

  it(`AC4 while \`deep backup\` copies a 1 GB record, deep-hook's PreToolUse replies cost under ${LIMIT_MS} ms at p95 on top of process start (five runs of ${CALLS} calls after a warm-up)`, async (ctx) => {
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const h = makeHome();
    installDefaultRules(h);
    // The command exists before an hour goes into seeding: a small backup first.
    const probe = await startHub(h);
    await backup(h, backupFolder(h, 'probe'));
    await stopHub(probe);
    await seedGigabyte(h);
    await buildDeepHook(true);
    const hub = await startHub(h, { timeoutMs: 900_000 });
    try {
      const s = newSession(h);
      const body = bashCall(s, 'ls');
      const once = async (): Promise<{ hook: number; floor: number }> => {
        const f = await run(FLOOR, [], { timeoutMs: 30_000 });
        if (f.code !== 0) throw Error(`BLOCKED: the floor ${FLOOR} exited ${f.code}`);
        const r = await hook(h, s, body, RELEASE_HOOK);
        if (decision(r) !== 'allow' || r.code !== 0) throw Error(`deep-hook must allow \`ls\` and exit 0 during the backup: ${shown(r)}`);
        return { hook: r.ms, floor: f.ms };
      };
      for (let i = 0; i < 20; i++) await once();   // warm-up: a new binary's first launches are slow on macOS
      const runs: number[] = [];
      for (let k = 0; k < 6; k++) {
        const hooks: number[] = [];
        const floors: number[] = [];
        let n = 0;
        while (hooks.length < CALLS) {
          const folder = backupFolder(h, `run-${k}-${n++}`);
          let running = true;
          const copying = deep(h, ['backup', folder], { timeoutMs: 1_800_000 }).finally(() => { running = false; });
          while (running && hooks.length < CALLS) {
            const t = await once();
            if (!running) break;   // only calls answered while the backup ran count
            hooks.push(t.hook);
            floors.push(t.floor);
          }
          const r = await copying;
          if (r.code !== 0) throw Error(`\`deep backup\` of the 1 GB record must exit 0: ${shown(r)}`);
          rmSync(folder, { recursive: true, force: true });
        }
        if (k > 0) runs.push(p95(hooks) - p95(floors));   // the first run is the warm-up
      }
      const spooled = walk(join(h.root, 'spool')).filter((p) => readFileSync(p, 'utf8').includes(s.id));
      expect(spooled, 'no timed call failed open into the spool: each reply came from the hub').toEqual([]);
      judge(ctx, `AC4 p95 hook overhead during a 1 GB backup over ${FLOOR}, ms, per run`, runs, LIMIT_MS);
    } finally {
      await stopHub(hub);
    }
  }, 7_200_000);
});
