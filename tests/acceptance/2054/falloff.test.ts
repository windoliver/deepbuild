// AC3 #2054.b0129c45: "The falloff exponent word written as 2 expands to the same item as the word unwritten. Written
// as 1, and as 0.5, the document's revision holds an issue at `items/<id>/params/<word>` whose fix names 2, and no
// light is drawn for that item. A range of 0 is refused the same way. A planted recipe that accepts 1 and draws the
// inverse square presents a light and fails, naming the word"
//
// fixtures/light-range.json `ac3`, through `deep-show run` with the pack's next minor: one revision holds the point
// light with omni_attenuation 2 and unwritten, and the spot light with spot_attenuation 2 and unwritten; each pair
// must expand to one light of its kind and to the same items (compared with the instance's own ID set aside). Each
// refused case is a revision of its own (so one refusal can't hide another): omni_attenuation 1 and 0.5 and
// spot_attenuation 1 must leave an issue at items/<id>/params/<word> whose `fix` names 2, and omni_range 0 an issue at
// items/<id>/params/omni_range; none may be drawn (a presented revision holds no derived item of it).
// Wrong programs: the base (no such pack version; the words unknown); scenario `planted: "falloff_one_drawn"`, a twin
// of the pack whose light recipes accept any exponent and draw the inverse square, which must present a light for
// omni_attenuation 1, the same as the unwritten word's, and fail naming omni_attenuation; an exponent dropped
// silently, refused with no fix or a fix that doesn't name 2, refused but drawn; a range of 0 drawn.

import { describe, expect, it } from 'vitest';
import { arr, failsNaming, none, obj, oneOfKind, useDir, useShow } from '../433/helpers.ts';
import { AC, FIXTURE, SLOW, expansionText, packProblems, presentedProblems, refusedProblems, sameProblems, showDocs, wordOf, type JsonObject, type ShowPlanted, type Word } from './helpers.ts';

const bin = useShow();
const dir = useDir();
const AC3 = obj(FIXTURE['ac3'], 'ac3');
const SAME = arr(AC3['same'], 'ac3.same').map((p, i) => obj(p, `ac3.same[${i}]`));
const REFUSED = arr(AC3['refused'], 'ac3.refused').map((c, i) => obj(c, `ac3.refused[${i}]`));

function read(planted?: ShowPlanted) {
  const pairs: Word[] = SAME.flatMap((p) => (['written', 'unwritten'] as const).map((k) => wordOf({ ...obj(p[k], `ac3 pair ${k}`), word: p['word']! }, `ac3 pair ${k}`)));
  const docs: [string, Word[]][] = [
    ['The falloff exponent written as 2 and unwritten', pairs],
    ...REFUSED.map((c): [string, Word[]] => [`A light word the pack refuses: ${String(c['id'])}`, [wordOf(c, `ac3 refused ${String(c['id'])}`)]]),
  ];
  const [same, ...refused] = showDocs(bin(), dir(), docs, planted);
  const problems = [
    ...packProblems(),
    ...presentedProblems(same!, 'the revision of the exponent written as 2 and unwritten'),
    ...SAME.flatMap((p) => sameProblems(same!, p)),
    ...REFUSED.flatMap((c, i) => refusedProblems(refused[i]!, c)),
  ];
  const byId = new Map<string, JsonObject>(REFUSED.map((c, i) => [String(c['id']), refused[i]!]));
  return { same: same!, byId, problems };
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
    expect(expansionText(one, 'point_falloff_1'), 'the twin draws the inverse square: the light the unwritten word expands to')
      .toBe(expansionText(r.same, 'point_falloff_unwritten'));
    failsNaming(r.problems, ['omni_attenuation'], 'the planted falloff_one_drawn');
  }, SLOW);
});
