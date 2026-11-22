// AC1 #2054.46de3b6b: "In a new fixture, a point light word with 800 lm and the range word at 8 expands to one
// `light.point@1` whose `range` is 8, and the same word with no range expands to `range` 5, each within 1e-9, read from
// the expanded item as `power` is read in `tests/acceptance/433/`. A spot light word gives the same two values on
// `light.spot@1`. A planted recipe that accepts the range word and doesn't pass it on leaves our automatic range,
// 35.68 m at 800 lm, and fails, naming the word"
//
// fixtures/light-range.json `ac1`: the engine's point light (godot.omni_light_3d@1) and spot light
// (godot.spot_light_3d@1) at 800 lm, each with its range word (omni_range, spot_range) at 8 and unwritten, in one
// document naming the pack's next minor, shown through `deep-show run`. Each instance must expand to one light of its
// kind whose `params.range` (read with #433's oneOfKind and paramOf, as its lights.test.ts reads `power`) is 8 or 5
// within 1e-9. A light that names no range takes our automatic range and fails, naming the word.
// Wrong programs: the base (no such pack version; the range word refused as unknown); scenario `planted:
// "range_word_dropped"`, a twin of the pack whose two light recipes accept the range word and pass nothing on, which
// must leave point_r8's light with no range (our automatic 35.68 m at 800 lm) and fail, naming omni_range and
// spot_range; our automatic range kept when unwritten; a range scaled, or taken from the other word.

import { describe, expect, it } from 'vitest';
import { arr, failsNaming, none, obj, useDir, useShow } from '../433/helpers.ts';
import { AC, FIXTURE, SLOW, automatic, packProblems, presentedProblems, rangeOf, rangeProblems, showDocs, wordOf, type ShowPlanted } from './helpers.ts';

const bin = useShow();
const dir = useDir();
const AC1 = obj(FIXTURE['ac1'], 'ac1');
const CASES = arr(AC1['cases'], 'ac1.cases').map((c, i) => obj(c, `ac1.cases[${i}]`));

function read(planted?: ShowPlanted) {
  const words = CASES.map((c) => wordOf(c, `ac1 case ${String(c['id'])}`));
  const [reply] = showDocs(bin(), dir(), [['The engine\'s lights with and without their range word', words]], planted);
  const problems = [...packProblems(), ...presentedProblems(reply!, 'the lights\' revision'), ...CASES.flatMap((c) => rangeProblems(reply!, c, AC1['tolerance'] as number))];
  return { reply: reply!, words, problems };
}

describe(`${AC[1]} the range word reaches our range in metres`, () => {
  it(`${AC[1]} a point light word of 800 lm expands to one light.point@1 of range 8 with the range word at 8 and of range 5 without it, and a spot light word gives the same on light.spot@1, each within 1e-9`, () => {
    none(read().problems, 'the expanded lights\' range');
  }, SLOW);

  it(`${AC[1]} the planted range_word_dropped accepts the range word, doesn't pass it on, leaves our automatic range (35.68 m at 800 lm) and fails, naming the word`, () => {
    expect(automatic(800).toFixed(2), 'our automatic range for 800 lm at EV100 5.7635').toBe(String(obj(AC1['automatic'], 'ac1.automatic')['range']));
    const r = read('range_word_dropped');
    const point8 = r.words.find((w) => w.id === 'point_r8')!;
    const { found, range } = rangeOf(r.reply, point8, 'light.point@1');
    expect(found, 'the twin accepts omni_range written as 8: point_r8 expands to one light.point@1').toBeDefined();
    expect(range, 'the twin passes nothing on: point_r8\'s light names no range, so it takes our automatic range').toBeUndefined();
    failsNaming(r.problems, ['omni_range', 'spot_range'], 'the planted range_word_dropped');
  }, SLOW);
});
