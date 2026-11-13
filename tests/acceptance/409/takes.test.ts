// #409.c2d0c9cf (AC6): "A brief with one declared 18 s long take passes shot_length, and a second long take fails
// naming it"
//
// Fixtures (helpers.ts: `takesFilm`; README: The long take): under a brief naming shot_length with its one long take
// declared (`signature: {count: 1, max: 20s}`), a film of a 3 s shot, an 18 s take (take-2) and a 3 s shot; and a film
// that adds a second 18 s take after another 3 s shot (take-4, from 24 s). Every other shot is within min 2 s and max
// 6 s.
//
// asserts: the film with one long take PASSes shot_length with no error or warning; the film with two FAILs with
// craft.shot_length naming take-4 at its first frame, 24 s, and no shot_length error names take-2, the declared one.
// Wrong programs: the base (no shot_length row), a check that ignores the declaration (fails take-2) or allows any
// number of long takes (passes take-4).
import { describe, it } from 'vitest';
import { AC, FULL, TIMEOUT, briefOf, code, docId, failsWith, judge, named, noErrorNaming, none, passes, takesFilm, useBuilds, useFolders, type Film } from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

describe(`${AC[6]} shot_length: one declared long take`, () => {
  it(`${AC[6]} one declared 18 s long take passes shot_length, and a second fails naming it`, () => {
    const brief = briefOf(named('shot_length', { signature: { count: 1, max: '20s' } }));
    const films: Film[] = [
      { name: 'the film with one 18 s take', doc: docId(1), document: takesFilm(docId(1), [3, 18, 3]), brief },
      { name: 'the film with a second 18 s take', doc: docId(2), document: takesFilm(docId(2), [3, 18, 3, 18]), brief },
    ];
    const { judged } = judge(bin(FULL), folder(), films);
    none([
      ...passes(judged[films[0]!.name], 'shot_length', films[0]!.name),
      ...failsWith(judged[films[1]!.name], 'shot_length', code('shot_length'), { shots: ['take-4'], t: 24 }, films[1]!.name),
      ...noErrorNaming(judged[films[1]!.name], code('shot_length'), 'take-2', films[1]!.name),
    ], 'the declared long take');
  }, TIMEOUT);
});
