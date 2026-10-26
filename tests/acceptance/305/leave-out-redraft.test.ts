// #305.4e03e5e7, redrafted (REDRAFT-388.md): a document evaluated in the full build and in a test
// build without the canvas modules it doesn't use hashes the same. "Hashes the same" is both the
// current revision's hash (the canonical document) and the render-back snapshot's sha256 (the
// evaluated frame). The builds come from the design's build sets (Registry and seal): `core` holds
// the core with text and look, `r1` adds marks2d, data, graph, record, sheet and motion, and `full`
// holds every canvas module; rect@1 and text@1 are marks2d's kinds (the technical design's module
// table), so `r1` is the smallest build set that holds every module these documents draw with.
import { describe, expect, it } from 'vitest';
import {
  DOC, EMPTY, aItem, board, currentHash, issues, label, rect, registry, requires, revisionsOf, run, scenario, show, theSnapshot,
  useBuilds, useEvidence, REGISTRY, type Build, type JsonObject, type Registry,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const R1: Build = { set: 'r1' };
const FULL_A: Build = { set: 'full', with: ['test-a'] };
const R1_A: Build = { set: 'r1', with: ['test-a'] };

const builds = useBuilds([FULL, R1, FULL_A, R1_A]);
const evidence = useEvidence();

/** A board drawn with marks2d's kinds (rect@1, text@1) on text's shaper and look's roles, and no other module. */
const MARKS_ONLY: JsonObject = board('Marks only', [
  rect('ground', 'Ground', [0, 0, 320, 200], 'a0', 'ground'),
  rect('meter', 'Meter', [24, 132, 180, 18], 'a1'),
  label('heading', 'Heading', 'Same in every build', [24, 32], 'a2'),
]);

/** A board that uses test.a (declared in requires.modules, as the envelope says) beside marks2d's kinds. */
const WITH_A: JsonObject = board('Uses test.a', [
  rect('ground', 'Ground', [0, 0, 320, 200], 'a0', 'ground'),
  aItem('a-1', [180, 48, 104, 72], 'a1', 5),
  label('heading', 'Heading', 'Module a joins', [24, 32], 'a2'),
], requires({ 'test.a': '^1' }));
/** WITH_A without its test.a item: the frame test.a's item must change, or the hashes prove nothing. */
const WITH_A_TWIN: JsonObject = board('Uses test.a', [
  rect('ground', 'Ground', [0, 0, 320, 200], 'a0', 'ground'),
  label('heading', 'Heading', 'Module a joins', [24, 32], 'a2'),
], requires({ 'test.a': '^1' }));

interface Evaluated { revision: string; snapshot: string; control: string; registry: Registry; codes: string[] }

/**
 * Evaluates `document` in one fresh process of `bin`: deep_show with a snapshot on DOC.a, its
 * revisions, `control` shown with a snapshot on DOC.b, and the registry the build sealed.
 */
function evaluate(bin: string, document: JsonObject, control: JsonObject, what: string): Evaluated {
  const { replies } = run(bin, scenario(evidence(), [
    show(document, { pixels: true }), revisionsOf(DOC.a), show(control, { doc: DOC.b, pixels: true }), REGISTRY,
  ]));
  const [shown, revs, other, reg] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
  const snapshot = theSnapshot(shown, `${what}: the document`).sha256;
  const list = issues(shown, `${what}: the document`);
  expect(list.filter((i) => i.severity === 'error'), `${what}: the document is presented with no error`).toEqual([]);
  return {
    revision: currentHash(revs),
    snapshot,
    control: theSnapshot(other, `${what}: the control board`).sha256,
    registry: registry(reg),
    codes: list.map((i) => i.code),
  };
}

/** The smaller build is the build set it names, and holds no canvas module the full build doesn't. */
function expectSmaller(full: Evaluated, small: Evaluated, set: string): void {
  expect(full.registry.build_set, 'the full build seals as build set full').toBe('full');
  expect(small.registry.build_set, `the smaller build seals as build set ${set}`).toBe(set);
  const extra = small.registry.modules.filter((m) => !full.registry.modules.includes(m));
  expect(extra, `full holds every canvas module, so ${set} holds none it lacks (full: ${full.registry.modules.join(', ')}; ${set}: ${small.registry.modules.join(', ')})`).toEqual([]);
}

describe('#305.4e03e5e7 a document hashes the same in the full build and in a build without the canvas modules it doesn\'t use (redraft)', () => {
  it('#305.4e03e5e7 a document that uses no test canvas module, drawn with marks2d\'s kinds, evaluated in full and in r1 has the same revision hash and the same snapshot hash', () => {
    const full = evaluate(builds.bin(FULL), MARKS_ONLY, EMPTY, 'full');
    const r1 = evaluate(builds.bin(R1), MARKS_ONLY, EMPTY, 'r1');
    expectSmaller(full, r1, 'r1');

    // The frame is drawn: an evaluation that draws nothing in both builds would hash the same too.
    expect(full.snapshot, 'in full the board draws: its snapshot is not the empty board\'s').not.toBe(full.control);
    expect(r1.snapshot, 'in r1 the board draws: its snapshot is not the empty board\'s').not.toBe(r1.control);

    expect(r1.revision, 'the revision hash (the canonical document) is the same in r1 as in full').toBe(full.revision);
    expect(r1.snapshot, 'the snapshot hash (the evaluated frame) is the same in r1 as in full').toBe(full.snapshot);
  }, 600_000);

  it('#305.4e03e5e7 a document that uses test.a, evaluated in full with test.a and in r1 with test.a, has the same revision hash and the same snapshot hash', () => {
    const full = evaluate(builds.bin(FULL_A), WITH_A, WITH_A_TWIN, 'full,test-a');
    const r1 = evaluate(builds.bin(R1_A), WITH_A, WITH_A_TWIN, 'r1,test-a');
    expectSmaller(full, r1, 'r1');
    expect(full.registry.modules, 'full,test-a holds test.a').toContain('test.a');
    expect(r1.registry.modules, 'r1,test-a holds test.a').toContain('test.a');

    // test.a's item is evaluated, not skipped: no unknown_kind or module_missing, and the frame differs from the twin without it.
    for (const [what, e] of [['full,test-a', full], ['r1,test-a', r1]] as const) {
      expect(e.codes.filter((c) => c === 'unknown_kind' || c === 'module_missing'), `${what}: test.a@1 is a known kind of a module the build holds`).toEqual([]);
      expect(e.snapshot, `${what}: the test.a item draws: the frame is not the one without it`).not.toBe(e.control);
    }

    expect(r1.revision, 'the revision hash is the same in r1,test-a as in full,test-a').toBe(full.revision);
    expect(r1.snapshot, 'the snapshot hash is the same in r1,test-a as in full,test-a').toBe(full.snapshot);
  }, 600_000);
});
