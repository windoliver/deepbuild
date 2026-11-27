// #3617.55464991: a module whose slot is ready late is caught: a planted module that sleeps 2 ms in its encode fails
// the timing check, naming the part the time went to. The planted run is read through the report's own parts, and the
// lane's judge names the part from a report's per-part means.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DRAW_P95_MS, PART_NAMES, SCENES, TARGET_NAME, expectReported, framesCall, framesReply, judgeReport, largestPart, median, p95, partsProblems, report, run,
  scenario, timingProblems, useBuild, useOut, type Frame, type PartName,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = CRITERIA.planted;
const FRAMES = 100;
const RUNS = 5;

function timed(planted?: 'sleeps_in_encode'): Frame[] {
  const [reply] = run(bin(), scenario(out(), [framesCall({ scene: SCENES.onePass, count: FRAMES, path: 'zero_copy', timings: true })]), planted);
  return framesReply(reply!, planted ? 'the planted run' : 'the plain run').frames;
}

describe(`${ID} a module that sleeps 2 ms in its encode fails the timing check, naming the part`, () => {
  it(`${ID} --planted sleeps_in_encode: in five runs every frame's encode part holds the sleep, the parts still add up, and the check fails naming encode`, () => {
    const plain = timed();
    const runs = Array.from({ length: RUNS }, () => timed('sleeps_in_encode'));
    for (const [k, frames] of runs.entries()) {
      const what = `planted run ${k + 1}`;
      expectReported(frames, what);
      expect(partsProblems(frames, what), `${what}: the planted run's parts are honest, so they add up to the whole`).toEqual([]);
      expect(frames.filter((f) => f.parts!.encode! < 1.9).map((f) => f.frame), `${what}: frames whose encode part is under the 2 ms sleep`).toEqual([]);
      expect(frames.every((f) => f.draw_ms! >= 2), `${what}: every frame's draw-and-finish time holds the sleep`).toBe(true);
      expect(largestPart(frames), `${what}: the time went to encode`).toBe('encode');
      const problems = timingProblems(frames, what);
      expect(problems.length, `${what}: p95 ${p95(frames.map((f) => f.draw_ms!)).toFixed(3)} ms fails the ${DRAW_P95_MS} ms check`).toBe(1);
      expect(problems[0], `${what}: the failure names the part`).toMatch(/went to encode$/);
    }
    // The twin: the same scene without the sleep carries it nowhere, so the sleep is what the encode part reads.
    const added = median(runs.flat().map((f) => f.parts!.encode!)) - median(plain.map((f) => f.parts!.encode ?? 0));
    expect(added, 'the planted encode part is at least 1.5 ms longer than the plain run\'s').toBeGreaterThanOrEqual(1.5);
    for (const p of PART_NAMES.filter((x) => x !== 'encode')) {
      const grew = median(runs.flat().map((f) => f.parts![p]!)) - median(plain.map((f) => f.parts![p] ?? 0));
      expect(grew, `the sleep isn't charged to ${p} (${grew.toFixed(3)} ms more than the plain run)`).toBeLessThan(1);
    }
  }, 3_600_000);

  it(`${ID} the lane's judge fails five readings over the limit on a reference Mac at rest and names the part the time went to`, () => {
    const dominant = (p: PartName): Record<PartName, number> => ({ encode: 0.05, submit: 0.05, gpu: 0.05, wait: 0.05, [p]: 2.2 });
    const verdicts = new Map<PartName, { status: string; reason: string }>();
    for (const p of PART_NAMES) {
      const v = judgeReport(report(Array.from({ length: RUNS }, () => ({ draw: 2.5, parts: dominant(p) }))));
      expect(v['task']).toBe('canvas-gpu-draw-finish');
      expect(v['status'], `${p}-dominant readings of 2.5 ms against ${DRAW_P95_MS}`).toBe('FAIL');
      const target = (v['targets'] as Record<string, Record<string, unknown>>)[TARGET_NAME]!;
      expect(target['status'], `the ${TARGET_NAME} target fails`).toBe('FAIL');
      const reason = String(v['reason']);
      expect(reason, `the failure names the part, ${p}`).toMatch(new RegExp(`\\b${p}\\b`));
      verdicts.set(p, { status: String(v['status']), reason });
    }
    expect(new Set([...verdicts.values()].map((v) => v.reason)).size, 'each part gives its own reason').toBe(PART_NAMES.length);
  }, 600_000);
});
