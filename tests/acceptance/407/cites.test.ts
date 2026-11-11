// #407.58086c02 (AC11): "A brief with one source and a six-line script, each line with a quote from it, passes. With
// line 4's citation removed it fails `film.uncited` naming the line and its frame; with a quote changed by one word it
// fails `film.quote_missing`; with a line saying 3.2 km where its quote says 3.4 km it fails `film.number_mismatch`"
// #407.f621d801 (AC12): "The same rule holds for a sentence of on-screen text in a stage of a staged piece, named by item
// and stage"
// #407.4f632f03 (AC13): "A brief with no `sources` runs no claim check, and the audit lists it as not run, never as
// passed"
// #407.56eb7041 (AC14): "A planted check that passes an empty `cites` fails its parity fixture"
//
// Fixtures (helpers.ts). The source `kettle-notes`, one paragraph of six sentences, is the brief's one source
// (`sources: [{id, title, text}]`, README: The brief); each claim holds the brief and one requirement {kind: film.audit}.
//   - scriptFilm: a 1920 × 1080 en film whose script holds six `caption` lines l1 to l6, line n at 1 + 3(n − 1) s, each
//     the source's nth sentence with a full stop and `cites: [{source: kettle-notes, quote: <the sentence>}]`; line 3
//     reads "The path to the spring climbs 3.4 km." Twins: line 4 with no `cites` (its frame 10 s); line 2's quote with
//     "short" changed to "long"; line 3 saying 3.2 km, its quote unchanged; and line 4 with `cites: []`.
//   - stagedPiece: stage markers stage-1 (0 s), stage-2 (4 s) and stage-3 (8 s); the on-screen sentence `fact`, "Steam
//     lifts the lid at the boil.", shown in stage 2 only, its params citing the source. Twins: no `cites`; its quote's
//     "boil" changed to "top"; and the sentence "The path to the spring climbs 3.2 km." citing the 3.4 km sentence.
//
// asserts:
//   - AC11: the six cited lines PASS with nothing raised; without line 4's citation the row FAILs with film.uncited
//     naming l4 at t = 10 s; with line 2's quote changed, film.quote_missing naming l2; with 3.2 km, film.number_mismatch
//     naming l3.
//   - AC12: the cited sentence PASSes; its three twins FAIL with film.uncited, film.quote_missing and
//     film.number_mismatch, each naming the item fact and the stage stage-2.
//   - AC13: under a brief with a goal and no `sources`, the script whose line 4 has no citation raises none of the three
//     codes, its row lists `claims` in `not_run`, and isn't FAIL.
//   - AC14: with `cites: []` on line 4 the row FAILs with film.uncited naming l4 (the parity fixture's twin, so the test
//     passes on a right program); planted `cites_empty_passes` passes it, and this check fails naming l4.
import { describe, it } from 'vitest';
import {
  AC, CITE_CODES, FULL, GOAL, NUMBER_MISMATCH, QUOTE_MISSING, SOURCES, TIMEOUT, UNCITED, brief, docId, failsNaming, failsWith, field, judge,
  lineAt, mentions, namesLine, none, noneOf, passFailures, scriptFilm, stagedPiece, useBuilds, useFolders, type Film, type JsonObject, type Row,
  type ScriptTwin,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const WITH_SOURCES: JsonObject = { goal: GOAL, sources: SOURCES };
const script = (n: number, twin: ScriptTwin, b: JsonObject = WITH_SOURCES): Film => ({ name: `the script (${twin})`, doc: docId(n), document: scriptFilm(docId(n), twin), brief: b });
const staged = (n: number, twin: 'none' | 'uncited' | 'quote' | 'number'): Film => ({ name: `the staged piece (${twin})`, doc: docId(n), document: stagedPiece(docId(n), twin), brief: WITH_SOURCES });
const rowOf = (films: Film[], planted?: string): ((name: string) => Row | undefined) => {
  const { judged } = judge(bin(FULL), folder(), films, planted ? { planted } : {});
  return (name: string) => judged[name]?.row;
};
const inStage = (i: JsonObject): boolean => mentions(i, 'fact') && field(i, 'stage') === 'stage-2';
const uncitedL4 = (row: Row | undefined, what: string): string[] =>
  failsWith(row, UNCITED, { subject: 'line l4', match: (i) => namesLine(i, 'l4'), t: lineAt(4) }, what);

describe(`${AC[11]} a factual film's lines quote its brief's sources`, () => {
  it(`${AC[11]} six cited lines pass; line 4 uncited fails film.uncited naming it and its frame; a quote one word off fails film.quote_missing; 3.2 km against 3.4 km fails film.number_mismatch`, () => {
    const films = [script(1, 'none'), script(2, 'uncited'), script(3, 'quote'), script(4, 'number')];
    const row = rowOf(films);
    none([
      ...passFailures(row('the script (none)'), 'the six cited lines'),
      ...uncitedL4(row('the script (uncited)'), "the script without line 4's citation"),
      ...failsWith(row('the script (quote)'), QUOTE_MISSING, { subject: 'line l2', match: (i) => namesLine(i, 'l2') }, "the script with line 2's quote changed by one word"),
      ...failsWith(row('the script (number)'), NUMBER_MISMATCH, { subject: 'line l3', match: (i) => namesLine(i, 'l3') }, 'the script saying 3.2 km where its quote says 3.4 km'),
    ], 'the claim check on narration');
  }, TIMEOUT);
});

describe(`${AC[12]} the same rule on a staged piece's on-screen text`, () => {
  it(`${AC[12]} a sentence of on-screen text in stage 2 is held to its quote, each failure named by item and stage`, () => {
    const films = [staged(1, 'none'), staged(2, 'uncited'), staged(3, 'quote'), staged(4, 'number')];
    const row = rowOf(films);
    none([
      ...passFailures(row('the staged piece (none)'), 'the cited sentence in stage 2'),
      ...failsWith(row('the staged piece (uncited)'), UNCITED, { subject: 'fact in stage-2', match: inStage }, 'the uncited sentence in stage 2'),
      ...failsWith(row('the staged piece (quote)'), QUOTE_MISSING, { subject: 'fact in stage-2', match: inStage }, 'the sentence whose quote is one word off'),
      ...failsWith(row('the staged piece (number)'), NUMBER_MISMATCH, { subject: 'fact in stage-2', match: inStage }, 'the sentence saying 3.2 km where its quote says 3.4 km'),
    ], 'the claim check on a staged piece');
  }, TIMEOUT);
});

describe(`${AC[13]} a brief with no sources runs no claim check`, () => {
  it(`${AC[13]} with no sources an uncited line raises nothing, and the audit lists the claim check as not run, never as passed`, () => {
    const film = script(1, 'uncited', { goal: GOAL });
    const row = rowOf([film])(film.name);
    const failures: string[] = CITE_CODES.flatMap((code) => noneOf(row, code, () => true, 'any line', 'the script under a brief with no sources'));
    if (!row) failures.push('the script under a brief with no sources has no row in the verdict');
    else {
      const notRun = Array.isArray(row.raw['not_run']) ? row.raw['not_run'] : [];
      if (!notRun.some((x) => x === 'claims' || (typeof x === 'object' && x !== null && !Array.isArray(x) && (x['check'] === 'claims' || x['name'] === 'claims')))) {
        failures.push(`the audit doesn't list the claim check as not run: not_run is ${brief(row.raw['not_run'])}`);
      }
      if (row.result === 'FAIL') failures.push(`the script under a brief with no sources is FAIL: ${brief(row.raw)}`);
    }
    none(failures, 'a brief with no sources');
  }, TIMEOUT);
});

describe(`${AC[14]} an empty cites is no citation`, () => {
  it(`${AC[14]} line 4 with cites: [] fails film.uncited naming it, the parity fixture's twin`, () => {
    const film = script(1, 'empty');
    none(uncitedL4(rowOf([film])(film.name), 'the script with cites: [] on line 4'), 'the parity fixture');
  }, TIMEOUT);

  it(`${AC[14]} a planted check that passes an empty cites fails its parity fixture, naming l4`, () => {
    const film = script(1, 'empty');
    failsNaming(uncitedL4(rowOf([film], 'cites_empty_passes')(film.name), 'the script with cites: [] on line 4'), ['l4'], 'the claim check passing an empty cites');
  }, TIMEOUT);
});
