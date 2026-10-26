// #379.1fbf8952: with a stub meter charging a work-product writer 3 ms of GPU per frame for frames 1 to 75,
// then 1 ms, and a second writer 1 ms throughout, the first steps to effects off at frame 30 and to LOD down
// at frame 60, each for frame health; it stays there with the view still for 600 frames; after a camera move
// at frame 700 it climbs one rung at frame 820; the second writer's rung never changes; one 3 ms frame among
// 1 ms frames changes nothing. A ladder that steps on the first slow frame, skips a rung or steps the second
// writer fails, naming the frame and the rung.
//
// The stub meter, on wgpu's noop backend and the virtual clock (`test-meter` build), everywhere. Both
// documents move (a channel slides a box), so every frame draws while the view stays still; the camera move
// is your input on alpha's view. The three planted ladders are `--planted steps_on_first_slow_frame`,
// `skips_a_rung` and `steps_every_writer`.
import { describe, expect, it } from 'vitest';
import { W, ladderProblems, liveCall, liveReply, one, rungProblems, sceneDoc, useBuilds, useOut, writeDoc, type Charge, type Expected, type Live, type Planted } from './helpers.ts';

const builds = useBuilds(['test-meter']);
const out = useOut();
const ID = '#379.1fbf8952';

function stepped(frames: number, alpha: Charge[], camera: boolean, planted?: Planted): Live {
  const a = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha, a work product', class: 'work_product', size: [128, 128], moving: true }));
  const b = writeDoc(out(), 'bravo', sceneDoc({ title: 'Bravo, a second writer', class: 'work_product', size: [128, 128], moving: true }));
  return liveReply(one(builds.bin('test-meter'), out(), liveCall({
    frames,
    sessions: [{ session: 's-alpha', writer: W.alpha, doc: a }, { session: 's-bravo', writer: W.bravo, doc: b }],
    events: camera ? [{ frame: 700, camera: { session: 's-alpha', azimuth: 20 } }] : [],
    stub_meter: { writers: { [W.alpha]: alpha, [W.bravo]: [{ from: 1, gpu_ms: 1 }] } },
  }), { backend: 'noop', ...(planted ? { planted } : {}) }));
}

const SCHEDULE: Charge[] = [{ from: 1, to: 75, gpu_ms: 3 }, { from: 76, gpu_ms: 1 }];
const initial: Expected = { frame: 1, from: null, to: 'base', reason: 'initial' };
const EXPECTED: Record<string, Expected[]> = {
  's-alpha': [
    initial,
    { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' },
    { frame: 60, from: 'effects_off', to: 'lod_down', reason: 'frame_health' },
    { frame: 820, from: 'lod_down', to: 'effects_off', reason: 'headroom' },
  ],
  's-bravo': [initial],
};

describe(`${ID} the ladder steps on the stub meter's schedule, frame by frame`, () => {
  it(`${ID} alpha steps to effects off at 30 and LOD down at 60 for frame health, holds while the view is still, and climbs one rung at 820 after the camera move at 700; bravo never changes`, () => {
    const live = stepped(900, SCHEDULE, true);
    expect(live.frames.length, '900 frames').toBe(900);
    expect(live.frames.every((f) => f.views.length === 2 && f.views.every((v) => v.drawn)), 'every frame draws both views').toBe(true);
    expect(ladderProblems(live, EXPECTED), 'the changes, frame by frame').toEqual([]);
    const at = (frame: number) => live.changes.find((c) => c.session === 's-alpha' && c.frame === frame)!;
    expect(rungProblems(live, 's-alpha', at(60).effective, 820, 'lod_down'), 'alpha draws at LOD down from the step at 60 through the still view to frame 820').toEqual([]);
    expect(rungProblems(live, 's-alpha', at(820).effective, 900, 'effects_off'), 'and at effects off once the climb takes effect').toEqual([]);
    expect(rungProblems(live, 's-bravo', 1, 900, 'base'), 'bravo draws at its base rung every frame').toEqual([]);
  }, 900_000);

  it(`${ID} one 3 ms frame among 1 ms frames changes nothing`, () => {
    const live = stepped(300, [{ from: 1, to: 149, gpu_ms: 1 }, { from: 150, to: 150, gpu_ms: 3 }, { from: 151, gpu_ms: 1 }], false);
    expect(ladderProblems(live, { 's-alpha': [initial], 's-bravo': [initial] }), 'no change but the initial rungs').toEqual([]);
  }, 600_000);

  it.each([
    ['steps_on_first_slow_frame', /^frame 1: s-alpha \(agent:alpha\) moved base → effects_off/],
    ['skips_a_rung', /^frame 30: s-alpha \(agent:alpha\) moved base → lod_down/],
    ['steps_every_writer', /^frame 30: s-bravo \(agent:bravo\) moved base → effects_off/],
  ] as const)(`${ID} a planted ladder (%s) fails, naming the frame and the rung`, (planted, named) => {
    const live = stepped(900, SCHEDULE, true, planted);
    const problems = ladderProblems(live, EXPECTED);
    expect(problems.length, `${planted} fails the schedule`).toBeGreaterThan(0);
    expect(problems.join('\n'), `${planted}'s failure names the frame and the rung`).toMatch(new RegExp(named.source, 'm'));
  }, 900_000);
});
