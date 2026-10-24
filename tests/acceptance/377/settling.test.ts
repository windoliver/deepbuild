// #377.6fcbd42e (second half): no canonical render, export or snapshot uses a frame that reports
// settling. parity/gpu/settling.scene is still: one 1024 × 1024 texture (4 MiB) drawn 1:1 over the
// frame, under a budget class whose upload_bytes_per_frame is 1 MiB, so its upload continues over
// several frames while each reports settling (Render worker), and every settled frame holds exactly the
// texture, computed here from the scene. At the base there is no `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import { SCENES, framesCall, framesReply, loadScene, renderCall, run, scenario, slotHash, str, useBuilds, useOut, type JsonObject } from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const SCENE = loadScene(SCENES.settling);
const SETTLED = slotHash(SCENE, 0, SCENE.size);
const PURPOSES = ['canonical', 'export', 'snapshot'] as const;

function rendered(reply: JsonObject, what: string): { pixel_hash: string; settling: boolean } {
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
  return { pixel_hash: str(reply['pixel_hash'], `${what}: pixel_hash`), settling: reply['settling'] as boolean };
}

describe('#377.6fcbd42e no canonical render, export or snapshot uses a frame that reports settling', () => {
  it('#377.6fcbd42e live frames report settling while the 4 MiB upload continues at 1 MiB a frame, and then hold exactly the texture', () => {
    expect(SCENE.budget_class!.upload_bytes_per_frame * 3 < 1024 * 1024 * 4, 'the fixture\'s upload needs more than three frames').toBe(true);
    const [live] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.settling })]));
    const frames = framesReply(live!, 'the live frames').frames;
    expect(frames.map((f) => f.frame), 'every live frame is presented').toEqual(Array.from({ length: SCENE.frames }, (_, i) => i));
    const settling = frames.filter((f) => f.settling).map((f) => f.frame);
    expect(settling.length, 'at least the first three frames report settling').toBeGreaterThanOrEqual(3);
    expect(settling, 'the settling frames are the first ones, in a row').toEqual(Array.from({ length: settling.length }, (_, i) => i));
    expect(frames.filter((f) => f.settling).every((f) => f.pixel_hash !== SETTLED), 'a settling frame doesn\'t yet hold the whole texture').toBe(true);
    expect(frames.filter((f) => !f.settling).every((f) => f.pixel_hash === SETTLED), 'every settled frame holds exactly the texture').toBe(true);
  }, 1_800_000);

  for (const purpose of PURPOSES) {
    it(`#377.6fcbd42e a ${purpose} render of frame 0 in a fresh process, and one asked for while live frames are still settling, both use the settled frame`, () => {
      const [first] = run(builds.bin(), scenario(out(), [renderCall(SCENES.settling, 0, purpose)]));
      const a = rendered(first!, `the ${purpose} render in a fresh process`);
      expect(a.settling, `the ${purpose} render doesn't report settling`).toBe(false);
      expect(a.pixel_hash, `the ${purpose} render holds the settled frame`).toBe(SETTLED);
      const [live, again] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.settling, count: 2 }), renderCall(SCENES.settling, 0, purpose)]));
      const lf = framesReply(live!, 'two live frames').frames;
      expect(lf.map((f) => f.settling), 'the two live frames before the render report settling').toEqual([true, true]);
      const b = rendered(again!, `the ${purpose} render asked for while the live frames settle`);
      expect(b.settling).toBe(false);
      expect(b.pixel_hash, `the ${purpose} render holds the settled frame, never a settling one`).toBe(SETTLED);
    }, 1_800_000);
  }
});
