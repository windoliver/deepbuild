// #407.0c62af86 (AC9): "With a test build of the film audit whose shortest reading hold is 2 s, standing in for a
// stricter rule in a new release, a film whose last good revision holds two text items for 1.7 s each takes a patch
// fixing a typo in a third: the patch is admitted with the two holds listed as carried, while the film's claim, whose
// check reads the document as the work, FAILs naming both items and their frames; a planted verdict that counts only
// the issues the patch brought passes the claim and fails, naming the two holds"
//
// Fixture (helpers.ts: `carriedFilm`): a 1920 × 1080 film, stored as the last release wrote it (revision 0, yours), with
// the kettle and three texts: `word-go` "Go" over [1, 2.7) s and `word-up` "Up" over [3, 4.7) s, 1.7 s each (by the
// shipped rule each needs max(1.5, 1.5 + 2 ÷ 15) = 1.633 s; by the test build's, max(2, 1.633) = 2 s), and
// `title-typo` "The kettel sings" over [5, 8) s (2.433 s needed either way). The claim's one requirement is
// {kind: film.audit}, with the film its deliverable.
//
// Builds: `full,test-hold-min-2s` (README: The test build: the film audit's `hold.min` is 2 s, nothing else changes)
// and, as the control that the test build is what fails the film, `full`.
//
// asserts:
//   - full: the claim's row PASSes with nothing raised.
//   - full,test-hold-min-2s: your patch (`deep show` from your shell, base 0) setting `title-typo`'s text to "The kettle
//     sings" is applied, its reply listing a film.hold_short naming word-go and one naming word-up, each `carried: true`;
//     the verdict on the claim then FAILs, its row raising a film.hold_short naming word-go at t = 1 s and one naming
//     word-up at t = 3 s.
//   - planted `verdict_counts_new_issues` (a verdict that counts only the issues the patch brought) passes the claim,
//     and this check fails, naming word-go and word-up.
import { describe, it } from 'vitest';
import {
  AC, FULL, GO, HOLD, HOLD_2S, TIMEOUT, TYPO, UP, YOU_PEER, brief, carriedFilm, docId, failsNaming, holdShort, isObject, judge, judgedOf,
  mentions, none, passFailures, patchId, run, scenarioOf, useBuilds, useFolders, type Film, type JsonObject,
} from './helpers.ts';

const bin = useBuilds([HOLD_2S, FULL]);
const folder = useFolders();
const FILM: Film = { name: 'the film with two 1.7 s holds', doc: docId(1), document: carriedFilm(docId(1)) };
const PATCH = patchId(1);
const fix: JsonObject = {
  call: 'deep show', peer: YOU_PEER, doc: FILM.doc,
  patch: { patch: PATCH, doc: FILM.doc, base: 0, reason: 'fix the typo in the title', ops: [{ op: 'set', id: TYPO, path: `items/${TYPO}/params/text`, value: 'The kettle sings' }] },
};

/** The patch is admitted with both holds carried, and the claim FAILs naming both items and their frames. */
function carriedFailures(planted?: string): string[] {
  const replies = run(bin(HOLD_2S), scenarioOf(folder(), [FILM], { before: [fix], ...(planted ? { planted } : {}) }));
  const patched = replies[0]!;
  const failures: string[] = [];
  if (patched['outcome'] !== 'applied') failures.push(`patch ${PATCH}, the typo fix, was ${String(patched['outcome'])}, not admitted: ${brief(patched['issues'])}`);
  const issues = (Array.isArray(patched['issues']) ? patched['issues'] : []).filter(isObject);
  for (const id of [GO, UP]) {
    if (!issues.some((i) => i['code'] === HOLD && mentions(i, id) && i['carried'] === true)) failures.push(`patch ${PATCH}'s reply doesn't list ${id}'s ${HOLD} as carried: ${brief(issues)}`);
  }
  const row = judgedOf(replies, [FILM], 1)[FILM.name]?.row;
  failures.push(...holdShort(row, GO, { t: 1 }, `the claim on ${FILM.name}, after the patch`));
  failures.push(...holdShort(row, UP, { t: 3 }, `the claim on ${FILM.name}, after the patch`));
  return failures;
}

describe(`${AC[9]} a stricter hold rule: the patch is admitted with the old holds carried, and the claim still fails on them`, () => {
  it(`${AC[9]} the shipped rule passes the two 1.7 s holds (control)`, () => {
    none(passFailures(judge(bin(FULL), folder(), [FILM]).judged[FILM.name]?.row, `${FILM.name} under the shipped rule`), 'the control');
  }, TIMEOUT);

  it(`${AC[9]} under the test build the typo fix is admitted with both holds carried, and the claim FAILs naming both items and their frames`, () => {
    none(carriedFailures(), 'show-time admission and the verdict');
  }, TIMEOUT);

  it(`${AC[9]} a planted verdict that counts only the issues the patch brought passes the claim, and this check fails naming the two holds`, () => {
    failsNaming(carriedFailures('verdict_counts_new_issues'), [GO, UP], 'the verdict counting only the patch\'s own issues');
  }, TIMEOUT);
});
