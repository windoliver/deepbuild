// #3617.ac333e6b: the timing run reports each frame's draw-and-finish time and its parts, and on every frame the
// parts add up to the whole within 5%. A planted run that leaves one part out fails, naming the frame.
import { describe, expect, it } from 'vitest';
import { CRITERIA, PART_NAMES, SCENES, expectReported, framesCall, framesReply, partsProblems, run, scenario, useBuild, useOut } from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = CRITERIA.parts;
const FRAMES = 60;

describe(`${ID} the timing run reports each frame's draw-and-finish time and its parts`, () => {
  it(`${ID} on both paths every frame reports draw_ms beside handoff_ms and draw_parts_ms with ${PART_NAMES.join(', ')}, and the parts add up to the whole within 5%`, () => {
    for (const path of ['zero_copy', 'copy'] as const) {
      const [reply] = run(bin(), scenario(out(), [framesCall({ scene: SCENES.onePass, count: FRAMES, path, timings: true })]));
      const { frames } = framesReply(reply!, `the ${path} timing run`);
      expect(frames.map((f) => f.frame), `${path}: every frame presented once, in order`).toEqual(Array.from({ length: FRAMES }, (_, i) => i));
      expect(frames.every((f) => f.drawn), `${path}: every frame was drawn into a slot`).toBe(true);
      expectReported(frames, `the ${path} timing run`);
      expect(partsProblems(frames, `the ${path} timing run`), `${path}: on every frame the parts add up to the whole within 5%`).toEqual([]);
    }
  }, 1_800_000);

  it(`${ID} a planted run that leaves one part out (--planted leaves_out_part) fails the parts check, naming each frame`, () => {
    const [reply] = run(bin(), scenario(out(), [framesCall({ scene: SCENES.onePass, count: FRAMES, path: 'zero_copy', timings: true })]), 'leaves_out_part');
    const { frames } = framesReply(reply!, 'the planted run');
    expect(frames.every((f) => f.draw_ms !== null && f.draw_ms > 0), 'the planted run still reports each frame\'s whole').toBe(true);
    const problems = partsProblems(frames, 'leaves_out_part');
    expect(problems.length, 'every frame fails: the part left out is its largest, at least a quarter of the whole').toBe(FRAMES);
    for (const f of frames) expect(problems.some((p) => p.includes(`frame ${f.frame}:`)), `a problem names frame ${f.frame}`).toBe(true);
  }, 1_800_000);
});
