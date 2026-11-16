// #456.e76ba4d1: "render.review never sees the authoring session: a fixture that plants a hint in the session finds it
// absent from the review's context"
//
// Fixture (helpers.ts): the review room and its render.review claim (criterion 1's). A hint, `HINT`, is planted in
// alpha's authoring session three ways, and nowhere else: the session's name; your words to alpha's session about the
// panel (point-and-ask), which alpha's `messages` then hold; and the reason of alpha's patch that makes revision 1
// (the crate's material recoloured). The verdict then reviews revision 1.
// asserts:
//   - the plant took: alpha's messages hold the hint and the patch is applied;
//   - the reading records the exact context the model was given (`reading.context`, bytes in the evidence store by
//     that hash), and that context is the review's own: it holds the brief's goal and the document's outline (the
//     hidden lantern's ID among its items), and not the hint, in any of its three places.
// Wrong programs: the base (no reading, so no context); `review_sees_session` (the review's context also holds the
// session: its name, the words sent to it and its patches' reasons).
import { describe, expect, it } from 'vitest';
import {
  GOAL, HIDDEN, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, TIMEOUT, askAlpha, brief, caught, doubts, messages, none, patch, patchId, proof, readEvidence, readingOf,
  requireMetal, reviewRoom, roomClaim, rowOf, run, scenarioOf, sha256, useBuild, useFolders, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.e76ba4d1';
const bin = useBuild();
const folder = useFolders();

/** A word found nowhere but in the session. */
const HINT = 'zephyr-amber-6c1f';
const SESSION_NAME = `Claude Code: the lantern ${HINT}`;
const CALLS: JsonObject[] = [
  askAlpha(`Make the lantern glow ${HINT} like the owner said`),
  messages(),
  patch(ROOM_DOC, patchId(1), 0, [{ op: 'set', id: 'crate-mat', path: 'items/crate-mat/params/base_color', value: [0.4, 0.25, 0.14, 1] }], `recolour the crate, as the owner hinted: ${HINT}`),
  verdict(ROOM_CLAIM),
];

/** The context the review of revision 1 was given, as text, or why there is none. */
function contextOf(evidence: string, replies: JsonObject[]): string {
  const what = 'render.review of revision 1';
  const reading = readingOf(rowOf(replies[3]!, ROOM_REVIEW, what), what);
  const sha = String(reading['context']);
  const bytes = readEvidence(evidence, sha);
  expect(bytes !== null && sha256(bytes) === sha, `${what}: the reading's context ${brief(reading['context'])} is bytes the evidence store holds by that hash`).toBe(true);
  return bytes!.toString('utf8');
}
/** Why a context breaks the criterion; empty when it holds. */
function judge(context: string): string[] {
  const failures: string[] = [];
  if (!context.includes(GOAL)) failures.push(`the review's context doesn't hold the brief's goal "${GOAL}": ${context.slice(0, 600)}`);
  if (!context.includes(HIDDEN)) failures.push(`the review's context doesn't hold the document's outline (no item ${HIDDEN}): ${context.slice(0, 600)}`);
  const at = context.indexOf(HINT);
  if (at >= 0) failures.push(`the review's context holds the session's hint "${HINT}": …${context.slice(Math.max(0, at - 200), at + 100)}…`);
  return failures;
}

describe(`${ID} render.review never sees the authoring session`, () => {
  it(`${ID} a hint planted in the session's name, its messages and its patch reason is absent from the context the review was given`, () => {
    requireMetal('the review room');
    const evidence = folder();
    const replies = run(bin(), scenarioOf(evidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), CALLS, { replies: [doubts()], sessionName: SESSION_NAME }));
    expect(JSON.stringify(replies[1]), `the plant took: alpha's messages hold the hint: ${brief(replies[1], 1200)}`).toContain(HINT);
    expect(replies[2]!['outcome'], `the plant took: alpha's patch with the hint in its reason is applied: ${brief(replies[2], 1200)}`).toBe('applied');
    const context = contextOf(evidence, replies);
    none(judge(context), "the review's context is the brief, the outline and the snapshots, never the session");
    proof('the context render.review was given', context.slice(0, 4000));

    const plantedEvidence = folder();
    const planted = run(bin(), scenarioOf(plantedEvidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), CALLS, { replies: [doubts()], sessionName: SESSION_NAME, planted: 'review_sees_session' }));
    caught(judge(contextOf(plantedEvidence, planted)), 'review_sees_session', "the review's context");
  }, TIMEOUT);
});
