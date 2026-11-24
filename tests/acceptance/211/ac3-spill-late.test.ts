// AC3 #211.aee9d8a7: "With the store's memory forced to 1 MiB so pages spill, and a test disk that delays every read by
// 50 ms, every step hash, deep hash and array equals the unlimited run's at every step and pages.late is above 0; a
// planted pager that applies moves in the order reads finish fails, naming the first step whose slot table differs"
//
// Through `deep-logic` (README): the walker (programs.ts) on a ring of 100 pages in a world of 1,024, 64 slots, one
// page a round of 8 steps, writing into each page it visits, for 3,600 steps (4.5 laps): from the second lap on every
// page it enters was moved out 36 or more versions ago, so with the store's memory at 1 MiB (16 pages) it comes back
// from the store's disk. The bake's `store` (README: the test store) sets the memory and the disk's read delay; a bake
// without it is the unlimited run. `walk.slots` is the slot table each step read. `pager_applies_moves_as_reads_finish`
// never holds a step for a late page: each move runs once its read has finished.

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, firstCheckpointDiff, firstStepDiff, int, logic, pagesOf, piece, useBuilds, useTemp, type Bake, type LogicPlanted, type Store } from './helpers.ts';
import { walkWrites, walker } from './programs.ts';

const ID = AC(3);
useBuilds(['logic']);
const temp = useTemp();

const STEPS = 3600;
const ringPiece = () => piece({
  seed: 211_03, controls: ['steer'],
  items: {
    walk: {
      program: walker({ name: 'ring', slots: 64, moves: 8, topology: { ring: 100 }, start: 0, mode: 'visit' }),
      reads: ['steer'], writes: walkWrites(64), pages: pagesOf({ max: 1024, slots: 64, moves: 8, lead: 4 }),
      budget: { memory: 5 }, checkpoint: { every: 60, budget: 268_435_456 },
    },
  },
});
const forced = (): Store => ({ dir: temp(), memory: 1_048_576, read_delay_ms: 50 });
function run(store: Store | undefined, planted: LogicPlanted[] = []): Bake {
  const [reply] = logic([bakeCall(ringPiece(), STEPS, store ? { store } : {})], { planted });
  return bakeOf(reply!, STEPS, `the ring walk${store ? ' with a 1 MiB store and a 50 ms disk' : ', unlimited'}${planted.length ? ` (planted ${planted.join(', ')})` : ''}`);
}
/** The first step whose slot table (`walk.slots`, as the step read it) differs between two runs, or null. */
function firstSlotTableDiff(a: Bake, b: Bake): number | null {
  for (let k = 0; k < STEPS; k++) {
    if (JSON.stringify(arrayOf(a.steps[k]!, 'walk.slots', 'run a')) !== JSON.stringify(arrayOf(b.steps[k]!, 'walk.slots', 'run b'))) return k;
  }
  return null;
}

describe(`${ID} a store that spills to a slow disk holds steps and never changes a value`, () => {
  it(`${ID} with 1 MiB of store memory and 50 ms reads, every step hash, deep hash and array is the unlimited run's, and pages.late is above 0`, () => {
    const unlimited = run(undefined);
    const spilled = run(forced());
    expect(unlimited.traps, 'the unlimited run never traps').toEqual([]);
    expect(firstStepDiff(spilled.steps, unlimited.steps, 'walk'), 'every step hash and array equals the unlimited run\'s').toBeNull();
    expect(firstCheckpointDiff(spilled.checkpoints['walk'] ?? [], unlimited.checkpoints['walk'] ?? []), 'every deep hash equals the unlimited run\'s').toBeNull();
    expect((spilled.checkpoints['walk'] ?? []).length, 'the spilled run has every checkpoint').toBe((unlimited.checkpoints['walk'] ?? []).length);
    const late = int(spilled.meters['walk']?.['pages.late'], 'the spilled run\'s meters.walk["pages.late"]');
    expect(late, 'pages came late from the slow disk (pages.late)').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} (planted pager_applies_moves_as_reads_finish) fails, naming the first step whose slot table differs`, () => {
    const unlimited = run(undefined);
    const planted = run(forced(), ['pager_applies_moves_as_reads_finish']);
    const k = firstSlotTableDiff(planted, unlimited);
    expect(k, 'the planted pager\'s slot table differs from the unlimited run\'s at some step').not.toBeNull();
    const want = arrayOf(unlimited.steps[k!]!, 'walk.slots', 'the unlimited run');
    const got = arrayOf(planted.steps[k!]!, 'walk.slots', 'the planted run');
    const missing = want.filter((p) => p >= 0 && !got.includes(p));
    expect(missing.length, `step ${k} is the first whose slot table differs: the unlimited run's names page(s) the planted run's lacks (${want.join(',')} against ${got.join(',')})`).toBeGreaterThan(0);
    expect(firstStepDiff(planted.steps, unlimited.steps, 'walk'), `the comparison fails, first at step ${k}`).toBe(k);
  }, TIMEOUT);
});
