// AC1 and AC4: a start with an approval on the record, refused with none; the mode an approval shows and the mode a
// start with none named uses (README).
import { expect, test } from 'vitest';
import {
  AC, approve, eventsOfSession, failureOf, mentions, mustStart, openWorld, realOr, requestApproval, shown, sleep, standIns,
  standInIn, start, waitFor, worktrees, type Bounds, type World,
} from './helpers.ts';

const ISSUE = 41;
const BOUNDS = (): Bounds => ({ issues: [ISSUE], agents: ['claude-code'], atOnce: 1, planShare: 50 });

/** With no approval on the record a start is refused, and nothing starts: no agent process, no worktree. */
async function refusedWithNone(w: World): Promise<void> {
  const before = worktrees(w.repo).length;
  const r = await start(w, { issue: ISSUE });
  const what = `#1330 ${AC[1]}: a start for issue ${ISSUE} with no approval on the record`;
  expect(r.out?.status, `${what} is refused (${shown(r)})`).toBe('refused');
  expect(r.code, `${what} exits non-zero (${shown(r)})`).not.toBe(0);
  await sleep(3000);
  expect(standIns(w).filter((s) => !s.refused).map((s) => s.cwd), `${what} starts no agent`).toEqual([]);
  expect(worktrees(w.repo).length, `${what} adds no worktree`).toBe(before);
}

test(`${AC[1]} with an approval a session starts in its own worktree and its first event names the run; with none the start is refused`, async () => {
  const w = await openWorld();
  await refusedWithNone(w);

  await approve(w, BOUNDS());
  const s = mustStart(await start(w, { issue: ISSUE }), `${AC[1]}: a start for issue ${ISSUE} under its approval`);
  const tree = worktrees(w.repo).find((t) => realOr(t.path) === realOr(s.worktree));
  expect(tree, `${AC[1]}: ${s.worktree} is a worktree of the repo (${JSON.stringify(worktrees(w.repo))})`).toBeTruthy();
  expect(realOr(s.worktree), `${AC[1]}: the session has a worktree of its own, not the repo's checkout`).not.toBe(realOr(w.repo));
  expect(tree!.head, `${AC[1]}: the worktree starts at the default branch's head, ${w.base}`).toBe(w.base);
  expect(tree!.branch, `${AC[1]}: the worktree's branch is named for issue ${ISSUE}`).toMatch(new RegExp(`(^|\\D)${ISSUE}(\\D|$)`));

  const agent = await standInIn(w, s.worktree, { done: true });
  const first = await waitFor(async () => (await eventsOfSession(w, String(agent.session)))[0], 30_000, `the record's first event of session ${agent.session}`);
  expect(mentions(first, s.run), `${AC[1]}: the session's first event names the run ${s.run}: ${JSON.stringify(first).slice(0, 1500)}`).toBe(true);
});

test(`${AC[1]} a planted hub that starts without an approval fails, naming the issue`, async () => {
  const w = await openWorld({ plant: 'starts-without-approval' });
  const failure = await failureOf(() => refusedWithNone(w));
  expect(failure, 'the hub planted to start without an approval fails the test').not.toBeNull();
  expect(failure, 'its failure names the issue').toContain('#1330');
  expect(failure, 'and the start it let through').toContain(`issue ${ISSUE}`);
});

test(`${AC[4]} an approval of a mode that skips prompts shows that mode on its ask; a start with no named mode uses the mode that asks`, async () => {
  // Your own settings name the skipping mode as Claude Code's default: a start must not take it from there.
  const w = await openWorld({ userSettings: { permissions: { defaultMode: 'bypassPermissions' } } });

  const skipping = await requestApproval(w, { ...BOUNDS(), modes: { 'claude-code': 'bypassPermissions' } });
  expect(JSON.stringify(skipping.created.data), `${AC[4]}: the ask for an approval of bypassPermissions shows that mode`).toContain('bypassPermissions');

  await approve(w, BOUNDS());
  const s = mustStart(await start(w, { issue: ISSUE }), `${AC[4]}: a start that names no mode`);
  const agent = await standInIn(w, s.worktree);
  expect(agent.mode, `${AC[4]}: Claude Code runs in default, its mode that asks before acting, though your settings name bypassPermissions (argv ${JSON.stringify(agent.argv)})`).toBe('default');
});
