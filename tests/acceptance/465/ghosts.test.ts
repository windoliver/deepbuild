// #465.b55974ba: "A flare's ghosts follow their light at 1,000 random times, and seeking equals playing"
// #465.1b29e5c0: "At 1,000 random times each ghost's centroid lies within 0.5 px of the line through the light's
// projected point and the frame's center; a planted flare with fixed ghost positions fails, naming the ghost"
//
// The fixture: a black room (a black sky, no ambient, no other item) seen at 480 × 270 from 6 m by a camera looking
// down −Z (fov 50° across the width), and one point light of radius 0.05 m (radiance 50) that wanders in the plane z = 0
// along 21 seeded keys, linear between them, 0.5 s apart over 10 s, staying between 0.25 and 0.45 of the half-frame from
// the centre (so the line through it and the centre is always defined, and ghosts up to about twice its offset stay in
// frame). The flare draws ghosts only: `flare: {from: lights, ghosts: 4}`, no streak, halo or starburst. The film plays
// at 300 fps (3,000 frames); 1,000 distinct frames are drawn at random (seed 465), the random times.
//
// What is measured (README: Readings): the flare is drawn before tone mapping, so it's in `pre_tone`, and in this black
// room `pre_tone` holds nothing but the flare and, if the renderer draws it, the light's own disc at its projected point.
// Each frame's pixels at or above 1% of the brightest pixel outside the light's disc form 8-connected parts; a part that
// touches the frame's border is cut by it and isn't judged. Each other part's luminance-weighted centroid must lie
// within 0.5 px of the line through the light's projected point (#378's pinhole, from the keys) and the frame's centre;
// the parts are named ghost 1, 2, … by their distance from the light. Ghosts that overlap make one part, whose centroid
// lies on the line when each ghost's does. Every frame must judge at least one part away from the light's disc, or the
// flare drew no ghost there. Seek: the 1,000 frames visited in a shuffled order by seeks (`seeks`) have the pixel hashes
// of the same frames played from frame 0. Planted: `flare_fixed_ghosts` draws each ghost at a fixed place in the frame,
// whatever the light; its failure names the ghost. Wrong programs: ghosts that don't follow the light, ghosts off the
// line through the centre, a flare that keeps state between frames.
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type Frame, type Lum, type Planted, Lcg, at, camItem, channel, discPx, failsNaming, flare, framesOf, frameAt,
  look3d, none, pointLight, project, readLum, requireGpu, runGpu, scratch, sceneDoc, unproject, useGpu, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const SIZE: [number, number] = [480, 270];
const CAM: Cam = { position: [0, 0, 6], target: [0, 0, 0], fov: 50, size: SIZE };
const LOOK = look3d('ghosts-465');
const FPS = 300;
const FRAMES = 3000;
const TIMES = 1000;
const DISC = discPx(CAM, 6);

/** The light's keys: x and y in the plane z = 0, every 0.5 s over 10 s. */
const keys = ((): { x: [number, number][]; y: [number, number][] } => {
  const r = new Lcg(465);
  const x: [number, number][] = []; const y: [number, number][] = [];
  for (let k = 0; k <= 20; k++) {
    const angle = ((k * 50 + (r.next() - 0.5) * 20) * Math.PI) / 180; const rho = 0.25 + 0.2 * r.next();
    const [wx, wy] = unproject(CAM, SIZE[0] / 2 + rho * Math.cos(angle) * (SIZE[0] / 2), SIZE[1] / 2 - rho * Math.sin(angle) * (SIZE[1] / 2), 6);
    x.push([k * 0.5, wx]); y.push([k * 0.5, wy]);
  }
  return { x, y };
})();
const lightAt = (n: number): [number, number] => project(CAM, [at(keys.x, n / FPS), at(keys.y, n / FPS), 0]);
const DOC = sceneDoc('ghosts-465', SIZE, { cam: camItem(CAM), sky: DARK_SKY, 'key-light': pointLight([keys.x[0]![1], keys.y[0]![1], 0]), flare: flare({ ghosts: 4 }) }, {
  channels: { lx: channel('items/key-light/at/pos/0', keys.x), ly: channel('items/key-light/at/pos/1', keys.y) },
});
/** The 1,000 random frames, distinct, in the order drawn. */
const RANDOM = ((): number[] => {
  const r = new Lcg(4651); const seen = new Set<number>(); const out: number[] = [];
  while (out.length < TIMES) { const n = Math.floor(r.next() * FRAMES); if (!seen.has(n)) { seen.add(n); out.push(n); } }
  return out;
})();

/** Each part of the frame's flare that the frame doesn't cut, and whether its centroid lies within 0.5 px of the line. */
function ghostFailures(f: Lum, n: number): string[] {
  const [px, py] = lightAt(n); const cx = SIZE[0] / 2; const cy = SIZE[1] / 2;
  const label = `frame ${n} (t = ${(n / FPS).toFixed(4)} s)`;
  const away = (x: number, y: number): boolean => Math.hypot(x + 0.5 - px, y + 0.5 - py) > DISC + 3;
  let peak = 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (away(x, y)) peak = Math.max(peak, f.y[y * f.width + x]!);
  if (!(peak > 0)) return [`${label}: no ghost is drawn`];
  const seen = new Uint8Array(f.y.length); const parts: { w: number; x: number; y: number; cut: boolean }[] = [];
  for (let i = 0; i < f.y.length; i++) {
    if (seen[i] || f.y[i]! < 0.01 * peak) continue;
    const part = { w: 0, x: 0, y: 0, cut: false }; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!; const x = j % f.width; const y = (j - x) / f.width; const w = f.y[j]!;
      part.w += w; part.x += w * (x + 0.5); part.y += w * (y + 0.5);
      if (x === 0 || y === 0 || x === f.width - 1 || y === f.height - 1) part.cut = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy; const k = yy * f.width + xx;
        if (xx < 0 || yy < 0 || xx >= f.width || yy >= f.height || seen[k] || f.y[k]! < 0.01 * peak) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (!part.cut) parts.push(part);
  }
  const judged = parts.map((p) => ({ gx: p.x / p.w, gy: p.y / p.w })).sort((a, b) => Math.hypot(a.gx - px, a.gy - py) - Math.hypot(b.gx - px, b.gy - py));
  const failures: string[] = [];
  const len = Math.hypot(cx - px, cy - py);
  judged.forEach((g, k) => {
    const d = Math.abs((cx - px) * (g.gy - py) - (cy - py) * (g.gx - px)) / len;
    if (d > 0.5) failures.push(`${label}: ghost ${k + 1}'s centroid (${g.gx.toFixed(2)}, ${g.gy.toFixed(2)}) lies ${d.toFixed(2)} px from the line through the light's point (${px.toFixed(2)}, ${py.toFixed(2)}) and the frame's centre`);
  });
  if (!judged.some((g) => Math.hypot(g.gx - px, g.gy - py) > DISC + 3)) failures.push(`${label}: no ghost lies wholly in the frame away from the light's disc`);
  return failures;
}

/** Plays the film from frame 0 to each chunk's last frame, capturing that chunk's `pre_tone`, and judges each frame
 * before the next chunk is drawn, so at most 250 targets are on disk at once. Returns the failures and the hashes of
 * every frame played by the last chunk. */
function play(frames: number[], planted?: Planted): { failures: string[]; hashes: Map<number, string> } {
  const sorted = [...frames].sort((a, b) => a - b);
  const failures: string[] = []; let hashes = new Map<number, string>();
  for (let c = 0; c < sorted.length; c += 250) {
    const chunk = sorted.slice(c, c + 250); const dir = scratch();
    try {
      const [reply] = runGpu(bin(), dir, [view3d({ doc: writeJson(dir, 'ghosts', DOC), look: LOOK, size: SIZE, frames: chunk.at(-1)! + 1, fps: FPS, capture: chunk, targets: ['pre_tone'] })], planted);
      const fs: Frame[] = framesOf(reply!, 'the played film');
      for (const n of chunk) failures.push(...ghostFailures(readLum(dir, frameAt(fs, n, 'played'), 'pre_tone', SIZE, `frame ${n}`), n));
      hashes = new Map(fs.map((f) => [f.frame, f.pixel_hash]));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { failures, hashes };
}
let shipped: { failures: string[]; hashes: Map<number, string> } | null = null;
const shippedPlay = (): { failures: string[]; hashes: Map<number, string> } => (shipped ??= play(RANDOM));

describe(`${AC[2]} ${AC[4]} a flare's ghosts follow their light at 1,000 random times`, () => {
  it(`${AC[2]} the 1,000 random frames reached by seeks, in a shuffled order, have the played frames' pixel hashes`, () => {
    requireGpu();
    const { hashes } = shippedPlay();
    const order = [...RANDOM];
    const r = new Lcg(4652);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
    const dir = scratch();
    try {
      const [reply] = runGpu(bin(), dir, [view3d({
        doc: writeJson(dir, 'ghosts', DOC), look: LOOK, size: SIZE, fps: FPS, from: order[0]!, frames: TIMES,
        seeks: order.slice(0, -1).map((a, i) => ({ after: a, to: order[i + 1]! })),
      })]);
      const seeked = framesOf(reply!, 'the seeks');
      expect(seeked.map((f) => f.frame), 'the seeks visit the 1,000 frames in the shuffled order').toEqual(order);
      const differ = seeked.filter((f) => f.pixel_hash !== hashes.get(f.frame)).map((f) => f.frame);
      expect(differ, 'every frame reached by a seek has the played frame\'s pixel hash').toEqual([]);
      expect(new Set(seeked.map((f) => f.pixel_hash)).size, 'the light moves, so the frames differ').toBeGreaterThan(TIMES / 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it(`${AC[4]} ${AC[2]} at 1,000 random times each ghost's centroid lies within 0.5 px of the line through the light's projected point and the frame's centre`, () => {
    requireGpu();
    none(shippedPlay().failures, 'ghosts on the line through the light and the centre');
  });

  it(`${AC[4]} a planted flare with fixed ghost positions (--planted flare_fixed_ghosts) fails, naming the ghost`, () => {
    requireGpu();
    const { failures } = play(RANDOM.slice(0, 60), 'flare_fixed_ghosts');
    failsNaming(failures, [/ghost \d+'s centroid/], 'flare_fixed_ghosts');
  });
});

