// AC13 #492.4cc26973: Placement A keys x and a bool `visible` and ends with extend after hold; placement B, a later replace,
// keys only y; during B, x and `visible` equal A's held end values bit for bit; a planted evaluator that resets unkeyed
// channels to the base fails, naming the path, and the fixture joins the migration corpus.
//
// Through `deep-motion eval` on fixtures/parity/animation/replace-keeps-unkeyed.film: `first` is A, `second` is B, x runs to
// 7.25, `visible` is false at the end, and the authored values are 100 and true. The plant `unkeyed_resets_to_base` goes
// through the same check. "Joins the migration corpus" has no surface: the repo commits no corpus folder (README: Criteria
// out of reach). Upstream port (oracle page): Blender's bl_animation_nla_strip.py, strips with extrapolation nothing:
// test_second_above_first (3.9 → 3, 4.0 → 1, 4.1 → 1) and test_extrapolation_nothing (0.9 → 0, 1.0 → 1, 1.1 → 1, 3.9 → 3,
// 4.1 → 0). Its 4.0 → 4 on a lone strip is left out: Blender's strip end is inclusive, and Placement's span is [start,
// start + span).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, at, clipOf, evalOk, evalPlanted, failsNaming, film, fixture, fl, isObject, none, place, posOr, rect, secs, seededTimes, useMotion, type Accepted, type Frame, type KeyList } from './helpers.ts';

const motion = useMotion();
const FILM = fixture('parity/animation/replace-keeps-unkeyed.film');

const END_X = 7.25;
const INSIDE = seededTimes(492_13, 30, fl(2), fl(3));
const HELD = [fl(1.5), ...INSIDE];
const visibleOf = (f: Frame): unknown => { const dot = f.items['dot']; return isObject(dot) ? dot['visible'] : undefined; };

/** The check: from A's end through B, x and `visible` keep A's end values; failures name the path. */
function heldFailures(a: Accepted): string[] {
  const failures: string[] = [];
  for (const f of a.frames) {
    const x = posOr(f, 'dot', 0);
    if (!Object.is(x, END_X)) failures.push(`items/dot/at/pos/0 at ${f.t} flicks reads ${x}, not A's held ${END_X}`);
    if (visibleOf(f) !== false) failures.push(`items/dot/visible at ${f.t} flicks reads ${String(visibleOf(f))}, not A's held false`);
  }
  return failures;
}

describe(`${AC[13]} a replace placement changes only the channels its clip keys`, () => {
  it(`${AC[13]} during B, x and visible equal A's held end values bit for bit, while B writes y`, () => {
    const a = evalOk(motion.bin(), { doc: FILM, times: HELD }, 'the fixture');
    none(heldFailures(a), 'A\'s held values under B');
    none(a.frames.slice(1).flatMap((f) => {
      const want = 3 * (secs(f.t) - 2); const y = posOr(f, 'dot', 1);
      return Math.abs(y - want) <= 1e-9 ? [] : [`y at ${f.t} flicks reads ${y}, not ${want}`];
    }), 'B writes y');
    expect(posOr(a.frames[0]!, 'dot', 1), 'y keeps its authored value before B').toBe(50);
  }, TIMEOUT);

  it(`${AC[13]} a planted evaluator that resets unkeyed channels to the base fails, naming the path`, () => {
    const plant = evalPlanted(motion.bin(), { doc: FILM, times: HELD, planted: 'unkeyed_resets_to_base' }, 'the fixture');
    expect(posOr(plant.frames[1]!, 'dot', 0), 'the plant puts x back to its authored 100 under B').toBe(100);
    failsNaming(heldFailures(plant), ['items/dot/at/pos/0', 'items/dot/visible'], 'the reset');
  }, TIMEOUT);

  // Blender's action: X keyed on frames 1 to 4 with the frame's value, constant interpolation. One frame is 1 s here.
  const ACTION: KeyList = [[0, 1, 'hold'], [1, 2, 'hold'], [2, 3, 'hold'], [3, 4, 'hold']];
  const strips = (starts: number[]) => film('nla-strips', [rect('dot', [0, 0])], {
    clips: { action: clipOf('x', 'at/pos/0', ACTION) },
    placements: Object.fromEntries(starts.map((start, i) => [`strip-${i}`, place('action', 'dot', { start: at(start), order: `a${i}` })])),
  }, { span: '10s' });
  const reads = (starts: number[], cases: [number, number][], what: string): string[] => {
    const a = evalOk(motion.bin(), { doc: strips(starts), times: cases.map(([s]) => fl(s)) }, what);
    return a.frames.flatMap((f, i) => (posOr(f, 'dot', 0) === cases[i]![1] ? [] : [`${what}: at ${cases[i]![0]} it reads ${posOr(f, 'dot', 0)}, not ${cases[i]![1]}`]));
  };

  it(`${AC[13]} Blender's stacked strips: the strip that holds the frame gives the value, the later one on the boundary, and past a strip with no extrapolation the base shows`, () => {
    none([
      ...reads([1], [[0.9, 0], [1.0, 1], [1.1, 1], [3.9, 3], [4.1, 0]], 'test_extrapolation_nothing'),
      ...reads([1, 4], [[3.9, 3], [4.0, 1], [4.1, 1]], 'test_second_above_first'),
    ], 'Blender\'s strip cases');
  }, TIMEOUT);
});
