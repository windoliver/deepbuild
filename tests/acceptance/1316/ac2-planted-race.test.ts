// AC2 #1316.33db7d22: A planted race that reproduces the cause fails that check, naming the sample.
//
// AC1's check (`sameEveryRun`) run on the planted wrong program `deep-gpu run --planted environment_texture_race`, which
// the fix adds to deep-gpu's Planted table to bring back the race on the environment-lit textured path (README: The
// planted race). A race may differ in only some runs, so each sample gets up to 10 fresh processes and stops at the
// first that differs. The check must return a problem for at least one sample, and every problem it returns must name
// its sample. At the base `--planted` refuses the unknown name, so the processes exit non-zero and this test fails.
import { describe, expect, it } from 'vitest';
import { AC, RUNS, khronos, requireReferenceMac, sameEveryRun, useDir, useGpu, type SampleName } from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();

describe(`${ID} a planted race on the environment-lit textured path fails AC1's check`, () => {
  it(`${ID} with --planted environment_texture_race, frame 0 differs between fresh deep-gpu run processes and the check's problem names the sample`, async () => {
    const machine = requireReferenceMac();
    const out = dir();
    const found: [SampleName, string][] = [];
    for (const name of ['SheenChair', 'DispersionTest'] as SampleName[]) {
      const f = await khronos(name, out);
      const problem = sameEveryRun(bin(), out, f, RUNS, 'environment_texture_race', true);
      if (problem) found.push([name, problem]);
    }
    expect(found.length, `on ${machine}: the planted race fails the check for at least one sample, but every sample drew the same bytes in ${RUNS} fresh processes`).toBeGreaterThan(0);
    for (const [name, problem] of found) expect(problem.startsWith(`${name} `) && problem.includes(`${name}: run `), `the problem names ${name}:\n${problem}`).toBe(true);
    console.log(`${ID}: the check's problems under the planted race:\n${found.map(([, p]) => p).join('\n')}`);
  }, 900_000);
});
