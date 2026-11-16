// AC4: two starts sent at once take one slot each of the approval's at_once (README).
//
// #1330's world: an approval for issues 41 and 42, Claude Code, at most one at once. Two start.session requests, the
// request `deep start` sends, go out on one cli connection in one write, so the second doesn't wait for the first's
// reply. One must start and the other be refused with bound at_once. On the base each counts the running sessions
// before either is in the hub's map of starts, so both start.
import { expect, test } from 'vitest';
import { approve, openWorld } from '../1330/helpers.ts';
import { blocked, installStandIn, startsAtOnce } from './helpers.ts';

const AC4 = 'AC4 #2120.bc7c2b7d';

test(`${AC4} under an approval with at_once 1, two start.session requests sent without waiting for the first: one starts and the other is refused with bound at_once`, async () => {
  const w = await openWorld();
  installStandIn(w);
  await blocked('the approval of issues 41 and 42, one at once', () => approve(w, { issues: [41, 42], agents: ['claude-code'], atOnce: 1, planShare: 50 }));

  const replies = await blocked('two start.session requests on one connection', () => startsAtOnce(w, [41, 42]));
  const outcomes = replies.map((r) => (r.status === 'started' ? 'started' : r.status === 'refused' ? `refused, bound ${String(r.bound)}` : `answered ${JSON.stringify(r).slice(0, 300)}`)).sort();
  expect(outcomes, `${AC4} two starts sent at once under an approval with at_once 1 take one slot each: one starts and the other is refused with bound at_once; the replies were ${JSON.stringify(replies.map((r) => ({ status: r.status, run: r.run, bound: r.bound, reason: r.reason })))}`)
    .toEqual(['refused, bound at_once', 'started']);
});
