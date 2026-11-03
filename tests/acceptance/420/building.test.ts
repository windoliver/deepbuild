// AC3: "Walls, openings, slabs, roofs and stairs build from the building module, each declaring what it reads, and
// a recipe repeat without a fixed count is refused"
//
// A small house: two 0.2 m walls meeting at a corner (wa from (0, 0) to (4, 0), wb from (4, 0) to (4, 3), plan
// metres), a door in wa (a child of wa, 0.9 × 2.1 m, sill 0), a floor slab with a hole that names the stair, a
// gable roof and a straight stair of 2.6 m rise. Each of the five kinds is registered by the `building` module and
// declares `reads` (siblings | children | refs) in the kinds call: a wall reads at least its siblings and its
// children, an opening and a slab at least refs. Each builds a closed mesh whose declared count is what it builds.
// What each reads is shown by what it builds: wa ends square at x = 4 without wb and mitred out to x = 4.1 with it;
// the door takes exactly 0.9 × 2.1 × 0.2 m³ out of wa's volume (no boolean geometry: the hole is part of the wall's
// own build); the floor's volume is its outline less the stair's `well` outline (clipped to the floor) times its
// thickness; the stair has ⌈2.6 ÷ 0.18⌉ = 15 risers, none above 0.18 m; and a change to the roof alone leaves the
// keys of wa's and the floor's nodes as they were, while removing wb changes wa's. Then the recipes: a pack whose
// repeat counts by its input n installs and expands n walls; a pack whose repeat count reads t, and one whose repeat
// names no count at all, are refused by the pack check, naming the recipe and the step; and a document that binds
// the count's input n to a channel (so the count would change while playing) is refused, naming the path.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, KINDS, PACKS, REGISTRY, RISER_MAX, ROWS, ROWS_OPEN, ROWS_TIMED, admitted, arr, canon, clipToRect, close, docId, errors,
  evalCall, geometryCall, geometryOf, installPack, issues, itemOf, kindsOf, meshProblems, nodesOf, none, num, obj, ofItem, outcome, packAt,
  polygon, registryKinds, runShow, scenario, sceneDoc, show, useBins, useDir, volumeOf, weld, weldedTriangles, type Geometry, type JsonObject,
  type Node,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();
const FIVE = ['arch.wall@1', 'arch.opening@1', 'arch.slab@1', 'arch.roof@1', 'arch.stair@1'];
const DOOR = { width: 0.9, height: 2.1 };
const WALL_T = 0.2;
const FLOOR: [number, number][] = [[-1, -1], [9, -1], [9, 7], [-1, 7]];
const FLOOR_T = 0.2;
const RISE = 2.6;

function houseDoc(opts: { wb?: boolean; door?: boolean; pitch?: number } = {}): JsonObject {
  const wall = (a: [number, number], b: [number, number]): JsonObject => ({ kind: 'arch.wall@1', params: { a, b, thickness: WALL_T, height: 2.7, justify: 'center', outside: 'left', cut_height: 1.2 } });
  const items: Record<string, JsonObject> = { cam: CAMERA, wa: wall([0, 0], [4, 0]) };
  if (opts.wb !== false) items['wb'] = wall([4, 0], [4, 3]);
  if (opts.door !== false) items['door'] = { kind: 'arch.opening@1', parent: 'wa', params: { wall: 'wa', type: 'door', at_along: 1, width: DOOR.width, height: DOOR.height, sill: 0, swing: 'in', hinge: 'left', open: 0 } };
  items['floor'] = { kind: 'arch.slab@1', params: { outline: FLOOR, holes: ['stair'], thickness: FLOOR_T }, at: { pos: [0, -FLOOR_T, 0] } };
  items['roof'] = { kind: 'arch.roof@1', params: { type: 'gable', size: [4.4, 3.4], pitch: opts.pitch ?? 30, overhang: 0.2 }, at: { pos: [2, 2.7, 1.5] } };
  items['stair'] = { kind: 'arch.stair@1', params: { type: 'straight', rise: RISE, width: 0.9 }, at: { pos: [5, 0, 1] } };
  return sceneDoc('A small house', items, { requires: { modules: { scene3d: '^1', building: '^1' } } });
}

const maxX = (g: Geometry): number => Math.max(...g.positions.map((p) => p[0]));
const minX = (g: Geometry): number => Math.min(...g.positions.map((p) => p[0]));
const solidVolume = (g: Geometry): number => { const w = weld(g.positions); return g.closed.reduce((s, part) => s + volumeOf(w.points, weldedTriangles(g, w, part.triangles)), 0); };
const keysOf = (nodes: Node[]): string => canon(Object.fromEntries(nodes.map((n) => [n.operator, n.key])));

describe(`${AC[3]} building kinds from the building module, each declaring what it reads`, () => {
  it(`${AC[3]} walls, openings, slabs, roofs and stairs are the building module's kinds, each declaring reads: a wall its siblings and children, an opening and a slab refs`, () => {
    const [reg, kinds] = runShow(bins.bin('deep-show'), scenario(dir(), [], [REGISTRY, KINDS]));
    const modules = registryKinds(reg!);
    for (const k of FIVE) expect(modules[k], `${k} is registered by the building module`).toBe('building');
    const rows = new Map(kindsOf(kinds!).map((r) => [r.kind, r]));
    for (const k of FIVE) {
      const reads = rows.get(k)?.reads;
      expect(Array.isArray(reads), `${k} declares what it reads`).toBe(true);
      for (const r of reads!) expect(['siblings', 'children', 'refs'], `${k} reads ${r}`).toContain(r);
    }
    expect(rows.get('arch.wall@1')!.reads, 'a wall reads its neighbours for mitres and its child openings for holes').toEqual(expect.arrayContaining(['siblings', 'children']));
    expect(rows.get('arch.opening@1')!.reads, 'an opening reads the wall it names').toEqual(expect.arrayContaining(['refs']));
    expect(rows.get('arch.slab@1')!.reads, 'a slab reads what its holes name (a stair\'s well)').toEqual(expect.arrayContaining(['refs']));
  }, 900_000);

  it(`${AC[3]} the house builds each of the five as a closed mesh it declares; wa mitres to x = 4.1 only beside wb; the door takes 0.9 × 2.1 × 0.2 m³ out of wa; the floor loses the stair's well; the stair has 15 risers of at most ${RISER_MAX} m`, () => {
    const ids = ['wa', 'wb', 'door', 'floor', 'roof', 'stair'];
    const [house, , alone, , plain, g1, g2, g3] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a, DOC.b, DOC.c], [
      show(DOC.a, houseDoc()), evalCall(DOC.a),
      show(DOC.b, houseDoc({ wb: false })), evalCall(DOC.b),
      show(DOC.c, houseDoc({ door: false })),
      geometryCall(DOC.a, { items: ids, stage: 'final' }),
      geometryCall(DOC.b, { items: ['wa'], stage: 'final' }),
      geometryCall(DOC.c, { items: ['wa'], stage: 'final' }),
    ]));
    admitted(house!, 'the house');
    admitted(alone!, 'the house without wb');
    admitted(plain!, 'the house without the door');
    const g = geometryOf(g1!, 'the house');
    const problems: string[] = [];
    for (const id of ids) {
      const item = itemOf(g, id, 'the house');
      if (item.closed.length === 0) problems.push(`${id}: no closed part`);
      problems.push(...meshProblems(id, item, null));
    }
    none(problems, 'the house\'s building kinds');
    const wa = itemOf(g, 'wa', 'the house');
    const waAlone = itemOf(geometryOf(g2!, 'without wb'), 'wa', 'without wb');
    const waPlain = itemOf(geometryOf(g3!, 'without the door'), 'wa', 'without the door');
    expect(Math.abs(minX(wa)) < 1e-6, `wa's free end is square at x = 0 (got ${minX(wa)})`).toBe(true);
    expect(Math.abs(maxX(wa) - 4.1) < 1e-6, `beside wb, wa mitres out to the outer corner at x = 4.1 (got ${maxX(wa)})`).toBe(true);
    expect(Math.abs(maxX(waAlone) - 4) < 1e-6, `without wb, wa ends square at x = 4 (got ${maxX(waAlone)})`).toBe(true);
    const cut = DOOR.width * DOOR.height * WALL_T;
    const v = solidVolume(wa); const vPlain = solidVolume(waPlain);
    expect(close(vPlain - v, cut), `the door takes ${cut} m³ out of wa: ${vPlain} without it, ${v} with it`).toBe(true);
    const stair = itemOf(g, 'stair', 'the house');
    const risers = num(stair.outputs['risers'], 'the stair\'s risers');
    expect(risers, `the stair's riser count from its rise: ⌈${RISE} ÷ ${RISER_MAX}⌉`).toBe(Math.ceil(RISE / RISER_MAX));
    expect(RISE / risers <= RISER_MAX + 1e-12, `each riser is at most ${RISER_MAX} m`).toBe(true);
    const well = arr(stair.outputs['well'], 'the stair\'s well outline').map((p, i) => { const q = arr(p, `well[${i}]`); return [num(q[0], 'x'), num(q[1], 'y')] as [number, number]; });
    const hole = polygon(clipToRect(well, [-1, -1, 9, 7])).area;
    expect(hole, 'the stair\'s well lies on the floor').toBeGreaterThan(0.5);
    const floor = itemOf(g, 'floor', 'the house');
    const want = (polygon(FLOOR).area - hole) * FLOOR_T;
    expect(close(solidVolume(floor), want), `the floor is its outline less the stair's well, times ${FLOOR_T} m: ${want} m³, got ${solidVolume(floor)} m³`).toBe(true);
  }, 900_000);

  it(`${AC[3]} what each reads decides what rebuilds: changing the roof's pitch alone leaves wa's and the floor's node keys, while removing wb changes wa's`, () => {
    const [a, fa, b, fb, c, fc] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
      show(DOC.a, houseDoc()), evalCall(DOC.a),
      show(DOC.a, houseDoc({ pitch: 40 })), evalCall(DOC.a, '0.1s'),
      show(DOC.a, houseDoc({ pitch: 40, wb: false }), ['wb']), evalCall(DOC.a, '0.2s'),
    ]));
    for (const [r, what] of [[a, 'the house'], [b, 'the steeper roof'], [c, 'without wb']] as const) admitted(r!, what);
    const n1 = nodesOf(fa!, 'the house'); const n2 = nodesOf(fb!, 'the steeper roof'); const n3 = nodesOf(fc!, 'without wb');
    expect(ofItem(n1, 'wa').length, 'wa has nodes').toBeGreaterThan(0);
    expect(keysOf(ofItem(n2, 'wa')), 'the roof\'s pitch is outside wa\'s reads').toBe(keysOf(ofItem(n1, 'wa')));
    expect(keysOf(ofItem(n2, 'floor')), 'the roof\'s pitch is outside the floor\'s reads').toBe(keysOf(ofItem(n1, 'floor')));
    expect(keysOf(ofItem(n2, 'roof')), 'and inside the roof\'s own').not.toBe(keysOf(ofItem(n1, 'roof')));
    expect(keysOf(ofItem(n3, 'wa')), 'wa reads its sibling wb, so removing wb changes wa\'s keys').not.toBe(keysOf(ofItem(n2, 'wa')));
  }, 900_000);
});

describe(`${AC[3]} a recipe repeat without a fixed count is refused`, () => {
  const fence = (kind: string, pack: string, extra: JsonObject = {}): JsonObject =>
    sceneDoc('A fence', { cam: CAMERA, f1: { kind, params: { n: 4 } } }, { packs: [pack], requires: { modules: { scene3d: '^1', building: '^1' } }, ...extra });

  it(`${AC[3]} a repeat counted by its input installs and expands at check (control); one counted by t and one with no count are refused by the pack check, naming the recipe and the step`, () => {
    const [counted, timed, open, packs, shown] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
      installPack(ROWS), installPack(ROWS_TIMED), installPack(ROWS_OPEN), PACKS,
      show(DOC.a, fence('rows.fence@1', packAt(ROWS))),
    ]));
    expect(outcome(counted!), `${packAt(ROWS)}, whose repeat counts by n, installs: ${canon(counted!['issues'])}`).toBe('installed');
    admitted(shown!, 'the fence of four walls');
    const derived = Object.keys(obj(obj(arr(shown!['expansions'], 'expansions').map((e) => obj(e, 'an expansion')).find((e) => e['instance'] === 'f1'), 'f1\'s expansion')['derived'], 'f1\'s derived items')).sort();
    expect(derived, 'n = 4 expands into four walls').toEqual(['f1.post.0', 'f1.post.1', 'f1.post.2', 'f1.post.3']);
    for (const [reply, pack, recipe] of [[timed, ROWS_TIMED, 'timedrows.fence@1'], [open, ROWS_OPEN, 'openrows.fence@1']] as const) {
      expect(outcome(reply!), `${packAt(pack)}, whose repeat has no fixed count, is refused`).toBe('refused');
      const errs = errors(issues(reply!, packAt(pack)));
      expect(errs.some((e) => canon(e.raw).includes(recipe) && canon(e.raw).includes('post')), `${packAt(pack)}: an error names ${recipe} and its step post: ${canon(reply!['issues'])}`).toBe(true);
    }
    const rows = arr(packs!['packs'], 'packs').map((p) => obj(p, 'a pack row'));
    for (const pack of [ROWS_TIMED, ROWS_OPEN]) expect(rows.find((r) => r['pack'] === pack.id)?.['state'], `${packAt(pack)} stays refused in the store`).toBe('refused');
  }, 900_000);

  it(`${AC[3]} a document that drives the repeat's count with a channel on f1's n is refused, naming items/f1/params/n; the same document without the channel is presented`, () => {
    const channel = { channels: { grow: { target: 'items/f1/params/n', type: 'f32', keys: { k0: { t: '0s', value: 2, interp: 'step' }, k1: { t: '1s', value: 6 } } } } };
    const [, refused, fine] = runShow(bins.bin('deep-show'), scenario(dir(), [docId(1), docId(2)], [
      installPack(ROWS),
      show(docId(1), fence('rows.fence@1', packAt(ROWS), channel)),
      show(docId(2), fence('rows.fence@1', packAt(ROWS))),
    ]));
    admitted(fine!, 'the fence without the channel');
    expect(outcome(refused!), 'the fence whose count a channel drives is refused').toBe('refused');
    const errs = errors(issues(refused!, 'the refused fence'));
    expect(errs.some((e) => canon(e.raw).includes('items/f1/params/n')), `an error names items/f1/params/n: ${canon(refused!['issues'])}`).toBe(true);
  }, 900_000);
});
