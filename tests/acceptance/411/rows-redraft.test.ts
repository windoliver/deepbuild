// AC1, blind redraft: deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn
// from a partial result is refused.
//
// Drafted afresh from the issue, the design and this suite's README (deep_query's rows reply, `expect`), never from
// an implementation. Read as the README reads it: a conclusion of absence is `expect: {none: {kind}}`; on a complete
// result deep_query answers `absent`, true or false, and on a result its cap cut it refuses with `partial_result` and
// never answers `absent: true`, since the rows it left out may hold one.
//
// Every document here is built only from kinds the base's `full` build registers (camera@1 and scene3d's
// mark.box@1 and mark.sphere@1), and the base's deep_show presents each with no issue and no notice
// (AC1-REDRAFT.md has that run), so each row is an item the core evaluates, never one it skips.
import { describe, expect, it } from 'vitest';
import {
  DOC, FULL, KEY, type JsonObject, type JsonValue, brief, coverage, presented, query, rows, run, scenario, show, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** A small 3D scene: a camera, then the items given. */
function scene3(title: string, items: JsonObject[]): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } };
  return {
    format: 1, profile: 'scene', title, description: `${title}, for the #411 suite's AC1 redraft.`,
    size: [128, 96], camera: 'cam', requires: { modules: { scene3d: '^1' } },
    items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])),
  };
}
const box = (id: string, name: string, order: string, pos: number[], extra: JsonObject = {}, size = [1, 1, 1]): JsonObject =>
  ({ id, kind: 'mark.box@1', name, order, params: { size, paint: { fill: { role: 'accent' } } }, at: { pos }, ...extra });
const sphere = (id: string, name: string, order: string, pos: number[]): JsonObject =>
  ({ id, kind: 'mark.sphere@1', name, order, params: { size: [1, 1, 1], paint: { fill: { role: 'muted' } } }, at: { pos } });

/** A shelf holding two bins of different sizes, and a loose crate: two levels under the camera. */
const SHELF = scene3('Shelf', [
  box('shelf', 'Shelf', 'b0', [0, 0, 0]),
  box('shelf.left', 'Left bin', 'b0', [-1, 1, 0], { parent: 'shelf' }),
  box('shelf.right', 'Right bin', 'b1', [1, 1, 0], { parent: 'shelf' }, [0.5, 0.5, 0.5]),
  box('crate', 'Crate', 'b1', [3, 0, 0]),
]);
/** What each row asked for must say: the item's kind, its parent and its number of children. */
const SHELF_ROWS: Record<string, { kind: string; parent: string | null; children: number }> = {
  'crate': { kind: 'mark.box@1', parent: null, children: 0 },
  'shelf': { kind: 'mark.box@1', parent: null, children: 2 },
  'shelf.left': { kind: 'mark.box@1', parent: 'shelf', children: 0 },
  'shelf.right': { kind: 'mark.box@1', parent: 'shelf', children: 0 },
};

/** Eight posts in a row (9 items with the camera); the same with a ball, last by ID, by order and in the listing. */
const POSTS: JsonObject[] = Array.from({ length: 8 }, (_, i) => box(`post.${i}`, `Post ${i}`, `b${i}`, [i * 1.5, 0, 0]));
const ROW = scene3('Posts', POSTS);
const ROW_BALL = scene3('Posts and a ball', [...POSTS, sphere('zz.ball', 'Ball', 'z0', [0, 2, 0])]);
const NO_SPHERE = { none: { kind: 'mark.sphere@1' } };
const CAP = 3;

const byId = (got: JsonObject[]): Map<JsonValue | undefined, JsonObject> => new Map(got.map((r) => [r['id'], r]));

describe('AC1 deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused', () => {
  it('AC1 rows asked for by ID come back keyed by those IDs, with kind, parent, content key and children_total, under a complete coverage block', () => {
    const asked = ['shelf.right', 'crate', 'shelf', 'shelf.left'];
    const [shown, first, again] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, SHELF),
      query(DOC.a, { what: 'rows', items: asked }),
      query(DOC.a, { what: 'rows', items: [...asked].reverse() }),
    ]));
    presented(shown!, 'the shelf scene');

    const got = rows(first!);
    expect(got.map((r) => r['id']).sort(), `one row for each ID asked for, none for the camera (${brief(got)})`).toEqual(Object.keys(SHELF_ROWS).sort());
    for (const [id, want] of Object.entries(SHELF_ROWS)) {
      const r = byId(got).get(id)!;
      expect(r['kind'], `row ${id}: the item's kind`).toBe(want.kind);
      expect(r['parent'], `row ${id}: the item's parent`).toBe(want.parent);
      expect(r['children_total'], `row ${id}: the item's number of children`).toBe(want.children);
      expect(String(r['key']), `row ${id}: a content key (${brief(r)})`).toMatch(KEY);
    }
    expect(byId(got).get('shelf.left')!['key'], 'the bins differ in size, so their rows carry different content keys').not.toBe(byId(got).get('shelf.right')!['key']);
    got.forEach((r, i) => {
      if (r['parent'] === null) return;
      const p = got.findIndex((x) => x['id'] === r['parent']);
      expect(p >= 0 && p < i, `row ${String(r['id'])} comes after its parent ${String(r['parent'])} (${got.map((x) => x['id']).join(', ')})`).toBe(true);
    });

    const c = coverage(first!);
    expect(c['complete'], `the coverage block says the result is complete (${brief(c)})`).toBe(true);
    expect([c['rows_total'], c['rows_shown']], 'the coverage block counts 4 rows matched, 4 shown').toEqual([4, 4]);
    expect(c['cut'], 'nothing was cut').toEqual([]);

    // A stable ID names the same row, with the same content key, whatever order the IDs are asked in.
    const twice = byId(rows(again!));
    expect([...twice.keys()].sort(), 'the same rows asked in another order').toEqual(Object.keys(SHELF_ROWS).sort());
    for (const id of Object.keys(SHELF_ROWS)) expect(twice.get(id), `row ${id} is the same row both times`).toEqual(byId(got).get(id));
  });

  it('AC1 absence is concluded both ways on a complete result, and refused with partial_result, never absent: true, on a result cut by its cap', () => {
    const [a, b, none, found, cutNone, cutHidden] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null, [DOC.b]: null }, [
      show(DOC.a, ROW),
      show(DOC.b, ROW_BALL),
      query(DOC.a, { expect: NO_SPHERE }),
      query(DOC.b, { expect: NO_SPHERE }),
      query(DOC.a, { expect: NO_SPHERE, cap: CAP }),
      query(DOC.b, { expect: NO_SPHERE, cap: CAP }),
    ]));
    presented(a!, 'the row of posts');
    presented(b!, 'the row of posts with a ball');

    // Complete results: the conclusion is drawn, either way.
    expect(coverage(none!)['complete'], `the uncut posts are a complete result (${brief(coverage(none!))})`).toBe(true);
    expect(none!['absent'], `no sphere among the posts: ${brief(none)}`).toBe(true);
    expect(none!['code'], 'a complete result is not refused').toBeUndefined();
    expect(coverage(found!)['complete'], `the uncut posts and ball are a complete result (${brief(coverage(found!))})`).toBe(true);
    expect(found!['absent'], `the ball is a sphere: ${brief(found)}`).toBe(false);
    expect(rows(found!).some((r) => r['id'] === 'zz.ball' && r['kind'] === 'mark.sphere@1'), 'the ball\'s row is in the result').toBe(true);

    // The same documents cut to 3 rows: absence can't be concluded from them, whether or not a sphere is really there.
    for (const [reply, total, what] of [[cutNone!, 9, 'the posts'], [cutHidden!, 10, 'the posts and ball']] as const) {
      const kept = rows(reply);
      const c = coverage(reply);
      expect(c['complete'], `${what} cut to ${CAP} rows: the coverage block says partial (${brief(c)})`).toBe(false);
      expect(kept.length, `${what}: ${CAP} rows kept`).toBe(CAP);
      expect([c['rows_total'], c['rows_shown']], `${what}: the coverage block counts ${total} rows matched, ${CAP} shown`).toEqual([total, CAP]);
      expect(c['cut'], `${what}: the cut is named at the top level`).toEqual([{ parent: null, shown: CAP, total }]);
      expect(reply['absent'], `${what}: absence is never concluded from ${CAP} of ${total} rows (${brief(reply)})`).not.toBe(true);
      // A kept sphere would settle it (absent: false); with none kept, the cut rows may hold one, so it is refused.
      // The ball is last by ID, by order and in the listing, so a cut to 3 leaves it out, and a conclusion of
      // absence drawn from the kept rows would be false there.
      if (kept.some((r) => r['kind'] === 'mark.sphere@1')) expect(reply['absent'], `${what}: a kept sphere settles it`).toBe(false);
      else expect(reply['code'], `${what}: the conclusion of absence is refused (${brief(reply)})`).toBe('partial_result');
    }
  });
});
