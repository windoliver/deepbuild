// #26.16520b7d `deep_ask` returns the answer when one arrives during the wait.
// #26.644467d9 A task raised through `deep_ask` without a check is refused.
// #26.01e00356 `deep_search` finds a past decision by its question.
// One agent stand-in with its session established through its hooks calls its own `deep mcp`; you answer in your
// terminal with `deep inbox answer` (#24), with the OS confirmation stubbed to confirm (README: Seams).

import { afterAll, expect, test } from 'vitest';
import {
  agentWorld, callTool, cleanup, deep, errorOf, eventMatching, events, filedWhileWaiting, pending, sleep, valueOf, word, type World,
} from './helpers.ts';

afterAll(cleanup, 30_000);

const tag = word();
/** A past decision: a choice ask for another session of the repo, raised before the hub starts and answered by you once it runs. */
const DECIDED = `Keep the ${tag} store on SQLite or plain files?`;
let world: Promise<World & { decided: string }> | undefined;
const setUp = () => (world ??= (async () => {
  let decided = '';
  const w = await agentWorld({
    seeded: async (s, _session, worktree) => {
      await s.start('S0past', worktree);
      decided = await s.raise('S0past', 'choice', DECIDED);
    },
  });
  const r = await deep(w.home, ['inbox', 'answer', decided, 'files']);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${decided} files exited ${r.code}: ${r.stdout}${r.stderr}`);
  return { ...w, decided };
})());

test('#26.16520b7d deep_ask returns the answer you give while it waits', async () => {
  const { home, hub, agent, session } = await setUp();
  const question = `Which header colour for ${tag}?`;
  const asked = pending(callTool(agent, 'deep_ask', {
    kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'blue',
  }));
  // The ask reaches the record under the agent's session while deep_ask still waits.
  const created = await filedWhileWaiting(asked, hub, (e) => e.kind === 'ask.created' && e.data?.question === question, `deep_ask "${question}"`);
  expect(created.session, 'the ask is filed under the session the agent\'s deep mcp serves').toBe(session.id);
  const handle = `ask:${created.id}`;
  await sleep(1000);
  const answered = await deep(home, ['inbox', 'answer', handle, 'green']);
  expect(answered.code, `you answer ${handle} with green in your terminal: ${answered.stdout}${answered.stderr}`).toBe(0);
  const out = await asked;
  if (!out.returned) throw Error(`deep_ask failed: ${out.failed}`);
  const value = valueOf(out.returned, 'deep_ask, answered during its wait');
  expect({ ask: value?.ask, status: value?.status, answer: value?.answer }, `deep_ask returns the answer that arrived during the wait: ${JSON.stringify(value)}`)
    .toEqual({ ask: handle, status: 'answered', answer: 'green' });
}, 120_000);

test('#26.644467d9 a task raised through deep_ask without a check is refused, and nothing is filed; with one it is filed', async () => {
  const { hub, agent, session } = await setUp();
  const task = (question: string) => ({
    kind: 'unblock', question, steps: ['Run gh auth login in your own terminal'], where: 'your own terminal', why: 'The push needs your GitHub sign-in',
  });
  const without = `Sign in to GitHub for ${tag}, no check?`;
  for (const [how, args] of [['left out', task(without)], ['null', { ...task(without), check: null }]] as const) {
    const refused = errorOf(await callTool(agent, 'deep_ask', args), `deep_ask raising a task with its check ${how}`);
    expect(refused.path, `the refusal names the missing check: ${JSON.stringify(refused)}`).toMatch(/(^|\/)check$/);
  }
  await sleep(500);
  expect((await events(hub)).filter((e) => e.kind === 'ask.created' && e.data?.question === without).map((e) => e.id), 'a task without a check files no ask').toEqual([]);

  // The twin: the same task naming the check that will prove it is filed, under the agent's session.
  const withCheck = `Sign in to GitHub for ${tag}, checked by unit?`;
  const filed = pending(callTool(agent, 'deep_ask', { ...task(withCheck), check: 'unit' }));
  const created = await filedWhileWaiting(filed, hub, (e) => e.kind === 'ask.created' && e.data?.question === withCheck, 'deep_ask raising a task that names the check unit');
  expect({ kind: created.data.kind, proves: created.data.proves, session: created.session }, 'the task is an unblock ask, proved by the check it names, under the agent\'s session')
    .toEqual({ kind: 'unblock', proves: 'unit', session: session.id });
}, 120_000);

test('#26.01e00356 deep_search finds a past decision by its question, citing the decision', async () => {
  const { hub, agent, decided } = await setUp();
  const decision = await eventMatching(hub, (e) => e.kind === 'decision.created' && e.data?.ask === decided, 10_000);
  expect(decision, `your answer to ${decided} was saved as a decision`).toBeDefined();
  const value = valueOf(await callTool(agent, 'deep_search', { query: DECIDED }), 'deep_search for a past decision\'s question');
  const hits = (value?.hits ?? []) as { source?: unknown; quote?: unknown }[];
  expect(Array.isArray(value?.hits), `deep_search answers with hits: ${JSON.stringify(value).slice(0, 1500)}`).toBe(true);
  expect(hits.filter((h) => typeof h.source !== 'string' || !h.source).length, 'every hit names its source').toBe(0);
  expect(hits.map((h) => h.source), `deep_search finds the decision decision:${decision!.id} by its question`).toContain(`decision:${decision!.id}`);
}, 120_000);
