// AC6 #162.bc95e877: "A repeater with 3.5 copies exports as four groups, the last at half its opacity, and a document
// with a twist exports its output path keyed at each export frame where it changes"
//
// The tiles: a 24 u square with a repeater of 3.5 copies, each 30 u right of the last, at full opacity (its default
// opacity [1, 1]); Lottie 1.0.1 has no repeater, so the export writes its copies: four groups each holding the square,
// with their own transforms, opacities 100, 100, 100 and 50, 30 u apart. The knot: a closed 240 × 60 outline with a
// twist whose angle runs from 0 at 0.5 s to 90° at 1.5 s, 24 fps for 2 s, so its output path changes at every export
// frame from 13 to 36 and nowhere else: its path shape must be keyed at every frame from 12 to 36, and the path written
// before the twist starts is the outline itself (the twist at 0° changes nothing), whatever points it adds.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, GEOMETRY, TIMEOUT, apply, channel, exportedOf, film, groupTransform, isKeyed, item, keysOf, layerNamed, lottieExport, none, readLottie, shapeToRoot,
  shapesIn, show, showRun, useShow, useTemp, valueAt, type JsonObject, type JsonValue, type Pt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function copiesDoc(evidence: string): JsonObject {
  return film(evidence, {
    id: 'copies', size: [320, 180], rate: [24, 1], frames: 48,
    items: [
      item('tiles', 'rect@1', 'Tiles', 'a02', { box: [20, 20, 24, 24], paint: { fill: { role: 'accent' } }, ops: [{ repeater: { copies: 3.5, at: { pos: [30, 0] } } }] }),
      item('knot', 'path@1', 'Knot', 'a03', { d: 'M 40 100 L 280 100 L 280 160 L 40 160 Z', paint: { stroke: { role: 'ink', width: 4 } }, ops: [{ twist: { angle: 0, center: [160, 130] } }] }),
    ],
    channels: { twist: channel('items/knot/params/ops/0/twist/angle', [[0.5, 0], [1.5, 90]]) },
  });
}
/** A point lies on the knot's outline (within 1e-3 u). */
const onOutline = ([x, y]: Pt): boolean => {
  const e = 1e-3;
  const inX = x >= 40 - e && x <= 280 + e; const inY = y >= 100 - e && y <= 160 + e;
  return (inX && (Math.abs(y - 100) <= e || Math.abs(y - 160) <= e)) || (inY && (Math.abs(x - 40) <= e || Math.abs(x - 280) <= e));
};

describe(`${AC[6]} a repeater of 3.5 copies as four groups, the last at half opacity; a twist's output path keyed where it changes`, () => {
  it(`${AC[6]} the tiles export as four groups 30 u apart at opacities 100, 100, 100 and 50; the knot's path is keyed at every export frame from 12 to 36`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'copies.json');
    const [reply] = showRun(shows.bin(FULL), evidence, [copiesDoc(evidence)], [lottieExport(0, out)], 'the repeater and the twist');
    exportedOf(reply!, 'the repeater and the twist');
    const anim = readLottie(out, 'the repeater and the twist');

    const tiles = layerNamed(anim, 'Tiles', 'the tiles');
    const groups = shapesIn(tiles.layer['shapes']).filter((s) => s.shape['ty'] === 'gr' && (Array.isArray(s.shape['it']) ? s.shape['it'] : []).some((x) => typeof x === 'object' && x !== null && !Array.isArray(x) && GEOMETRY.has(String((x as JsonObject)['ty']))));
    expect(groups.length, `the repeater's 3.5 copies are four groups, each holding the square: ${show(tiles.layer['shapes'] ?? null, 800)}`).toBe(4);
    const copies = groups.map((g) => {
      const at = shapeToRoot(anim, tiles, [...g.groups, g.shape], 0, 'a copy');
      const tr = groupTransform(g.shape);
      return { origin: apply(at, [0, 0]), opacity: tr ? valueAt(tr['o'], 0)[0] ?? 100 : 100 };
    }).sort((p, q) => p.origin[0] - q.origin[0]);
    none(copies.flatMap((c, k) => {
      const dx = c.origin[0] - copies[0]!.origin[0]; const dy = c.origin[1] - copies[0]!.origin[1];
      return Math.abs(dx - 30 * k) <= 1e-4 && Math.abs(dy) <= 1e-4 ? [] : [`copy ${k} is (${dx}, ${dy}) from the first, not (${30 * k}, 0)`];
    }), 'each copy is the repeater\'s step from the last');
    expect(copies.map((c) => c.opacity), 'the copies\' opacities: three at 100, the last at half its own').toEqual([100, 100, 100, 50]);

    const knot = layerNamed(anim, 'Knot', 'the knot');
    const paths = shapesIn(knot.layer['shapes']).filter((s) => s.shape['ty'] === 'sh');
    expect(paths.length, 'the knot is one path shape').toBe(1);
    const ks = paths[0]!.shape['ks'];
    expect(isKeyed(ks), `the twisted path is keyed: ${show(ks ?? null, 400)}`).toBe(true);
    const at = new Set(keysOf(ks).map((k) => Number(k['t'])));
    none(Array.from({ length: 25 }, (_, i) => 12 + i).filter((k) => !at.has(k)).map((k) => `no key at export frame ${k}`), 'a key at every export frame from 12 to 36, where the twist changes the path');
    const extra = [...at].filter((k) => k < 12 || k > 36);
    expect(extra.length, `at most a key before and one after the twist's span: ${extra.join(', ')}`).toBeLessThanOrEqual(2);
    const toRoot = shapeToRoot(anim, knot, paths[0]!.groups, 0, 'the knot');
    const first = keysOf(ks)[0]!;
    const shape = (Array.isArray(first['s']) ? first['s'][0] : first['s']) as JsonValue;
    const vertices = (typeof shape === 'object' && shape !== null && !Array.isArray(shape) && Array.isArray(shape['v']) ? shape['v'] : []) as JsonValue[];
    const pts = vertices.map((v) => apply(toRoot, [Number((v as number[])[0]), Number((v as number[])[1])]));
    expect(pts.length, 'the path before the twist has vertices').toBeGreaterThanOrEqual(4);
    none(pts.filter((p) => !onOutline(p)).map((p) => `(${p[0]}, ${p[1]})`), 'before the twist starts, every written vertex lies on the outline');
    none(([[40, 100], [280, 100], [280, 160], [40, 160]] as Pt[]).filter((c) => !pts.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= 1e-3)).map((c) => `corner (${c[0]}, ${c[1]})`), 'the outline\'s four corners are written');
  }, TIMEOUT);
});
