// AC5 #222.f1e8b886: "Two cues that write `items/sq/at/pos` over overlapping spans are refused naming both; a `pulse`
// on the same path is accepted"
//
// Two films of one square. In the first, cue `east` sets its position to (3, 0) over 0–1 s and cue `north`, `at`
// 0.5 s, sets it to (0, −2) over 0.5–1.5 s: both write items/sq/at/pos over 0.5–1 s, and `deep show` refuses the
// film with an error naming `east` and `north`. In the second, `north` is a pulse on the same path over the same span
// (README: Documents, a pulse in `set`), which adds to `east`'s move: presented with no error.
//
// Wrong programs: an expander that lets the later cue win silently (no refusal), one that names only one of the two,
// and a check that refuses every second writer of a path, pulses included.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, cueList, docId, errors, film, mentions, present, presented, run, scenario, square, useFolders, useShow, type JsonObject } from './helpers.ts';

const show = useShow();
const folder = useFolders();

const east: JsonObject = { id: 'east', targets: ['sq'], span: '1s', set: { 'at/pos': [3, 0, 0] } };
const twoMoves = film('Two moves at once', [square('sq'), cueList([east, { id: 'north', when: { at: '0.5s' }, targets: ['sq'], span: '1s', set: { 'at/pos': [0, -2, 0] } }])], { span: 2 });
const withPulse = film('A move and a pulse', [square('sq'), cueList([east, { id: 'north', when: { at: '0.5s' }, targets: ['sq'], span: '1s', set: { 'at/pos': { pulse: { amount: [0, -2, 0] } } } }])], { span: 2 });

describe(`${AC[5]} two cues never write one path at once, unless the second adds`, () => {
  it(`${AC[5]} two cues writing items/sq/at/pos over overlapping spans are refused naming both, and a pulse on the same path is accepted`, () => {
    const [refused, accepted] = run(show(), scenario(folder(), [present(docId(1), twoMoves), present(docId(2), withPulse)]));
    expect(refused!['outcome'], `the two moves on items/sq/at/pos are refused: ${brief(refused)}`).not.toBe('presented');
    const naming = errors(refused!).filter((i) => mentions(i, 'east') && mentions(i, 'north'));
    expect(naming.length, `an error names both cues, east and north: ${brief(errors(refused!))}`).toBeGreaterThan(0);
    presented(accepted!, 'the move with a pulse on the same path');
  }, TIMEOUT);
});
