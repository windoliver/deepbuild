// AC3: a click on a box picks that box's ID.
// The scene and its label go through `deep show` (two test agents' processes); the hub's current revision is
// drawn by the GPU layer's view on this machine's GPU (#378's `view3d`), 330 frames at 60 fps with the orbit and
// the move. Clicks arrive through the view3d call's `clicks` (this suite's addition; README: The surface under
// test) at frames 0, 75, 150, 225, 299 and 320. Where to click comes from two places: box-10-05 sits at the
// orbit's target, so it projects to the view's centre at every azimuth (no camera convention needed); and a first
// run's object-ID target gives, at each click frame, a pixel inside each of four other boxes (one per quadrant of
// the view), inside the moved box after the move, and on empty ground or sky where nothing is (expected null).
// At the base the hub refuses the scene, and view3d has no `clicks`.
import { describe, expect, it } from 'vitest';
import {
  CENTER_BOX, FPS, GPU_BIN, LOOK, MOVED_BOX, RUN_FRAMES, SHOW_BIN, SIZE, everyFrame, frameAt, keepProof, movePatch, readIds, requireGpu,
  runGpu, solidSpots, useBins, useOut, view3d, view3Reply, viaDeepShow, type Click,
} from './helpers.ts';

const bins = useBins([SHOW_BIN, GPU_BIN]);
const out = useOut();
const CLICK_FRAMES = [0, 75, 150, 225, 299, 320];
const CENTRE: [number, number] = [SIZE[0] / 2, SIZE[1] / 2];

interface Planned { click: Click; want: string | null; why: string }

describe('AC3 a click on a box picks that box\'s ID', () => {
  it('AC3 clicks on boxes in the GPU layer\'s view, during the orbit and after the move, pick each box\'s own ID; a click on nothing picks nothing', () => {
    requireGpu();
    const hub = viaDeepShow(bins.bin(SHOW_BIN), out(), 'the checkpoint');
    const base = { doc: hub.path, look: LOOK, size: SIZE, frames: RUN_FRAMES, fps: FPS, patches: [movePatch(hub.sceneWriter)], targets: ['ids' as const], capture: CLICK_FRAMES };
    const [first] = runGpu(bins.bin(GPU_BIN), out(), [view3d(base)]);
    const seen = view3Reply(first!, 'the first run');
    everyFrame(seen, RUN_FRAMES, 'the first run');
    const plan: Planned[] = [];
    for (const n of CLICK_FRAMES) {
      plan.push({ click: { frame: n, at: CENTRE }, want: CENTER_BOX, why: 'the box at the orbit\'s target, at the view\'s centre' });
      const ids = readIds(out(), frameAt(seen, n, 'the first run'), `frame ${n}'s object-ID target`);
      const spots = solidSpots(ids);
      const quadrant = ([x, y]: [number, number]): number => (x < CENTRE[0] ? 0 : 1) + (y < CENTRE[1] ? 0 : 2);
      const taken = new Set<number>();
      for (const [id, at] of spots) {
        if (id === null || !/^box-/.test(id) || id === CENTER_BOX || taken.has(quadrant(at))) continue;
        taken.add(quadrant(at));
        plan.push({ click: { frame: n, at }, want: id, why: 'a box the frame draws there' });
      }
      expect(taken.size, `frame ${n}: boxes to click in at least three quadrants of the view`).toBeGreaterThanOrEqual(3);
      if (n > 310) {
        const moved = spots.get(MOVED_BOX);
        expect(moved, `frame ${n}: the moved ${MOVED_BOX} draws a 5 × 5 block to click`).toBeDefined();
        plan.push({ click: { frame: n, at: moved! }, want: MOVED_BOX, why: 'the moved box, where it now draws' });
      }
      const nothing = spots.get(null);
      if (nothing) plan.push({ click: { frame: n, at: nothing }, want: null, why: 'where nothing draws' });
    }
    expect(plan.filter((p) => p.want === null).length, 'at least one click lands where nothing draws').toBeGreaterThan(0);

    const [second] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ ...base, clicks: plan.map((p) => p.click) })]);
    const clicked = view3Reply(second!, 'the clicked run');
    everyFrame(clicked, RUN_FRAMES, 'the clicked run');
    for (const n of CLICK_FRAMES) {
      expect(frameAt(clicked, n, 'the clicked run').ids, `frame ${n} draws the same picture with and without the clicks (its ID target's hash)`).toBe(frameAt(seen, n, 'the first run').ids);
    }
    const results: { frame: number; at: [number, number]; want: string | null; pick: string | null | undefined; why: string }[] = [];
    for (const n of CLICK_FRAMES) {
      const mine = plan.filter((p) => p.click.frame === n);
      const answers = frameAt(clicked, n, 'the clicked run').clicks;
      // No picking at all (the base) fails here.
      expect(answers, `frame ${n} answers its clicks`).not.toBeNull();
      expect(answers!.length, `frame ${n} answers each of its ${mine.length} clicks, in order`).toBe(mine.length);
      mine.forEach((p, i) => {
        expect(answers![i]!.at, `frame ${n}: click ${i} is answered at the point it was made`).toEqual(p.click.at);
        results.push({ frame: n, at: p.click.at, want: p.want, pick: answers![i]!.pick, why: p.why });
      });
    }
    keepProof('ac3-picks', results);
    // A pick by draw position or instance index instead of the item's ID, a readback flipped or offset, a pick from
    // another frame than the one shown, or one that misses the move, fails here, naming the frame and the click.
    const wrong = results.filter((r) => r.pick !== r.want).map((r) => `frame ${r.frame}: a click at (${r.at.join(', ')}) on ${r.want ?? 'nothing'} (${r.why}) picks ${r.pick === null ? 'nothing' : r.pick}`);
    expect(wrong, 'every click picks the ID of the box under it, and nothing where nothing draws').toEqual([]);
  }, 1_800_000);
});
