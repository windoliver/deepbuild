// #16 AC12: budgets on the reference Mac in the local preflight, compared with the merge base. The
// merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): the hub's three
// tasks must be there and valid against the merge base's budgets. The issue's own numbers are judged here by
// the design's rule for timing results (five runs after a warm-up; PASS when all are within the limit, FAIL
// when all are over it by more than the margin, otherwise INCONCLUSIVE), and count only on a reference Mac
// in a fit state; anywhere else the test is skipped with the reason, never passed (as #14's budgets are).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  alive, cleanup, Conn, control, DAY, environmentProblem, fromHere, health, hookRequest, installedRoot, judge, makeHome, newSession, NODE,
  p95, REPO, run, sleep, spawnHub, startHub, stopHub, ulid, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const TASKS = { 'hub-cold-start': 'cold-start', 'hub-round-trip': 'round-trip', 'hub-idle': 'idle' } as const;
const problem = environmentProblem();

describe('AC12 #16.6034dec3 budgets, compared with the merge base in the local preflight', () => {
  it('AC12 the perf lane has the hub\'s three tasks, each a #16 first measurement, valid against the merge base\'s budgets', async () => {
    const perf = join(REPO, 'scripts/benchmark.mjs');
    const { validateBudgets } = (await import(perf)) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    const baseBudgets = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' }));
    validateBudgets(current, baseBudgets);
    for (const [id, mode] of Object.entries(TASKS)) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command, `${id} runs the hub bench in ${mode} mode`).toEqual(['node', 'benchmarks/hub.mjs', mode]);
      expect(String(task!.initialReason), `${id} says why, naming issue #16`).toMatch(/#16/);
    }
  });

  it.each(Object.values(TASKS))('AC12 `node benchmarks/hub.mjs %s` runs and exits 0', async (mode) => {
    const r = await run(NODE, [join(REPO, 'benchmarks/hub.mjs'), mode], { timeoutMs: 600_000 });
    expect(r.code, `benchmarks/hub.mjs ${mode}: ${r.stderr}`).toBe(0);
  }, 600_000);
});

describe('AC12 #16.6034dec3 the issue\'s numbers on the reference Mac', () => {
  it('AC12 cold start under 500 ms: from spawning `deep hub run` to the socket answering', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const once = async (): Promise<number> => {
      const home = makeHome();
      const socket = join(installedRoot(home), 'hub.sock');
      const t0 = performance.now();
      const proc = spawnHub({ home });
      for (;;) {
        try {
          const c = await Conn.open(socket, 1000);
          c.close();
          break;
        } catch { await new Promise((r) => setTimeout(r, 2)); }
        if (performance.now() - t0 > 10_000) throw Error(`BLOCKED: the hub didn't answer within 10 s: ${proc.stderr()}`);
      }
      const took = performance.now() - t0;
      await stopHub({ pid: proc.pid, proc });
      return took;
    };
    await once();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, 'AC12 cold start (ms)', runs, 500);
  }, 120_000);

  it('AC12 a socket round trip under 2 ms at p95: 1,000 PreToolUse requests to their replies', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const home = makeHome();
    const hub = await startHub({ home });
    const s = newSession(home, 'claude-code');
    const once = async (): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const c = await Conn.open(hub.socket);
        const from = c.received.length;
        const t0 = c.send(fromHere(hookRequest(s, 'PreToolUse')));
        const reply = await c.seek((l) => 'exit' in l, from);
        if (!reply) throw Error('BLOCKED: no reply');
        samples.push(reply.at - t0);
        c.close();
      }
      return p95(samples);
    };
    await once();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, 'AC12 round trip p95 (ms)', runs, 2);
  }, 300_000);

  it('AC12 with 30 days of history: idle CPU under 0.5% of one core and resident memory under 150 MB', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const home = makeHome();
    await seedHistory(installedRoot(home), 30);
    const hub = await startHub({ home }, 120_000);
    const cli = await control(hub);
    expect((await health(cli)).pid).toBe(hub.pid);
    cli.close();
    await sleep(15_000);   // the start's own work (retention, replay) is not idle time
    const ps = (field: string) => execFileSync('ps', ['-o', `${field}=`, '-p', String(hub.pid)], { encoding: 'utf8' }).trim();
    const cpuSeconds = () => {
      const [rest, frac = '0'] = ps('time').split('.');
      const parts = rest!.split(':').map(Number);
      const whole = parts.reduce((acc, p) => acc * 60 + p, 0);
      return whole + Number(`0.${frac}`);
    };
    const cpu: number[] = [];
    const rss: number[] = [];
    for (let i = 0; i < 5; i++) {
      const c0 = cpuSeconds();
      const t0 = performance.now();
      await sleep(20_000);
      cpu.push(((cpuSeconds() - c0) / ((performance.now() - t0) / 1000)) * 100);
      rss.push(Number(ps('rss')) * 1024 / 1e6);
    }
    expect(alive(hub.pid)).toBe(true);
    await stopHub(hub);
    judge(ctx, 'AC12 idle CPU (% of one core)', cpu, 0.5);
    judge(ctx, 'AC12 resident memory (MB)', rss, 150);
  }, 600_000);
});

/** 30 days of heavy use in the hub's ledger, through the record (#14): 20 sessions a day of ten turns, about 3,000 events a day. */
async function seedHistory(root: string, days: number): Promise<void> {
  const end = Date.now() - 60_000;
  let now = end - days * DAY;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  for (let d = 0; d < days; d++) {
    const dayStart = end - (days - d) * DAY;
    for (let s = 0; s < 20; s++) {
      const session = `${ulid(dayStart)}`;
      let at = dayStart + s * 600_000;
      now = at;
      const pending: Promise<unknown>[] = [];
      pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } }));
      for (let t = 0; t < 10; t++) {
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
        for (let k = 0; k < 13; k++) {
          at += 1000;
          const kind = k % 2 === 0 ? 'tool.before' : 'tool.after';
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind, ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
        }
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } }));
      }
      await Promise.all(pending);
    }
  }
  await record.close();
}
