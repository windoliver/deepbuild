// #1903.47941574: Three test passes that each meet their own budget alone, 4 ms of GPU each at full screen, fail the
// combined envelope together on the showpiece class's 10 ms at p95, naming the three passes and the measured total,
// where a check that times each pass alone passes all three.
//
// The envelope on the stub meter (`test-meter` build, wgpu's noop backend, the virtual clock) under a reference Mac's
// environment, full screen on its display. The scene stands in for every pass the build has: an orbit camera, a box
// and three `test.burn@1` passes, burn-a, burn-b and burn-c, whose passes the stub has cover 4 ms each, one after
// another, so every frame's passes cover 12 ms. The same scene with one burn at a time is each pass alone. The wrong
// program is `--planted times_each_pass_alone`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE, RUNS, SCENE, SHOWPIECE_GPU_MS, envelopeCall, envelopeOf, fixtureRow, run, sceneDoc, stubMeter, useBuild, useOut, writeDoc,
  type Envelope, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1903.47941574';
const BURNS = ['burn-a', 'burn-b', 'burn-c'] as const;
const PASS_MS = 4;
const TOTAL_MS = PASS_MS * BURNS.length;
/** 300 frames a run, the design's floor for a frame-time p95; the criterion names no length. */
const SECONDS = 5;

/** The envelope of the scene with `burns` on, each covering 4 ms, in a store of its own. */
function call(dir: string, burns: readonly string[]): JsonObject {
  const name = burns.join('+');
  return envelopeCall({
    store: join(dir, `store-${name}`), scene: writeDoc(dir, `scene-${name}`, sceneDoc({ burns })), seconds: SECONDS, stub_environment: REFERENCE,
    stub_meter: stubMeter({ [SCENE]: { passes: Object.fromEntries(burns.map((b) => [b, PASS_MS])), gpu_bytes: 100_000_000 } }),
  });
}

const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) <= 1e-6;

/** The criterion's check on the three passes on at once: each sentence names what it is about. */
function combinedProblems(e: Envelope): string[] {
  const out: string[] = [];
  const ft = fixtureRow(e, SCENE)?.frame_time;
  if (!ft) return ['the envelope reports no frame time for the scene'];
  const p95s = ft.runs.map((r) => r.p95_ms);
  if (ft.limit_ms !== SHOWPIECE_GPU_MS) out.push(`the frame time is held to ${ft.limit_ms} ms, not the showpiece class's ${SHOWPIECE_GPU_MS} ms`);
  if (ft.verdict !== 'FAIL') out.push(`burn-a, burn-b and burn-c on at once read ${ft.verdict} at p95 ${JSON.stringify(p95s)} ms, not FAIL against the showpiece class's ${SHOWPIECE_GPU_MS} ms`);
  if (ft.runs.length !== RUNS) out.push(`the frame time attaches ${ft.runs.length} runs, not five`);
  ft.runs.forEach((r, i) => { if (!near(r.p95_ms, TOTAL_MS)) out.push(`run ${i + 1}'s p95 reads ${r.p95_ms} ms, not the measured total of the three passes, ${TOTAL_MS} ms`); });
  for (const b of BURNS) {
    const p = ft.passes.find((x) => x.item === b);
    if (!p) out.push(`the frame time doesn't name the pass ${b}`);
    else if (!near(p.p95_ms, PASS_MS)) out.push(`the pass ${b} reads ${p.p95_ms} ms at p95, not ${PASS_MS}`);
  }
  if (e.verdict !== 'FAIL') out.push(`the envelope is ${e.verdict}, not FAIL`);
  return out;
}

function together(planted?: Planted): Envelope {
  const dir = out();
  const [reply] = run(bin(), dir, [call(dir, BURNS)], planted ? { planted } : {});
  return envelopeOf(reply!, planted ? `the three passes together, planted ${planted}` : 'the three passes together');
}

describe(`${ID} a pass within its own budget alone proves nothing about the total`, () => {
  it(`${ID} three test passes of 4 ms each pass alone and fail the envelope together on the showpiece's 10 ms at p95, naming the three passes and the 12 ms total`, () => {
    const dir = out();
    const calls = [call(dir, BURNS), ...BURNS.map((b) => call(dir, [b]))];
    const [all, ...alone] = run(bin(), dir, calls);
    for (const [k, reply] of alone.entries()) {
      const b = BURNS[k]!;
      const ft = fixtureRow(envelopeOf(reply, `${b} alone`), SCENE)?.frame_time;
      expect(ft, `${b} alone: the scene's frame time`).toBeDefined();
      expect(ft!.verdict, `${b} alone meets its own budget`).toBe('PASS');
      expect(ft!.runs.length, `${b} alone: five runs`).toBe(RUNS);
      for (const [i, r] of ft!.runs.entries()) expect(r.p95_ms, `${b} alone: run ${i + 1}'s p95`).toBeCloseTo(PASS_MS, 6);
      expect(ft!.passes.find((p) => p.item === b)?.p95_ms, `${b} alone: the pass named, at 4 ms`).toBeCloseTo(PASS_MS, 6);
    }
    expect(combinedProblems(envelopeOf(all!, 'the three passes together')), 'FAIL together, naming the three passes and the total').toEqual([]);
  }, 1_800_000);

  it(`${ID} planted times_each_pass_alone passes all three and fails this criterion`, () => {
    const e = together('times_each_pass_alone');
    expect(fixtureRow(e, SCENE)?.frame_time?.verdict, 'the planted envelope, timing each pass alone, passes the three').toBe('PASS');
    expect(combinedProblems(e).length, 'it fails the criterion').toBeGreaterThan(0);
  }, 1_800_000);
});
