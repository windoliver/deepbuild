// #34 AC8: budgets on the reference Mac in the local preflight, compared with the merge base. The merge-base
// comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16's budgets are: #34's
// two tasks must be there and valid against the merge base's budgets. The issue's own numbers are judged here
// by #16's rule for timing results (five runs after a warm-up: PASS when all are within the limit, FAIL when
// all are over it by more than the margin, INCONCLUSIVE otherwise), and count only on a reference Mac; on any
// other machine each is skipped as INCONCLUSIVE, never passed. Power isn't gated on: a reading on battery that
// lands over the limit by less than the margin is INCONCLUSIVE by the same rule.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  asApp, cleanup, Confirmer, confirmEnv, Conn, DAY, framesOf, fromHere, hookRequest, installedRoot, judge, logEnd, makeHome, newSession, NODE,
  notReferenceMac, p95, REPO, result, run, startHub, ulid, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const TASKS = { 'hub-stream': 'stream', 'hub-history': 'history' } as const;
const problem = notReferenceMac();

describe('AC8 #34.c677f0f1 budgets, compared with the merge base in the local preflight', () => {
  it('AC8 the perf lane has #34\'s two tasks, each a #34 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const [id, mode] of Object.entries(TASKS)) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command, `${id} runs the hub bench in ${mode} mode`).toEqual(['node', 'benchmarks/hub.mjs', mode]);
      expect(String(task!.initialReason), `${id} says why, naming issue #34`).toMatch(/#34/);
    }
  });

  it.each(Object.values(TASKS))('AC8 `node benchmarks/hub.mjs %s` runs and exits 0', async (mode) => {
    const r = await run(NODE, [join(REPO, 'benchmarks/hub.mjs'), mode], { timeoutMs: 600_000 });
    expect(r.code, `benchmarks/hub.mjs ${mode}: ${r.stderr}`).toBe(0);
  }, 600_000);
});

describe('AC8 #34.c677f0f1 the issue\'s numbers on the reference Mac', () => {
  it('AC8 the live stream delivers an event to the app within 50 ms at p95: 1,000 hooks, each from its request written to the app\'s frame read', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const hub = await startHub({ home: makeHome(), env: confirmEnv(new Confirmer()) });
    const app = await asApp(hub);
    const from = app.received.length;
    const reply = await app.call('stream.subscribe', { after: await logEnd(app) });
    expect(reply.result?.start, 'the stream\'s first frame carries the start ID').toBe(hub.start);
    const sub = reply.id as string;
    const s = newSession(hub.home, 'claude-code');
    const once = async (): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const request = fromHere(hookRequest(s, 'PreToolUse'));
        const hookConn = await Conn.open(hub.socket);
        const t0 = hookConn.send(request);
        const frame = await app.seek((l) => l.id === sub && l.event?.id === request.id, from, 10_000);
        hookConn.close();
        if (!frame) throw Error(`BLOCKED: no frame for hook ${request.id}`);
        samples.push(frame.at - t0);
      }
      return p95(samples);
    };
    await once();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    expect(framesOf(app, sub, from).frames.length, 'every hook\'s event reached the app').toBe(6000);
    judge(ctx, 'AC8 stream delivery p95 (ms)', runs, 50);
  }, 600_000);

  it('AC8 30 days of history page in under 300 ms: the app pages the whole log through events.read, from 0 to the log_pos its last read reflects', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const home = makeHome();
    const seeded = await seedHistory(installedRoot(home), 30);
    const hub = await startHub({ home, env: confirmEnv(new Confirmer()) }, 120_000);
    const app = await asApp(hub);
    await waitFor(async () => (await logEnd(app)) >= seeded, 60_000, 'the seeded history');
    const once = async (): Promise<number> => {
      const t0 = performance.now();
      let after = 0;
      let count = 0;
      for (;;) {
        const page = result(await app.call('events.read', { after, limit: 10_000 }, 30_000));
        if (page.start !== hub.start) throw Error(`BLOCKED: events.read carries no start ID: ${JSON.stringify(page.start)}`);
        const events = page.events as Line[];
        count += events.length;
        if (!events.length) break;
        after = page.log_pos as number;
      }
      const took = performance.now() - t0;
      if (count < seeded) throw Error(`BLOCKED: paged ${count} events of ${seeded}`);
      return took;
    };
    await once();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, 'AC8 30 days of history paged in (ms)', runs, 300);
  }, 900_000);
});

/** 30 days of heavy use in the ledger, through the record (#14), as #16's budgets seed it: about 3,000 events a day. */
async function seedHistory(root: string, days: number): Promise<number> {
  const end = Date.now() - 60_000;
  let now = end - days * DAY;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  let count = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  for (let d = 0; d < days; d++) {
    const dayStart = end - (days - d) * DAY;
    for (let s = 0; s < 20; s++) {
      const session = ulid(dayStart);
      let at = dayStart + s * 600_000;
      now = at;
      const pending: Promise<unknown>[] = [];
      pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } }));
      for (let t = 0; t < 10; t++) {
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
        for (let k = 0; k < 13; k++) {
          at += 1000;
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: k % 2 === 0 ? 'tool.before' : 'tool.after', ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
        }
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } }));
      }
      count += pending.length;
      await Promise.all(pending);
    }
  }
  await record.close();
  return count;
}
