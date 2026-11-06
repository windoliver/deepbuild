// #67: a session outside any repo stays where it is, so the agent has to hear where its task's home is. The blind suite
// reads the folder from the record; this holds what the agent itself is told, in the reply to the prompt that opened it.
import { afterAll, expect, it } from 'vitest';
import { cleanup, draft, handDrafts, makeWorld, req, replyText, Session, settle, startHub } from '../../../tests/acceptance/67/hub.ts';

afterAll(cleanup, 60_000);

it('the prompt that lands a task in a new workspace tells the agent the folder, and a question tells it nothing', async () => {
  const w = makeWorld();
  handDrafts(w, [draft('free 200 GB', [req('R1', '200 GB is free')])]);
  const hub = await startHub(w);
  const s = new Session(w, w.outside);
  await s.start();
  expect((await s.typed('what is using my disk?')).stdout).not.toContain('workspace');
  const reply = await s.typed('free 200 GB');
  const events = await settle(hub, (all) => all.some((e) => e.kind === 'workspace.created'));
  const folder = String(events.find((e) => e.kind === 'workspace.created')!.data.folder);
  expect(`${reply.stdout}${replyText(reply)}`).toContain(folder);
}, 120_000);
