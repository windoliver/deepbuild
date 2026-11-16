// AC4 #233.ca1d4667: "`to_corner(UR)` at 1080 × 1920 lands 0.5 units (67.5 u) from both edges within 0.5 px; a planted
// conversion that keeps y up fails the positions fixture, naming the first label more than 1 px off"
//
// The positions fixture (fixtures/positions.json): seven math@1 objects on a portrait figure of 1080 × 1920 u, each
// placed by an upstream layout word (to_corner UR and DL, to_edge UP and LEFT, move_to two points), each with the box it
// must take, worked out by hand from the stated conversions and the upstream defaults (README: Fixtures). `deep show`
// presents them in one figure; the drawn form goes to `deep-canvas-render geometry`, and each object's box is the union
// of its derived items' boxes (#221's `box`, geometry only).
// The first test: ur_square, Square().to_corner(UR), has its right edge 67.5 u from the frame's right edge and its top
// 67.5 u from the top, each within 0.5 px; and every entry's box edges are within 0.5 px of the fixture's.
// The second test presents the same figure under `planted: math_keeps_y_up` (README: The planted programs): the
// fixture's judge (any box edge more than 1 px off) fails, and the first label it names is ur_square.
// Wrong programs: the base (no math@1); y kept up (UR lands at the bottom right); the origin left at the top left; a
// unit from the long side (240 u) or from 1920 × 1080's short side regardless of orientation; a buff in u (0.5 u).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HERE, TIMEOUT, boxOf, derivedOf, docId, drawnForm, geometryOfAll, mathDoc, none, notPresented, present, run, scenario, useBins, useFolders,
  type Box, type JsonObject, type P2, type Planted, type Spec,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
interface Entry { label: string; kind: string; params: JsonObject; box: Box }
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'positions.json'), 'utf8')) as { size: P2; entries: Entry[] };
const SIZE = FIXTURE.size;
const doc = mathDoc('Objects placed by layout words on a portrait frame', SIZE,
  Object.fromEntries(FIXTURE.entries.map((e): [string, Spec] => [e.label, { kind: e.kind, params: e.params }])));

/** Each entry's drawn box: the union of its derived items' boxes. */
function boxes(planted?: Planted): Map<string, Box | null> {
  const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)], planted ? { planted } : {}));
  expect(a.ok, `deep-show run accepts the scenario${planted ? ` with planted ${planted}` : ''}: ${a.why}`).toBe(true);
  const shown = a.replies[0]!;
  expect(notPresented(shown), `the positions figure is presented with no error${planted ? ` (planted ${planted})` : ''}`).toBe('');
  const drawn = drawnForm(doc, shown);
  const out = new Map<string, Box | null>();
  for (const e of FIXTURE.entries) {
    const ids = Object.keys(derivedOf(shown, e.label));
    const bs = ids.length ? Object.values(geometryOfAll(bin('deep-canvas-render'), drawn, ids)).map(boxOf).filter((b): b is Box => b !== null) : [];
    if (!bs.length) { out.set(e.label, null); continue; }
    const x0 = Math.min(...bs.map((b) => b[0])); const y0 = Math.min(...bs.map((b) => b[1]));
    const x1 = Math.max(...bs.map((b) => b[0] + b[2])); const y1 = Math.max(...bs.map((b) => b[1] + b[3]));
    out.set(e.label, [x0, y0, x1 - x0, y1 - y0]);
  }
  return out;
}
/** Each entry more than `tol` px off at some edge, in fixture order, naming its label. */
function off(got: Map<string, Box | null>, tol: number): string[] {
  const edges = (b: Box): number[] => [b[0], b[1], b[0] + b[2], b[1] + b[3]];
  return FIXTURE.entries.flatMap((e) => {
    const b = got.get(e.label);
    if (!b) return [`${e.label}: no box drawn`];
    const d = Math.max(...edges(b).map((v, i) => Math.abs(v - edges(e.box)[i]!)));
    return d > tol ? [`${e.label}: box (${b.map((v) => v.toFixed(2)).join(', ')}) u, ${d.toFixed(2)} px off the fixture's (${e.box.join(', ')})`] : [];
  });
}

describe(`${AC[4]} layout words on a 1080 × 1920 frame`, () => {
  it(`${AC[4]} to_corner(UR) lands 0.5 units (67.5 u) from the right and top edges within 0.5 px, and every fixture entry is where its words put it`, () => {
    const got = boxes();
    const ur = got.get('ur_square');
    expect(ur, 'Square().to_corner(UR) draws a box').toBeTruthy();
    const [x, y, w] = ur!;
    expect(Math.abs(SIZE[0] - (x + w) - 67.5), `its right edge is ${(SIZE[0] - (x + w)).toFixed(3)} u from the frame's right edge, not 67.5`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - 67.5), `its top is ${y.toFixed(3)} u from the frame's top, not 67.5`).toBeLessThanOrEqual(0.5);
    none(off(got, 0.5), 'every entry of the positions fixture within 0.5 px');
  }, TIMEOUT);

  it(`${AC[4]} a planted conversion that keeps y up fails the positions fixture, naming the first label more than 1 px off`, () => {
    const failures = off(boxes('math_keeps_y_up'), 1);
    console.log(`${AC[4]} the plant's failures: ${failures.join('; ')}`);
    expect(failures.length, 'the fixture fails the plant').toBeGreaterThan(0);
    expect(failures[0], 'the first label more than 1 px off is ur_square').toMatch(/^ur_square: /);
  }, TIMEOUT);
});
