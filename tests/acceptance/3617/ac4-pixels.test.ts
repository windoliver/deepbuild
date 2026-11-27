// #3617.00965c72: each frame's pixels are byte-equal before and after the change on both paths, and the fence record
// still audits clean. "Before" is the scene's own bytes, computed here from the scene alone: #377's conformance proves
// the base's slots hold exactly them, so a slot equal to them is byte-equal to the base's. Each run takes the timing
// report too, so the code that times the frame runs in the frames compared.
import { describe, expect, it } from 'vitest';
import { CRITERIA, SCENES, expectReported, fenceCoverage, fenceProblems, framesCall, framesReply, loadScene, run, scenario, slotHash, useBuild, useOut } from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = CRITERIA.pixels;
const HANDOFF = loadScene(SCENES.handoff);
const ONE = loadScene(SCENES.onePass);
const SLOTS = 3;

describe(`${ID} frames are byte-equal before and after the change on both paths, and the fences audit clean`, () => {
  for (const path of ['zero_copy', 'copy'] as const) {
    it(`${ID} ${path}: all ${HANDOFF.frames} frames of surface-handoff hold the scene's bytes, and the fence record audits clean beside the timing report`, () => {
      const [reply] = run(bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, path, timings: true, fences: true })]));
      const r = framesReply(reply!, `the ${path} run`);
      expect(r.frames.length).toBe(HANDOFF.frames);
      expect(r.frames.every((f) => f.path === path), `every frame handed off by ${path}`).toBe(true);
      expectReported(r.frames, `the ${path} run`);
      const wrong = r.frames.filter((f) => f.pixel_hash !== slotHash(HANDOFF, f.frame)).map((f) => f.frame);
      expect(wrong, `${path}: frames whose slot isn't the scene's bytes for that frame`).toEqual([]);
      expect(r.fences, 'the run returns its fence record').not.toBeNull();
      expect(fenceProblems(r.fences!, SLOTS, `${path} fences`), `${path}: the fence record audits clean`).toEqual([]);
      expect(fenceCoverage(r.fences!, HANDOFF.frames, `${path} fences`)).toEqual([]);
    }, 1_800_000);
  }

  it(`${ID} the one-pass fixture's frames are the same bytes on the zero-copy and the copy path`, () => {
    const [zero, copy] = run(bin(), scenario(out(), [
      framesCall({ scene: SCENES.onePass, count: 60, path: 'zero_copy', timings: true }),
      framesCall({ scene: SCENES.onePass, count: 60, path: 'copy', timings: true }),
    ]));
    const want = slotHash(ONE, 0);
    for (const [name, reply] of [['zero_copy', zero!], ['copy', copy!]] as const) {
      const r = framesReply(reply, name);
      expectReported(r.frames, name);
      expect(r.frames.filter((f) => f.pixel_hash !== want).map((f) => f.frame), `${name}: frames whose slot isn't the scene's bytes`).toEqual([]);
    }
  }, 1_800_000);
});
