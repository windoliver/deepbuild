// AC1 #222.88afab32: "A five-cue list (create a square over 1 s; move it 3 u right `after`; turn 45° `with` it; wait
// 1 s; fade out 0.5 s) expands to keys at exactly 0, 1, 2, 2, 3 and 3.5 s in flicks, and its evaluated data at 2.5 s
// equals a hand-written channel document by evaluated-data hash; a planted expander that starts `with` cues at the
// previous cue's end fails at 2.5 s"
//
// The list (README: Documents): `draw` create over 1 s; `slide` after, `set: {at/pos: [3, 0, 0]}` (the square starts
// at the origin, so 3 u right); `turn` with, `set: {at/rot/2: 45}`; `rest`, a wait of 1 s; `fade` fade_out over
// 0.5 s. Read off `deep show`'s expansion of the list (README: The expansion): the list's start and its five cues'
// ends, in order, are exactly 0, 1, 2, 2, 3 and 3.5 s in flicks (the markers `cues.<id>`), every key the expansion
// writes lies on one of those times, and the move and the turn each key exactly 1 s and 2 s. The hand-written
// document holds the same square with the move, the turn and the fade written as channels on sigmoid(10), the cues'
// default ease (create's path build has no hand-written form a blind test can give; at 2.5 s it has ended and the
// square is fully drawn). At 2.5 s both evaluate to the square at (3, 0), turned 45°, opaque: equal `data_hash`.
//
// Wrong programs: an expander that ignores `when` (every cue after the previous) or `with` at the previous cue's
// end puts the turn at 2–3 s, so the markers read 0, 1, 2, 3, 4, 4.5 and at 2.5 s the turn is halfway (22.5°);
// an expander that writes nothing leaves the square at the origin at 2.5 s. The planted expander
// `cue_with_at_previous_end` is that wrong program, and its `data_hash` at 2.5 s must differ from the hand-written one.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, VERBS_AT, VERBS_PACK, WITH_AT_END, channel, cueList, dataHashOf, docId, evalAt, expansionOf, fl, film, markerOf, none, present,
  presented, run, scenario, showTime, square, useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

const SQ = 'sq';
const FIVE: JsonObject[] = [
  { id: 'draw', kind: 'create', targets: [SQ], span: '1s' },
  { id: 'slide', when: 'after', targets: [SQ], set: { 'at/pos': [3, 0, 0] } },
  { id: 'turn', when: 'with', targets: [SQ], set: { 'at/rot/2': 45 } },
  { id: 'rest', span: '1s' },
  { id: 'fade', kind: 'fade_out', targets: [SQ], span: '0.5s' },
];
const cued = film('Five cues', [square(SQ), cueList(FIVE)], { span: 4, packs: [VERBS_AT] });
const byHand = film('Five cues written by hand', [square(SQ)], {
  span: 4,
  extra: {
    channels: {
      slide: channel(`items/${SQ}/at/pos`, 'vec3', [[1, [0, 0, 0]], [2, [3, 0, 0]]]),
      turn: channel(`items/${SQ}/at/rot/2`, 'angle', [[1, 0], [2, 45]]),
      fade: channel(`items/${SQ}/adjust/opacity`, 'f32', [[3, 1], [3.5, 0]]),
    },
  },
});
const CUED = docId(1);
const HAND = docId(2);
const AT = fl(2.5);
const calls = (): JsonObject[] => [present(CUED, cued), present(HAND, byHand), evalAt(CUED, AT, { hash: true }), evalAt(HAND, AT, { hash: true })];

describe(`${AC[1]} a five-cue list expands at check to exact keys and evaluates as the same channels written by hand`, () => {
  it(`${AC[1]} expands to keys at exactly 0, 1, 2, 2, 3 and 3.5 s in flicks, and at 2.5 s equals the hand-written channel document by evaluated-data hash`, () => {
    const [shown, hand, cuedAt, handAt] = run(show(), scenario(folder(), calls(), { packs: [VERBS_PACK] }));
    presented(shown!, 'the five-cue list');
    presented(hand!, 'the hand-written channel document');
    const e = expansionOf(shown!, 'the five-cue list');

    const ends = FIVE.map((c) => { const m = markerOf(e, String(c['id']), 'the five-cue list'); return m.t + m.span; });
    const times = [markerOf(e, 'draw', 'the five-cue list').t, ...ends];
    const want = [0, 1, 2, 2, 3, 3.5].map(fl);
    expect(times, `the list's start and its cues' ends, in order, are 0, 1, 2, 2, 3 and 3.5 s exactly; got ${times.map(showTime).join(', ')}`).toEqual(want);

    const failures: string[] = [];
    const on = new Set(want);
    for (const c of e.channels) for (const t of c.times) if (!on.has(t)) failures.push(`${c.id} (${c.target}) keys ${showTime(t)}, not one of 0, 1, 2, 3, 3.5 s`);
    for (const t of new Set(want)) if (!e.channels.some((c) => c.times.includes(t))) failures.push(`no key lies at ${showTime(t)}`);
    for (const target of [`items/${SQ}/at/pos`, `items/${SQ}/at/rot/2`]) {
      const writes = e.channels.filter((c) => c.target === target);
      const keyed = writes.flatMap((c) => c.times);
      if (writes.length === 0) failures.push(`the expansion writes no channel on ${target}`);
      else if (JSON.stringify(keyed) !== JSON.stringify([fl(1), fl(2)])) failures.push(`${target} is keyed at ${keyed.map(showTime).join(', ')}, not exactly 1 s and 2 s`);
    }
    none(failures, 'every key the expansion writes lies on the cues\' exact times');

    expect(dataHashOf(cuedAt!, 'the five-cue list at 2.5 s'), 'at 2.5 s the list\'s evaluated data equals the hand-written channels\' by evaluated-data hash').toBe(dataHashOf(handAt!, 'the hand-written document at 2.5 s'));
  }, TIMEOUT);

  it(`${AC[1]} the planted expander that starts \`with\` cues at the previous cue's end fails at 2.5 s`, () => {
    const [shown, hand, cuedAt, handAt] = run(show(), scenario(folder(), calls(), { packs: [VERBS_PACK], planted: WITH_AT_END }));
    presented(shown!, 'the five-cue list under the planted expander');
    presented(hand!, 'the hand-written channel document');
    expect(dataHashOf(cuedAt!, 'the planted expansion at 2.5 s'), 'under the planted expander the list\'s evaluated data at 2.5 s differs from the hand-written channels\'').not.toBe(dataHashOf(handAt!, 'the hand-written document at 2.5 s'));
  }, TIMEOUT);
});
