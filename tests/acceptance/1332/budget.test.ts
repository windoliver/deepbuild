// AC9: a blocker whose change landed with only a budget window's requirement open, its issue still open naming that
// requirement, is done for its dependents: they start, and don't wait for the window.
import { expect, test } from 'vitest';
import { checkFile, iso, MIN, must, mustFail, named, requirement, sleep, waitUntil, World, type Ran } from './helpers.ts';

const BLOCKER = 100;
const DEPENDENTS = [101, 102];
const SCOPE = 'work through #100, #101 and #102 with Claude Code, two at a time';
const BUDGET = 'p95 of checkout under 5 ms on the reference Mac';

/** The run until #100's change lands: it holds a check and a requirement only the scheduled budget window settles. */
async function scene(plant?: string): Promise<{ w: World; asked: Ran }> {
  const w = await World.open({
    issues: [{ requirements: [requirement('R1', 'the shop does 100', checkFile(BLOCKER)), requirement('R2', BUDGET, null, { settled_by: 'budget-window' })] }, { blockedBy: [BLOCKER] }, { blockedBy: [BLOCKER] }],
    // The dependents start and wait: they need not land.
    plan: Object.fromEntries(DEPENDENTS.map((n) => [n, { launches: ['gated' as const] }])),
    ...(plant ? { plant } : {}),
  });
  const asked = await w.run(SCOPE);
  if (asked.code !== 0) return { w, asked };
  await w.approve(asked);
  await waitUntil(() => w.merged(BLOCKER), 30 * MIN, 2000);
  await sleep(5000);
  return { w, asked };
}

/** The judgement: each dependent starts within 5 minutes of its blocker's change landing. */
async function dependentsStart(w: World): Promise<void> {
  const landed = w.landedAt(BLOCKER)!;
  for (const d of DEPENDENTS) {
    const start = await waitUntil(() => w.on(d)[0], Math.max(0, landed + 5 * MIN - Date.now()), 1000);
    must(start !== undefined, `#${d} never started, though its blocker #${BLOCKER} landed at ${iso(landed)} with only the budget window's requirement open: it waits for the window`);
  }
}

test(named(9), async () => {
  const { w, asked } = await scene();
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  expect(w.merged(BLOCKER), `#${BLOCKER}'s change lands with only the budget window's requirement open`).toBe(true);
  expect(w.state(BLOCKER), `#${BLOCKER} stays open`).toBe('open');
  expect(w.issueText(BLOCKER), `#${BLOCKER} names the requirement the window settles`).toContain(BUDGET);
  await dependentsStart(w);

  const planted = await scene('waits-for-budget-window');
  expect(planted.asked.code, `the planted run's approval: exit ${planted.asked.code}`).toBe(0);
  expect(planted.w.merged(BLOCKER) && planted.w.state(BLOCKER) === 'open', `in the planted run too, #${BLOCKER} lands and stays open`).toBe(true);
  await mustFail('a run that keeps the dependents waiting for the window', () => dependentsStart(planted.w), [`#${DEPENDENTS[0]}`, `#${BLOCKER}`]);
}, 90 * MIN);
