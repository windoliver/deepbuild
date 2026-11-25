// AC4 #3032.876d5479: "For each mapped light, a fixture states the library's own value and ours with the conversion
// between them, as `familiar.point_light@1` states candela against lumens, and a planted recipe that copies the number
// as written fails, naming both values"
//
// fixtures/lights.json states, for each of the four lights among the twenty, the library's number with its unit and
// what it means in the picture (by the reference's own lines at the pin), our field with its unit (by the design),
// the conversion between them, and cases: the library's words, its value, and what the expanded item must hold.
// judges.ts derives every expected number again from the words (CONVERSIONS), and a fixture that states another fails
// before anything runs. Which lights the tree maps is read from its census. Each case of each mapped light is written
// alone in a document of its own through `deep-show run` with the tree's pack installed, and its instance must lower
// to one item of the light's kind holding ours within 1e-9: the number written, and the library's own default
// unwritten (1, on a face of 10 m × 10 m), never ours.
// The second test runs the planted `light_number_copied` on each mapped light whose number differs between the two
// (an ambient or hemisphere light's lux against our sky's cd/m², an area light's cd/m² against our lumens): a copy of
// the tree's pack whose recipe for that light is replaced by one that copies the number as written (the fixture's
// `planted`). The copy as shipped must pass the judge; the planted one must install, leave the library's number in
// our field, and fail every case with a failure that names both values, the library's and ours. A directional
// light's number is lux in both, so a recipe that copies it is the right one (the fixture's `copied` says so) and no
// planted program runs on it. A tree that maps no light whose number differs leaves the criterion's wrong program
// unproven, and the test fails as INCONCLUSIVE, never passing.
// Wrong programs: the merge base, which maps none of the four; our own default kept where the word is unwritten
// (10,000 lx, 800 lm, 0.5 m); an ambient light written as its illuminance; lumens taken for nits; the planted recipe.

import { describe, expect, it } from 'vitest';
import { SLOW, WORD, copyPack, failsNaming, familiar, installs, none, plantCopied, run, showWord, sub, suite, useShow, useTemp, type Familiar, type Suite } from './helpers.ts';
import { AC, LIGHTS, copiedNumber, decided, fmt, libraryText, lightProblems, oursText, recipeFor, type JsonObject, type Light } from './judges.ts';

const bin = useShow();
const temp = useTemp();

/** The lights of the fixture the tree's census maps. */
const mappedLights = (s: Suite, pack: Familiar): Light[] => {
  const mapped = decided(pack.census, LIGHTS).mapped.map((row) => row.name);
  return s.lights.filter((light) => mapped.includes(light.name));
};
/** Each case of `light` in a document of its own, under the pack in `pack.dir`: the replies, in the cases' order. */
function shown(pack: Familiar, light: Light, evidence: string, what: string): JsonObject[] {
  const calls = light.cases.map((c, i) => showWord(i, pack, `${light.name}: ${c.id}`, { kind: recipeFor(pack.manifest, light.name), params: c.params }));
  const { installed, replies } = run(bin(), evidence, pack, calls);
  installs(installed, what);
  return replies;
}

describe(`${AC[4]} the lights' conversions`, () => {
  it(`${AC[4]} for each light the census maps, the fixture states the library's own value and ours with the conversion between them, and the recipe's item holds ours`, () => {
    const s = suite();
    const pack = familiar();
    const lights = mappedLights(s, pack);
    expect(lights.length, `the census maps at least one of the four lights, so there is a number to convert; it maps none of ${LIGHTS.join(', ')}`).toBeGreaterThan(0);
    const problems = lights.flatMap((light) => {
      const replies = shown(pack, light, sub(temp(), `evidence-${light.name}`), `packs/${pack.folder}`);
      return light.cases.flatMap((c, i) => lightProblems(replies[i]!, WORD, light, c, s.tolerance));
    });
    none(problems, 'the lights the census maps');
  }, SLOW);

  it(`${AC[4]} the planted light_number_copied, a recipe that copies the library's number as written, fails, naming both values`, () => {
    const s = suite();
    const pack = familiar();
    const lights = mappedLights(s, pack).filter((light) => !light.sameNumber);
    const differ = s.lights.filter((light) => !light.sameNumber).map((light) => light.name);
    expect(lights.length, `INCONCLUSIVE unless the census maps a light whose number differs between the library and ours (${differ.join(', ')}): a recipe that copies the number is wrong only for those, and it maps none of them`).toBeGreaterThan(0);

    for (const light of lights) {
      const control = copyPack(pack, sub(temp(), `control-${light.name}`));
      const right = shown(control, light, sub(temp(), `evidence-control-${light.name}`), 'a copy of the pack as shipped');
      none(light.cases.flatMap((c, i) => lightProblems(right[i]!, WORD, light, c, s.tolerance)), `${light.name} under the pack as shipped`);

      const planted = copyPack(pack, sub(temp(), `planted-${light.name}`));
      plantCopied(planted, light);
      const wrong = shown(planted, light, sub(temp(), `evidence-planted-${light.name}`), `the planted light_number_copied on ${light.name}, a wrong program that runs,`);
      light.cases.forEach((c, i) => {
        const [first] = Object.keys(light.fields);
        expect(fmt(copiedNumber(wrong[i]!, WORD, light, first!) ?? NaN), `${light.name} ${c.id}: the planted recipe leaves the library's ${libraryText(light, c)} in our ${first!} as written`).toBe(fmt(c.library));
        failsNaming(lightProblems(wrong[i]!, WORD, light, c, s.tolerance), [light.name, libraryText(light, c), ...oursText(light, c)], `the planted light_number_copied on ${light.name} (${c.id})`);
      });
    }
  }, SLOW);
});
