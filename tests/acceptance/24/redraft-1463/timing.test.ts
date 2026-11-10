// #24.bbe12971, its timing part, redrafted blind (README.md here): on a reference Mac in the local preflight,
// `deep inbox` lists 30 days of asks in under 300 ms, from spawning the command to its exit, five runs after a
// warm-up, judged by the design's rule for timing results (../helpers.ts, `judge`: all within, PASS; all over by more
// than the margin, FAIL; otherwise INCONCLUSIVE). Off a reference Mac, on battery, with Low Power Mode on or unknown,
// or with a thermal warning (../helpers.ts, `environmentProblem`) it is skipped as INCONCLUSIVE, never passed.
// Each run must list every open ask of the month in the design's layout, as listing.test.ts reads it: one line per
// ask, its question first and its handle last. The perf lane's task stays in ../budgets.test.ts.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { AskKind } from '../../../../packages/asks/src/index.ts';
import { askData, CLI, cleanup, DAY, deep, environmentProblem, judge, MINUTE, seed, startHub, tempDir } from '../helpers.ts';

const ID = '#24.bbe12971';
const LIMIT_MS = 300;

afterEach(cleanup, 30_000);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const KINDS: AskKind[] = ['authority', 'taste', 'choice', 'definition', 'exception'];
/**
 * A heavy month, as ../budgets.test.ts's `seedMonth` seeds it (copied here, since a test file isn't imported):
 * 30 days of 20 sessions, #16's heavy month, each raising five asks, the most a session holds before its asks fold,
 * so 3,000 asks raised through the asks core on a clock moving through the month. Each of the first 29 days' asks
 * takes its default at its deadline, a day later; the last day's 100 are open. Returns the open asks' handles, each
 * with its question.
 */
async function seedMonth(home: string): Promise<Map<string, string>> {
  const end = Date.now() - MINUTE;
  const open = new Map<string, string>();
  await seed(home, async (s) => {
    for (let d = 0; d < 30; d++) {
      const dayStart = end - (30 - d) * DAY;
      for (let n = 0; n < 20; n++) {
        const session = `D${d}S${n}`;
        let at = dayStart + n * 30 * MINUTE;
        s.at(at);
        await s.start(session);
        for (const kind of KINDS) {
          s.at((at += MINUTE));
          const subject = `${session} ${kind}`;
          const deadline = at + (d === 29 ? 3 * DAY : DAY);
          const ask = await s.raise(session, kind, subject, deadline);
          if (d === 29) open.set(ask, String(askData(kind, subject, at, deadline).question));
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

/** The open asks a run of `deep inbox` doesn't list on one line of its own, its question first and its handle last. */
function notListed(stdout: string, open: Map<string, string>): string[] {
  const lines = stdout.split('\n');
  const wrong: string[] = [];
  for (const [ask, question] of open) {
    const mine = lines.filter((line) => line.includes(ask));
    const line = mine[0] ?? '';
    const at = line.indexOf(question);
    const last = new RegExp(`${escape(ask)}(?:\\s+deepbuild://ask/${ask.slice('ask:'.length)})?\\s*$`);
    if (mine.length !== 1 || at < 0 || /[0-9A-Za-z]/.test(line.slice(0, at)) || !last.test(line)) {
      wrong.push(`${ask} (${mine.length} line${mine.length === 1 ? '' : 's'}${mine.length ? `: ${line}` : ''})`);
    }
  }
  return wrong;
}

it(`${ID} deep inbox lists 30 days of asks in under ${LIMIT_MS} ms`, async (ctx) => {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: the built CLI ${CLI} is missing; run npm run build --workspaces first`);
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const open = await seedMonth(home);
  if (open.size !== 100) throw Error(`BLOCKED: the month seeded ${open.size} open asks, not the last day's 100`);
  await startHub(home, { confirm: 'cancelled' });
  const once = async (): Promise<number> => {
    const r = await deep(home, ['inbox']);
    expect(r.code, `deep inbox exits 0: ${r.stderr}`).toBe(0);
    expect(notListed(r.stdout, open), `deep inbox lists every open ask of the month once, its question first and its handle last`).toEqual([]);
    return r.ms;
  };
  console.log(`warm-up: ${(await once()).toFixed(1)} ms (discarded)`);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) runs.push(await once());
  judge(ctx, '#24 deep inbox with 30 days of asks (ms)', runs, LIMIT_MS);
}, 600_000);
