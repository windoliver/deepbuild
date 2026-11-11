// AC5 #535.0f8922c0: A set whose two array columns hold 9,216 and 9,215 values is refused at check, naming both; so are
// a column reading an array no logic item in the document writes, and an f32 column reading a vec2 array without part,
// each naming the column
//
// Each document carries the logic item `grid` (programs.ts `countsProgram`: `big` i32 × 9,216, `short` i32 × 9,215,
// `where` vec2 × 4) and one set (fixtures.ts). "Refused at check" is `deep_show`'s check: the reply is `refused` with an
// error issue. "Naming" is read in the issue's own fields (its `ids`, `path`, `actual` and fields at its top level, not
// its prose), as a whole name. Each refusal has its control, presented, so a check that refuses every logic column
// fails: both columns reading the 9,216-value array, the column reading an array `grid` writes, the vec2 with `part: "x"`.
//
// The fourth test is the issue's Proof line and Scope, "the build without logic": in the full set without the logic module
// (#403's `test-leave-out-logic`), the build seals and a document that reads a logic array is refused with
// module_missing, naming logic. No criterion states it alone; it rides with this criterion's refusals at check (README).
import { describe, expect, it } from 'vitest';
import { countsProgram, layerProgram } from './programs.ts';
import { countsDoc, layerAtlas, layerDoc, mismatchSet, poolAtlas, unwrittenSet, vectorSet } from './fixtures.ts';
import {
  AC, DOC, binOf, issuesOf, names, namedIn, namesItem, prebuild, presented, putEvidence, runShow, scenario, show, showCall, useTemp,
  type Build, type JsonObject,
} from './helpers.ts';

prebuild(['full', 'no-logic']);
const temp = useTemp();
const D = DOC(1);

function shown(make: (ev: string) => JsonObject, what: string, build: Build = 'full'): JsonObject {
  const ev = temp();
  const document = make(ev);
  return runShow(binOf(build), scenario(ev, [D], [showCall(D, document)]), what)[0]!;
}
const counts = (set: (atlas: string) => JsonObject, id: string) => (ev: string): JsonObject => {
  const program = countsProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, poolAtlas());
  return countsDoc(id, program, atlas, set(atlas));
};
/** The document is refused at check with an error issue that names the set and each of `words` (any one of `alts`). */
function refusedNaming(reply: JsonObject, set: string, alts: string[][], what: string): void {
  expect(reply['outcome'], `${what} is refused at check: ${show(reply, 2000)}`).toBe('refused');
  const errors = issuesOf(reply).filter((i) => i['severity'] === 'error');
  const naming = errors.filter((i) => namesItem(i, set) && alts.some((words) => words.every((w) => names(namedIn(i), w))));
  expect(naming.length, `${what}: an error issue names the set ${set} and ${alts.map((w) => w.join(' and ')).join(', or ')}; the errors: ${show(errors, 2500)}`).toBeGreaterThan(0);
}

describe(`${AC[5]} sets whose logic columns can't be read are refused at check, naming what`, () => {
  it(`${AC[5]} a set whose two array columns hold 9,216 and 9,215 values is refused at check, naming both; with both reading the 9,216 it is presented`, () => {
    const reply = shown(counts(mismatchSet, 'mismatch'), 'the set of 9,216 and 9,215 rows');
    refusedNaming(reply, 'mismatch', [['tile', 'flip'], ['grid.big', 'grid.short']], 'the set of 9,216 and 9,215 rows');
    presented(shown(counts((a) => mismatchSet(a, 'grid.big'), 'mismatch-control'), 'the set whose columns both hold 9,216'), 'the set whose columns both hold 9,216');
  }, 1_800_000);

  it(`${AC[5]} a column reading an array no logic item in the document writes is refused at check, naming the column; reading one it writes, it is presented`, () => {
    const reply = shown(counts(unwrittenSet, 'unwritten'), 'the column reading grid.missing');
    refusedNaming(reply, 'ghost', [['tile']], 'the column reading grid.missing');
    presented(shown(counts((a) => unwrittenSet(a, 'grid.big'), 'unwritten-control'), 'the column reading grid.big'), 'the column reading grid.big');
  }, 1_800_000);

  it(`${AC[5]} an f32 column reading a vec2 array without part is refused at check, naming the column; with part x it is presented`, () => {
    const reply = shown(counts(vectorSet, 'vector'), 'the f32 column reading grid.where without part');
    refusedNaming(reply, 'spots', [['x']], 'the f32 column reading grid.where without part');
    presented(shown(counts((a) => vectorSet(a, 'x'), 'vector-part'), 'the f32 column reading grid.where with part x'), 'the f32 column reading grid.where with part x');
  }, 1_800_000);

  it(`${AC[5]} (Proof: the build without logic) the full set without the logic module seals, and a document that reads a logic array is refused with module_missing, naming logic`, () => {
    const reply = shown((ev) => {
      const program = layerProgram();
      putEvidence(ev, program.bytes);
      return layerDoc(program, putEvidence(ev, layerAtlas()));
    }, 'the 96 × 96 layer in the build without logic', 'no-logic');
    expect(reply['outcome'], `the layer is refused in the build without logic: ${show(reply, 2000)}`).toBe('refused');
    const missing = issuesOf(reply).filter((i) => i['code'] === 'module_missing' && i['severity'] === 'error');
    expect(missing.some((i) => names(namedIn(i), 'logic')), `with module_missing naming logic: ${show(issuesOf(reply), 2500)}`).toBe(true);
  }, 1_800_000);
});
