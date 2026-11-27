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
