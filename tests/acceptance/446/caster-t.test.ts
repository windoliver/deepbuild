// AC6 #446.3834c570: A caster whose material's coverage depends on t invalidates its local map in every frame it changes,
// and a still one never does.
//
// Two shadowed spots straight over a plate in plan, 12 m apart with ranges of 8 m, so neither reaches the other's caster,
// each over one 1 m square caster 2 m up, 3 m below the spot, so each throws a shadow 1.67 m square, whose ring outside
// the caster the view sees. `gate`'s material operator discards the
// whole part when fract(5 t + 0.25) ≥ 0.5, so at 10 fps it is there on even frames and gone on odd ones (the 0.25 keeps
// t away from the step). `still`'s operator reads t too, for its emission only, so its coverage doesn't depend on t
// (Light policy: local shadows: "plus t when a caster's material makes coverage or displacement depend on t").
//
// Eight frames. The pixels in `gate`'s ring read dark on even frames (under 5% of the lit plate beside the shadow) and
// lit on odd ones (over 90% of it), every frame, so a map one frame late or a kept map shows; `still`'s ring stays dark. Frame by frame after the first, `spot_gate`'s
// map is drawn with a new key and `spot_still`'s isn't drawn and keeps its key, and `shadows.passes` is 1. Wrong programs:
// `--planted local_map_ignores_t` (a caster's t isn't in the key) fails naming "gate"; `--planted
// local_map_rekeys_on_any_t` (any operator that reads t joins the key) fails naming "still".
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, failsNaming, frameAt, framesOf, material, materialOp, matte, none, ortho, orthoProject, readLinear, requireMetal, runGpu, sessionDoc, shadowsOf, spot, useDir, useGpu, view3dCall,
  writeJson, type GpuPlanted, type JsonObject, type Linear, type V3,
} from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [960, 240];
const WIDTH = 16;
const TARGET: V3 = [0, 0, 0];
const FRAMES = 8;
const FPS = 10;
const X = { gate: -6, still: 6 };
const POWER = 987;

const BLINK = materialOp('Gone for half of each 0.4 s.', {
  tt: { op: 't@1', args: {} },
  k: { op: 'mul@1', args: { a: 'tt', b: 5 } },
  s: { op: 'add@1', args: { a: 'k', b: 0.25 } },
  f: { op: 'fract@1', args: { x: 's' } },
  g: { op: 'ge@1', args: { a: 'f', b: 0.5 } },
  d: { op: 'discard_if@1', args: { cond: 'g' } },
  c: { op: 'const@1', args: { value: [0.8, 0.8, 0.8], type: 'vec3' } },
}, { base_color: 'c' });
const GLOW = materialOp('Reads t for its glow alone.', {
  tt: { op: 't@1', args: {} },
  w: { op: 'sin@1', args: { x: 'tt' } },
  z: { op: 'const@1', args: { value: 0, type: 'f32' } },
  e: { op: 'compose@1', args: { x: 'w', y: 'z', z: 'z' } },
  c: { op: 'const@1', args: { value: [0.8, 0.8, 0.8], type: 'vec3' } },
}, { emission: 'e', base_color: 'c' });

function casterDoc(): JsonObject {
  const beam = { shadow: true, inner: 28, outer: 30, range: 8, radius: 0.02 };
  return sessionDoc('casters-t', SIZE, {
    cam: ortho(TARGET, WIDTH), sky: DARK_SKY, grey: matte(0.8), blink: BLINK, glow: GLOW,
    blink_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, op: 'blink' }), glow_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, op: 'glow' }),
    plate: box([16, 5, 0.1], [0, 0, -0.05], { material: 'grey' }),
    gate: box([1, 1, 0.1], [X.gate, 0, 2], { material: 'blink_mat' }),
    still: box([1, 1, 0.1], [X.still, 0, 2], { material: 'glow_mat' }),
    spot_gate: spot(POWER, [X.gate, 0, 5], [0, 0, 0], beam), spot_still: spot(POWER, [X.still, 0, 5], [0, 0, 0], beam),
  }, { light_policy: { soft: { method: 'pcf' }, shadowed: { spots: 2 } } });
}
/** The mean between `from` and `to` m from the caster's centre, on its ±X sides, |y| ≤ 0.4 m. */
function band(l: Linear, x0: number, from: number, to: number): number {
  let sum = 0; let n = 0;
  for (const side of [-1, 1]) {
    const [a, b] = orthoProject(TARGET, WIDTH, SIZE, [x0 + side * from, 0.4]);
    const [c, d] = orthoProject(TARGET, WIDTH, SIZE, [x0 + side * to, -0.4]);
    for (let y = Math.floor(Math.min(b, d)); y <= Math.ceil(Math.max(b, d)); y++) for (let x = Math.floor(Math.min(a, c)); x <= Math.ceil(Math.max(a, c)); x++) { sum += l.at(x, y); n++; }
  }
  expect(n, 'the band holds at least 400 pixels').toBeGreaterThanOrEqual(400);
  return sum / n;
}
/** The ring past the caster and inside its shadow. */
const ring = (l: Linear, x0: number): number => band(l, x0, 0.6, 0.74);
/** The plate just outside the shadow, which is lit in every frame. */
const beside = (l: Linear, x0: number): number => band(l, x0, 1, 1.2);
function problems(planted?: GpuPlanted): string[] {
  const out = dir();
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'casters', casterDoc()), size: SIZE, frames: FRAMES, fps: FPS, capture: 'every', targets: ['linear'], shadows: true })], planted);
  const frames = framesOf(reply!, 'the casters');
  const found: string[] = [];
  let last: Record<string, string> = {};
  for (let n = 0; n < FRAMES; n++) {
    const f = frameAt(frames, n, 'the casters');
    const l = readLinear(out, f, SIZE, `frame ${n}`);
    const here = n % 2 === 0;
    const gate = ring(l, X.gate) / beside(l, X.gate); const still = ring(l, X.still) / beside(l, X.still);
    if (here && gate > 0.05) found.push(`gate's shadow is missing at frame ${n}: ${gate.toFixed(3)} of the lit plate`);
    if (!here && gate < 0.9) found.push(`gate's shadow stayed at frame ${n}, where it's gone: ${gate.toFixed(3)} of the lit plate`);
    if (still > 0.05) found.push(`still's shadow is missing at frame ${n}: ${still.toFixed(3)} of the lit plate`);
    const s = shadowsOf(f, 'the casters');
    const map = (id: string) => s.maps.find((m) => m.light === id);
    const g = map('spot_gate'); const k = map('spot_still');
    if (!g || !k) { found.push(`frame ${n} doesn't report both maps: ${s.maps.map((m) => m.light).join(', ')}`); continue; }
    if (n > 0) {
      if (!g.drawn) found.push(`gate's map wasn't drawn at frame ${n}, where its coverage changed`);
      if (g.key === last['g']) found.push(`gate's key didn't change at frame ${n}`);
      if (k.drawn) found.push(`still's map was drawn at frame ${n}`);
      if (k.key !== last['k']) found.push(`still's key changed at frame ${n}`);
      if (s.passes !== 1) found.push(`frame ${n} issued ${s.passes} shadow passes, not gate's one`);
    }
    last = { g: g.key, k: k.key };
  }
  return found;
}

describe(`${ID} a caster's coverage over t keys its map`, () => {
  it(`${ID} a map whose caster's coverage changes draws every frame and matches it, one whose caster only glows with t never does; the planted local_map_ignores_t and local_map_rekeys_on_any_t fail`, () => {
    requireMetal();
    none(problems(), 'the casters');
    failsNaming(problems('local_map_ignores_t'), ['gate'], 'the planted local_map_ignores_t');
    failsNaming(problems('local_map_rekeys_on_any_t'), ['still'], 'the planted local_map_rekeys_on_any_t');
  }, 1_800_000);
});
