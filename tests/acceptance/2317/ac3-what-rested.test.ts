// Criterion 3: what rested still rests: five 1 m cubes of density 1,000 kg/m³ and friction 0.5 set one on another each
// move slower than 1 mm/s throughout the sixth second, the top one ends 5.87 mm below 4.5 m within 0.3 mm, and ten
// stacked rest too. A 1 cm cube of friction 0 sliding at 0.886 m/s off a static table's edge at `step_rate: 480`, with
// no other setting changed, has dropped 0.5 mm before its centre is 1.6 sides past the edge, where the first
// criterion's planted wrapper has not until 5.23. Five 1 cm cubes of density 1,000 kg/m³ and friction 0.5 stacked at
// `step_rate: 480`, `contact_hz: 240` and `length_unit: 0.01` (#2308) end with the top one's centre within 2% of a
// side of 4.5 sides up. A planted wrapper that turns the backend's contact reuse off for every world topples them and
// fails, naming the top body.
import { describe, expect, test } from 'vitest';
import {
  AC, CUBE, EDGE_STEPS, REUSE_OFF, REUSE_ON, SIDE, TIMEOUT, TOP, ask, bigStackBake, edgeBake, edgeRead, prebuild,
  restRead, smallStackBake, smallStackRead, type EdgeRead,
} from './helpers.ts';

prebuild(['release']);

const sides = (r: EdgeRead): string => (r.sides === null ? 'never' : r.sides.toFixed(2));
const share = (low: number | null): string => (low === null ? 'unread' : `${((low / SIDE) * 100).toFixed(2)}% of a side`);

describe(`${AC[3]} what rested still rests: stacks of 1 m cubes, a 1 cm cube at a table's edge at step_rate 480, and five 1 cm cubes at contact_hz 240 and length_unit 0.01`, () => {
  test(`${AC[3]} five and ten 1 m cubes move slower than 1 mm/s through the sixth second and the top of five ends 5.87 mm low within 0.3 mm; the 1 cm cube has dropped 0.5 mm before 1.6 sides past the edge; the five 1 cm cubes end 4.5 sides up within 2% of a side`, () => {
    const run = ask([bigStackBake(5), bigStackBake(5, 80), bigStackBake(10), bigStackBake(10, 80), edgeBake(), smallStackBake()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const stacks = [
      restRead(run.replies[0]!, 5, true, 'five 1 m cubes at the default contact frequency'),
      restRead(run.replies[1]!, 5, false, 'five 1 m cubes at contact_hz 80'),
      restRead(run.replies[2]!, 10, false, 'ten 1 m cubes at the default contact frequency'),
      restRead(run.replies[3]!, 10, false, 'ten 1 m cubes at contact_hz 80'),
    ];
    const edge = edgeRead(run.replies[4]!, EDGE_STEPS, 'the edge at step_rate 480');
    const small = smallStackRead(run.replies[5]!, 'the stack of five 1 cm cubes');
    console.log(`the stacks' fastest cube in the sixth second: ${stacks.map((s) => (s.fastest === null ? 'unread' : `${(s.fastest * 1000).toFixed(4)} mm/s`)).join(', ')} (five and ten, each at the default and at contact_hz 80); the top of five ends ${stacks[0]!.low === null ? 'unread' : `${(stacks[0]!.low * 1000).toFixed(3)} mm`} low`);
    console.log(`the edge: the cube has dropped 0.5 mm at step ${String(edge.step)}, its centre ${sides(edge)} sides past the edge; the five 1 cm cubes: the top ends ${share(small.low)} low`);
    const failures = [...stacks.flatMap((s) => s.failures), ...edge.failures, ...small.failures];
    expect(failures, `what rested:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} the first criterion's planted wrapper, which leaves the backend's contact reuse on, has not dropped the 1 cm cube until 5.23 sides past the edge`, () => {
    const run = ask([edgeBake(), smallStackBake()], REUSE_ON);
    expect(run.problem, `${run.what} answers`).toBe('');
    const edge = edgeRead(run.replies[0]!, EDGE_STEPS, `the edge under ${REUSE_ON}`);
    console.log(`planted ${REUSE_ON}: the cube has dropped 0.5 mm at step ${String(edge.step)}, its centre ${sides(edge)} sides past the edge`);
    expect(sides(edge), 'how many sides past the edge the cube\'s centre is when it has dropped 0.5 mm under the planted wrapper, as the issue prints it').toBe('5.23');
    expect(edge.failures.some((f) => f.startsWith(`${CUBE}:`)), `the judge that passes the real program fails on the planted wrapper at the edge:\n  ${edge.failures.join('\n  ')}`).toBe(true);
    // The wrapper is the one its name says: with reuse on, the five 1 cm cubes stand as they do at the merge base.
    const small = smallStackRead(run.replies[1]!, `the stack of five 1 cm cubes under ${REUSE_ON}`);
    expect(small.failures, `with reuse left on, the five 1 cm cubes still stand:\n  ${small.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted wrapper that turns the backend's contact reuse off for every world topples the five 1 cm cubes and fails, naming the top body`, () => {
    const run = ask([smallStackBake(), edgeBake()], REUSE_OFF);
    expect(run.problem, `${run.what} answers`).toBe('');
    const small = smallStackRead(run.replies[0]!, `the stack of five 1 cm cubes under ${REUSE_OFF}`);
    console.log(`planted ${REUSE_OFF}: the top of the five 1 cm cubes ends ${share(small.low)} low`);
    expect(small.low === null ? small.failures.join('; ') : small.low > SIDE / 2, 'the planted wrapper topples the stack: the top cube\'s centre ends more than half a side below 4.5 sides').toBe(true);
    expect(small.failures.some((f) => f.startsWith(`${TOP}:`)), `the judge that passes the real program fails on the planted wrapper, naming the top body:\n  ${small.failures.join('\n  ')}`).toBe(true);
    // The wrapper is the one its name says: with reuse off for every world, the cube at the edge drops in time.
    const edge = edgeRead(run.replies[1]!, EDGE_STEPS, `the edge under ${REUSE_OFF}`);
    expect(edge.failures, `with reuse off for every world, the 1 cm cube drops before 1.6 sides past the edge:\n  ${edge.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
