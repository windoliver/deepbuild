// #465 scope, a gap the blind suite leaves open: "Effect flare from the evaluated lights and the brightest emissive
// pixels". With `from: {emissive: EV100}` a flare is built from the frame's pixels at or above that level, so its
// ghosts follow what the frame shows of an emissive part, not the part itself.
//
// The fixture (960 × 540, fov 50° across the width): a black room, the camera at z = 6 looking down −Z, a small box
// whose material emits radiance 50 at the frame's right on its horizontal midline, and an opaque black box nearer the
// camera hiding the emissive box's top half. The flare: `from: {emissive: log2(80)}` (a level of 10 cd/m²), 4 ghosts.
// Its own light is `pre_tone` with the flare less without it. The emissive pixels' centroid E is read from the frame
// without the flare (luminance ≥ 10); every ghost (an 8-connected part at 1% of the flare's brightest pixel that the
// frame doesn't cut) must lie within 0.5 px of the line through E and the frame's centre. A flare built from the part's
// centre, whose top half is hidden, puts its ghosts about |place| × 9 px off that line. At a level above the box's
// radiance (100 cd/m²) the flare draws nothing.
import { describe, expect, it } from 'vitest';
import {
  type Cam, DARK_SKY, type JsonObject, type Lum, box, camItem, flare, frameAt, framesOf, look3d, material, minus, readLum, requireGpu, runGpu,
  sceneDoc, unproject, useGpu, useOut, view3d, writeJson,
} from '../465/helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [960, 540];
const CAM: Cam = { position: [0, 0, 6], target: [0, 0, 0], fov: 50, size: SIZE };
const LOOK = look3d('emissive-465');
const [EX, EY] = unproject(CAM, 690, 270, 6);
const [OX, OY] = unproject(CAM, 690, 255, 5);
const PX_AT_6 = SIZE[0] / 2 / Math.tan((25 * Math.PI) / 180) / 6;
const PX_AT_5 = (PX_AT_6 * 6) / 5;

function room(withFlare: boolean, level: number): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camItem(CAM), sky: DARK_SKY,
    glow: material({ base_color: [0, 0, 0, 1], emission: [1, 1, 1], emission_strength: 50, roughness: 1 }),
    black: material({ base_color: [0, 0, 0, 1], roughness: 1 }),
    lamp: box([36 / PX_AT_6, 36 / PX_AT_6, 0.05], [EX, EY, 0], 'glow'),
    cover: box([50 / PX_AT_5, 30 / PX_AT_5, 0.05], [OX, OY, 1], 'black'),
  };
  if (withFlare) {
    const f = flare({ ghosts: 4 }) as { params: { flare: JsonObject } };
    f.params.flare['from'] = { emissive: Math.log2(level / 0.125) };
    items['flare'] = f as unknown as JsonObject;
  }
  return sceneDoc(`emissive-${withFlare ? 'flare' : 'plain'}-${level}`, SIZE, items);
}

function parts(f: Lum): { gx: number; gy: number }[] {
  const peak = f.y.reduce((m, v) => Math.max(m, v), 0);
  const seen = new Uint8Array(f.y.length); const found: { gx: number; gy: number }[] = [];
  for (let i = 0; i < f.y.length; i++) {
    if (seen[i] || f.y[i]! < 0.01 * peak) continue;
    let w = 0; let sx = 0; let sy = 0; let cut = false; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!; const x = j % f.width; const y = (j - x) / f.width; const v = f.y[j]!;
      w += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
      if (x === 0 || y === 0 || x === f.width - 1 || y === f.height - 1) cut = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy; const k = yy * f.width + xx;
        if (xx < 0 || yy < 0 || xx >= f.width || yy >= f.height || seen[k] || f.y[k]! < 0.01 * peak) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (!cut) found.push({ gx: sx / w, gy: sy / w });
  }
  return found;
}

describe('#465 scope: a flare from the brightest emissive pixels', () => {
  it('ghosts lie on the line through the shown emissive pixels\' centroid and the centre; above the level, no flare', () => {
    requireGpu();
    const dir = out();
    const call = (doc: JsonObject): JsonObject => view3d({ doc: writeJson(dir, String(doc['id']), doc), look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['pre_tone'] });
    const replies = runGpu(bin(), dir, [call(room(false, 10)), call(room(true, 10)), call(room(true, 100))]);
    const [plain, lit, above] = replies.map((r, k) => readLum(dir, frameAt(framesOf(r, `room ${k}`), 0, `room ${k}`), 'pre_tone', SIZE, `room ${k}`));
    let w = 0; let ex = 0; let ey = 0;
    for (let i = 0; i < plain!.y.length; i++) if (plain!.y[i]! >= 10) { const x = i % SIZE[0]; const y = (i - x) / SIZE[0]; w += 1; ex += x + 0.5; ey += y + 0.5; }
    expect(w, 'the emissive box shows some pixels at the level').toBeGreaterThan(100);
    [ex, ey] = [ex / w, ey / w];
    const cx = SIZE[0] / 2; const cy = SIZE[1] / 2; const len = Math.hypot(cx - ex, cy - ey);
    const ghosts = parts(minus(lit!, plain!));
    console.log(`emissive centroid (${ex.toFixed(2)}, ${ey.toFixed(2)}); ghosts ${ghosts.map((g) => `(${g.gx.toFixed(2)}, ${g.gy.toFixed(2)})`).join(' ')}`);
    expect(ghosts.length, 'the flare draws its ghosts').toBeGreaterThanOrEqual(3);
    const off = ghosts.map((g, k) => ({ k: k + 1, d: Math.abs((cx - ex) * (g.gy - ey) - (cy - ey) * (g.gx - ex)) / len })).filter((g) => g.d > 0.5);
    expect(off.map((g) => `ghost ${g.k} lies ${g.d.toFixed(2)} px off the line`), 'every ghost on the line through the shown pixels and the centre').toEqual([]);
    const drawn = minus(above!, plain!).y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(drawn, 'a level above the box\'s radiance draws no flare').toBe(0);
  });
});
