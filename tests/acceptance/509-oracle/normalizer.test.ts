// #509.637f3d04 (Oracle lane, port): the reference normalizer's tests the Oracle page pins for criterion 6, from
// openai/whisper at 31243bad24cc746f07d4c8bfdd2d974872cb1803, tests/test_normalizer.py (test_number_normalizer,
// test_spelling_normalizer, test_text_normalizer), run against normalizer@1 through our comparison: `media_heard
// {expected: <the spoken form>, heard: <upstream's normalized form>, locale: "en"}` must match, and the spoken form's
// tokens after normalizer@1, joined by spaces, must be upstream's output. Ported: the cases whose forms normalizer@1
// states a rule for (Check input: narration.transcript@1: number words to digit tokens with adjacent groups joined,
// ordinals to digits and the suffix, `percent` to %, contractions spelt out, British spellings to American); for the
// percentage only the match is held, since the design doesn't say whether % stands as a token of its own. Not ported,
// as normalizer@1 states no rule for them: currency and cents, decimals ("point"), "double"/"triple", signs, fractions
// ("and a half"), plurals of numbers ("nineteen fifties", "millions"), "per cent", dates, units split from digits
// (10km), titles and abbreviations (Mr., Prof.), and "he's"/"she's", whose reading upstream takes from context.
//
// The test strings and expected values are ported from that file, under its licence:
//   MIT License. Copyright (c) 2022 OpenAI
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
//   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
//   and this permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, hear, proof, useShow, useTemp } from '../509/helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** [upstream's input, upstream's output, whether the tokens are held to it]. */
const CASES: [string, string, boolean][] = [
  ['two', '2', true],
  ['thirty one', '31', true],
  ['five twenty four', '524', true],
  ['nineteen ninety nine', '1999', true],
  ['twenty nineteen', '2019', true],
  ['three thousand twenty nine', '3029', true],
  ['forty three thousand two hundred sixty', '43260', true],
  ['thirty first', '31st', true],
  ['three billion', '3000000000', true],
  ['ninety percent', '90%', false],
  ['nine one one', '911', true],
  ['two thousandth', '2000th', true],
  ['thirty two thousandth', '32000th', true],
  ['10th', '10th', true],
  ['mobilisation', 'mobilization', true],
  ["Let's", 'let us', true],
];

describe(`${AC[6]} the reference normalizer's number, spelling and text cases (31243bad24) on normalizer@1`, () => {
  it(`${AC[6]} each case's spoken form matches upstream's output through media_heard, and reads as its tokens`, () => {
    const got = hear(shows.bin(FULL), temp(), CASES.map(([input, output]) => ({ expected: input, heard: output, locale: 'en' })), 'the upstream normalizer cases');
    proof('oracle-normalizer.json', CASES.map(([input, output], i) => ({ input, output, ours: got[i]!.raw })));
    const failures = CASES.flatMap(([input, output, tokens], i) => {
      const h = got[i]!;
      const f: string[] = [];
      if (!h.match) f.push(`std(${JSON.stringify(input)}) == ${JSON.stringify(output)}: ${JSON.stringify(input)} heard as ${JSON.stringify(output)} does not match: ${JSON.stringify(h.raw)}`);
      if (tokens && h.expected.join(' ') !== output) f.push(`std(${JSON.stringify(input)}) == ${JSON.stringify(output)}: normalizer@1 reads ${JSON.stringify(h.expected)}`);
      return f;
    });
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});
