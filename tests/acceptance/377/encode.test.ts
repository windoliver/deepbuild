// #377.6fcbd42e (first half): a frame's pixel hash is the same with 1 and 4 encode workers.
// #377.8ae4f399: with a test pool that finishes encodes in reverse and in 20 seeded random orders, every
// frame's pixel hash equals the 1-worker run's; a planted submit-on-completion fails on the reverse
// order, naming the frame.
// The scene, parity/gpu/encode-layers.scene, holds eight independent writer layers that overlap with
// partial alpha and move every frame, so the order they're composited in shows in every frame's hash.
// The test pool is the `test-pool` build's (README: Builds); each frame's `encodes` says, per layer, the
// rank its encode finished at and the rank its command buffer was submitted at. At the base there is no
// `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import { SCENES, backgroundHash, framesCall, framesReply, loadScene, run, scenario, useBuilds, useOut, type Frame, type FramesCall } from './helpers.ts';

const builds = useBuilds(['default', 'test-pool']);
const out = useOut();
const SCENE = loadScene(SCENES.encode);
const LAYERS = SCENE.layers!.length;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function hashes(frames: Frame[]): (string | null)[] { return frames.map((f) => f.pixel_hash); }
/** Frames whose hash differs from the reference run's, each named. */
function differ(reference: Frame[], frames: Frame[], what: string): string[] {
  return reference.flatMap((ref, i) => {
    const f = frames[i];
    if (!f || f.frame !== ref.frame) return [`${what}: frame ${ref.frame} is missing`];
    return f.pixel_hash === ref.pixel_hash ? [] : [`${what}: frame ${ref.frame}'s pixel hash ${f.pixel_hash} isn't the 1-worker run's ${ref.pixel_hash}`];
  });
}
const call = (extra: Partial<FramesCall>): FramesCall => ({ scene: SCENES.encode, ...extra });

function reference(): Frame[] {
  const [one] = run(builds.bin('default'), scenario(out(), [framesCall(call({ workers: 1 }))]));
  const r = framesReply(one!, 'the 1-worker run');
  expect(r.frames.map((f) => f.frame), 'the 1-worker run presents every frame').toEqual(Array.from({ length: SCENE.frames }, (_, i) => i));
  const blank = backgroundHash(SCENE, SCENE.size);
  expect(r.frames.every((f) => f.pixel_hash !== null && f.pixel_hash !== blank), 'every frame draws its layers (no frame is the background alone)').toBe(true);
  expect(new Set(hashes(r.frames)).size, 'the layers move: every frame differs').toBe(SCENE.frames);
  return r.frames;
}

describe('#377.6fcbd42e a frame\'s pixel hash is the same with 1 and 4 encode workers', () => {
  it('#377.6fcbd42e every frame of eight overlapping writer layers hashes the same with 4 encode workers as with 1', () => {
    const ref = reference();
    const [four] = run(builds.bin('default'), scenario(out(), [framesCall(call({ workers: 4 }))]));
    expect(differ(ref, framesReply(four!, 'the 4-worker run').frames, '4 workers'), 'frames whose hash differs').toEqual([]);
  }, 1_800_000);
});

describe('#377.8ae4f399 with a test pool that finishes encodes in reverse and in 20 seeded random orders, every frame\'s hash equals the 1-worker run\'s; a planted submit-on-completion fails on the reverse order, naming the frame', () => {
  it('#377.8ae4f399 encodes finished in reverse, and in 20 seeded random orders, are still submitted in frame order by index, and every frame hashes as the 1-worker run', () => {
    const ref = reference();
    const pools = [{ order: 'reverse' as const }, ...SEEDS.map((seed) => ({ order: 'seeded' as const, seed }))];
    const replies = run(builds.bin('test-pool'), scenario(out(), pools.map((pool) => framesCall(call({ workers: 4, pool })))));
    const orders = new Set<string>();
    for (const [i, reply] of replies.entries()) {
      const pool = pools[i]!;
      const name = pool.order === 'reverse' ? 'reverse' : `seed ${pool.seed}`;
      const frames = framesReply(reply, name).frames;
      for (const f of frames) {
        expect(f.encodes?.length, `${name}, frame ${f.frame}: the pool reports each layer's encode`).toBe(LAYERS);
        const byCompletion = [...f.encodes!].sort((a, b) => a.completed - b.completed).map((e) => e.layer);
        const bySubmit = [...f.encodes!].sort((a, b) => a.submitted - b.submitted).map((e) => e.layer);
        expect(bySubmit, `${name}, frame ${f.frame}: submitted in frame order by index`).toEqual(Array.from({ length: LAYERS }, (_, k) => k));
        expect([...byCompletion].sort((a, b) => a - b), `${name}, frame ${f.frame}: each layer finishes once`).toEqual(Array.from({ length: LAYERS }, (_, k) => k));
        if (pool.order === 'reverse') expect(byCompletion, `reverse, frame ${f.frame}: encodes finish in reverse`).toEqual(Array.from({ length: LAYERS }, (_, k) => LAYERS - 1 - k));
        else orders.add(byCompletion.join(','));
      }
      expect(differ(ref, frames, name), `${name}: frames whose hash differs from the 1-worker run`).toEqual([]);
    }
    expect(orders.size, 'the seeded orders are random: more than a handful of distinct finishing orders, not index order alone').toBeGreaterThan(5);
  }, 3_600_000);

  it('#377.8ae4f399 a planted pool that submits on completion (--planted submits_on_completion) fails on the reverse order, naming the frame', () => {
    const ref = reference();
    const [rev] = run(builds.bin('test-pool'), scenario(out(), [framesCall(call({ workers: 4, pool: { order: 'reverse' } }))]), { planted: 'submits_on_completion' });
    const problems = differ(ref, framesReply(rev!, 'the planted reverse run').frames, 'submits_on_completion');
    expect(problems.length, 'the planted submission order changes frames\' hashes').toBeGreaterThan(0);
    expect(problems[0], 'the failure names the frame').toMatch(/frame \d+'s pixel hash/);
  }, 1_800_000);
});
