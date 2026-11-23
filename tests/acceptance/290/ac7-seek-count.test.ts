// AC7 #290.f96ca349: Seeking equals playing and render-back equals the live frame by pixel hash on one machine; at
// opacity 0 the item adds no pass, counted, and above 0 exactly one depth pass and one blended draw
//
// The fixture is helpers.ts's sphere behind a wall, its hidden view's opacity a channel: `items/sphere/hidden_view/
// opacity` keyed from 0 at 0 s to 0.8 at 1 s, linear, and nothing else in the document moves. The look draws one
// sample a frame in the live view and in an export alike (helpers.ts, `ONE_SAMPLE`; README: Readings), at 30 frames a
// second.
//
// Seek and render-back, by each frame's `pixel_hash` (#378's): one process plays frames 0 to 30; fresh processes seek
// to frames 10 and 25 (`from`), and one draws frame 25 as a render-back (`class: "render_back"`). Each sought frame's
// hash is the played frame's, and the render-back's is the live frame's. That a seek is a seek: the played hashes at
// 10 and 25 differ, which only the hidden view's opacity can make them do; and frame 0, where the channel gives 0,
// has the hash of the same document with no `hidden_view` at all.
//
// The count, from each frame's `draws` under `counts` (#1636's rows, one for each draw of a mesh, `{pass, of}`), to
// which this suite adds the hidden view's two passes (README: The surface under test): `hidden_depth`, the depth pass
// of the item's own triangles, and `hidden_view`, its blended draw. With no `hidden_view`, with `{opacity: 0}`, and at
// frame 0 of the played run, a frame lists neither, its other rows are those of the document with no hidden view, and
// the reply's `passes` are the same. At `{opacity: 0.4}`, and at each of the played frames 1 to 30, it lists exactly
// one `hidden_depth` and one `hidden_view`, both of `sphere`, and its other rows are unchanged.
//
// Wrong programs it fails: the merge base (the channel moves nothing: frames 10 and 25 are one picture, and no frame
// lists a hidden pass); a hidden view only the live view draws, or one that reads the frame before it; a depth pass
// kept at opacity 0; two blended draws.
import { describe, expect, it } from 'vitest';
import { requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import { AC, HIDDEN_DEPTH, HIDDEN_VIEW, ONE_SAMPLE, OPACITY, SIZE, TIMEOUT, drawsOf, gpu, passNames, refusals, shotsOf, sphereDoc, view3d, type JsonObject, type Shot } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FPS = 30;
const LAST = 30;
const SOUGHT = [10, 25];
const BACK = 25;
const ONE_OF_EACH = [`${HIDDEN_DEPTH} sphere`, `${HIDDEN_VIEW} sphere`];

describe(`${AC[7]} seeking equals playing, render-back equals the live frame, and the hidden view's passes are counted`, () => {
  it(`${AC[7]} frames sought and a render-back equal the frames played, by pixel hash; at opacity 0 the item adds no pass, and above 0 exactly one depth pass and one blended draw`, () => {
    requireMetal();
    const out = dir();
    const fading = writeJson(out, 'fading', sphereDoc('sphere-fading', { hidden: { opacity: 0 }, fade: true }));
    const still = (name: string, hidden?: { opacity: number }): JsonObject =>
      view3d({ doc: writeJson(out, name, sphereDoc(name, hidden ? { hidden } : {})), size: SIZE, look: ONE_SAMPLE, fps: FPS, targets: ['final'], counts: true });
    const at = (from: number, more: JsonObject = {}): JsonObject => ({ ...view3d({ doc: fading, size: SIZE, look: ONE_SAMPLE, fps: FPS, from, frames: 1, targets: ['final'] }), ...more });

    const labels = ['frames 0 to 30 played', 'the sphere with no hidden view', 'the sphere at opacity 0', 'the sphere at opacity 0.4'];
    const played = gpu(bin(), out, [
      view3d({ doc: fading, size: SIZE, look: ONE_SAMPLE, fps: FPS, frames: LAST + 1, capture: [0], targets: ['final'], counts: true }),
      still('still-plain'), still('still-zero', { opacity: 0 }), still('still-hidden', { opacity: OPACITY }),
    ]);
    expect(refusals(played, labels), 'view3d plays the fading sphere and draws the three stills').toEqual([]);
    const frames = shotsOf(played.replies[0]!, labels[0]!);
    const [bare, zero, hidden] = [1, 2, 3].map((i) => shotsOf(played.replies[i]!, labels[i]!)[0]!);
    expect(frames.map((f) => f.frame), 'the played run drew frames 0 to 30').toEqual(Array.from({ length: LAST + 1 }, (_, n) => n));
    const hash = (n: number): string | null => frames[n]!.hash;
    expect(frames.filter((f) => !/^[0-9a-f]{64}$/.test(f.hash ?? '')).map((f) => f.frame), 'every played frame has a pixel hash').toEqual([]);

    // A seek is a seek: the hidden view's opacity, and nothing else, moves the frame.
    expect(hash(0), 'frame 0, where the channel gives opacity 0, is the picture of the document with no hidden view').toBe(bare!.hash);
    expect([hash(SOUGHT[0]!) === hash(0), hash(SOUGHT[0]!) === hash(SOUGHT[1]!)], 'the channel on the hidden view\'s opacity moves the frame: frames 0, 10 and 25 are three pictures').toEqual([false, false]);

    const problems: string[] = [];
    for (const n of SOUGHT) {
      const run = gpu(bin(), out, [at(n)]);
      expect(refusals(run, [`the seek to frame ${n}`]), `a fresh process seeks to frame ${n}`).toEqual([]);
      const sought = shotsOf(run.replies[0]!, `the seek to frame ${n}`).find((f) => f.frame === n)?.hash ?? null;
      if (sought !== hash(n)) problems.push(`frame ${n}: seeking draws ${String(sought)}, playing drew ${String(hash(n))}`);
    }
    const back = gpu(bin(), out, [at(BACK, { class: 'render_back' })]);
    expect(refusals(back, [`the render-back of frame ${BACK}`]), `a fresh process draws frame ${BACK} as a render-back`).toEqual([]);
    const drawnBack = shotsOf(back.replies[0]!, `the render-back of frame ${BACK}`).find((f) => f.frame === BACK)?.hash ?? null;
    if (drawnBack !== hash(BACK)) problems.push(`frame ${BACK}: render-back draws ${String(drawnBack)}, the live frame was ${String(hash(BACK))}`);
    expect(problems, 'seeking equals playing and render-back equals the live frame, by pixel hash').toEqual([]);

    // The count.
    const listed = (s: Shot): boolean => s.draws !== null && s.draws.length > 0;
    expect([bare!, zero!, hidden!, ...frames].filter((s) => !listed(s)).map((s) => s.frame), 'every frame drawn with counts lists its draws').toEqual([]);
    const plain = drawsOf(bare!);
    expect(plain.hidden, 'the fixture: with no hidden view, a frame lists no hidden pass').toEqual([]);
    expect({ ...drawsOf(zero!), passes: passNames(played.replies[2]!) }, 'at opacity 0 the item adds no pass: the frame\'s draws and the reply\'s passes are those of the document with no hidden view')
      .toEqual({ ...plain, passes: passNames(played.replies[1]!) });
    expect(drawsOf(frames[0]!), 'at frame 0, where the channel gives opacity 0, the item adds no pass').toEqual(plain);
    expect(drawsOf(hidden!), 'at opacity 0.4 the item adds exactly one depth pass and one blended draw, and no other draw changes').toEqual({ hidden: ONE_OF_EACH, rest: plain.rest });
    const off = frames.slice(1).filter((f) => JSON.stringify(drawsOf(f)) !== JSON.stringify({ hidden: ONE_OF_EACH, rest: plain.rest })).map((f) => `frame ${f.frame}: ${drawsOf(f).hidden.join(', ') || 'no hidden pass'}`);
    expect(off, 'at each played frame from 1 on, where the opacity is above 0, exactly one depth pass and one blended draw').toEqual([]);
  }, TIMEOUT);
});
