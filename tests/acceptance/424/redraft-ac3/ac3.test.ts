// AC3 #424.649ef843 An engine block at adjust opacity 0.3 over its crankshaft shows each crankshaft pixel as 0.7 of
// its value with the block hidden plus 0.3 of the block's own shaded color, within 2 code values, with none of the
// block's back faces drawn; and a channel that keys a material's emission_strength from 0 to 4 changes only the pixels
// of the parts that use it and compiles no pipeline.
//
// Blind redraft (REDRAFT.md). Two tests, one per half of the criterion, each one deep-gpu process on Metal:
// - The block: three view3d calls of one engine fixture (block hidden, block opaque, block at adjust opacity 0.3).
//   Every crankshaft pixel (ID target, block hidden) is judged on the see-through frame's final codes against
//   code(0.7 × hidden + 0.3 × opaque), each mixed in linear light from the other two calls' linear targets, within 2.
//   Each of those pixels lies behind two back faces and two front faces of the block, so a back face drawn, or a
//   surface past the nearest, moves it by many codes (iron red over steel blue).
// - The channel: one view3d call of six frames at 4 fps while a channel keys `glow`'s emission_strength 0, 1, 2, 3,
//   4, 4. Pixels more than 2 px from the parts that use `glow` keep their codes exactly (among them the parts of
//   `twin`, a material holding the same numbers); the glow parts' inner pixels change, rising in linear light in step
//   with the strength; and no frame after the first compiles a pipeline.
// Off macOS each test fails INCONCLUSIVE before drawing.

import { describe, expect, test } from 'vitest';
import {
  AC3, EMISSION_FPS, EMISSION_FRAMES, GLOW_PARTS, OTHER_PARTS, PLAIN_LOOK, SIZE,
  emissionDoc, engineDoc, frameAt, framesOf, judgeComposite, judgeEmission, none, readFinal, readIds, readLinear,
  requireMetal, runGpu, strengthAt, useDir, useGpu, view3dCall, writeJson,
  type EmissionFrame,
} from './helpers.ts';

const gpu = useGpu();
const dir = useDir();

describe(`${AC3} see-through in 3D and a keyed emission`, () => {
  test(`${AC3} an engine block at adjust opacity 0.3 shows each crankshaft pixel as 0.7 of it with the block hidden plus 0.3 of the block's own shaded color, within 2 codes, no back face drawn`, () => {
    requireMetal();
    const bin = gpu(); const out = dir();
    const kinds = ['absent', 'opaque', 'see_through'] as const;
    const calls = kinds.map((k) => view3dCall({ doc: writeJson(out, `engine-${k}`, engineDoc(k)), look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'linear', 'ids'] }));
    const replies = runGpu(bin, out, calls);
    const [hidden, opaque, seeThrough] = kinds.map((k, i) => frameAt(framesOf(replies[i]!, `view3d of the block ${k}`), 0, `view3d of the block ${k}`));
    const verdict = judgeComposite({
      width: SIZE[0], height: SIZE[1],
      idsHidden: readIds(out, hidden!, 'the ID target with the block hidden'),
      idsOpaque: readIds(out, opaque!, 'the ID target with the block opaque'),
      linHidden: readLinear(out, hidden!.linear, SIZE, 'the linear target with the block hidden'),
      linOpaque: readLinear(out, opaque!.linear, SIZE, 'the linear target with the block opaque'),
      shown: readFinal(out, seeThrough!.final, SIZE, 'the final target with the block at adjust opacity 0.3'),
    }, 'crankshaft', 'block');
    console.log(`AC3 block: ${verdict.judged} crankshaft pixels judged, worst ${verdict.worst.toFixed(2)} codes off, ${verdict.failures.length} failing`);
    none(verdict.problems, 'the fixture puts the block over its crankshaft');
    // The fixture's crankshaft shows on about 13,500 pixels (REDRAFT.md: The fixture); a tenth of that means it isn't drawn.
    expect(verdict.judged, 'crankshaft pixels behind the block').toBeGreaterThan(5_000);
    none(verdict.failures, 'each crankshaft pixel shows 0.7 of its value with the block hidden plus 0.3 of the block\'s own shaded color, within 2 codes');
  }, 3_600_000);

  test(`${AC3} a channel keying a material's emission_strength from 0 to 4 changes only the pixels of the parts that use it and compiles no pipeline`, () => {
    requireMetal();
    const bin = gpu(); const out = dir();
    const call = view3dCall({ doc: writeJson(out, 'emission', emissionDoc()), look: PLAIN_LOOK, size: SIZE, frames: EMISSION_FRAMES, fps: EMISSION_FPS, capture: 'every', targets: ['final', 'linear', 'ids'], counts: true });
    const [reply] = runGpu(bin, out, [call]);
    const frames = framesOf(reply!, 'view3d of the keyed emission');
    const ids = readIds(out, frameAt(frames, 0, 'view3d of the keyed emission'), 'the ID target at frame 0');
    const judged: EmissionFrame[] = Array.from({ length: EMISSION_FRAMES }, (_, n) => {
      const f = frameAt(frames, n, 'view3d of the keyed emission');
      return {
        frame: n, strength: strengthAt(n), compiled: f.compiled,
        shown: readFinal(out, f.final, SIZE, `the final target at frame ${n}`),
        linear: readLinear(out, f.linear, SIZE, `the linear target at frame ${n}`),
      };
    });
    const verdict = judgeEmission(judged, ids, GLOW_PARTS);
    console.log(`AC3 emission: ${verdict.still} pixels judged unchanged (${[...verdict.stillOfOthers].map(([k, v]) => `${k} ${v}`).join(', ')}), ${[...verdict.glowing].map(([k, v]) => `${k} ${v}`).join(', ')} glow pixels judged, ${verdict.failures.length} failing`);
    // Each other part and each glow part shows: the judge would pass vacuously over parts that aren't drawn.
    for (const part of OTHER_PARTS) expect(verdict.stillOfOthers.get(part) ?? 0, `${part}'s pixels judged unchanged`).toBeGreaterThan(500);
    for (const part of GLOW_PARTS) expect(verdict.glowing.get(part) ?? 0, `${part}'s pixels inside its silhouette`).toBeGreaterThan(1_000);
    none(verdict.failures, 'emission_strength keyed from 0 to 4 changes only the pixels of the parts that use it and compiles no pipeline');
  }, 3_600_000);
});
