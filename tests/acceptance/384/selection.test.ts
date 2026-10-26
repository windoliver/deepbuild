// AC1: selecting two parts and typing a request hands both to the agent by their stable names, and the session shows
// them as its context. On the shared test board at revision 14 (an agent's session keeps it), you click the API part,
// shift-click the Postgres part, and type a request into the panel's ask box; the agent's session then reads one
// message whose attachment names both parts by handle, each resolving live to its item, and the session lists both
// handles as its context. Driven through `deep-show run`'s `input` (with `mods` on a press), `ask` and `messages`
// calls on the virtual clock (README: The surface under test). At the base `deep-show` has no `ask` or `messages`
// call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, arr, ask, boardDoc, boxOf, center, click, handleOf, inbox, isObject, messageFailures, messageOf, messagesCall, nameOf, obj, proof,
  putPng, runShow, sameHandle, screenshotPng, show, slot, str, strs, boardScenario, useOut, useShow,
} from './helpers.ts';

const bin = useShow();
const out = useOut();

const PARTS = ['alpha.part-api', 'alpha.part-db'];
const REQUEST = 'why do these two talk so much?';

describe('AC1 selecting two parts and typing a request hands both to the agent by their stable names', () => {
  it('AC1 two parts selected by click and shift-click and a typed request reach the agent as both handles, each resolving to its part, and the session shows both as its context', async () => {
    const evidence = out();
    const shot = await putPng(evidence, screenshotPng());
    const doc = boardDoc(shot);
    const [api, db] = PARTS.map((id) => center(boxOf(doc, id)));
    const calls = [...click(slot(0), api!), ...click(slot(1), db!, true), ask(slot(2), 'main', REQUEST), messagesCall(slot(3))];
    const replies = runShow(bin(), boardScenario(evidence, shot, calls), 'two parts selected and a request typed');
    const n = replies.length;

    // The selection the ask is made from: both parts, the second added by the shift-click (Selection: `mode: toggle`).
    const state = obj(replies[n - 3]!['state'], 'the scope after the shift-click');
    expect([...strs(state['selection'], 'selection')].sort(), `the shift-click adds Postgres to the selection, keeping API: ${show(state['selection'])}`).toEqual([...PARTS].sort());

    const sent = messageOf(replies[n - 2]!['message'], 'the ask: message as sent');
    proof('AC1 attachment as sent', sent.attachment.raw);
    const { messages, context } = inbox(replies[n - 1]!, 'the session\'s messages');
    expect(messages.length, `the agent's session gets exactly one message: ${show(replies[n - 1])}`).toBe(1);
    const m = messages[0]!;
    expect(messageFailures(m, { words: REQUEST, handles: PARTS.map(handleOf), precision: 'id' }), 'the message carries both parts by handle, precision id, beside your words').toEqual([]);
    expect(m.attachment.raw, 'the session reads the attachment as it was sent').toEqual(sent.attachment.raw);
    expect(m.words, 'the session reads your words as they were sent').toEqual(sent.words);

    // Each handle resolves when the agent reads it: both parts are there, so each comes back live, naming its item.
    for (const id of PARTS) {
      const r = m.resolved.find((x) => sameHandle(x.handle, handleOf(id)));
      expect(r, `the agent's read resolves ${handleOf(id)} (\`resolved\`: ${show(m.raw['resolved'])})`).toBeDefined();
      expect(r!.raw['state'], `${handleOf(id)} resolves live: ${show(r!.raw)}`).toBe('live');
      expect(r!.raw['id'], `${handleOf(id)} resolves to its item`).toBe(id);
      expect(r!.raw['name'], `${handleOf(id)} resolves with its item's name`).toBe(nameOf(doc, id));
    }

    // The session shows them as its context: exactly the two handles.
    const ctx = arr(context, 'the session\'s `context`').map((h, i) => str(h, `context[${i}]`));
    const missing = PARTS.map(handleOf).filter((h) => !ctx.some((c) => sameHandle(c, h)));
    expect(missing, `the session's context ${show(ctx)} shows both parts`).toEqual([]);
    expect(ctx.length, `the session's context ${show(ctx)} shows the two parts and nothing else`).toBe(2);
    expect(isObject(m.task) && typeof m.task['handle'] === 'string', `the message opens an ask-task for ${ALPHA.id}: ${show(m.raw['task'])}`).toBe(true);
  }, 600_000);
});
