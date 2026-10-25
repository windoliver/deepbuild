// #24.bbe12971: budgets, on the reference Mac in the local preflight, compared with the merge base: `deep inbox`
// lists 30 days of asks in under 300 ms. What it lists is checked anywhere: each open ask once, with its kind,
// session and age, and no closed one. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #16 and #319 left it. The 300 ms is judged by the design's rule for timing results
// (five runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the
// margin, otherwise INCONCLUSIVE), and counts only on a reference Mac on mains power, Low Power Mode off and no
// thermal warning; anywhere else the test is skipped with the reason, never passed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AskKind } from '../../../packages/asks/src/index.ts';
import {
  cleanup, DAY, deep, environmentProblem, HOUR, judge, listed, MINUTE, NODE, REPO, run, seed, startHub, tempDir,
} from './helpers.ts';

afterEach(cleanup, 30_000);

const problem = environmentProblem();
const TASK = 'deep-inbox-30d';
const home = (): string => {
  const dir = join(tempDir(), 'h');
  mkdirSync(dir);
  return dir;
};

describe('#24.bbe12971 deep inbox lists the open asks', () => {
  it('#24.bbe12971 deep inbox lists each open ask once, with its kind, session and age, and no closed ask', async () => {
    const h = home();
    const now = Date.now();
    const open: { ask: string; kind: string; session: string; age: string }[] = [];
    let closed = '';
    await seed(h, async (s) => {
      s.at(now - 2 * DAY - 3 * HOUR);
      await s.start('S1');
      open.push({ ask: await s.raise('S1', 'taste', 'the header', now + DAY), kind: 'taste', session: 'S1', age: '2d' });
      s.at(now - 3 * HOUR - 5 * MINUTE);
      await s.start('S2');
      open.push({ ask: await s.raise('S2', 'authority', 'feature/login', now + 20 * HOUR), kind: 'authority', session: 'S2', age: '3h' });
      s.at(now - 5 * MINUTE - 30_000);
      await s.start('S3');
      open.push({ ask: await s.raise('S3', 'definition', 'offline mode', now + 4 * HOUR), kind: 'definition', session: 'S3', age: '5m' });
      closed = await s.raise('S3', 'choice', 'the store', now + DAY);
      await s.answerOnCard(closed, 'files');
    }, now - 2 * DAY - 3 * HOUR);
    await startHub(h, { confirm: 'cancelled' });
    const r = await deep(h, ['inbox']);
    expect(r.code, `deep inbox exits 0: ${r.stderr}`).toBe(0);
    const rows = listed(r.stdout);
    for (const want of open) {
      expect(rows.filter((row) => row.ask === want.ask), `deep inbox lists the open ${want.kind} ask ${want.ask} once, with its kind, session and age:\n${r.stdout}`).toEqual([want]);
    }
    expect(rows.map((row) => row.ask), `deep inbox doesn't list ${closed}, answered on the card`).not.toContain(closed);
  }, 120_000);
});

describe('#24.bbe12971 budgets, compared with the merge base in the local preflight', () => {
  it(`#24.bbe12971 the perf lane has the task ${TASK}, a #24 first measurement, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
    expect(String(task!.initialReason), `${TASK} says why, naming issue #24`).toMatch(/#24\b/);
    const [command, ...args] = task!.command;
    const r = await run(command === 'node' ? NODE : command!, args, { timeoutMs: 600_000 });
    expect(r.code, `${task!.command.join(' ')} exits 0: ${r.stderr}`).toBe(0);
  }, 600_000);

  it('#24.bbe12971 deep inbox lists 30 days of asks in under 300 ms', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const h = home();
    const open = await seedMonth(h);
    await startHub(h, { confirm: 'cancelled' });
    const once = async (): Promise<number> => {
      const r = await deep(h, ['inbox']);
      expect(r.code, `deep inbox exits 0: ${r.stderr}`).toBe(0);
      const shown = new Set(listed(r.stdout).map((row) => row.ask));
      expect([...open].filter((ask) => !shown.has(ask)), 'deep inbox lists every open ask of the month').toEqual([]);
      return r.ms;
    };
    console.log(`warm-up: ${(await once()).toFixed(1)} ms (discarded)`);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    judge(ctx, '#24 deep inbox with 30 days of asks (ms)', runs, 300);
  }, 600_000);
});

const KINDS: AskKind[] = ['authority', 'taste', 'choice', 'definition', 'exception'];
/**
 * A heavy month (README: Criterion 3): 30 days of 20 sessions, as #16's 30 days of heavy use has, each raising
 * five asks, the most a session holds before its asks fold (the fold drafted at setup), so 3,000 asks raised
 * through the asks core on a clock moving through the month. Each of the first 29 days' asks takes its default at
 * its deadline, a day later; the last day's are open. Returns the open asks' handles.
 */
async function seedMonth(h: string): Promise<Set<string>> {
  const end = Date.now() - MINUTE;
  const open = new Set<string>();
  await seed(h, async (s) => {
    for (let d = 0; d < 30; d++) {
      const dayStart = end - (30 - d) * DAY;
      for (let n = 0; n < 20; n++) {
        const session = `D${d}S${n}`;
        let at = dayStart + n * 30 * MINUTE;
        s.at(at);
        await s.start(session);
        for (const kind of KINDS) {
          s.at((at += MINUTE));
          const ask = await s.raise(session, kind, `${session} ${kind}`, at + (d === 29 ? 3 * DAY : DAY));
          if (d === 29) open.add(ask);
        }
      }
      s.at(dayStart + DAY);
      await s.asks.tick();
    }
    s.at(end);
    await s.asks.tick();
  }, end - 30 * DAY);
  return open;
}
