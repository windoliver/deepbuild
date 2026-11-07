// AC5: a started agent that writes no first event in 60 s ends as never started and frees its slot (README:
// `session.never_started`, and `at_once`, the bound a start meets while the approval's slots are full).
import { expect, test } from 'vitest';
import { AC, alive, approve, eventsOfSession, mentions, mustRefuse, mustStart, openWorld, standInIn, start, waitFor } from './helpers.ts';

test(`${AC[5]} a started agent with no first event in 60 s ends as never started and frees its slot`, async () => {
  const w = await openWorld();
  await approve(w, { issues: [41, 42, 43], agents: ['claude-code'], atOnce: 1, planShare: 50 });

  const quiet = mustStart(await start(w, { issue: 41, prompt: 'Say nothing. [standin:silent]' }), `${AC[5]}: the start of an agent that writes no event`);
  const agent = await standInIn(w, quiet.worktree, { ms: 60_000 });
  const full = mustRefuse(await start(w, { issue: 42 }), `${AC[5]}: a second start while the first holds the approval's one slot`);
  expect(full.bound, `${AC[5]}: the slot is held while the agent may still start: ${JSON.stringify(full)}`).toBe('at_once');

  const ended = await waitFor(async () => (await w.client.events('session.never_started')).find((e) => mentions(e, quiet.run)), 150_000, `session.never_started naming the run ${quiet.run}`);
  const after = Date.now() - Number(agent.started);
  expect(after, `${AC[5]}: it ends as never started after its 60 s, not before (${after} ms after the agent started): ${JSON.stringify(ended)}`).toBeGreaterThanOrEqual(55_000);
  expect(after, `${AC[5]}: and soon after them`).toBeLessThanOrEqual(110_000);
  await waitFor(() => !alive(Number(agent.pid)), 20_000, `the never-started agent's process (${agent.pid}) to end`);

  const next = mustStart(await start(w, { issue: 43 }), `${AC[5]}: a start once the never-started session freed its slot`);
  const nextAgent = await standInIn(w, next.worktree, { done: true });
  const first = await waitFor(async () => (await eventsOfSession(w, String(nextAgent.session)))[0], 30_000, `the first event of session ${nextAgent.session}`);
  expect(mentions(first, next.run), `${AC[5]}: the session started in the freed slot runs as usual, its first event naming run ${next.run}`).toBe(true);
});
