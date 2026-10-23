// The issue's "It can never" lines, as generated properties (technical design: Rules every primitive
// follows, "Universal rules are tested as properties"): fast-check from the recorded seed, 1,000 cases
// (the local preflight's count), shrunk to the smallest failing case. Each property's cases are sampled
// from the same seed first and solved in one run of the binary, so the property reads their answers
// without a process per case; a case shrinking makes that isn't among them is solved on its own.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_BIN, boxOf, boxesOf, measure, near, obj, rawLines, useBinaries, TOL,
  type Box, type JsonObject, type JsonValue, type Measured,
} from './helpers.ts';

useBinaries('deep-layout', 'deep-text');

/** The recorded seed and the local preflight's case count. */
const SEED = 375;
const RUNS = 1000;

const LETTERS = 'abcdefghijklmnop';
/** Words for text leaves: no digits and no number words, so no text reads as an unsourced number. */
const WORDS = ['plan', 'checks', 'review', 'waiting', 'merge', 'draft', 'notes', 'gate', 'proof', 'agents', 'layout', 'card', 'ahead', 'Ship'];

type Size = { w: number; h: number };
type Kid =
  | { kind: 'box'; w: number; h: number; width: 'fixed' | 'fill'; height: 'fixed' | 'fill' }
  | { kind: 'text'; text: string; size: number; weight: number }
  | { kind: 'frame'; layout: 'row' | 'column'; gap: number; padding: number; kids: Size[] };
interface Grid { rows: JsonValue[]; cols: JsonValue[]; flow: string; reverse: string; align_rows: string[]; align_cols: string[] }
interface Tree {
  layout: 'row' | 'column' | 'grid';
  fixed: Size | null;
  wrap: boolean;
  padding: number;
  gap: number | [number, number];
  align_main: string;
  align_cross: string;
  grid: Grid;
  kids: Kid[];
}

const size: fc.Arbitrary<Size> = fc.record({ w: fc.integer({ min: 1, max: 160 }), h: fc.integer({ min: 1, max: 160 }) });
const kid: fc.Arbitrary<Kid> = fc.oneof(
  fc.record({
    kind: fc.constant('box' as const), w: fc.integer({ min: 1, max: 160 }), h: fc.integer({ min: 1, max: 160 }),
    width: fc.constantFrom('fixed' as const, 'fill' as const), height: fc.constantFrom('fixed' as const, 'fill' as const),
  }),
  fc.record({
    kind: fc.constant('text' as const),
    text: fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }).map((w) => w.join(' ')),
    size: fc.constantFrom(11, 13, 16, 20), weight: fc.constantFrom(400, 500, 600),
  }),
  fc.record({
    kind: fc.constant('frame' as const), layout: fc.constantFrom('row' as const, 'column' as const),
    gap: fc.integer({ min: 0, max: 24 }), padding: fc.integer({ min: 0, max: 16 }), kids: fc.array(size, { minLength: 1, maxLength: 3 }),
  }),
);
/** A track: a number of u (wider than any child, so no child overflows its cell), fr or hug. */
const track: fc.Arbitrary<JsonValue> = fc.oneof(fc.integer({ min: 600, max: 700 }), fc.constantFrom('1fr', '2fr', 'hug'));
const tree: fc.Arbitrary<Tree> = fc.record({
  layout: fc.constantFrom('row' as const, 'column' as const, 'grid' as const),
  fixed: fc.option(fc.record({ w: fc.integer({ min: 100, max: 600 }), h: fc.integer({ min: 60, max: 400 }) }), { nil: null }),
  wrap: fc.boolean(),
  padding: fc.integer({ min: 0, max: 24 }),
  gap: fc.oneof(fc.integer({ min: 0, max: 32 }), fc.tuple(fc.integer({ min: 0, max: 32 }), fc.integer({ min: 0, max: 32 }))),
  align_main: fc.constantFrom('start', 'center', 'end', 'between'),
  align_cross: fc.constantFrom('start', 'center', 'end', 'stretch', 'baseline'),
  grid: fc.record({
    rows: fc.array(track, { minLength: 1, maxLength: 3 }),
    cols: fc.array(track, { minLength: 1, maxLength: 4 }),
    flow: fc.constantFrom('row', 'column'),
    reverse: fc.constantFrom('none', 'x', 'y'),
    align_rows: fc.array(fc.constantFrom('start', 'center', 'end', 'baseline'), { maxLength: 3 }),
    align_cols: fc.array(fc.constantFrom('start', 'center', 'end'), { maxLength: 4 }),
  }),
  kids: fc.array(kid, { minLength: 1, maxLength: 10 }),
});

const ROOT = 'root';
const kidId = (i: number): string => `c${LETTERS[i]}`;
const grandId = (i: number, j: number): string => `c${LETTERS[i]}k${LETTERS[j]}`;

function envelope(id: string, description: string, items: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: 'Generated auto layout', description, size: [1600, 1600],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items,
  };
}

const fixedFrame = (id: string, name: string, parent: string, order: string, s: Size, width = 'fixed', height = 'fixed'): JsonObject => ({
  id, kind: 'frame@1', layer: 'main', name, parent, order, params: { box: [0, 0, s.w, s.h], width, height },
});

/** The tree as a document: a root frame at (16, 16) and its children in `order`, a nested frame's own children under it. */
function treeDoc(t: Tree): JsonObject {
  const root: JsonObject = { layout: t.layout, wrap: t.wrap, padding: t.padding, gap: t.gap, align_main: t.align_main, align_cross: t.align_cross };
  if (t.layout === 'grid') root['grid'] = { ...t.grid };
  if (t.fixed) root['box'] = [0, 0, t.fixed.w, t.fixed.h];
  const items: JsonObject = { [ROOT]: { id: ROOT, kind: 'frame@1', layer: 'main', name: 'Root', order: 'a0', at: { pos: [16, 16, 0] }, params: root } };
  t.kids.forEach((k, i) => {
    const id = kidId(i);
    const name = `Tile ${LETTERS[i]}`;
    const order = `a${LETTERS[i]}`;
    if (k.kind === 'box') items[id] = fixedFrame(id, name, ROOT, order, k, k.width, k.height);
    else if (k.kind === 'text') items[id] = { id, kind: 'text@1', layer: 'main', name, parent: ROOT, order, params: { text: k.text, font: 'body', size: k.size, weight: k.weight } };
    else {
      items[id] = { id, kind: 'frame@1', layer: 'main', name, parent: ROOT, order, params: { layout: k.layout, gap: k.gap, padding: k.padding } };
      k.kids.forEach((g, j) => { items[grandId(i, j)] = fixedFrame(grandId(i, j), `${name} ${LETTERS[j]}`, id, `a${LETTERS[j]}`, g); });
    }
  });
  return envelope('never-overlap', 'A generated frame tree whose flow children must never overlap.', items);
}

/** Each frame of the tree with its flow children, and the fixed sizes those children must keep. */
function framesOf(t: Tree): { frame: string; kids: { id: string; w?: number; h?: number }[] }[] {
  const frames = [{
    frame: ROOT,
    kids: t.kids.map((k, i) => (k.kind === 'box'
      ? { id: kidId(i), ...(k.width === 'fixed' ? { w: k.w } : {}), ...(k.height === 'fixed' ? { h: k.h } : {}) }
      : { id: kidId(i) })),
  }];
  t.kids.forEach((k, i) => {
    if (k.kind === 'frame') frames.push({ frame: kidId(i), kids: k.kids.map((g, j) => ({ id: grandId(i, j), w: g.w, h: g.h })) });
  });
  return frames;
}

/** No two flow children of one frame overlap by more than the tolerance on both axes; fixed sizes are kept. */
function expectNoOverlap(t: Tree, line: string): void {
  const out = obj(JSON.parse(line) as JsonValue, 'deep-layout solve: the answer');
  expect(out['ok'], `deep-layout solve refused a generated tree: ${line.slice(0, 2000)}`).toBe(true);
  const boxes = boxesOf(out, 'the generated tree');
  for (const { frame, kids } of framesOf(t)) {
    boxOf(boxes, frame, 'the generated tree');
    const placed: [string, Box][] = kids.map((k) => {
      const b = boxOf(boxes, k.id, 'the generated tree');
      // A layout that answers zero boxes never overlaps; a fixed child keeping its size rules that out.
      if (k.w !== undefined) near(b.w, k.w, `${k.id} keeps its fixed width`);
      if (k.h !== undefined) near(b.h, k.h, `${k.id} keeps its fixed height`);
      return [k.id, b];
    });
    for (let p = 0; p < placed.length; p++) {
      for (let q = p + 1; q < placed.length; q++) {
        const [a, A] = placed[p]!;
        const [b, B] = placed[q]!;
        const ix = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const iy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        expect(ix > TOL && iy > TOL, `flow children ${a} [${A.x}, ${A.y}, ${A.w}, ${A.h}] and ${b} [${B.x}, ${B.y}, ${B.w}, ${B.h}] of ${frame} overlap`).toBe(false);
      }
    }
  }
}

/**
 * Every sampled tree solved in one run: first in sample order, then again in reverse, so each tree is
 * solved a second time after its own result and after others'. Keyed by the document's JSON.
 */
let solved: { first: Map<string, string>; again: Map<string, string> } | undefined;
function solvedTrees(): { first: Map<string, string>; again: Map<string, string> } {
  if (solved) return solved;
  const docs = fc.sample(tree, { seed: SEED, numRuns: RUNS }).map(treeDoc);
  const lines = rawLines(LAYOUT_BIN, 'solve', [...docs, ...[...docs].reverse()].map((doc) => ({ doc })));
  const first = new Map<string, string>();
  const again = new Map<string, string>();
  docs.forEach((doc, i) => {
    const key = JSON.stringify(doc);
    first.set(key, lines[i]!);
    again.set(key, lines[2 * docs.length - 1 - i]!);
  });
  solved = { first, again };
  return solved;
}

function answersFor(doc: JsonObject): [string, string] {
  const key = JSON.stringify(doc);
  const { first, again } = solvedTrees();
  const a = first.get(key);
  const b = again.get(key);
  if (a !== undefined && b !== undefined) return [a, b];
  const [x, y] = rawLines(LAYOUT_BIN, 'solve', [{ doc }, { doc }]);
  return [x!, y!];
}

// ---------------------------------------------------------------------------------------------------
// A bound number in a frame: the text leaf shows a reading, and its frame is laid out once per reading.

const HANDLE = `reading:01JB4${'0'.repeat(20)}1`;
/** The widest the bound number can show; every generated reading is narrower. */
const WIDEST = '8,888,888';

interface BoundCase { layout: 'row' | 'column' | 'grid'; before: Size[]; after: Size[]; size: number; weight: number; readings: number[] }
const boundCase: fc.Arbitrary<BoundCase> = fc.record({
  layout: fc.constantFrom('row' as const, 'column' as const, 'grid' as const),
  before: fc.array(size, { maxLength: 3 }),
  after: fc.array(size, { maxLength: 3 }),
  size: fc.constantFrom(11, 13, 16, 20),
  weight: fc.constantFrom(400, 500, 600),
  readings: fc.array(fc.integer({ min: 0, max: 9999 }), { minLength: 2, maxLength: 4 }),
});

function boundDoc(c: BoundCase): JsonObject {
  const root: JsonObject = { layout: c.layout, gap: 8, padding: 4 };
  if (c.layout === 'grid') root['grid'] = { cols: ['hug', 'hug'] };
  const items: JsonObject = { [ROOT]: { id: ROOT, kind: 'frame@1', layer: 'main', name: 'Root', order: 'a0', at: { pos: [16, 16, 0] }, params: root } };
  c.before.forEach((s, i) => { items[`b${LETTERS[i]}`] = fixedFrame(`b${LETTERS[i]}`, `Before ${LETTERS[i]}`, ROOT, `a${LETTERS[i]}`, s); });
  items['value'] = {
    id: 'value', kind: 'text@1', layer: 'main', name: 'Value', parent: ROOT, order: 'm',
    params: { text: '—', font: 'body', size: c.size, weight: c.weight, widest: WIDEST },
  };
  c.after.forEach((s, i) => { items[`f${LETTERS[i]}`] = fixedFrame(`f${LETTERS[i]}`, `After ${LETTERS[i]}`, ROOT, `t${LETTERS[i]}`, s); });
  const doc = envelope('never-resize', 'A generated frame holding a text bound to a live reading among fixed tiles.', items);
  doc['bound_values'] = { count: { target: 'items/value/params/text', source: HANDLE } };
  return doc;
}

const boundLines = (c: BoundCase): JsonObject[] => { const doc = boundDoc(c); return c.readings.map((n) => ({ doc, readings: { [HANDLE]: n } })); };

let boundSolved: Map<string, string[]> | undefined;
function boundAnswers(c: BoundCase): string[] {
  const key = JSON.stringify(c);
  if (!boundSolved) {
    const cases = fc.sample(boundCase, { seed: SEED, numRuns: RUNS });
    const lines = rawLines(LAYOUT_BIN, 'solve', cases.flatMap(boundLines));
    boundSolved = new Map();
    let at = 0;
    for (const s of cases) { boundSolved.set(JSON.stringify(s), lines.slice(at, at + s.readings.length)); at += s.readings.length; }
  }
  return boundSolved.get(key) ?? rawLines(LAYOUT_BIN, 'solve', boundLines(c));
}

let widestMeasured: Map<string, Measured> | undefined;
function widestFor(sizePx: number, weight: number): Measured {
  if (!widestMeasured) {
    const combos = [11, 13, 16, 20].flatMap((s) => [400, 500, 600].map((w) => ({ text: WIDEST, number: true, font: 'body', size: s, weight: w })));
    const measured = measure(combos);
    widestMeasured = new Map(combos.map((c, i) => [`${c.size}/${c.weight}`, measured[i]!]));
  }
  return widestMeasured.get(`${sizePx}/${weight}`)!;
}

describe('It can never: depend on its own result; resize because a bound number changed; let flow children overlap', () => {
  it(`never: flow children of a frame never overlap, in generated row, column and grid trees (${RUNS} cases, seed ${SEED})`, () => {
    fc.assert(fc.property(tree, (t) => { expectNoOverlap(t, answersFor(treeDoc(t))[0]); }), { seed: SEED, numRuns: RUNS });
  }, 600_000);

  it(`never: a layout doesn't depend on its own result: a tree solved again after its own result, and after others', gives the same bytes (${RUNS} cases, seed ${SEED})`, () => {
    fc.assert(fc.property(tree, (t) => {
      const [first, again] = answersFor(treeDoc(t));
      expect(again, 'the same document solved again in the same run gives the same answer, byte for byte').toBe(first);
    }), { seed: SEED, numRuns: RUNS });
  }, 600_000);

  it(`never: a frame doesn't resize because a bound number changed; the bound text is sized by its widest (${RUNS} cases, seed ${SEED})`, () => {
    fc.assert(fc.property(boundCase, (c) => {
      const answers = boundAnswers(c).map((line, i) => {
        const out = obj(JSON.parse(line) as JsonValue, `reading ${c.readings[i]}: the answer`);
        expect(out['ok'], `deep-layout solve refused the bound case at reading ${c.readings[i]}: ${line.slice(0, 2000)}`).toBe(true);
        return boxesOf(out, `reading ${c.readings[i]}`);
      });
      const value = boxOf(answers[0]!, 'value', `reading ${c.readings[0]}`);
      const widest = widestFor(c.size, c.weight);
      // A layout that measures the placeholder, or the reading shown, sizes the leaf by something else.
      near(value.w, widest.width, `the bound text is as wide as its widest, ${WIDEST}, as the shaper measures it`);
      near(value.h, widest.height, 'the bound text is one line of its size');
      for (const [i, boxes] of answers.entries()) {
        // A layout that measures each reading as it shows moves or resizes something when the reading changes.
        expect(boxes, `with reading ${c.readings[i]}, every box is the same as with reading ${c.readings[0]}`).toEqual(answers[0]);
      }
    }), { seed: SEED, numRuns: RUNS });
  }, 600_000);
});
