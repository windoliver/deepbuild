// AC1: "A repeat over a plate's faces makes one derived step per face, and adding a face reseeds no other"
// Proof line: "A repeat over a plate's faces with its parity fixtures."
//
// The parity fixture `repeat-plate-faces.scene`: a 3 x 2 grid plate `plot` of 1 m cells and an instance `lot`
// of test/lots@1.0.0's lots.post@1, whose step `post` repeats over {each: {part: "ground#top", domain: "face"},
// as: "e"} with `ground` holding `plot` and stands a mark.box@1 at each `e.center`; then, as a second revision
// of the same document, the same instance over the plate with one more row of cells (3 x 3), whose three new
// faces take indices 6, 7 and 8.
//
// asserts: both revisions are presented with no error; in each, `lot` expands into exactly one derived item per
// face, lot.post.0 … lot.post.<n − 1> (n = 6, then 9), each a mark.box@1 standing at its face's cell centre in
// index order x fastest, then z, the centres taken from the design's cell rule over the plate's own extent (its
// built positions, by `geometry`), each with a seed of its own (`faceFailures`); and lot.post.0 … lot.post.5 keep
// their seeds once the row is added (`reseedFailures`). The planted `each_seeds_by_element_count` fails the
// reseed check, naming lot.post.0, and `each_face_per_triangle` fails the face check, naming "12 derived items
// for 6 faces".

import { describe, expect, it } from 'vitest';
import {
  DOC, admitted, arr, expansionOf, failsNaming, fixture, fmt, geometryCall, isObject, none, num, obj, positionsOf, runShow, scenario, sceneDoc,
  show, shown, str, useDir, useShow, type Expansion, type JsonObject, type JsonValue, type Planted, type V3,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SCENE = fixture('parity', 'recipe', 'repeat-plate-faces.scene');
const PLATE = str(SCENE['plate'], 'the fixture\'s plate');
const INSTANCE = str(SCENE['instance'], 'the fixture\'s instance');
const KIND = str(SCENE['kind'], 'the fixture\'s derived kind');
const PACKS = arr(SCENE['packs'], 'the fixture\'s packs').map((p, i) => str(p, `packs[${i}]`));
const KEPT = arr(SCENE['kept'], 'the fixture\'s kept IDs').map((p, i) => str(p, `kept[${i}]`));
const TOL = num(SCENE['tolerance_m'], 'the fixture\'s tolerance');
const TWINS = arr(SCENE['twins'], 'the fixture\'s twins').map((t, i) => obj(t, `twins[${i}]`));

/** One revision of the fixture: the plate's grid and size, and the derived IDs and cells its faces make, in index order. */
interface Side { name: string; items: JsonObject; grid: [number, number]; size: [number, number]; derived: string[]; cells: [number, number][] }
const pair = (v: JsonValue | undefined, what: string): [number, number] => {
  const a = arr(v, what);
  expect(a.length, `${what} has two numbers`).toBe(2);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)];
};
const SIDES: Side[] = arr(SCENE['revisions'], 'the fixture\'s revisions').map((r, k) => {
  const o = obj(r, `revisions[${k}]`);
  return {
    name: str(o['name'], `revisions[${k}].name`), items: obj(o['items'], `revisions[${k}].items`),
    grid: pair(o['grid'], `revisions[${k}].grid`), size: pair(o['size'], `revisions[${k}].size`),
    derived: arr(o['derived'], `revisions[${k}].derived`).map((d, i) => str(d, `revisions[${k}].derived[${i}]`)),
    cells: arr(o['cells'], `revisions[${k}].cells`).map((c, i) => pair(c, `revisions[${k}].cells[${i}]`)),
  };
});

/**
 * Each face's centre, in index order: the design's rule (a grid plate's faces are its cells, x fastest, then z;
 * cell [i, j]'s centre is (i + 1/2, j + 1/2) cell sizes from the plate's least corner) over the plate's extent as
 * it built, since the design doesn't fix where a grid plate stands about its origin.
 */
function centresOf(positions: V3[], side: Side, what: string): V3[] {
  expect(positions.length, `${what}: the plate built positions`).toBeGreaterThan(0);
  const lo = [0, 1, 2].map((a) => Math.min(...positions.map((p) => p[a]!)));
  const hi = [0, 1, 2].map((a) => Math.max(...positions.map((p) => p[a]!)));
  expect(hi[1]! - lo[1]!, `${what}: the plate is flat`).toBeLessThanOrEqual(TOL);
  expect(Math.abs(hi[0]! - lo[0]! - side.size[0]), `${what}: the plate spans its ${side.size[0]} m along x`).toBeLessThanOrEqual(TOL);
  expect(Math.abs(hi[2]! - lo[2]! - side.size[1]), `${what}: the plate spans its ${side.size[1]} m along z`).toBeLessThanOrEqual(TOL);
  return side.cells.map(([i, j]) => [lo[0]! + ((i + 0.5) * side.size[0]) / side.grid[0], lo[1]!, lo[2]! + ((j + 0.5) * side.size[1]) / side.grid[1]]);
}

/** A derived item's `at.pos`, or null when it has none of three numbers. */
function posOf(item: JsonObject): V3 | null {
  const at = item['at'];
  if (!isObject(at) || !Array.isArray(at['pos']) || at['pos'].length !== 3) return null;
  const p = at['pos'];
  return p.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (p as V3) : null;
}

/** One derived item per face, `<instance>.<step>.<index>`, a KIND at its face's centre, each with its own seed. Each failure names the item or the count. */
function faceFailures(e: Expansion, side: Side, centres: V3[]): string[] {
  const failures: string[] = [];
  const n = side.derived.length;
  const got = Object.keys(e.derived);
  if (got.length !== n) failures.push(`${e.instance} expands into ${got.length} derived items for ${n} faces of ${PLATE}#top (the ${side.name} plate), not one per face`);
  for (const id of got) if (!side.derived.includes(id)) failures.push(`${id} is no face's derived item: the ${side.name} plate's faces make ${side.derived[0]} … ${side.derived[n - 1]}`);
  side.derived.forEach((id, k) => {
    const item = e.derived[id];
    if (!item) { failures.push(`${id} is missing: face ${k} of the ${side.name} plate has no derived item`); return; }
    if (item['kind'] !== KIND) failures.push(`${id} is a ${String(item['kind'])}, not the step's ${KIND}`);
    const pos = posOf(item);
    const want = centres[k]!;
    const [i, j] = side.cells[k]!;
    if (!pos) failures.push(`${id} has no at.pos of three numbers: ${shown(item['at'])}`);
    else if (pos.some((v, a) => Math.abs(v - want[a]!) > TOL)) failures.push(`${id} stands at ${fmt(pos)}, not at face ${k}'s centre ${fmt(want)} (cell ${i}, ${j} of the ${side.name} plate, x fastest, then z)`);
    if (!e.seeds[id]) failures.push(`${id} has no seed`);
  });
  const bySeed = new Map<string, string[]>();
  for (const id of side.derived) {
    const s = e.seeds[id];
    if (s) bySeed.set(s, [...(bySeed.get(s) ?? []), id]);
  }
  for (const [s, ids] of bySeed) if (ids.length > 1) failures.push(`${ids.join(', ')} share the seed ${s}, though seeds come from (instance, step, element index)`);
  return failures;
}

/** The derived items there were keep their seeds once faces are added. Each failure names the item. */
function reseedFailures(before: Expansion, after: Expansion, was: Side, now: Side): string[] {
  const failures: string[] = [];
  for (const id of KEPT) {
    const b = before.seeds[id];
    const a = after.seeds[id];
    if (b === undefined) failures.push(`${id} has no seed over the ${was.name} plate`);
    else if (a === undefined) failures.push(`${id} has no seed over the ${now.name} plate, once a row of faces was added`);
    else if (a !== b) failures.push(`${id}'s seed is ${a} over the ${now.name} plate and ${b} over the ${was.name} plate: adding faces reseeded it`);
  }
  return failures;
}

interface Played { side: Side; expansion: Expansion; centres: V3[] }
/** Both revisions of one document, each followed by the plate's built positions. */
function play(planted?: Planted): [Played, Played] {
  const calls = SIDES.flatMap((s) => [show(DOC, sceneDoc(`Posts on a ${s.name} plate`, PACKS, s.items)), geometryCall(DOC, [PLATE])]);
  const replies = runShow(bin(), scenario(dir(), DOC, calls, planted));
  const played = SIDES.map((side, k): Played => {
    const what = `the ${side.name} plate's revision`;
    admitted(replies[2 * k]!, what);
    return { side, expansion: expansionOf(replies[2 * k]!, INSTANCE, what), centres: centresOf(positionsOf(replies[2 * k + 1]!, PLATE, `${what}: geometry`), side, what) };
  });
  return [played[0]!, played[1]!];
}

function faceProblems(planted?: Planted): string[] {
  return play(planted).flatMap((p) => faceFailures(p.expansion, p.side, p.centres));
}
function reseedProblems(planted?: Planted): string[] {
  const [before, after] = play(planted);
  return reseedFailures(before.expansion, after.expansion, before.side, after.side);
}

describe('AC1 a repeat over a plate\'s faces makes one derived step per face, and adding a face reseeds no other', () => {
  it('AC1 the 3 x 2 plate, and the same instance over it with one more row, each make one derived item per face at its cell\'s centre, and the six there were keep their seeds', () => {
    const [before, after] = play();
    none([
      ...faceFailures(before.expansion, before.side, before.centres),
      ...faceFailures(after.expansion, after.side, after.centres),
      ...reseedFailures(before.expansion, after.expansion, before.side, after.side),
    ], 'one derived item per face, and no reseeding');
  });

  for (const twin of TWINS) {
    const planted = str(twin['planted'], 'a twin\'s planted') as Planted;
    const names = arr(twin['names'], `${planted}'s names`).map((n, i) => str(n, `${planted}'s names[${i}]`));
    it(`AC1 the planted ${planted} (${String(twin['wrong'])}) fails the ${String(twin['check'])} check, naming ${names.join(', ')}`, () => {
      const problems = twin['check'] === 'reseed' ? reseedProblems(planted) : faceProblems(planted);
      failsNaming(problems, names, `the planted ${planted}`);
    });
  }
});
