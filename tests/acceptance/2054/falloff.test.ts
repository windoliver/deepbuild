// AC3 #2054.b0129c45: "The falloff exponent word written as 2 expands to the same item as the word unwritten. Written
// as 1, and as 0.5, the document's revision holds an issue at `items/<id>/params/<word>` whose fix names 2, and no
// light is drawn for that item. A range of 0 is refused the same way. A planted recipe that accepts 1 and draws the
// inverse square presents a light and fails, naming the word"
//
// fixtures/light-range.json `ac3`, through `deep-show run` with the pack's next minor, every word alone in a revision of
// its own, so each instance stands at the same position (a derived item carries its instance's `order`) and one
// refusal can't hide another. The point light with omni_attenuation 2 and unwritten, and the spot light with
// spot_attenuation 2 and unwritten: each pair must be presented, expand to one light of its kind, and to the same
// items, compared whole with the instance's own ID set aside. omni_attenuation 1 and 0.5 and spot_attenuation 1 must
// leave an issue at items/<id>/params/<word> whose `fix` names 2, and omni_range 0 an issue at
// items/<id>/params/omni_range; none may be drawn (a presented revision holds no derived item of it).
// Wrong programs: the base (no such pack version; the words unknown); scenario `planted: "falloff_one_drawn"`, a twin
// of the pack whose light recipes accept any exponent and draw the inverse square, which must present a light for
// omni_attenuation 1, the same as the unwritten word's, and fail naming omni_attenuation; an exponent dropped
// silently, refused with no fix or a fix that doesn't name 2, refused but drawn; a range of 0 drawn.

import { describe, expect, it } from 'vitest';
import { arr, failsNaming, none, obj, oneOfKind, useDir, useShow } from '../433/helpers.ts';
import { AC, FIXTURE, SLOW, expansionText, packProblems, pairOf, refusedProblems, sameProblems, showDocs, wordOf, type JsonObject, type ShowPlanted, type Word } from './helpers.ts';

const bin = useShow();
const dir = useDir();
const AC3 = obj(FIXTURE['ac3'], 'ac3');
const SAME = arr(AC3['same'], 'ac3.same').map((p, i) => obj(p, `ac3.same[${i}]`));
const REFUSED = arr(AC3['refused'], 'ac3.refused').map((c, i) => obj(c, `ac3.refused[${i}]`));

/** Every AC3 word alone in a revision of its own, through one `deep-show run`: each revision by its word's ID. */
function read(planted?: ShowPlanted) {
  const words: Word[] = [...SAME.flatMap(pairOf), ...REFUSED.map((c) => wordOf(c, `ac3 refused ${String(c['id'])}`))];
  const replies = showDocs(bin(), dir(), words.map((w): [string, Word[]] => [`A falloff or range word alone: ${w.id}`, [w]]), planted);
  const byId = new Map<string, JsonObject>(words.map((w, i) => [w.id, replies[i]!]));
  const problems = [
    ...packProblems(),
    ...SAME.flatMap((p) => { const [a, b] = pairOf(p); return sameProblems(byId.get(a.id)!, byId.get(b.id)!, p); }),
    ...REFUSED.flatMap((c) => refusedProblems(byId.get(String(c['id']))!, c)),
  ];
  return { byId, problems };
}

describe(`${AC[3]} the falloff exponent: 2 accepted, anything else refused with a fix that names 2`, () => {
  it(`${AC[3]} the exponent written as 2 expands to the same item as unwritten; written as 1 and as 0.5 the revision holds an issue at items/<id>/params/<word> whose fix names 2 and no light is drawn, and a range of 0 is refused the same way`, () => {
    none(read().problems, 'the falloff exponent and the range of 0');
  }, SLOW);

  it(`${AC[3]} the planted falloff_one_drawn accepts 1, draws the inverse square, presents a light and fails, naming the word`, () => {
    const r = read('falloff_one_drawn');
    const one = r.byId.get('point_falloff_1')!;
    expect(one['outcome'], 'the twin presents the revision of omni_attenuation written as 1').toBe('presented');
    expect(oneOfKind(one, 'point_falloff_1', 'light.point@1').problem, 'the twin draws a light for omni_attenuation written as 1').toBeUndefined();
    expect(expansionText(one, 'point_falloff_1'), 'the twin draws the inverse square: the light the unwritten word expands to, each alone in its revision')
      .toBe(expansionText(r.byId.get('point_falloff_unwritten')!, 'point_falloff_unwritten'));
    failsNaming(r.problems, ['omni_attenuation'], 'the planted falloff_one_drawn');
  }, SLOW);
});
