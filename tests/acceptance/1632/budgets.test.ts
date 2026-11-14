// #1632.c4de6dbc Budget, on the reference Mac in the local preflight, compared with the merge base: no change to a
// bound call's p95.
// A bound call is a deep_open_item from a deep mcp bound to its session at its hello (no clear), the call every
// session makes. Five rounds alternate this tree and the merge base's built tree (DEEP_1632_BASE_TREE, invented here),
// each round a fresh world with 20 untimed calls and then 40 timed ones; each round's p95 is paired with the base's
// and judged by the design's timing rule (helpers.ts, judgeAgainstBase). Off a reference Mac (Mac15,7 or Mac15,12),
// on battery, Low Power Mode on or unknown, or with a thermal warning, or with no merge-base tree given, it is skipped
// as INCONCLUSIVE with the reason, never passed.

import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { cleanup, environmentProblem, HERE, judgeAgainstBase, p95, REPO, treeAt, valueOf, word, world, type Tree } from './helpers.ts';

afterEach(cleanup, 30_000);

const problem = environmentProblem();
const BASE = process.env.DEEP_1632_BASE_TREE;

it('#1632.c4de6dbc on the reference Mac, a bound deep_open_item\'s p95 is unchanged from the merge base\'s', async (ctx) => {
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
  if (!BASE) ctx.skip('INCONCLUSIVE: no merge-base tree; set DEEP_1632_BASE_TREE to a built checkout of `git merge-base HEAD origin/main` with its own node_modules');
  const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  const baseHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BASE, encoding: 'utf8' }).trim();
  expect(baseHead, `DEEP_1632_BASE_TREE ${BASE} is at the merge base`).toBe(mergeBase);
  const base = treeAt(BASE!);
  const term = word();
  const round = async (tree: Tree): Promise<number> => {
    const w = await world({ tree });
    const ms: number[] = [];
    for (let i = 0; i < 60; i++) {
      const o = await w.agent.call('deep_open_item', { text: `budget item ${i} for ${term}` });
      valueOf(o, `deep_open_item #${i} from ${tree.root}`);
      if (i >= 20) ms.push(o.ms);
    }
    await cleanup();
    return p95(ms);
  };
  await round(HERE);
  await round(base);
  const here: number[] = [];
  const then: number[] = [];
  for (let i = 0; i < 5; i++) {
    here.push(await round(HERE));
    then.push(await round(base));
  }
  judgeAgainstBase(ctx, '#1632 bound deep_open_item p95', here, then);
}, 900_000);
