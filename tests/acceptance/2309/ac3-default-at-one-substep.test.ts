// Criterion 3: a world at 120 Hz and `substeps: 1` that writes no `contact_hz` runs its contacts at 20 Hz: the five
// cubes each move slower than 5 mm/s throughout the sixth second. A planted default that keeps 30 Hz moves them faster
// than 0.05 m/s and fails, naming a body. A world at 4 substeps that writes none gives step hashes byte-identical to the
// merge base's.
import { describe, expect, test } from 'vitest';
import {
  AC, STEPS, TIMEOUT, bake, caught, cube, cubes, hashesOf, none, onBase, physics, prebuild, restFailures, shownSpeeds, speeds,
  stackWorld, statesOf, withBase,
} from './helpers.ts';

prebuild(['release']);
withBase();
const LIMIT = 0.005;

describe(`${AC[3]} unwritten, solver.contact_hz is the lower of 30 Hz and the bound`, () => {
  test(`${AC[3]} at 1 substep with no contact_hz the five cubes each move slower than 5 mm/s throughout the sixth second, and end where a written 20 Hz ends them`, () => {
    const what = 'the stack of five at 1 substep, contact_hz unwritten';
    const [unwritten, twenty] = physics([bake(stackWorld(5, { substeps: 1 })), bake(stackWorld(5, { substeps: 1, contactHz: 20 }))]);
    console.log(`${what}, largest speed in the sixth second: ${shownSpeeds(speeds(unwritten!, 5, what))}`);
    none(restFailures(unwritten!, 5, LIMIT, what), what);
    // It runs its contacts at 20 Hz: each cube's last state is the one the same world with 20 written gives.
    none(cubes(5).flatMap((id) => {
      const [a, b] = [statesOf(unwritten!, id, what).at(-1)!, statesOf(twenty!, id, 'the same stack with contact_hz 20 written').at(-1)!];
      return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${id}: unwritten it ends at ${JSON.stringify(a)}, with 20 Hz written at ${JSON.stringify(b)}`];
    }), 'the unwritten default at 1 substep against a written 20 Hz');
  }, TIMEOUT);

  test(`${AC[3]} a planted default that keeps 30 Hz at 1 substep moves the cubes faster than 0.05 m/s and fails, naming a body`, () => {
    const what = 'the stack of five at 1 substep under the planted default';
    const [baked] = physics([bake(stackWorld(5, { substeps: 1 }))], 'contact_default_30');
    const moved = speeds(baked!, 5, what);
    console.log(`planted contact_default_30, largest speed in the sixth second: ${shownSpeeds(moved)}`);
    expect(Math.max(...moved.map((s) => s.max)), 'the planted default moves a cube faster than 0.05 m/s in the sixth second').toBeGreaterThan(0.05);
    const failures = restFailures(baked!, 5, LIMIT, what);
    caught(failures, 'the planted default that keeps 30 Hz');
    expect(failures.some((f) => cubes(5).some((id) => f.startsWith(`${id}:`))), `a failure names a body; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);

  test(`${AC[3]} at 4 substeps with no contact_hz the step hashes are byte-identical to the merge base's`, () => {
    const call = bake(stackWorld(5), { read: [cube(5)] });
    const here = hashesOf(physics([call])[0]!, 'the stack of five at 4 substeps here');
    const { sha, replies } = onBase([call]);
    const there = hashesOf(replies[0]!, 'the stack of five at 4 substeps on the merge base');
    expect(here.length, 'a hash for the built state and each of the 720 steps').toBe(STEPS + 1);
    const first = here.findIndex((h, k) => h !== there[k]);
    console.log(`step hashes at 4 substeps, contact_hz unwritten: ${here.length} here, ${there.length} on the merge base ${sha.slice(0, 12)}; last ${here.at(-1)} and ${there.at(-1)}`);
    none(first < 0 && here.length === there.length ? [] : [`the step hash at step ${first} is ${here[first]} here and ${String(there[first])} on the merge base ${sha.slice(0, 12)} (${here.length} and ${there.length} hashes)`], 'the step hashes at 4 substeps against the merge base\'s');
  }, 4 * TIMEOUT);
});
