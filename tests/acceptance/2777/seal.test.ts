// AC1 #2777.d820cdcc: "A planted kind with a field of three words and no closure is refused at the seal, naming the
// kind and the field. Its twin closed with a reason, `reopens_if` and `instead` seals"
//
// asserts: the full set with the test canvas module test.tone (feature `test-tone-unclosed`), whose kind test.tint@1
// declares the field tone as `warm | cool | neutral` and gives the list no closure, is refused at startup, before any
// scenario: `deep-show run` exits 2 with one line {"ok": false, "code": "seal_refused", "reason": "list_unclosed", …}
// whose `entries` names test.tint@1 and whose `field` is tone. Its twin (feature `test-tone-closed`), the same list
// closed with a reason, reopens_if and instead, seals (exit 0, its `registry` call answered), and its sealed listing
// (`deep-show kinds --dump`) holds test.tint@1.tone with the words warm, cool and neutral and that closed closure.

import { describe, expect, it } from 'vitest';
import {
  TINT, TONE, TONE_CLOSED, TONE_LIST, TONE_UNCLOSED, TONE_WORDS, closedOf, dumpOf, fieldListsOf, none, sealFailures, show, sorted, startup,
  theList, unclosedRefusalFailures, useBuilds,
} from './helpers.ts';

const builds = useBuilds([TONE_UNCLOSED, TONE_CLOSED]);

describe('AC1 #2777.d820cdcc a field list with no closure is refused at the seal', () => {
  it('AC1 #2777.d820cdcc a planted kind with a field of three words and no closure is refused at the seal, naming the kind and the field', () => {
    const s = startup(builds.bin(TONE_UNCLOSED));
    none(unclosedRefusalFailures(s, { entry: TINT, field: TONE }), `the full set with test.tone, whose ${TINT} declares ${TONE}: ${TONE_WORDS.join(' | ')} with no closure`);
  }, 3_600_000);

  it('AC1 #2777.d820cdcc its twin closed with a reason, reopens_if and instead seals', () => {
    const bin = builds.bin(TONE_CLOSED);
    none(sealFailures(startup(bin), `the full set with test.tone, whose ${TONE_LIST} is closed`), 'the closed twin\'s startup');
    // The twin is what it claims: its sealed listing holds the list with its words and a closed closure.
    const list = theList(fieldListsOf(dumpOf(bin).value), TONE_LIST);
    expect(sorted(list.words), `${TONE_LIST}'s words in the twin's listing`).toEqual(sorted(TONE_WORDS));
    expect(list.entry, `${TONE_LIST}'s entry`).toBe(TINT);
    expect(list.field, `${TONE_LIST}'s field`).toBe(TONE);
    expect(closedOf(list.closure), `${TONE_LIST} is closed with a reason, reopens_if and instead in the twin's listing: ${show(list.closure ?? null)}`).toBeDefined();
  }, 3_600_000);
});
