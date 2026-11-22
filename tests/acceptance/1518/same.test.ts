// #1518.b19abf07: "The same recording, list and tool version give byte-identical strips"
//
// The video recording cut at words 3, 6, 10 and 13 (README: Fixtures), one build of deep-show. Run 1 presents it as
// document a. Run 2, a fresh process, first presents the same recording under another keep list as document a, then the
// first document as documents b and c. The expansion's row as deep show answers it, its strips, pictures, channels,
// removed, fragments and cuts, is the same text byte for byte each time (rowText). The rows are not empty: five strips,
// five pictures and eight cuts; and the other list's row differs, so the comparison can tell two lists apart.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, TIMEOUT, VIDEO_KEEP, VIDEO_REMOVED, cutRow, present, presented, proof, rowText, runShow, scenario, stageVideo, useShow, useTemp, videoFilm,
  type Keep,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const OTHER: Keep = [[0, 7], [9, 15]];

describe(`${AC[6]} the same recording, list and tool version give byte-identical strips`, () => {
  it(`${AC[6]} two fresh runs, and the same document presented after another list's, give the same row byte for byte`, () => {
    const bin = shows.bin(FULL);
    const evidence = temp();
    const v = stageVideo(bin, evidence);
    const doc = videoFilm(v.sha, [v.record], VIDEO_KEEP);
    const [one] = runShow(bin, scenario(evidence, [present(DOC.a, doc)]), 'run 1');
    const [other, two, three] = runShow(bin, scenario(evidence, [present(DOC.a, videoFilm(v.sha, [v.record], OTHER)), present(DOC.b, doc), present(DOC.c, doc)]), 'run 2');
    const rows = [
      cutRow(presented(one, 'run 1, document a'), 'run 1, document a'), cutRow(presented(two, 'run 2, document b'), 'run 2, document b'),
      cutRow(presented(three, 'run 2, document c'), 'run 2, document c'),
    ];
    const another = cutRow(presented(other, 'run 2, document a, another list'), 'run 2, another list');
    proof('ac6-same.json', { rows: rows.map(rowText), other: rowText(another) });

    expect([rows[0]!.strips.length, rows[0]!.derived.length, rows[0]!.cuts.length], 'the row isn\'t empty: five strips, five pictures, eight cuts').toEqual([5, 5, 8]);
    expect(rows[0]!.removed, 'the row removes words 3, 6, 10 and 13').toEqual([...VIDEO_REMOVED]);
    expect(rowText(rows[1]!), 'a fresh run gives the same row byte for byte').toBe(rowText(rows[0]!));
    expect(rowText(rows[2]!), 'the same document presented again after another list\'s gives the same row byte for byte').toBe(rowText(rows[0]!));
    expect(rowText(another), 'another keep list gives another row').not.toBe(rowText(rows[0]!));
  }, TIMEOUT);
});
