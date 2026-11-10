// #1637.1a41b696: "A city fixture of 20,000 buildings and 100,000 instanced street items, the camera 1.7 m above the
// street walking for 10 s with at least 80% of elements hidden: every frame equals by pixel hash, on one machine, the
// frame drawn with `occlusion: off`, and the kept set holds every element that has a pixel in the unculled frame's
// object-ID target"
//
// The city is `helpers.ts: cityDoc({camera: 'walk', shadows: false})`: 20,000 building items on a 200 × 100 grid of
// 32 m blocks, 100,000 street items in one instancer `street` (lamps, trees, benches, bins: four batches) on the
// sidewalks, and a camera 1.7 m above the street at z = 1,601 walking +X at 1.4 m/s from x = 1,296, looking along it,
// 60° across 960 × 540, its far plane at 3 km. Its sun casts no shadow: this criterion and criterion 5 are about the
// camera's passes, and criterion 4 draws the same city with cascades (README: Readings). A scratch CPU ray cast put
// about 30,400 elements and items in the frustum at 0 s, 7.5 s and 10 s and under 1% of them visible.
//
// Sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of 0 to 10 s (README: Readings). Two `view3d` calls in
// one process, so one machine: the shipped path, and the same call with `occlusion: 'off'` and the object-ID target.
// Each reports what its passes kept (`cull_report`: the `cull` rows of #484 and this suite's `kept_items`). At every
// frame:
//   - both frames have a pixel hash, and they're equal;
//   - every element (`street#<id>`) and item with a pixel in the unculled frame's object-ID target is in the shipped
//     path's camera kept set, and in `occlusion: 'off'`'s, the frustum-only set;
//   - at least 80% of what the frustum keeps has no pixel in that target, and the frustum keeps at least 10,000;
//   - the shipped path's camera kept set is smaller than the frustum's, so a culler that keeps everything fails.
import { describe, expect, it } from 'vitest';
import { AC, PLAY, SIZE, cityDoc, frameAt, framesOf, keptBy, none, readIds, requireGpu, run, unkept, useGpu, useOut, view3dCall, writeJson } from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const HIDDEN = 0.8;
const FRUSTUM_AT_LEAST = 10_000;

function walkProblems(): string[] {
  const out = dir();
  const doc = writeJson(out, 'city', cityDoc({ camera: 'walk', shadows: false }));
  const base = { doc, size: SIZE, fps: PLAY.fps, frames: PLAY.frames, capture: 'every' as const, cull_report: true };
  const [onReply, offReply] = run(bin(), out, [view3dCall(base), view3dCall({ ...base, occlusion: 'off', targets: ['ids'] })]);
  const on = framesOf(onReply!, 'the shipped path');
  const off = framesOf(offReply!, "occlusion: 'off'");
  expect(on.length, `frames 0 to ${PLAY.frames - 1}`).toBe(PLAY.frames);
  const problems: string[] = [];
  for (let n = 0; n < PLAY.frames; n++) {
    const a = frameAt(on, n, 'the shipped path');
    const b = frameAt(off, n, "occlusion: 'off'");
    if (!a.hash || a.hash !== b.hash) problems.push(`frame ${n}: the shipped frame hashes ${String(a.hash)}, occlusion: 'off' ${String(b.hash)}`);
    const ids = readIds(out, b, `frame ${n}, occlusion: 'off'`);
    const kept = keptBy(out, a, 'view', 'the shipped path');
    const frustum = keptBy(out, b, 'view', "occlusion: 'off'");
    problems.push(...unkept(kept, ids, n, 'the occlusion cull'));
    problems.push(...unkept(frustum, ids, n, "occlusion: 'off''s frustum cull"));
    const shown = [...frustum].filter((e) => ids.count.has(e)).length;
    const hidden = frustum.size === 0 ? 0 : 1 - shown / frustum.size;
    if (frustum.size < FRUSTUM_AT_LEAST) problems.push(`frame ${n}: the frustum keeps ${frustum.size} elements and items, under ${FRUSTUM_AT_LEAST}: the fixture is wrong`);
    if (hidden < HIDDEN) problems.push(`frame ${n}: ${shown} of the ${frustum.size} the frustum keeps have a pixel, so ${(100 * hidden).toFixed(1)}% are hidden, under ${100 * HIDDEN}%`);
    if (kept.size >= frustum.size) problems.push(`frame ${n}: the occlusion cull keeps ${kept.size}, the frustum alone ${frustum.size}, so it culled nothing`);
  }
  return problems;
}

describe(`${AC[1]} the city walk draws the unculled frame from what the occlusion cull keeps`, () => {
  it(`${AC[1]} over the 10 s walk through 20,000 buildings and 100,000 street items, with at least 80% of what the frustum keeps hidden, every frame equals occlusion: 'off''s by pixel hash, and the kept set holds every element with a pixel in the unculled object-ID target`, () => {
    requireGpu();
    none(walkProblems(), 'the walk');
  }, 3_600_000);
});
