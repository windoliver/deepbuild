// #456.b291398a: "render.review run twice on one revision, with a stub model that words its observations differently,
// opens one taste ask, and once you answer it a third run on that revision asks nothing"
//
// Fixture (helpers.ts): the review room and its render.review claim (criterion 1's). A first run learns the ID view's
// numbers. Then one `deep-show run` reads revision 0 and judges it three times, you answering between the second and
// the third; the stub model doubts the brief each time with one observation, missing_item on the lantern's number,
// worded one way the first time, another way the second, and the first way again the third.
// asserts:
//   - the first two verdicts carry one taste ask between them (`kind: taste`, listed again counts once): on the
//     render.review requirement, keyed by the revision's hash (`key`, `read`'s `hash`), and the first verdict carries
//     it;
//   - your `answer` on that requirement, from your own shell, is `answered`;
//   - the third verdict carries no ask at all;
//   - no row is PASS.
// Wrong programs: the base (no render.review, no taste ask); `ask_keyed_by_words` (the taste ask is keyed by the
// reading's words, so each wording opens another); `asks_again_after_answer` (a revision whose ask you answered is
// asked again by the next review).
import { describe, it } from 'vitest';
import {
  HIDDEN, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, TIMEOUT, answer, asksOf, brief, caught, distinctAsks, doubts, none, numberOf, proof, read, requireMetal,
  reviewRoom, roomClaim, roomView, rowOf, run, scenarioOf, shown, tasteAsks, useBuild, useFolders, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.b291398a';
const bin = useBuild();
const folder = useFolders();

const WORDS = ['The lantern the brief keeps is nowhere to be seen.', 'I cannot find any lantern; it looks left out of the shot.'];
const CALLS = [read(ROOM_DOC), verdict(ROOM_CLAIM), verdict(ROOM_CLAIM), answer(ROOM_CLAIM, ROOM_REVIEW, true), verdict(ROOM_CLAIM)];

/** Why three reviews of one revision break the criterion; empty when they hold. */
function judge(replies: JsonObject[]): string[] {
  const failures: string[] = [];
  const { hash } = shown(replies[0]!, 'read of revision 0');
  const [v1, v2, answered, v3] = [replies[1]!, replies[2]!, replies[3]!, replies[4]!];
  [v1, v2, v3].forEach((v, k) => {
    const row = rowOf(v, ROOM_REVIEW, `review ${k + 1}`);
    if (row.result === 'PASS') failures.push(`review ${k + 1}'s render.review row PASSes: ${brief(row.raw, 600)}`);
  });
  const opened = distinctAsks(tasteAsks(v1), tasteAsks(v2));
  if (opened.length !== 1) failures.push(`two reviews of one revision, worded differently, open ${opened.length} taste asks, not one: ${brief(opened)}`);
  const ask = opened[0];
  if (ask && (ask['requirement'] !== ROOM_REVIEW || ask['key'] !== hash)) failures.push(`the taste ask isn't on ${ROOM_REVIEW} keyed by the revision's hash ${hash}: ${brief(ask)}`);
  if (ask && !tasteAsks(v1).length) failures.push(`the first review opens no taste ask; the second does: ${brief(ask)}`);
  if (answered['outcome'] !== 'answered') failures.push(`your answer on ${ROOM_REVIEW} is ${brief(answered, 600)}, not answered`);
  if (asksOf(v3).length) failures.push(`the third review of the answered revision asks again: ${brief(asksOf(v3))}`);
  return failures;
}

describe(`${ID} render.review opens one taste ask per revision, and asks nothing once you answer it`, () => {
  it(`${ID} two reviews worded differently open one taste ask keyed by the revision's hash, and after your answer a third review asks nothing`, () => {
    requireMetal('the review room');
    const lantern = numberOf(roomView(bin(), folder()), HIDDEN, 'the review room');
    const say = (words: string): JsonObject => doubts([{ category: 'missing_item', item: lantern, words }]);
    const replies = [say(WORDS[0]!), say(WORDS[1]!), say(WORDS[0]!)];
    const out = run(bin(), scenarioOf(folder(), { [ROOM_DOC]: reviewRoom() }, roomClaim(), CALLS, { replies }));
    none(judge(out), 'one taste ask for the revision, and none after your answer');
    proof('the taste ask', distinctAsks(tasteAsks(out[1]!), tasteAsks(out[2]!)));

    for (const planted of ['ask_keyed_by_words', 'asks_again_after_answer']) {
      caught(judge(run(bin(), scenarioOf(folder(), { [ROOM_DOC]: reviewRoom() }, roomClaim(), CALLS, { replies, planted }))), planted, 'the taste asks of three reviews');
    }
  }, TIMEOUT);
});
