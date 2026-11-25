// #3150.3f890426: "A document's `keep` holding a value neither form takes is refused at check, naming the form."
//
// asserts: the agent's deep_show (on the full build's `deep-show run`, with its issues) of a film holding one
// `cut.words@1` item whose `keep` holds an entry that is neither a word index nor an inclusive [first, last] is refused:
// the revision is not presented, and an error issue at items/cut/params/keep (or inside it) names the form keep takes,
// `[index | [first: index, last: index]]`, somewhere in what it carries (its fix, forms or words). Two such values, each
// its own test: a three-number entry `[0, 1, 2]`, and a string entry `"two"`. A control document whose keep holds both
// forms, `[0, [1, 2]]`, gets no such issue at keep, so the refusal is the value's. On the base keep's declaration
// doesn't read, so the check refuses neither value by its form (BASE-FAILURE.txt).

import { describe, expect, it } from 'vitest';
import { KEEP_FORM, KEEP_PATH, cutFilm, docId, keepErrors, run, show, showCall, showWorld, useFullBuild, type JsonValue } from './helpers.ts';

const ID = '#3150.3f890426';
const build = useFullBuild();

function refusedNamingTheForm(keep: JsonValue): void {
  const [bad, good] = [docId(1), docId(2)];
  const [r, c] = run(build(), [showCall(bad, cutFilm(keep)), showCall(good, cutFilm([0, [1, 2]]))], showWorld([bad, good]));
  // The control: a keep both forms take is not refused by its form.
  const control = keepErrors(c!).filter((i) => JSON.stringify(i.raw).includes(KEEP_FORM));
  expect(control.map((i) => i.raw), `${ID}: keep [0, [1, 2]] (an index and a [first, last]) draws no refusal naming keep's form`).toEqual([]);
  const named = keepErrors(r!).filter((i) => JSON.stringify(i.raw).includes(KEEP_FORM));
  expect(
    named.length,
    `${ID}: keep ${show(keep)} is refused at check by an error at ${KEEP_PATH} naming the form ${KEEP_FORM}; the errors at keep were ${show(keepErrors(r!).map((i) => i.raw), 2000)}; every issue: ${show(r!['issues'] ?? null, 3000)}`,
  ).toBeGreaterThan(0);
  expect(r!['outcome'], `${ID}: the revision with keep ${show(keep)} is refused, not presented`).not.toBe('presented');
}

describe(`${ID} a cut.words@1 keep holding a value neither form takes is refused at check, naming the form`, () => {
  it(`${ID} keep [[0, 1, 2]], a three-number entry, is refused at check naming [index | [first: index, last: index]]`, () => {
    refusedNamingTheForm([[0, 1, 2]]);
  }, 3_600_000);

  it(`${ID} keep [0, "two"], a string entry, is refused at check naming [index | [first: index, last: index]]`, () => {
    refusedNamingTheForm([0, 'two']);
  }, 3_600_000);
});
