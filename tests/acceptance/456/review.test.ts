// #456.04d3fc26: "render.review records a model's judgment as a reading that can open a taste ask, and no requirement
// passes on it, checked by a fixture that tries"
//
// Fixture (helpers.ts): the review room, alpha's stored document, the one deliverable of a claim whose one requirement
// is render.review (`asks: [matches_brief, reads_as_modeled, mood]`, grounding left at its default) and whose brief has
// a goal. One `deep-show run` judges it twice on revision 0, the stub model answering:
//   1. `TRIES_TO_PASS`: every ask yes, nothing found, and `result: PASS`, `pass: true` in its answer, the fixture that
//      tries to pass the requirement;
//   2. `doubts()`: matches_brief no, mood unsure.
// asserts:
//   - each verdict's render.review row carries a reading (`reading`) recording the judgment: the model that made it
//     (`model`, the stub's name), the exact context it was given (`context`, a hash the evidence store holds) and its
//     answers as the model gave them;
//   - neither row is PASS, and neither verdict is PASS, though the first answer says every ask is met and claims PASS;
//   - the second verdict carries a taste ask (`kind: taste`) on the render.review requirement, keyed by the revision's
//     hash (`key`, `read`'s `hash`).
// Wrong programs: the base (no render.review: its row is BLOCKED `module_missing`, with no reading);
// `review_passes_on_yes` (the requirement passes when the model answers yes to every ask and finds nothing).
import { describe, it } from 'vitest';
import {
  MODEL, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, TIMEOUT, TRIES_TO_PASS, brief, caught, doubts, isObject, none, proof, read, readEvidence, readingOf,
  requireMetal, reviewRoom, roomClaim, rowOf, run, same, scenarioOf, sha256, shown, tasteAsks, useBuild, useFolders, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.04d3fc26';
const bin = useBuild();
const folder = useFolders();
const REPLIES = [TRIES_TO_PASS, doubts()];

/** Why a run of the two reviews breaks the criterion; empty when it holds. */
function judge(evidence: string, replies: JsonObject[]): string[] {
  const failures: string[] = [];
  const { hash } = shown(replies[0]!, 'read of the review room');
  [replies[1]!, replies[2]!].forEach((v, k) => {
    const what = `render.review of revision 0, the model answering ${k === 0 ? 'yes to every ask and claiming PASS' : 'that the brief is not met'}`;
    const row = rowOf(v, ROOM_REVIEW, what);
    if (row.result === 'PASS') failures.push(`${what}: the requirement PASSes on the model's reading: ${brief(row.raw, 800)}`);
    if (v['result'] === 'PASS') failures.push(`${what}: the claim's verdict PASSes on the model's reading: ${brief(v, 800)}`);
    if (!isObject(row.raw['reading'])) { failures.push(`${what}: the row carries no reading: ${brief(row.raw, 1200)}`); return; }
    const reading = readingOf(row, what);
    if (reading['model'] !== MODEL) failures.push(`${what}: the reading names the model ${brief(reading['model'])}, not ${MODEL}`);
    const context = String(reading['context']);
    const bytes = readEvidence(evidence, context);
    if (!bytes || sha256(bytes) !== context) failures.push(`${what}: the reading's context ${brief(reading['context'])} isn't bytes the evidence store holds by that hash`);
    const given = (k === 0 ? TRIES_TO_PASS : doubts())['answers'];
    if (!same(reading['answers'], given)) failures.push(`${what}: the reading's answers are ${brief(reading['answers'])}, not the model's ${brief(given)}`);
    if (k === 1) {
      const asks = tasteAsks(v).filter((a) => a['requirement'] === ROOM_REVIEW);
      if (!asks.some((a) => a['key'] === hash)) failures.push(`${what}: no taste ask on ${ROOM_REVIEW} keyed by the revision's hash ${hash}; it asks ${brief(tasteAsks(v))}`);
    }
  });
  return failures;
}

describe(`${ID} render.review records a model's judgment as a reading that can open a taste ask, and no requirement passes on it`, () => {
  it(`${ID} a model that answers yes to every ask and claims PASS passes nothing, and one that doubts the brief opens a taste ask keyed by the revision, each recorded as a reading with its model and context`, () => {
    requireMetal('the review room');
    const calls = [read(ROOM_DOC), verdict(ROOM_CLAIM), verdict(ROOM_CLAIM)];
    const evidence = folder();
    const replies = run(bin(), scenarioOf(evidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), calls, { replies: REPLIES }));
    none(judge(evidence, replies), 'render.review records the judgment as a reading, opens a taste ask on doubt, and passes nothing');
    proof('the reading that tried to pass', rowOf(replies[1]!, ROOM_REVIEW, 'the first review').raw);
    proof('the taste ask', tasteAsks(replies[2]!));

    const plantedEvidence = folder();
    const planted = run(bin(), scenarioOf(plantedEvidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), calls, { replies: REPLIES, planted: 'review_passes_on_yes' }));
    caught(judge(plantedEvidence, planted), 'review_passes_on_yes', 'the review that tries to pass');
  }, TIMEOUT);
});
