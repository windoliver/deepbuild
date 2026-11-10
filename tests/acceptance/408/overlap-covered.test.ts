// #408.72c2e372: "Two vector@1 formulas sharing 6% of the smaller box fail layout.overlap and at 4% pass, and a
// match_morph's source and target in one place never fail; an opaque rect drawn after a text over 40% of its samples
// fails layout.covered with share 0.41 ± 0.02, and the same rect drawn first passes"
//
// Fixtures (helpers.ts), 1920 × 1080 films with cue ends 1, 2.5 and 4 s. Each formula is a vector@1 over an SVG in
// the evidence store whose one part fills its viewBox, so the part's glyph box is the item's box, exactly:
//   - `overlapFilm`: formula-a, 200 × 100 u at (400, 400), and formula-b, 300 × 100 u at (588, 400): they share
//     12 × 100 u², 6% of formula-a's 20,000 u², the smaller box; at (592, 400), 4%;
//   - `morphFilm`: two copies of one formula at (400, 400), morph-from and morph-to, a match_morph from one to the other
//     over [2, 3] s; the control, the same two with no transition, shares 100% of the box;
//   - `coveredFilm`: the text@1 `cap` ("HHHHHHHH", centred on x = 960) and the opaque ink rect `veil` covering its whole
//     height from the left to 12 u short of its centre: 3 of the 7 columns of its 7 × 7 samples, 21 of 49 (0.43), drawn
//     after the text, or first.
//
// asserts: one verdict per film on this Mac, each on one requirement `{kind: film.layout}`:
//   - 6%: FAIL, exactly one layout.overlap, an error, naming formula-a and formula-b, share 0.06 ± 0.001; 4%: PASS;
//   - the morph's two copies: PASS at every cue end; control without the morph: one layout.overlap naming both, share 1;
//   - the rect drawn after: FAIL, exactly one layout.covered, an error, naming cap and veil, share 0.41 ± 0.02; drawn
//     first: PASS.
import { describe, it } from 'vitest';
import {
  AC, FORMULA_A, FORMULA_B, FULL, TIMEOUT, blockSvg, coveredFailures, coveredFilm, docId, judge, morphFilm, none, overlapFailures, overlapFilm,
  passFailures, putStore, useBuilds, useFolders, type Film,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

describe(`${AC[2]} formulas that share over 5% of the smaller box overlap, a morph's two copies never do, and a rect drawn over a text covers it`, () => {
  it(`${AC[2]} formulas sharing 6% fail layout.overlap and 4% pass; a match_morph's two copies in one place pass; a rect drawn after a text over 21 of 49 samples fails layout.covered at 0.41 ± 0.02, and drawn first passes`, () => {
    const evidence = folder();
    const srcA = putStore(evidence, blockSvg(...FORMULA_A, 'term'));
    const srcB = putStore(evidence, blockSvg(...FORMULA_B, 'term'));
    const films: Film[] = [
      { name: 'formulas sharing 6%', doc: docId(1), document: overlapFilm(docId(1), srcA, srcB, 588) },
      { name: 'formulas sharing 4%', doc: docId(2), document: overlapFilm(docId(2), srcA, srcB, 592) },
      { name: "a match_morph's two copies in one place", doc: docId(3), document: morphFilm(docId(3), srcA, true) },
      { name: 'two copies in one place with no morph', doc: docId(4), document: morphFilm(docId(4), srcA, false) },
      { name: 'an opaque rect drawn after the text', doc: docId(5), document: coveredFilm(docId(5), false) },
      { name: 'the same rect drawn first', doc: docId(6), document: coveredFilm(docId(6), true) },
    ];
    const { rows } = judge(bin(FULL), evidence, films);
    const row = (k: number) => rows[films[k]!.name];
    none(overlapFailures(row(0), 'formula-a', 'formula-b', 0.06, 0.001), films[0]!.name);
    none(passFailures(row(1), films[1]!.name), films[1]!.name);
    none(passFailures(row(2), films[2]!.name), films[2]!.name);
    none(overlapFailures(row(3), 'morph-from', 'morph-to', 1, 0.001), `control: ${films[3]!.name}`);
    none(coveredFailures(row(4), 'cap', 'veil', 0.41, 0.02), films[4]!.name);
    none(passFailures(row(5), films[5]!.name), films[5]!.name);
  }, TIMEOUT);
});
