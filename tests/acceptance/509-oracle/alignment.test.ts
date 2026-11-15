// #509.d30b5b10 (Oracle lane, port): the word alignment and measure tests the Oracle page pins for criterion 1, from
// jitsi/jiwer at 19e88eae1815e7ca40db9b45b14af5f1f9d8b6ce, tests/test_alignment.py (TestAlignmentVisualizationWords)
// and tests/test_measures.py (TestMeasuresContiguousSentencesTransform), run against our comparison: `deep-show run`'s
// pure call `media_heard {expected: <REF>, heard: <HYP>, locale: "en"}`, the comparison narration.transcript@1 makes
// (Check input: narration.transcript@1). A missing word is upstream's D, an extra one its I and a wrong pair its S. Where
// the upstream alignment is the only one of its cost, the words are held exactly; where equal-cost alignments exist
// (test_all_three, test_show_measures) only the error count is held: upstream's WER times the reference's words.
// Not ported: test_multiple_sentences and test_skip_correct ("one" against "1" is S upstream; normalizer@1 reads both as
// 1 by design, the point of criterion 6), the visualisation's layout and line width, and the character tests.
//
// The test strings and expected values are ported from those files, under their licence:
//   Copyright 2018 8x8, Inc.
//   Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
//   with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
//   Unless required by applicable law or agreed to in writing, software distributed under the License is distributed
//   on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for
//   the specific language governing permissions and limitations under the License.
// Changed from upstream: each case is re-expressed as our comparison's missing, extra and wrong words.
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, hear, proof, useShow, useTemp, type Heard } from '../509/helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

interface Case { from: string; ref: string; hyp: string; missing?: string[]; extra?: string[]; wrong?: [string, string][]; errors: number }
const CASES: Case[] = [
  { from: 'test_alignment.py test_insertion', ref: 'this is a', hyp: 'this is a test', extra: ['test'], missing: [], wrong: [], errors: 1 },
  { from: 'test_alignment.py test_deletion', ref: 'this is a test', hyp: 'this is a', missing: ['test'], extra: [], wrong: [], errors: 1 },
  { from: 'test_alignment.py test_substitution', ref: 'this is a test', hyp: 'this was a test', wrong: [['is', 'was']], missing: [], extra: [], errors: 1 },
  { from: 'test_alignment.py test_all_three', ref: 'this is a test of skill', hyp: 'this was a messy test', errors: 4 },
  { from: 'test_alignment.py test_show_measures (wer=88.89%)', ref: 'this test will  have a high word error rate', hyp: 'no it will not', errors: 8 },
  { from: 'test_alignment.py test_empty_hypothesis', ref: 'empty', hyp: '', missing: ['empty'], extra: [], wrong: [], errors: 1 },
  { from: 'test_alignment.py test_empty_ref_with_hyp_deletion', ref: '', hyp: 'inserted', extra: ['inserted'], missing: [], wrong: [], errors: 1 },
  { from: 'test_measures.py test_input_ref_string_hyp_string (wer 0)', ref: 'This is a test', hyp: 'This is a test', missing: [], extra: [], wrong: [], errors: 0 },
  { from: 'test_measures.py test_input_ref_string_hyp_string (wer 1)', ref: 'This is a test', hyp: '', missing: ['this', 'is', 'a', 'test'], extra: [], wrong: [], errors: 4 },
  { from: 'test_measures.py test_input_ref_string_hyp_string (wer 0.5)', ref: 'This is a test', hyp: 'This test', missing: ['is', 'a'], extra: [], wrong: [], errors: 2 },
  { from: 'test_measures.py test_different_sentence_length_equal_type (wer 7/6)', ref: 'i am a short ground truth', hyp: 'i am a considerably longer and very much incorrect hypothesis', errors: 7 },
  {
    from: 'test_measures.py test_different_sentence_length_unequal_type', ref: 'i like monthy python what do you mean african or european swallow', hyp: 'i like python what you mean or swallow',
    missing: ['monthy', 'do', 'african', 'european'], extra: [], wrong: [], errors: 4,
  },
];

/** Our comparison against one upstream case: each failure names the case. */
function failuresOf(c: Case, h: Heard): string[] {
  const f: string[] = [];
  const at = `${c.from}: REF ${JSON.stringify(c.ref)}, HYP ${JSON.stringify(c.hyp)}`;
  const errors = h.missing.length + h.extra.length + h.wrong.length;
  if (errors !== c.errors) f.push(`${at}: ${errors} errors (missing ${JSON.stringify(h.missing)}, extra ${JSON.stringify(h.extra)}, wrong ${JSON.stringify(h.wrong)}), upstream ${c.errors}`);
  if (h.match !== (c.errors === 0)) f.push(`${at}: match is ${h.match}`);
  const low = (xs: string[]): string[] => xs.map((x) => x.toLowerCase());
  if (c.missing && JSON.stringify(low(h.missing)) !== JSON.stringify(c.missing)) f.push(`${at}: missing ${JSON.stringify(h.missing)}, upstream's deletions ${JSON.stringify(c.missing)}`);
  if (c.extra && JSON.stringify(low(h.extra)) !== JSON.stringify(c.extra)) f.push(`${at}: extra ${JSON.stringify(h.extra)}, upstream's insertions ${JSON.stringify(c.extra)}`);
  if (c.wrong && JSON.stringify(h.wrong.map(low)) !== JSON.stringify(c.wrong)) f.push(`${at}: wrong ${JSON.stringify(h.wrong)}, upstream's substitutions ${JSON.stringify(c.wrong)}`);
  return f;
}

describe(`${AC[1]} the upstream word alignment tests (19e88eae18) on our comparison, media_heard`, () => {
  it(`${AC[1]} each REF and HYP of test_alignment.py and test_measures.py gives upstream's deletions, insertions and substitutions, or its error count where alignments tie`, () => {
    const got = hear(shows.bin(FULL), temp(), CASES.map((c) => ({ expected: c.ref, heard: c.hyp, locale: 'en' })), 'the upstream alignment cases');
    proof('oracle-alignment.json', CASES.map((c, i) => ({ ...c, ours: got[i]!.raw })));
    const failures = CASES.flatMap((c, i) => failuresOf(c, got[i]!));
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});
