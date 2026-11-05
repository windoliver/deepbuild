// AC3 #424.649ef843: An engine block at adjust opacity 0.3 over its crankshaft shows each crankshaft pixel as 0.7 of its
// value with the block hidden plus 0.3 of the block's own shaded color, within 2 code values, with none of the block's
// back faces drawn; and a channel that keys a material's emission_strength from 0 to 4 changes only the pixels of the
// parts that use it and compiles no pipeline.
//
// The block (`engineDoc`, helpers): a double-sided closed box (so its far wall would draw, if nothing kept it out)
// around a crankshaft that pokes out of both ends, on a ground, lit by a sun without shadows. Three frames in one run:
// A, the block at adjust opacity 0.3; H, the block left out; O, the block at opacity 1. Over every pixel the block
// covers in O (2 px in from its silhouette), A's final target equals the sRGB code of 0.7 × H's linear value + 0.3 ×
// O's, within 2 codes per channel: on the crankshaft (at least 2,000 such pixels) that is the criterion's mix; over
// the ground (at least 2,000) it is the same mix, which holds only if no back face of the block drew (the block drawn
// see-through after a depth pass of its own: Object). Wrong programs: the base's plain blend of every block face (its
// far wall over the ground); a block faded over the crankshaft by its depth-tested back faces; the mix done in sRGB.
//
// The emission: an orthographic view of two lamps in material `glow` and one part in `matte`, lit by a sun; a channel
// keys `items/glow/params/emission_strength` from 0 at 0 s to 4 at 1 s, drawn at 10 fps for 11 frames with `counts`.
// Every frame after the first reports `compiled: []` (no pipeline compiled while drawing it: README: Assumed
// surfaces); every pixel 2 px or more from either lamp is byte-equal to frame 0's in every frame; the lamps' inner
// pixels change by more than 2 codes on 99% of them by frame 10. Wrong programs: a recompile when the value leaves 0;
// emission lighting other parts or spreading past the lamps.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, ENGINE_SIZE, box, code8, codeOff, engineDoc, framesOf, frameAt, linearChannel, material, only, ortho, px, readIds, readLinear,
  readPng, requireMetal, runGpu, sessionDoc, sun, useDir, useGpu, view3dCall, within, writeJson, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC[3]} adjust opacity in 3D and a keyed emission`, () => {
  it(`${AC[3]} the block at adjust opacity 0.3 shows 0.7 of what's behind it plus 0.3 of its own shaded color within 2 codes, and none of its back faces`, () => {
    requireMetal();
    const out = dir();
    const [a, h, o] = runGpu(bin(), out, [engineDoc('shown', 0.3), engineDoc('hidden', 1), engineDoc('shown', 1)].map((d, i) =>
      view3dCall({ doc: writeJson(out, `engine-${i}`, d), size: ENGINE_SIZE, targets: ['final', 'linear', 'ids'] })));
    const af = only(a!, 'the block at 0.3'); const hf = only(h!, 'the block hidden'); const of = only(o!, 'the block opaque');
    const aPng = readPng(out, af.final, 'the block at 0.3');
    const hLin = readLinear(out, hf, ENGINE_SIZE, 'the block hidden'); const oLin = readLinear(out, of, ENGINE_SIZE, 'the block opaque');
    const hIds = readIds(out, hf, 'the block hidden'); const oIds = readIds(out, of, 'the block opaque');
    let crank = 0; let rest = 0; const failures: string[] = [];
    for (let y = 0; y < ENGINE_SIZE[1]; y++) for (let x = 0; x < ENGINE_SIZE[0]; x++) {
      if (!within(oIds, x, y, 'block', 2)) continue;
      const behind = hIds.at(x, y);
      const onCrank = typeof behind === 'string' && behind.startsWith('crank_');
      if (onCrank) crank++; else rest++;
      const hv = hLin.at(x, y); const ov = oLin.at(x, y);
      const want = [0, 1, 2].map((k) => code8(0.7 * hv[k]! + 0.3 * ov[k]!)) as Rgb;
      const got = px(aPng, x, y);
      if (codeOff(got, want) > 2) failures.push(`(${x}, ${y}) over ${behind ?? 'nothing'} reads ${got.join(', ')}, 0.7 × hidden + 0.3 × the block's own gives ${want.join(', ')}`);
    }
    console.log(`${AC[3]}: ${crank} block pixels over the crankshaft, ${rest} over the rest, ${failures.length} off`);
    expect(crank, 'the block covers at least 2,000 crankshaft pixels (the fixture)').toBeGreaterThanOrEqual(2000);
    expect(rest, 'the block covers at least 2,000 pixels over the ground, where a back face would show (the fixture)').toBeGreaterThanOrEqual(2000);
    expect(failures, `the block at adjust opacity 0.3:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
  }, 1_800_000);

  it(`${AC[3]} a channel keying emission_strength 0 → 4 changes only the lamps' pixels and compiles no pipeline`, () => {
    requireMetal();
    const out = dir();
    const size: [number, number] = [480, 360];
    const doc = sessionDoc('glow', size, {
      cam: ortho([0, 0, 0], 8), sky: DARK_SKY,
      glow: material({ base_color: [0.2, 0.2, 0.2, 1], roughness: 0.8, emission: [1, 0.6, 0.2], emission_strength: 0 }),
      matte: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 }),
      back_mat: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 1 }),
      lamp_a: box([1.2, 1.2, 1.2], [-2, 0, 0], { material: 'glow' }),
      lamp_b: box([1.2, 1.2, 1.2], [0, 0, 0], { material: 'glow' }),
      plain: box([1.2, 1.2, 1.2], [2, 0, 0], { material: 'matte' }),
      back: box([20, 20, 0.2], [0, 0, -3], { material: 'back_mat' }),
      sun: sun(Math.PI, [0, 0, 0], false),
    }, { channels: { glow_up: linearChannel('items/glow/params/emission_strength', 0, 4, 1) } });
    const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'glow', doc), size, frames: 11, fps: 10, capture: 'every', targets: ['final', 'ids'], counts: true })]);
    const frames = framesOf(reply!, 'the keyed emission');
    const first = frameAt(frames, 0, 'the keyed emission');
    const ids = readIds(out, first, 'frame 0');
    const base = readPng(out, first.final, 'frame 0');
    const lampNear = (x: number, y: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const id = ids.at(x + dx, y + dy); if (id === 'lamp_a' || id === 'lamp_b') return true; }
      return false;
    };
    const problems: string[] = [];
    let lampPx = 0; let lampChanged = 0;
    for (const f of frames.filter((g) => g.frame > 0)) {
      expect(f.compiled, `frame ${f.frame} reports the pipelines compiled while drawing it (counts)`).not.toBeNull();
      if (f.compiled!.length) problems.push(`frame ${f.frame}: emission_strength moved and ${f.compiled!.join(', ')} compiled`);
      const img = readPng(out, f.final, `frame ${f.frame}`);
      let off = 0; let at = '';
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        if (lampNear(x, y)) {
          if (f.frame === 10 && (within(ids, x, y, 'lamp_a', 2) || within(ids, x, y, 'lamp_b', 2))) { lampPx++; if (codeOff(px(img, x, y), px(base, x, y)) > 2) lampChanged++; }
          continue;
        }
        if (px(img, x, y).join() !== px(base, x, y).join()) { off++; if (!at) at = `(${x}, ${y}) over ${ids.at(x, y) ?? 'nothing'}: ${px(base, x, y).join(', ')} → ${px(img, x, y).join(', ')}`; }
      }
      if (off) problems.push(`frame ${f.frame}: ${off} pixels away from the lamps changed; first ${at}`);
    }
    console.log(`${AC[3]}: by frame 10, ${lampChanged} of ${lampPx} lamp pixels changed`);
    expect(lampPx, 'the lamps cover at least 2,000 inner pixels (the fixture)').toBeGreaterThanOrEqual(2000);
    if (lampChanged / lampPx < 0.99) problems.push(`by frame 10 (emission_strength 4) only ${lampChanged} of ${lampPx} of the lamps' pixels changed by more than 2 codes`);
    expect(problems, `the keyed emission:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 1_800_000);
});
