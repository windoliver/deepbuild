// AC1 #1316.a4e5e495: Khronos SheenChair and DispersionTest, drawn by `view3d` with an environment-lit `sky@1` and a
// sun, give byte-identical final and linear targets at frame 0 in 10 fresh processes on the reference Mac.
//
// Each sample, fetched by hash, is drawn in 428's AC9 three-quarter view (1280 × 800, filmic) under 428's daylight sky
// lighting by its environment and 428's AC9 sun, one `view3d` call per fresh `deep-gpu run` process, 10 processes per
// sample. Every run's final and linear SHA-256 must equal the first run's; a mismatch names the sample, the run, the
// target and how many pixels differ. Off macOS or off a reference Mac: INCONCLUSIVE. No cache and no network: BLOCKED.
import { describe, expect, it } from 'vitest';
import { AC, RUNS, khronos, requireReferenceMac, sameEveryRun, useDir, useGpu, type SampleName } from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

describe(`${ID} environment-lit textured glTF frames are byte-identical from run to run`, () => {
  it(`${ID} SheenChair and DispersionTest under an environment-lit sky@1 and a sun give the same final and linear bytes at frame 0 in ${RUNS} fresh deep-gpu run processes each`, async () => {
    const machine = requireReferenceMac();
    const out = dir();
    const problems: string[] = [];
    for (const name of ['SheenChair', 'DispersionTest'] as SampleName[]) {
      const f = await khronos(name, out);
      const problem = sameEveryRun(bin(), out, f, RUNS);
      if (problem) problems.push(problem);
    }
    expect(problems, `on ${machine}:\n${problems.join('\n')}`).toEqual([]);
  }, 900_000);
});
