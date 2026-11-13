// #407.b38e05f8 (AC4): "A headline that wraps past its line limit with the longest copy fails, naming the copy and the
// frame"
// #407.64b30d68 (AC6): "A reading hold too short for its words, a state mismatch at a shot boundary, or a cursor crossing
// text fails, naming the frame"
// #407.0ee0ea87 (AC7): "Each film check (reading holds, line limits, shot boundaries, cursor paths, flicker, honest
// numbers) has a parity fixture and a planted-fault twin that fails with its exact code and frame"
//
// One scenario judges twelve films (helpers.ts), a parity fixture and its planted-fault twin per film check:
//   - reading holds {kind: film.audit}: "Steam lifts the lid." (need 2.633 s) shown from 1 s for 2.75 s / 2.55 s.
//   - line limits {kind: film.audit}: the text@1 `headline`, copy key `headline` in en and de, 48 u in a 400 u box
//     that doesn't grow, `max_lines: 2`, shown from 1 s in an en film. Parity: en "The kettle sings", de "Der Kessel
//     singt"; twin: de "Der Wasserkessel singt laut und pfeift hell über dem alten Herd", four lines or more.
//   - shot boundaries {kind: film.audit}: shots [0, 3) and [3, 6) s framing the same page and a cut carrying the kettle;
//     the twin moves the kettle 300 u at the cut.
//   - cursor paths {kind: film.audit, cursor_path: {item: cursor, presses: [pour]}}: texts "Stir" (x from 605) and
//     "Pour" (x from 1305), 48 u, and an 8 u cursor that ends on "Pour" at 3 s; parity goes over "Stir" along y = 700,
//     the twin along y = 885 through its glyphs, reaching them between 1.69 and 1.72 s.
//   - flicker {kind: film.flicker}: the mid-grey quarter at 2 Hz / 4 Hz (flicker.test.ts).
//   - honest numbers {kind: honest_numbers}: "Boils in … min" shown from 2 s, its number a story constant through a
//     template / the literal "4".
//
// asserts:
//   - AC4: the twin headline FAILs with a film.line_limit naming the headline and the copy de, at t = 1 s.
//   - AC6: the short hold FAILs with a film.hold_short at t = 1 s; the jump FAILs with a film.boundary naming the kettle
//     at t = 3 s, the cut; the cursor through "Stir" FAILs with a film.cursor_crossing naming stir, its frame in
//     [1.65, 1.75] s; none names the pressed "Pour".
//   - AC7: each parity fixture PASSes with nothing raised, and each twin FAILs with an error of exactly its code naming
//     its frame: film.hold_short 1 s, film.line_limit 1 s, film.boundary 3 s, film.cursor_crossing [1.65, 1.75] s,
//     film.flash 1 s (within a frame at 24 frames a second), number_unsourced 2 s.
import { describe, it } from 'vitest';
import {
  AC, AUDIT, BOUNDARY, CURSOR, CURSOR_CHECK, FLASH, FLICKER, FLICKER_FPS, FULL, HEADLINE_DE_LONG, HEADLINE_DE_SHORT, HOLD, HONEST, LINE_LIMIT, STEAM,
  TIMEOUT, UNSOURCED, boundaryFilm, cursorFilm, docId, failsWith, field, headlineFilm, holdFilm, judge, mentions, none, noneOf, numberFilm,
  passFailures, quarterFilm, useBuilds, useFolders, type Expect, type Film, type Judged, type Row,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

interface Check { check: string; code: string; parity: string; twin: string; expect: Expect }
const CHECKS: Check[] = [
  { check: 'reading holds', code: HOLD, parity: 'the steam line held 2.75 s', twin: 'the steam line held 2.55 s', expect: { subject: 'steam', match: (i) => mentions(i, 'steam'), t: 1 } },
  { check: 'line limits', code: LINE_LIMIT, parity: 'the headline whose copies fit', twin: 'the headline whose de copy wraps', expect: { subject: 'headline in its de copy', match: (i) => mentions(i, 'headline') && field(i, 'locale') === 'de', t: 1 } },
  { check: 'shot boundaries', code: BOUNDARY, parity: 'the kettle carried across the cut', twin: 'the kettle jumping at the cut', expect: { subject: 'kettle', match: (i) => mentions(i, 'kettle'), t: 3 } },
  { check: 'cursor paths', code: CURSOR, parity: 'the cursor going over Stir', twin: 'the cursor crossing Stir', expect: { subject: 'stir', match: (i) => mentions(i, 'stir'), tIn: [1.65, 1.75] } },
  { check: 'flicker', code: FLASH, parity: 'the mid-grey quarter at 2 Hz', twin: 'the mid-grey quarter at 4 Hz', expect: { subject: 'a flash from 1 s', match: () => true, t: 1, within: 1 / FLICKER_FPS + 1e-6 } },
  { check: 'honest numbers', code: UNSOURCED, parity: 'the story number', twin: 'the literal number', expect: { subject: 'wait', match: (i) => mentions(i, 'wait'), t: 2 } },
];

function films(): Film[] {
  let n = 0;
  const f = (name: string, document: (doc: string) => Film['document'], check: Film['check'] = AUDIT, stored?: Buffer[]): Film => {
    const doc = docId(++n);
    return { name, doc, document: document(doc), check, ...(stored ? { stored } : {}) };
  };
  const quarter = (hz: number, name: string): Film => {
    const doc = docId(++n);
    const made = quarterFilm(doc, hz);
    return { name, doc, document: made.document, stored: made.stored, check: FLICKER };
  };
  return [
    f('the steam line held 2.75 s', (d) => holdFilm(d, 'steam', STEAM, 1, 2.75)),
    f('the steam line held 2.55 s', (d) => holdFilm(d, 'steam', STEAM, 1, 2.55)),
    f('the headline whose copies fit', (d) => headlineFilm(d, HEADLINE_DE_SHORT)),
    f('the headline whose de copy wraps', (d) => headlineFilm(d, HEADLINE_DE_LONG)),
    f('the kettle carried across the cut', (d) => boundaryFilm(d, false)),
    f('the kettle jumping at the cut', (d) => boundaryFilm(d, true)),
    f('the cursor going over Stir', (d) => cursorFilm(d, false), CURSOR_CHECK),
    f('the cursor crossing Stir', (d) => cursorFilm(d, true), CURSOR_CHECK),
    quarter(2, 'the mid-grey quarter at 2 Hz'),
    quarter(4, 'the mid-grey quarter at 4 Hz'),
    f('the story number', (d) => numberFilm(d, false), HONEST),
    f('the literal number', (d) => numberFilm(d, true), HONEST),
  ];
}
// The three tests read one scenario's verdicts, judged once.
let judged: Record<string, Judged> | null = null;
function rows(): (name: string) => Row | undefined {
  judged ??= judge(bin(FULL), folder(), films()).judged;
  return (name: string) => judged![name]?.row;
}
const byCheck = (check: string): Check => CHECKS.find((c) => c.check === check)!;

describe(`${AC[4]} the longest headline is held to its line limit`, () => {
  it(`${AC[4]} a headline that wraps past its line limit with its longest copy fails, naming the copy and the frame`, () => {
    const c = byCheck('line limits');
    none(failsWith(rows()(c.twin), c.code, c.expect, c.twin), 'the line limit');
  }, TIMEOUT);
});

describe(`${AC[6]} the film checks name the frame`, () => {
  it(`${AC[6]} a reading hold too short for its words, a state mismatch at a shot boundary and a cursor crossing text each fail, naming the frame`, () => {
    const row = rows();
    const failures: string[] = [];
    for (const name of ['reading holds', 'shot boundaries', 'cursor paths']) {
      const c = byCheck(name);
      failures.push(...failsWith(row(c.twin), c.code, c.expect, c.twin));
    }
    failures.push(...noneOf(row('the cursor crossing Stir'), CURSOR, (i) => mentions(i, 'pour'), 'pour, the text it presses', 'the cursor crossing Stir'));
    none(failures, 'the film checks');
  }, TIMEOUT);
});

describe(`${AC[7]} each film check has a parity fixture and a planted-fault twin`, () => {
  it(`${AC[7]} reading holds, line limits, shot boundaries, cursor paths, flicker and honest numbers: each parity fixture passes and each twin fails with its exact code and frame`, () => {
    const row = rows();
    none(CHECKS.flatMap((c) => [
      ...passFailures(row(c.parity), `${c.check}: ${c.parity}`),
      ...failsWith(row(c.twin), c.code, c.expect, `${c.check}: ${c.twin}`),
    ]), 'the parity fixtures and their twins');
  }, TIMEOUT);
});
