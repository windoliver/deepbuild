// #138.b658e38b: time order. One warm instance plays a module's own fixtures straight, then steps back one
// frame at a time, then at 100 seeded times in shuffled order, against a cold instance at each time.
// `test.kit.keys`'s fixture has keys at 0, 0.5 and 1 s and times 0 to 1 s every 1/60 s; its planted twin keeps
// its last key index and searches only forward, so it passes the straight play and first differs at 59/60 s,
// the first time stepped back. At the base there is no `kit` call and no `test-kit-keys*` feature.
import { describe, expect, it } from 'vitest';
import {
  FRAME_60, SEEDED_TIMES, arr, failuresIn, kit, matching, moduleOf, num, obj, partIn, show, useBuilds, useEvidence,
  type Build, type Case,
} from './helpers.ts';

const KEYS: Build = { set: 'full', with: ['test-kit-keys'] };
const KEPT: Build = { set: 'full', with: ['test-kit-keys-kept-index'] };
const builds = useBuilds([KEYS, KEPT]);
const evidence = useEvidence();

const FIXTURE = 'parity/kernel/keys.board';
const STRAIGHT = Array.from({ length: 61 }, (_, k) => k * FRAME_60);

function times(c: Case): { straight: number[]; back: number[]; shuffled: number[] } {
  const t = obj(c.raw['times'], `${c.case}.times`);
  const list = (k: string): number[] => arr(t[k], `${c.case}.times.${k}`).map((v, i) => num(v, `${k}[${i}]`));
  return { straight: list('straight'), back: list('back'), shuffled: list('shuffled') };
}
function keysCase(build: Build): { c: Case; m: ReturnType<typeof moduleOf> } {
  const r = kit(builds.bin(build), evidence(), { modules: ['test.kit.keys'], parts: ['time_order'] });
  const m = moduleOf(r, 'test.kit.keys');
  const c = partIn(m, 'time_order').cases.find((x) => x.fixture === FIXTURE);
  expect(c, `the time-order part ran ${FIXTURE}`).toBeDefined();
  return { c: c!, m };
}

describe('#138.b658e38b a module that keeps its last key index passes a straight play and fails the time-order part at the first time stepped back', () => {
  it(`#138.b658e38b the time-order case plays the fixture's 61 times straight, steps back one frame at a time, then ${SEEDED_TIMES} seeded times in shuffled order`, () => {
    const { c } = keysCase(KEYS);
    const t = times(c);
    expect(t.straight, 'the fixture\'s times, 0 to 1 s every 1/60 s, in order').toEqual(STRAIGHT);
    expect(t.back, 'then back one frame at a time from 59/60 s to 0').toEqual([...STRAIGHT].reverse().slice(1));
    expect(t.shuffled.length, `${SEEDED_TIMES} seeded times`).toBe(SEEDED_TIMES);
    expect(new Set(t.shuffled).size, 'distinct times').toBe(SEEDED_TIMES);
    expect(t.shuffled.every((x) => x >= 0 && x <= 705_600_000), 'within the fixture').toBe(true);
    const ascending = [...t.shuffled].sort((a, b) => a - b);
    expect(t.shuffled, 'in shuffled order, not sorted').not.toEqual(ascending);
    expect(t.shuffled, 'nor sorted descending').not.toEqual([...ascending].reverse());
    expect(c.verdict, show(c.raw, 600)).toBe('PASS');
  }, 1_800_000);

  it('#138.b658e38b test.kit.keys with a kept, forward-only key index fails time_order naming test.kit.keys and 59/60 s, and nothing on the straight play', () => {
    const { c, m } = keysCase(KEPT);
    const t = times(c);
    expect(m.verdict).toBe('FAIL');
    const failures = matching(failuresIn(m, 'time_order'), 'time_order', { module: 'test.kit.keys' });
    expect(failures.length, `a time_order failure naming test.kit.keys: ${show(failuresIn(m, 'time_order'))}`).toBeGreaterThan(0);
    const first = failures[0]!;
    expect(first['t'], 'the failure is at the first time stepped back').toBe(t.back[0]);
    expect(first['t'], 'which is 59/60 s').toBe(59 * FRAME_60);
    expect(first['during'], 'while stepping back: the straight play passed').toBe('back');
    expect(failures.filter((f) => f['during'] === 'straight'), 'the straight play passes').toEqual([]);
  }, 1_800_000);

  it('#138.b658e38b the same module without the kept index passes', () => {
    const { m } = keysCase(KEYS);
    expect(partIn(m, 'time_order').verdict).toBe('PASS');
    expect(matching(failuresIn(m), 'time_order')).toEqual([]);
  }, 1_800_000);
});
