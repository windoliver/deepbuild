// #409.0dc34e08 (AC5): "not_example fails a film that matches its example on 3 of 6 measures and passes one that
// differs on 4"
//
// Fixtures (helpers.ts: `exampleFilm`; README: not_example): the fixture film, which you present (`deep show`) and the
// brief's not_example names in `fixtures`: four 3 s shots (a wide hold, a push and a pan onto the subject, a wide
// hold), one 0.5 s cross-fade at 6 s, a 120 BPM tempo map with two 3-bar sections. The film that matches it on 3 of
// the 6 measures changes the first shot's look (lk-b), the signature transition (a wipe) and the tempo map's section
// shape (90 BPM, sections of 2, 4 and 6 s), and keeps the shot kinds, the camera moves and the last shot. The film that
// differs on 4 changes the camera moves too (the middle shots pull and hold).
//
// asserts: under a brief naming not_example alone (`min_differ` at its default, 4 of 6), the film matching on 3 FAILs
// with craft.not_example and the film differing on 4 PASSes. Wrong programs: the base (no not_example row), and any
// threshold other than 4 of 6 or a measure left uncounted, which flips one of the two.
import { describe, it } from 'vitest';
import { AC, FULL, TIMEOUT, briefOf, code, docId, exampleFilm, failsWith, judge, named, none, passes, useBuilds, useFolders, type Film } from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const EXAMPLE = docId(90);

describe(`${AC[5]} not_example: 4 of 6 measures must differ from the nearest example`, () => {
  it(`${AC[5]} a film matching its fixture film on 3 of 6 measures fails, and one differing on 4 passes`, () => {
    const brief = briefOf(named('not_example', { fixtures: [EXAMPLE] }));
    const changed = { first: true, transition: true, tempo: true };
    const films: Film[] = [
      { name: 'the film matching its example on 3 of 6', doc: docId(1), document: exampleFilm(docId(1), changed), brief },
      { name: 'the film differing on 4 of 6', doc: docId(2), document: exampleFilm(docId(2), { ...changed, moves: true }), brief },
    ];
    const { judged } = judge(bin(FULL), folder(), films, { fixtures: [{ doc: EXAMPLE, document: exampleFilm(EXAMPLE) }] });
    none([
      ...failsWith(judged[films[0]!.name], 'not_example', code('not_example'), { anyOf: ['part-1', 'part-2', 'part-3', 'part-4'], tIn: [0, 12] }, films[0]!.name),
      ...passes(judged[films[1]!.name], 'not_example', films[1]!.name),
    ], 'not_example against the fixture film');
  }, TIMEOUT);
});
