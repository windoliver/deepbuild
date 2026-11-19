// AC4 #1634.919ee285: Switching fill lamps on one at a time from 0 to 2,048 over 10 s, and back, creates no pipeline
// after the first frame, counted on the noop lane and on the reference Mac.
//
// The switches (helpers: `switchDoc`, `switchPatches`): a showpiece of 2,048 fill lamps over a ground slab, every one
// hidden at first. Lamp k switches on at (k + 1) × 10 ÷ 2,048 s and off again on the way back, the last on first, so at
// 60 frames a second frames 0 to 600 show 0, 3, 6, 10 … 2,048 lamps and frames 601 to 1,200 take them back to 0; each
// frame's patch sets `visible` on the three or four lamps that switch before it, one `set` each, in the order they
// switch. `envelope_counts` (#1903) plays the 1,201 frames and counts what the device creates while each is drawn, a
// patch's check included. No frame after frame 0 may create a pipeline.
// So the count is of lamps that are shaded, the same process draws the document with every lamp on through `view3d`
// with `light_cut: true`: its `fill` (README: Assumed surfaces 4) holds all 2,048.
// Counted twice: on wgpu's noop backend (`--backend noop`), which runs anywhere; and on the Metal device of a
// reference Mac (the perf lane's list of models, chips and memory; its power, heat and load don't matter to a count),
// INCONCLUSIVE on any other machine.
// Wrong programs: the base (whose check refuses `fill` as an unknown field); a shader, a cluster pass or a buffer
// layout compiled per light count, at a count's threshold (8, 32, 64, 512), or when the first fill light appears; a
// policy that shades none of them.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, SWITCH, TIMEOUT, WRITER, answered, fillOf, frameAt, framesOf, inconclusive, none, num, objs, offReferenceMac, payload, requireMetal, runGpu,
  switchDoc, switchPatches, useDir, useGpu, view3dCall, writeJson,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();

/** The frames after the first that created a pipeline, and whether the lamps are fill lights the view shades. */
function problems(lane: 'noop' | 'metal'): string[] {
  const out = dir();
  const counts = { call: 'envelope_counts', look: PLAIN_LOOK, writer: WRITER, doc: writeJson(out, 'switch-off', payload(switchDoc(false))), render: { seconds: SWITCH.frames / SWITCH.fps, pixels: SWITCH.size }, fps: SWITCH.fps, patches: switchPatches() };
  const peak = view3dCall({ doc: writeJson(out, 'switch-on', switchDoc(true)), look: PLAIN_LOOK, size: SWITCH.size, targets: [], light_cut: true });
  const [played, lit] = runGpu(bin(), out, [counts, peak], { lane, timeoutMs: 6_600_000 });
  const failures: string[] = [];
  const rows = objs(answered(played!, `the switches on ${lane}`)['frames'], 'envelope_counts: frames');
  expect(rows.map((r) => r['frame']), `a row for each of the ${SWITCH.frames} frames, in order`).toEqual(Array.from({ length: SWITCH.frames }, (_, i) => i));
  for (const r of rows.slice(1)) {
    const made = num(r['pipelines'], `frame ${String(r['frame'])}: pipelines`);
    if (made !== 0) failures.push(`frame ${String(r['frame'])} creates ${made} pipeline${made === 1 ? '' : 's'}; no frame after the first creates one`);
  }
  const fill = fillOf(frameAt(framesOf(out, lit!, SWITCH.size, 'every lamp on'), 0, 'every lamp on'), 'every lamp on');
  if (fill.length !== SWITCH.lamps) failures.push(`with every lamp on the view shades ${fill.length} fill lights, not ${SWITCH.lamps}`);
  console.log(`${ID} on ${lane}: ${rows.length} frames, ${failures.length} problems`);
  return failures;
}

describe(`${ID} switching fill lamps on and off creates no pipeline after the first frame`, () => {
  it(`${ID} on the noop lane, 2,048 fill lamps switched on one at a time over 10 s and back create no pipeline after frame 0, and all 2,048 are shaded when on`, () => {
    none(problems('noop'), 'the switches on the noop lane');
  }, 2 * TIMEOUT);

  it(`${ID} on the reference Mac's Metal device, the same switches create no pipeline after frame 0`, () => {
    requireMetal();
    const off = offReferenceMac();
    if (off) inconclusive(`the count is the reference Mac's: ${off}`);
    none(problems('metal'), 'the switches on the reference Mac');
  }, 2 * TIMEOUT);
});
