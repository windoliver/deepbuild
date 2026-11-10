// AC4: "A frame with no change to any item it reads runs no solve, read from the scheduler's counters. A planted
// per-frame solve fails, naming the item."

import { describe, expect, it } from 'vitest';
import {
  AC, ARRANGEMENT, DOC, TIMEOUT, arr, frames, isObject, num, obj, presented, roomDoc, runShow, scenario, show, useDir,
  useShow, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();
const COUNT = 10;

/** The room with a turning ceiling fan the arrangement doesn't read, shown, then ten frames 1/60 s apart. */
function counted(planted?: Planted): JsonObject[] {
  const [shown, played] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, roomDoc({ fan: true })), frames(DOC.a, COUNT)], planted));
  presented(shown!, 'the room with a fan');
  const list = arr(obj(played, 'the frames reply')['frames'], 'frames').filter(isObject);
  expect(list.length, 'ten frames').toBe(COUNT);
  return list;
}

/** Each frame after the first that ran a solve, naming the arrangement item, from the frames' `solves` counters. */
function perFrameSolves(list: JsonObject[]): string[] {
  const out: string[] = [];
  list.slice(1).forEach((f, k) => {
    const solves = obj(f['solves'], `frame ${k + 1}: solves`);
    const n = num(solves[ARRANGEMENT], `frame ${k + 1}: solves.${ARRANGEMENT}`);
    if (n !== 0) out.push(`frame ${k + 1} (t ${String(f['t'])}) changed nothing ${ARRANGEMENT} reads, yet ran ${n} solve(s) of ${ARRANGEMENT}`);
  });
  return out;
}

describe(`${AC[4]} a frame with no change to any item the arrangement reads runs no solve`, () => {
  it(`${AC[4]} frames that turn only the fan run no solve of the arrangement, by the scheduler's counters`, () => {
    const list = counted();
    // Something does change every frame (the fan's channel runs), so the frames aren't idle.
    list.slice(1).forEach((f, k) => expect(num(f['ran'], `frame ${k + 1}: ran`), `frame ${k + 1} ran the fan's nodes`).toBeGreaterThan(0));
    expect(perFrameSolves(list), 'no frame after the first solves the arrangement').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} the planted arrange_solves_per_frame fails, naming ${ARRANGEMENT}`, () => {
    const failures = perFrameSolves(counted('arrange_solves_per_frame'));
    expect(failures.length, 'the planted per-frame solve fails the counter check').toBeGreaterThan(0);
    expect(failures.every((f) => f.includes(ARRANGEMENT)), `each failure names ${ARRANGEMENT}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
