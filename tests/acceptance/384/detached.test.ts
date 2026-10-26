// AC3: a handle whose item is gone comes back detached, and the ask-task stays open. You point at the caption on the
// shared test board, paused at 4.2 s with revision 14 showing, and type "too small"; the agent's render-back at 4.2 s
// and revision 14 is taken; then the test agent's patch deletes the caption, making revision 15, before the session
// reads the message. The session then gets the caption's handle as `detached`, with its last name, the deleting writer
// and revision 15; the ask-task is still open; and render-back at 4.2 s and revision 14 returns the frame you pointed
// at, equal by pixel hash to the one taken before the delete. A planted resolver that returns only ref_unresolved, or
// one that closes the ask-task, fails the same check, naming the handle. Driven through `deep-show run`'s `ask`,
// `messages` and `render_back` calls, the `playhead` control and #96's patches on the virtual clock (README: The
// surface under test). At the base `deep-show` has none of the new calls and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA_WRITER, REV_DELETE, REV_SEEN, T_POINTED, WORDS, ask, boardDoc, boardScenario, boxOf, center, deletePatch, detachedFailures, handleOf, inbox,
  messagesCall, nameOf, num, proof, putPng, renderBack, renderedHash, runShow, screenshotPng, show, slot, useOut, useShow,
  type JsonObject, type Message, type Planted,
} from './helpers.ts';

const bin = useShow();
const out = useOut();

const CAPTION = 'alpha.caption';
const CAPTION_HANDLE = handleOf(CAPTION);

interface Run { read: Message[]; before: JsonObject; after: JsonObject; afterRev15: JsonObject; afterT0: JsonObject; evidence: string; deleted: JsonObject }

/** Point and ask at the caption, render back, delete the caption (revision 15), then read and render back again. */
async function deleteRun(planted?: Planted): Promise<Run> {
  const evidence = out();
  const shot = await putPng(evidence, screenshotPng());
  const pointer = center(boxOf(boardDoc(shot), CAPTION));
  const calls = [
    ask(slot(0), 'main', WORDS, pointer),
    renderBack(slot(1), T_POINTED, REV_SEEN),
    deletePatch(slot(2), CAPTION),
    messagesCall(slot(4)),
    renderBack(slot(5), T_POINTED, REV_SEEN),
    renderBack(slot(6), T_POINTED, REV_DELETE),
    renderBack(slot(7), 0, REV_SEEN),
  ];
  const replies = runShow(bin(), boardScenario(evidence, shot, calls, planted), `the caption deleted before the session reads it${planted ? ` (planted ${planted})` : ''}`);
  const r = replies.slice(replies.length - calls.length);
  return { evidence, before: r[1]!, deleted: r[2]!, read: inbox(r[3]!, 'the session\'s messages after the delete').messages, after: r[4]!, afterRev15: r[5]!, afterT0: r[6]! };
}

/** The check the criterion names: one message, its caption handle detached with name, writer and revision 15, its ask-task open. */
function resolverFailures(run: Run): string[] {
  if (run.read.length !== 1) return [`handle ${CAPTION_HANDLE}: the agent's session reads ${run.read.length} messages after the delete, not the one it was sent (a detached handle is never dropped)`];
  return detachedFailures(run.read[0]!, CAPTION_HANDLE, { name: nameOf(boardDoc('0'.repeat(64)), CAPTION), writer: ALPHA_WRITER, rev: REV_DELETE });
}

describe('AC3 a handle whose item is gone comes back detached, and the ask-task stays open', () => {
  it('AC3 the caption deleted at revision 15 before the session reads the attachment comes back detached, with its last name, the deleting writer and revision 15, and the ask-task stays open; planted resolvers that return only ref_unresolved or close the ask-task fail, naming the handle', async () => {
    const run = await deleteRun();
    expect(num(run.deleted['rev'], 'the delete\'s rev'), 'the agent\'s delete makes revision 15').toBe(REV_DELETE);
    proof('AC3 detached handle after the delete', run.read.map((m) => ({ resolved: m.raw['resolved'] ?? null, task: m.raw['task'] ?? null })));
    expect(resolverFailures(run), 'the caption\'s handle after the delete').toEqual([]);

    // Wrong programs: a resolver that answers only ref_unresolved, and one that closes the ask-task, each fail the same
    // check, naming the handle.
    for (const [planted, about] of [['resolver_only_ref_unresolved', 'detached'], ['resolver_closes_task', 'ask-task']] as [Planted, string][]) {
      const twin = resolverFailures(await deleteRun(planted));
      proof(`AC3 planted ${planted} fails`, twin);
      expect(twin.length, `the planted ${planted} fails the check: ${show(twin)}`).toBeGreaterThan(0);
      expect(twin.every((f) => f.includes(CAPTION_HANDLE)), `the planted ${planted}'s failures name the handle ${CAPTION_HANDLE}: ${show(twin)}`).toBe(true);
      expect(twin.some((f) => f.includes(about)), `the planted ${planted}'s failures say what's wrong (${about}): ${show(twin)}`).toBe(true);
    }
  }, 900_000);

  it('AC3 render-back at 4.2 s and revision 14 after the delete returns the frame you pointed at, equal by pixel hash to the same render-back taken before it', async () => {
    const run = await deleteRun();
    const before = await renderedHash(run.evidence, run.before, 'render-back at 4.2 s, revision 14, before the delete');
    const after = await renderedHash(run.evidence, run.after, 'render-back at 4.2 s, revision 14, after the delete');
    proof('AC3 render-back pixel hashes at 4.2 s and revision 14', { before, after });
    expect(after, 'render-back at 4.2 s and revision 14 after the delete equals, by pixel hash, the one taken before it').toBe(before);
    // The call draws the revision and the time it is asked for, not the current revision or time 0: revision 15 lacks the
    // caption, and at 0 s the sweep its channel moves stands elsewhere.
    const rev15 = await renderedHash(run.evidence, run.afterRev15, 'render-back at 4.2 s, revision 15');
    expect(rev15, 'render-back at revision 15, without the caption, differs from revision 14\'s frame').not.toBe(before);
    const t0 = await renderedHash(run.evidence, run.afterT0, 'render-back at 0 s, revision 14');
    expect(t0, 'render-back at 0 s differs from the frame at 4.2 s (the sweep moves along the transport)').not.toBe(before);
  }, 600_000);
});
