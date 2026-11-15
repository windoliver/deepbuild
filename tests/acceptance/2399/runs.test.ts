// #2399 AC4: a refusal recorded for one run doesn't hide the same operation and target for a second run beside it,
// and the first refusal of a run started after another ended is recorded. A planted supervisor that keeps the set
// without the run records none for the second run and fails, naming the run. Two runs beside each other are two
// worktrees of one test repo, each brought up by `deep env up` on the same hub: each stack is a run of its own with
// a filter of its own. The same request, `GET http://dh2399-same.invalid/`, goes to each run's filter port. Then
// the first worktree's stack is taken down (`deep env down`), which ends its run, and brought up again: a third run,
// started after the first ended, sent the same request.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, type Up, upWorld } from '../1106/helpers.ts';
import { type Denied, denied, down, downAll, filterOf, gained, names, plain, secondWorktree, settled, show, up } from './helpers.ts';

afterEach(cleanup, 60_000);

const HOST = 'dh2399-same.invalid';
const PLANT = 'egress-refusals-seen-without-run';

/** AC4's reading of one run: null when the record gained exactly one egress-plain-http for it naming the host. */
function runProblem(which: string, run: string, now: Denied[]): string | null {
  const ours = now.filter(names('egress-plain-http', HOST));
  if (ours.length === 0) return `no sandbox.denied is recorded for ${which} run ${run} with the operation egress-plain-http and the target ${HOST}, its filter having refused that request (the record gained ${show(now)} for it)`;
  if (ours.length !== 1) return `${which} run ${run} has ${ours.length} sandbox.denied events for one refused request, not one`;
  return null;
}

interface Scene { u: Up; worktrees: string[]; runs: string[]; answers: (number | string)[]; marked: boolean[]; problems: string[] }
async function scenario(plant?: string): Promise<Scene> {
  const u = await upWorld(plant);
  const s: Scene = { u, worktrees: [u.wt], runs: [u.run], answers: [], marked: [], problems: [] };
  const wait = plant ? 10_000 : 60_000;
  const wtB = secondWorktree(u.wt);
  s.worktrees.push(wtB);
  const b = await up(u.hub, wtB);
  s.runs.push(b.run);
  expect(b.run, 'the second worktree\'s stack is a run of its own').not.toBe(u.run);
  const fA = await filterOf(u.port);
  const fB = await filterOf(b.port);
  expect(fB.port, 'and has a filter port of its own').not.toBe(fA.port);

  // The first run, then the second beside it: the same operation and target.
  const startA = await denied(u.client, u.run);
  const startB = await denied(u.client, b.run);
  s.answers.push(await plain(fA, HOST));
  s.marked.push(await settled(u.client, fA, u.run, wait));
  s.answers.push(await plain(fB, HOST));
  s.marked.push(await settled(u.client, fB, b.run, wait));
  const first = runProblem('the first', u.run, gained(startA, await denied(u.client, u.run)));
  const second = runProblem('the second', b.run, gained(startB, await denied(u.client, b.run)));

  // A run started after another ended: the first worktree's stack down, then up again.
  expect(await down(u.hub, u.wt), '`deep env down` in the first worktree exits 0').toBe(0);
  const c = await up(u.hub, u.wt);
  s.runs.push(c.run);
  expect([u.run, b.run], 'the stack brought up after the first ended is a new run').not.toContain(c.run);
  const fC = await filterOf(c.port);
  const startC = await denied(u.client, c.run);
  s.answers.push(await plain(fC, HOST));
  s.marked.push(await settled(u.client, fC, c.run, wait));
  const third = runProblem('the later', c.run, gained(startC, await denied(u.client, c.run)));
  s.problems = [first, second, third].filter((p): p is string => p !== null);
  return s;
}

describe('AC4 #2399.d19e2d85 a refusal recorded for one run doesn\'t hide the same operation and target for a second run beside it, and the first refusal of a run started after another ended is recorded; a planted supervisor that keeps the set without the run records none for the second run and fails, naming the run', () => {
  it('AC4 the same refused request sent to the filters of two runs beside each other, and to a run started after the first ended, leaves one sandbox.denied for each run', async () => {
    let s: Scene | undefined;
    try {
      s = await scenario();
      expect(s.answers, 'each run\'s filter answers the request 403').toEqual([403, 403, 403]);
      expect(s.marked, 'a refusal of a target not seen before, sent to each run after it, is in the record').toEqual([true, true, true]);
      expect(s.problems).toEqual([]);
    } finally {
      await downAll(s?.u, s?.worktrees ?? []);
    }
  }, 600_000);

  it(`AC4 (wrong program) a supervisor that keeps the set without the run (DEEP_HUB_PLANT=${PLANT}) fails the reading, naming the second run`, async () => {
    let s: Scene | undefined;
    try {
      s = await scenario(PLANT);
      expect(s.problems.length, 'the reading passes on a supervisor that records nothing for the second run').toBeGreaterThan(0);
      expect(s.problems.join(' | '), 'and names that run').toContain(`no sandbox.denied is recorded for the second run ${s.runs[1]}`);
    } finally {
      await downAll(s?.u, s?.worktrees ?? []);
    }
  }, 600_000);
});
