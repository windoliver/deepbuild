// AC11 #142.53adec01: "A main word 2.9 times its sub-line's size fails the grammar rule and 3.1 times passes; a section
// of 8 s plus one flick fails and 8 s passes; an exit as long as its entrance fails; each names the cue and the rule"
//
// The boundary pairs, explain.kinetic_type films on the 2D stage at 120 BPM (README: Fixtures), each otherwise clean:
//   - cue_small enters its word at 116 u over a 40 u sub-line (2.9×): refused, naming cue_small and
//     explain.main_word_size; at 124 u (3.1×): presented. (Sizes through the cue's `data: {size, sub_size}`, README:
//     Cues in a film recipe.)
//   - cue_opening enters over 0.5 s and cue_hold waits 7.5 s plus one flick (5,292,000,001 flicks), so the list's one
//     section runs 8 s and one flick: refused, naming cue_hold and explain.section_length; cue_hold waiting 7.5 s, a
//     section of exactly 8 s: presented.
//   - cue_leave fades cue_opening's word out over 0.5 s, as long as its entrance: refused, naming cue_leave and
//     explain.exit_faster.
// In each failing film cue_coda, where it ends one, breaks nothing and the error doesn't name it.
// Wrong programs: the base; a size rule at ≥ 2.9 or > 3.1, a section rule at < 8 s or ≤ 8 s + 1 s, an exit rule that
// lets an equal exit pass (≤ in place of <); a refusal naming no cue, or every cue.
import { describe, it } from 'vitest';
import { AC, FLICKS, RULES, TIMEOUT, docId, enter, kinetic, none, present, presented, refusalFailures, run, scenario, useFolders, useShow } from './helpers.ts';

const show = useShow();
const folder = useFolders();
const opening = enter('cue_opening', 'MAKE');
const coda = enter('cue_coda', 'END');
const sized = (size: number) => kinetic(`A main word ${size / 40} times its sub-line`, [opening, enter('cue_small', 'TINY', 0.5, { sub: 'a sub-line', data: { size, sub_size: 40 } }), coda]);
const section = (wait: number | string) => kinetic('One section', [opening, { id: 'cue_hold', span: wait }], 10);

describe(`${AC[11]} the size, section and exit rules hold at their boundaries, each refusal naming the cue and the rule`, () => {
  it(`${AC[11]} 2.9× fails and 3.1× passes; 8 s plus one flick fails and 8 s passes; an exit as long as its entrance fails`, () => {
    const [small, big, over, exact, exit] = run(show(), scenario(folder(), [
      present(docId(1), sized(116)), present(docId(2), sized(124)),
      present(docId(3), section(7.5 * FLICKS + 1)), present(docId(4), section('7.5s')),
      present(docId(5), kinetic('An exit as long as its entrance', [opening, { id: 'cue_leave', kind: 'fade_out', targets: ['cue_opening'], span: '0.5s' }, coda])),
    ]));
    none([
      ...refusalFailures(small!, 'cue_small', RULES.mainWord, 'a main word 2.9 times its sub-line', 'cue_coda'),
      ...refusalFailures(over!, 'cue_hold', RULES.section, 'a section of 8 s and one flick'),
      ...refusalFailures(exit!, 'cue_leave', RULES.exitFaster, 'an exit as long as its entrance', 'cue_coda'),
    ], 'each film past a boundary is refused, naming its cue and its rule');
    presented(big!, 'a main word 3.1 times its sub-line');
    presented(exact!, 'a section of exactly 8 s');
  }, TIMEOUT);
});
