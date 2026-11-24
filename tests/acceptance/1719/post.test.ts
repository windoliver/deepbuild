// AC6 #1719.ce14bb8d: A document with one `particles@1` emitter (count 2,000) in front of a dark `slab@1` renders back
// with a pixel hash different from the same document without the emitter. On the merge base the two hashes are equal
// and the test fails, naming the item.
// AC7 #1719.32afa26e: A painted `mark.box@1` on a painted `slab@1`, with no `material@1`, under a `light.sun@1` with
// `shadow: true`, renders back with the slab's mean luma on the box's shadow side at least 0.1 below its sunlit side.
// On the merge base the two match within 0.01 and the test fails, naming the light.
// AC8 #1719.15766d54: A one-box 3D document holding a `gpu.pass@1` item, declared exact, that adds 0.6 to red renders
// back with the box region's mean red at least 0.3 above the same document's without the item. On the merge base the
// two are equal and the test fails, naming the item.
//
// Each document names the suite's own look `plain-look@1` (drawing basis, no tone map, unit exposure, no bloom, no
// grid), which the base's render-back already draws pixel for pixel as view3d does (README: What view3d draws), so what
// differs here is the post stage alone. "Renders back" is both replies a revision's snapshot comes back on, its
// presenting reply and a `render_back` of it in the same `deep-show run` (README: Readings); each is judged, and a
// failure names which.
import { describe, it } from 'vitest';
import { bothWays, type JsonObject, meanLuma, meanRgb, naming, none, ownLook, proof, type Rect, requireMetal, scene, seed, sub, useBins, useDir, visibleBox, WAYS } from './helpers.ts';

const bins = useBins();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const LOOK = 'plain-look';
const FRONT: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 8], target: [0, 0, 0], fov: 40 } };
/** A document of `items` in `plain-look@1`, its look in the evidence store. */
function inPlainLook(evidence: string, title: string, items: Record<string, JsonObject>, modules: JsonObject = { scene3d: '^1' }): JsonObject {
  return scene(title, SIZE, items, { ...naming(LOOK, { [LOOK]: seed(evidence, Buffer.from(JSON.stringify(ownLook(LOOK)))) }), requires: { modules } });
}

describe('AC6 particles', () => {
  it('AC6 #1719.ce14bb8d a document with one particles@1 emitter in front of a dark slab renders back with a pixel hash different from the same document without it', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const bare: Record<string, JsonObject> = {
      cam: FRONT,
      wall: { kind: 'slab@1', params: { size: [5, 4, 0.2], paint: { fill: { role: 'coal' } } }, at: { pos: [0, -2, -1] } },
    };
    const sparks: JsonObject = {
      kind: 'particles@1', at: { pos: [0, 0, 0] },
      params: {
        count: 2000, emit: { shape: 'sphere', rate: 2000, span: 4 }, life: [1, 2], motion: { ballistic: { v0: [0.5, 1.5], gravity: [0, -1, 0], drag: 0.2 } },
        size: 3, opacity: 1, color: [{ at: 0, role: 'sand' }, { at: 1, role: 'accent' }], draw: 'dot',
      },
    };
    const modules: JsonObject = { scene3d: '^1', effects: '^1' };
    // At 1 s the emitter, at 2,000 a second, has made its 2,000 particles, and all still live (1 to 2 s each).
    const at = (title: string, items: Record<string, JsonObject>): ReturnType<typeof bothWays> => bothWays(bins.show(), evidence, inPlainLook(evidence, title, items, modules), SIZE, title, { t: 1 });
    const without = at('A dark slab', bare);
    const lit = at('Sparks before a dark slab', { ...bare, sparks });
    const failures: string[] = [];
    for (const way of WAYS) {
      const [a, b] = [lit[way].snap.pixelHash, without[way].snap.pixelHash];
      proof(`AC6 ${way}`, { with_sparks: a, without: b });
      if (a === b) failures.push(`${way}: with the particles@1 item sparks (count 2,000, at 1 s) the snapshot has the pixel hash it has without it, ${a}: sparks drew nothing`);
    }
    none(failures, 'the particles@1 item sparks changes the snapshot\'s pixel hash');
  }, 1_800_000);
});

describe('AC7 a painted box\'s shadow', () => {
  it('AC7 #1719.32afa26e a painted box on a painted slab under a sun with shadow: true renders back with the slab\'s mean luma on the box\'s shadow side at least 0.1 below its sunlit side', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    // Looking straight down; the sun comes from −x at 45°, so the 1.6 m box's shadow lies on the slab to its right, 1.6 m
    // (64 px) long, and the slab to its left is sunlit.
    const back = bothWays(bins.show(), evidence, inPlainLook(evidence, 'A painted box on a painted slab', {
      cam: { kind: 'camera@1', params: { projection: 'orthographic', view_width: 8, position: [0, 10, 0.001], target: [0, 0, 0] } },
      sun: { kind: 'light.sun@1', params: { illuminance: 10, color: [1, 1, 1], shadow: true }, at: { rot: [-45, -90, 0] } },
      floor: { kind: 'slab@1', params: { size: [10, 0.2, 10], paint: { fill: { role: 'slate' } } }, at: { pos: [0, -0.2, 0] } },
      box: { kind: 'mark.box@1', params: { size: [1.2, 1.6, 1.2], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0.8, 0] } },
    }), SIZE, 'a painted box on a painted slab');
    const failures: string[] = [];
    for (const way of WAYS) {
      const { reply, snap } = back[way];
      const [x0, y0, x1, y1] = visibleBox(reply, 'box', way);
      // A strip of slab beside the box on each side, 4 px off it, 24 px wide, 6 px in from the box's ends.
      const strips: Record<'shadow' | 'sunlit', Rect> = { shadow: [x1 + 4, y0 + 6, x1 + 28, y1 - 6], sunlit: [x0 - 28, y0 + 6, x0 - 4, y1 - 6] };
      const [shadow, sunlit] = [meanLuma(snap.image, strips.shadow), meanLuma(snap.image, strips.sunlit)];
      proof(`AC7 ${way}`, { shadow_side: shadow, sunlit_side: sunlit });
      if (sunlit - shadow < 0.1) failures.push(`${way}: the light.sun@1 sun casts no shadow of the box: the slab's mean luma is ${shadow.toFixed(4)} on the box's shadow side and ${sunlit.toFixed(4)} on its sunlit side, ${(sunlit - shadow).toFixed(4)} apart, under 0.1`);
    }
    none(failures, 'the light.sun@1 sun casts the painted box\'s shadow on the painted slab');
  }, 1_800_000);
});

/** A composed `gpu.pass@1` item in the effects chain at full resolution. */
const pass = (about: string, inputs: JsonObject, steps: JsonObject, outputs: JsonObject, more: JsonObject = {}): JsonObject => ({
  kind: 'gpu.pass@1',
  params: { origin: 'composed', about, inputs, steps, outputs, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 50 }, fallback: 'look', ...more },
});
const ADD: JsonObject = { op: 'const@1', args: { value: [0.6, 0, 0, 0], type: 'vec4' } };
/**
 * A pass that adds 0.6 to red, in the two forms that share the criterion's words (README: Readings, "declared exact"):
 * `declared`, declared `determinism: exact`: a constant 0.6 red its output adds (`blend: add`), the only such pass the
 * base's check lets a document declare exact, since a pass that reads the frame's color computes as same machine and
 * the check refuses `exact` on it (`not_exact`); and `tint`, #429's, which reads the frame's color and adds 0.6 red.
 */
const PASSES: Record<'declared' | 'tint', JsonObject> = {
  declared: pass('Adds red to the frame.', {}, { out: ADD }, { color: 'out', blend: 'add' }, { determinism: 'exact' }),
  tint: pass('Tints the frame red.', { src: { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } } }, {
    uv: { op: 'screen_uv@1', args: {} }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, red: ADD, out: { op: 'add@1', args: { a: 'c', b: 'red' } },
  }, { color: 'out' }),
};

describe('AC8 a document\'s own GPU operator', () => {
  it('AC8 #1719.15766d54 a one-box document holding a gpu.pass@1 item that adds 0.6 to red renders back with the box region\'s mean red at least 0.3 above the same document\'s without the item', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const box: Record<string, JsonObject> = { cam: FRONT, box: { kind: 'mark.box@1', params: { size: [2.4, 2.4, 2.4], paint: { fill: { role: 'coal' } } } } };
    const modules: JsonObject = { scene3d: '^1', effects: '^1' };
    const at = (title: string, items: Record<string, JsonObject>): ReturnType<typeof bothWays> => bothWays(bins.show(), evidence, inPlainLook(evidence, title, items, modules), SIZE, title);
    const without = at('A dark box', box);
    const failures: string[] = [];
    for (const [id, item] of Object.entries(PASSES)) {
      const lit = at(`A dark box under ${id}`, { ...box, [id]: item });
      for (const way of WAYS) {
        const region = visibleBox(without[way].reply, 'box', way);
        const [a, b] = [meanRgb(lit[way].snap.image, region)[0], meanRgb(without[way].snap.image, region)[0]];
        proof(`AC8 ${way}, ${id}`, { red_with: a, red_without: b });
        if (a - b < 0.3) failures.push(`${way}: with the gpu.pass@1 item ${id} the box's region holds a mean red of ${a.toFixed(4)}, ${(a - b).toFixed(4)} above the ${b.toFixed(4)} without it, under 0.3: ${id} never ran`);
      }
    }
    none(failures, 'the document\'s own gpu.pass@1 item adds red to the box\'s region');
  }, 1_800_000);
});
