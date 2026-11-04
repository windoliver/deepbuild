// #323 AC15: the agent's own task list is read too (issue Scope: "Claude Code's TodoWrite list and Codex's plan
// updates, as each adapter's facts name them; at a stop, every item left pending or in progress is an open item, and
// an item the agent marked completed closes nothing, since that is its word"; design invariant 1, an agent's word is
// never evidence).
//
// A recorded Claude Code session writes a TodoWrite list of four items, two completed, one in progress and one
// pending, and stops with the unit test failing, so it is sent back; it then fixes the code, marks all four completed
// and stops again. A recorded Codex session updates its plan twice and stops: its last update has the same four
// steps, and its first a pending step the last one dropped.
import { afterAll, describe, it } from 'vitest';
import {
  AC15, CodexSession, FIX, FLAG, begin, cleanup, draft, expectTask, failureOf, isOpen, itemsNaming, itemsOf, judgedAfter, lastPos, listed, lockedFor,
  makeWorld, must, settle, startHub, type Todo,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PROMPT = 'make the auth middleware reject expired tokens';
const CODEX_PROMPT = 'make the auth middleware refuse expired tokens';
const DONE_1 = 'Read the auth middleware';
const DONE_2 = 'Flag expired tokens in the middleware';
const DOING = 'Run the unit test for expired tokens';
const LEFT = 'Add an e2e test for the refresh endpoint';
const DROPPED = 'Write a migration for the tokens table';
const list = (doing: Todo['status'], left: Todo['status']): Todo[] => [
  { content: DONE_1, status: 'completed', activeForm: 'Reading the auth middleware' },
  { content: DONE_2, status: 'completed', activeForm: 'Flagging expired tokens' },
  { content: DOING, status: doing, activeForm: 'Running the unit test' },
  { content: LEFT, status: left, activeForm: 'Adding an e2e test' },
];

/** The Claude Code session; throws naming the item a wrong gate closes. */
async function claudeSession(plant?: string): Promise<void> {
  const w = await makeWorld({ drafts: [draft(PROMPT)] });
  const hub = await startHub(w, plant);
  const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT, AC15);
  await s.todo(list('in_progress', 'pending'));
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since1 = await lastPos(hub);
  await s.stop('The middleware flags expired tokens; I am still running the tests.');
  await judgedAfter(hub, ref, since1);
  const first = await settle(hub, () => false, 3000);
  for (const item of [DOING, LEFT]) {
    must(itemsNaming(first, ref, [item], since1).length > 0, `${AC15} [Claude Code] the TodoWrite item "${item}", left ${item === DOING ? 'in progress' : 'pending'} at the stop, is an open item quoting it: the task's open items are ${listed(itemsOf(first, ref))}`);
  }
  for (const item of [DONE_1, DONE_2]) must(itemsNaming(first, ref, [item]).length === 0, `${AC15} [Claude Code] "${item}" was marked completed, so it is no open item: ${listed(itemsNaming(first, ref, [item]))}`);

  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.todo(list('completed', 'completed'));
  const since2 = await lastPos(hub);
  await s.stop('All four steps are done.');
  await judgedAfter(hub, ref, since2);
  const second = await settle(hub, () => false, 3000);
  for (const item of [DOING, LEFT]) {
    const items = itemsNaming(second, ref, [item]);
    must(items.length > 0 && items.some((i) => isOpen(second, i)), `${AC15} [Claude Code] the agent marked "${item}" completed, which is its word and closes nothing: the open item "${item}" must still be open after the second stop: ${listed(second.filter((e) => e.kind === 'open_item.closed' && e.data.task_ref === ref))}`);
  }
}

/** The Codex session; throws naming what its last plan update should have given. */
async function codexSession(): Promise<void> {
  const w = await makeWorld({ drafts: [draft(CODEX_PROMPT)] });
  const hub = await startHub(w);
  const s = new CodexSession(w, w.repos.repo!);
  await s.start();
  await s.typed(CODEX_PROMPT);
  let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, CODEX_PROMPT, AC15)).length > 0; } catch { return false; } });
  const ref = expectTask(events, s, CODEX_PROMPT, AC15);
  if (!lockedFor(events, ref).length) throw Error(`BLOCKED: ${AC15} [Codex] the definition handed for "${CODEX_PROMPT}" never locked`);
  s.plan([{ step: DONE_1, status: 'in_progress' }, { step: DROPPED, status: 'pending' }]);
  await s.patch(FLAG.file, FLAG.from, FLAG.to);
  s.plan(list('in_progress', 'pending').map((t) => ({ step: t.content, status: t.status })));
  const since = await lastPos(hub);
  await s.stop('The middleware flags expired tokens; the tests are still running.');
  await judgedAfter(hub, ref, since);
  events = await settle(hub, () => false, 3000);
  for (const item of [DOING, LEFT]) must(itemsNaming(events, ref, [item], since).length > 0, `${AC15} [Codex] the last plan update leaves "${item}" ${item === DOING ? 'in progress' : 'pending'} at the stop, so it is an open item quoting it: the task's open items are ${listed(itemsOf(events, ref))}`);
  for (const item of [DONE_1, DONE_2, DROPPED]) must(itemsNaming(events, ref, [item]).length === 0, `${AC15} [Codex] "${item}" is ${item === DROPPED ? 'only in an earlier plan update, which the last one replaced' : 'completed in the last plan update'}, so it is no open item: ${listed(itemsNaming(events, ref, [item]))}`);
}

describe(`${AC15} the agent's own task list: what it leaves pending or in progress is open, and its "completed" closes nothing`, () => {
  it(`${AC15} a Claude Code session's TodoWrite list of four, "${DOING}" in progress and "${LEFT}" pending, gives two open items quoting them, which stay open when the agent marks them completed; a Codex session's last plan update gives the same two`, async () => {
    await claudeSession();
    await codexSession();
  }, 900_000);

  it(`${AC15} (wrong program) a gate that closes an open item the agent marked completed (DEEP_HUB_PLANT=completed-closes-item) fails this test, naming the item`, async () => {
    const failure = await failureOf(() => claudeSession('completed-closes-item'));
    must(failure !== null, `${AC15} the planted gate must fail this test: it passed`);
    must(failure.includes(DOING) || failure.includes(LEFT), `${AC15} the failure names the item the gate closed, "${DOING}" or "${LEFT}"; it said: ${failure}`);
  }, 600_000);
});
