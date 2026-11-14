// AC1: one approval runs six issues with seven blocked-by links to the end, with no app running, and no issue starts
// before every issue it is blocked by is done (landed on its own PASS).
import { expect, test } from 'vitest';
import { asksBesides, iso, MIN, must, mustFail, named, waitUntil, World, type IssueSpec } from './helpers.ts';

const SET = [100, 101, 102, 103, 104, 105];
/** The seven links, blocker first. */
const LINKS: [number, number][] = [[100, 102], [100, 103], [101, 103], [102, 104], [103, 104], [101, 105], [104, 105]];
const ISSUES: IssueSpec[] = SET.map((n) => ({ blockedBy: LINKS.filter(([, d]) => d === n).map(([b]) => b) }));
const SCOPE = 'work through #100, #101, #102, #103, #104 and #105 with Claude Code, two at a time';

/** Each start of a played agent on an issue that came before the merge that landed one of its blockers. */
function earlyStarts(w: World): { issue: number; blocker: number; at: number; landed: number | undefined }[] {
  const out = [];
  for (const l of w.launches()) {
    for (const [b, d] of LINKS) {
      if (l.issue !== d) continue;
      const landed = w.landedAt(b);
      if (landed === undefined || l.started < landed) out.push({ issue: d, blocker: b, at: l.started, landed });
    }
  }
  return out;
}
/** The judgement: no issue started before its blockers were done. */
function judgeOrder(w: World): void {
  const early = earlyStarts(w)[0];
  must(!early, early ? `issue #${early.issue} started at ${iso(early.at)}, before its blocker #${early.blocker} was done (its change landed ${iso(early.landed)})` : '');
}

test(named(1), async () => {
  const w = await World.open({ issues: ISSUES });
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  const { ask, approval } = await w.approve(asked);
  expect([...approval.data.issues].sort(), 'the words name the set: start.approval holds its six issues').toEqual(SET);
  expect(approval.data.agents, 'and its agent').toEqual(['claude-code']);
  expect(approval.data.at_once, 'and how many run at once').toBe(2);

  const done = await waitUntil(() => SET.every((n) => w.merged(n) && w.state(n) === 'closed'), 45 * MIN, 2000);
  expect(done, `one approval runs the set to the end: ${SET.map((n) => `#${n} ${w.merged(n) ? 'landed' : 'not landed'}, ${w.state(n)}`).join('; ')}`).toBe(true);
  const events = await w.events();
  for (const n of SET) {
    expect(events.some((e) => e.kind === 'landing.made' && e.data.step === 'landed' && e.data.issue === n && e.data.outcome === 'PASS'), `#${n}'s change is on main with a PASS in the record`).toBe(true);
  }
  expect((await asksBesides(w, ask)).map((e) => String(e.data.question).slice(0, 200)), 'the one approval is the only ask the run raised').toEqual([]);
  judgeOrder(w);

  // The planted run starts an issue before its blockers are done.
  const p = await World.open({ issues: ISSUES, plant: 'starts-before-blockers-done' });
  const pasked = await p.run(SCOPE);
  expect(pasked.code, `the planted run's approval: exit ${pasked.code}, ${pasked.stderr.slice(-600)}`).toBe(0);
  await p.approve(pasked);
  await waitUntil(() => earlyStarts(p).length > 0 || SET.every((n) => p.merged(n)), 30 * MIN, 2000);
  const early = earlyStarts(p)[0];
  expect(early, 'the planted run started no issue before its blockers were done, so it proves nothing').toBeDefined();
  await mustFail('a run that starts an issue before its blockers are done', () => judgeOrder(p), [`#${early!.issue}`, `#${early!.blocker}`]);
}, 90 * MIN);
