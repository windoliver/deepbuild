// AC2 #1430.c8134c7e: "A property test over random text, fonts, sizes and widths: output from the split cache is
// byte-equal to output from an empty cache. A planted key missing the font fails it"
//
// The cases come from the recorded seed (helpers: generate): 160 layouts of eleven random texts, some sharing
// paragraphs and some one typed character apart, in the three font roles at random sizes and widths. One `deep-text
// shape` process lays them out in turn, each asking for its `run`, the text's whole output (README); each case is also
// laid out alone in a fresh process, whose cache is empty. Every pair must be byte-equal. A difference is shrunk to the
// fewest earlier cases that still make it, and named with the seed. `--planted key_without_font` is the criterion's
// wrong program: a shape key that leaves the font out.
import { describe, it } from 'vitest';
import { AC, CASES, SEED, TIMEOUT, failsNaming, faces, generate, meetingFailures, none, propertyFailures, useRelease } from './helpers.ts';

useRelease('deep-text');
const ID = AC[2];

describe(`${ID} the split cache's output is byte-equal to an empty cache's, over random texts, fonts, sizes and widths`, () => {
  it(`${ID} over ${CASES} layouts from seed ${SEED} of random texts, fonts, sizes and widths laid out in turn, each output from the split cache is byte-equal to the same layout's output from an empty cache`, () => {
    const cases = generate();
    none(meetingFailures(cases), `the cases from seed ${SEED}`);
    none(propertyFailures(cases.cases, faces()), `the split cache against an empty cache, seed ${SEED}`);
  }, TIMEOUT);

  it(`${ID} the planted key missing the font fails the property, naming the case, its first difference and the shrunk cases`, () => {
    failsNaming(propertyFailures(generate().cases, faces(), 'key_without_font'), [
      /^seed 1430, case \d+ of 160 \(.+\): the split cache's output differs from an empty cache's: /,
      /^shrunk to \d+ cases? laid out in turn/,
    ], 'the planted key missing the font');
  }, TIMEOUT);
});
