// #166.ab96f725: "A reflected post's image moves from the flat mirror's by at most `distort` px, and with waves of
// amplitude 0 and no ripples the water's reflection equals a plain mirror's by pixel hash"
//
// The fixture (640 × 360): a black sky; a lake plate `lake` 40 m × 40 m of 256 × 256 cells at y = 0; an unlit red post
// 0.4 m × 3 m × 0.4 m standing in it at the origin; the camera 1.5 m above the water 9 m away, looking at the post, so
// the post's reflection lies on the water below it. Both materials have roughness 0 and blur 0, so neither mirror blurs.
//
// The reflection is read from the `reflection` target (README): at each pixel of a mirror part, the linear color its
// mirror lookup returned, after the water's distortion and before any mix with the part's own shading. "The flat
// mirror" is the same plate with a plain material whose `mirror` is `{strength: 1, blur: 0, plane: "lake"}`.
//
// Clause 1: the water with small waves (LAKE_WAVES at a quarter of their amplitude), ripples at 0.3 and `distort: 16`,
// at 1 s. A post pixel is one whose reflected red is above 0.05 and more than four times its green and blue. Every post
// pixel of the water's reflection lies within 16 px (+ 2 px for the lookup's filtering at the post's edge) of a post
// pixel of the flat mirror's. Not vacuous: the flat mirror's reflection holds at least 200 post pixels, and the water's
// post pixels differ from the flat mirror's, so the water bends the lookup. Wrong programs: a distortion scaled past
// `distort` (in other units, or by the bent normal's raw slope), a reflection of the displaced surface's own plane.
// Clause 2: the water with the same four waves at amplitude 0, ripples at strength 0 and no rain: its `reflection`
// target has the plain mirror's SHA-256. Wrong programs: a lookup moved by anything but the bent normal, the water's own
// mirror at another strength, resolution or blur than a plain mirror's.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type Floats, LAKE_WAVES, type JsonObject, type Water, camItem, frameAt, framesOf, look3d, material, plate, readFloats,
  requireGpu, runGpu, sceneDoc, str, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [640, 360];
const CAM: Cam = { position: [0, 1.5, 9], target: [0, 0.8, 0], fov: 50, size: SIZE };
const LOOK = look3d('mirror-166');
const DISTORT = 16;

function pond(id: string, lakeMaterial: JsonObject): JsonObject {
  return sceneDoc(id, SIZE, {
    cam: camItem(CAM), sky: DARK_SKY, 'lake-water': lakeMaterial,
    'post-red': material({ base_color: [1, 0, 0, 1], unlit: true }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
    post: { kind: 'mark.box@1', params: { size: [0.4, 3, 0.4] }, at: { pos: [0, 1, 0] }, material: 'post-red' },
  });
}
const PLAIN = material({ base_color: [0.1, 0.1, 0.1, 1], metallic: 0, roughness: 0, mirror: { strength: 1, blur: 0, plane: 'lake' } });
const water = (w: Water): JsonObject => waterMaterial(w, { roughness: 0 });

/** The post's pixels in a reflection target. */
function postPixels(t: Floats): Set<number> {
  const s = new Set<number>();
  for (let p = 0; p < t.width * t.height; p++) {
    const [r, g, b] = [t.v[p * 4]!, t.v[p * 4 + 1]!, t.v[p * 4 + 2]!];
    if (r > 0.05 && r > 4 * Math.max(g, b, 0)) s.add(p);
  }
  return s;
}

describe(`${AC[3]} the water's reflection is a plain mirror's, moved by at most distort px`, () => {
  it(`${AC[3]} with waves and ripples, every pixel of the reflected post lies within distort (16) px of the flat mirror's post`, () => {
    requireGpu();
    const dir = out();
    const quarter = LAKE_WAVES.map((w) => ({ ...w, amplitude: w.amplitude / 4 }));
    const call = (name: string, m: JsonObject) => view3d({ doc: writeJson(dir, name, pond(name, m)), look: LOOK, size: SIZE, from: 30, frames: 1, fps: 30, capture: [30], targets: ['reflection'] });
    const [wavy, flat] = runGpu(bin(), dir, [call('wavy', water({ waves: quarter, ripples: { strength: 0.3 }, rain: 0, distort: DISTORT })), call('flat', PLAIN)]);
    const read = (r: JsonObject, what: string) => postPixels(readFloats(dir, frameAt(framesOf(r, what), 30, what), 'reflection', SIZE, what));
    const w = read(wavy!, 'the water'); const f = read(flat!, 'the flat mirror');
    console.log(`${AC[3]}: the post's reflection covers ${f.size} px in the flat mirror, ${w.size} px in the water`);
    expect(f.size, 'the flat mirror reflects the post over at least 200 px').toBeGreaterThanOrEqual(200);
    expect(w.size, 'the water reflects the post').toBeGreaterThan(0);
    const R = DISTORT + 2; const far: string[] = []; let moved = 0;
    for (const p of w) {
      if (!f.has(p)) moved++;
      const x = p % SIZE[0]; const y = Math.floor(p / SIZE[0]);
      let best = Infinity;
      for (let dy = -R; dy <= R && best > 0; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SIZE[0] || yy >= SIZE[1] || !f.has(yy * SIZE[0] + xx)) continue;
        best = Math.min(best, Math.hypot(dx, dy));
      }
      if (best > R && far.length < 8) far.push(`pixel (${x}, ${y}) of the water's reflected post is ${best === Infinity ? `over ${R}` : best.toFixed(1)} px from the flat mirror's`);
    }
    expect(moved + [...f].filter((p) => !w.has(p)).length, 'the waves and ripples move the reflected post').toBeGreaterThan(0);
    expect(far, `the reflected post moves by at most ${DISTORT} px (+ 2 px at its edge)`).toEqual([]);
  });

  it(`${AC[3]} with waves of amplitude 0 and no ripples, the water's reflection equals a plain mirror's by hash`, () => {
    requireGpu();
    const dir = out();
    const calm = water({ waves: LAKE_WAVES.map((w) => ({ ...w, amplitude: 0 })), ripples: { strength: 0 }, rain: 0, distort: DISTORT });
    const call = (name: string, m: JsonObject) => view3d({ doc: writeJson(dir, name, pond(name, m)), look: LOOK, size: SIZE, from: 30, frames: 1, fps: 30, capture: [30], targets: ['reflection'] });
    const [calmR, plainR] = runGpu(bin(), dir, [call('calm', calm), call('plain', PLAIN)]);
    const hash = (r: JsonObject, what: string) => str(frameAt(framesOf(r, what), 30, what).raw['reflection'], `${what}: reflection`);
    const plainTarget = readFloats(dir, frameAt(framesOf(plainR!, 'the plain mirror'), 30, 'the plain mirror'), 'reflection', SIZE, 'the plain mirror');
    readFloats(dir, frameAt(framesOf(calmR!, 'the calm water'), 30, 'the calm water'), 'reflection', SIZE, 'the calm water');
    expect(postPixels(plainTarget).size, 'the plain mirror reflects the post').toBeGreaterThanOrEqual(200);
    expect(hash(calmR!, 'the calm water'), 'the calm water\'s reflection has the plain mirror\'s hash').toBe(hash(plainR!, 'the plain mirror'));
  });
});
