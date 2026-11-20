// #2240.c9639f9f: "The box of the first criterion at rest on level ground reads the same `pose` position with and
// without the field, within 1 mm. A planted output that reads the centre of mass reads a position 0.75 m lower and
// fails, naming the output"
//
// The box (README: The fixtures) stands on level ground with the output `box_pose`, `{from: "box", read: "pose"}`, and
// is baked 1 s at 120 Hz twice: with no `centre_of_mass` and with (0, −0.75, 0). The output's samples (README: A body's
// `pose` output) are compared frame by frame: the two positions lie within 1 mm at every step, and the box with no field
// stays within 1 mm of where it was built, so it is at rest. `pose_reads_centre_of_mass` reads the body's centre of mass
// in the output: with the field its position is 0.75 m lower at every step, within 1 mm, and the judge fails, naming
// `box_pose`.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, LOW, TIMEOUT, ask, bakeRead, caught, fmt, length, naming, none, posesOf, prebuildBuilds, show, standWorld, stepAt, sub,
  type JsonObject, type Planted, type PoseSample, type V3,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[4];
const STEPS = stepAt(1);
const OUTPUT = 'box_pose';
const MM = 0.001;
const level = (centre?: V3): JsonObject => standWorld(0, centre, { outputs: { [OUTPUT]: { from: 'box', read: 'pose' } } });

/** The output's samples with no field and with it, and the judge's failures, each naming the output. */
function judge(planted?: Planted): { failures: string[]; bare: PoseSample[]; low: PoseSample[] } {
  const [without, written] = ask([bakeRead(level(), STEPS, ['box']), bakeRead(level(LOW), STEPS, ['box'])], planted);
  const low = posesOf(written, OUTPUT, STEPS + 1, 'the box at rest with centre_of_mass (0, −0.75, 0)');
  const bare = posesOf(without, OUTPUT, STEPS + 1, 'the box at rest with no centre_of_mass');
  const worst = low.map((p, k) => ({ k, off: length(sub(p.pos, bare[k]!.pos)) })).reduce((w, x) => (x.off > w.off ? x : w));
  console.log(`${planted ? `planted ${planted}: ` : ''}${OUTPUT} reads ${show(low[worst.k]!.pos)} with centre_of_mass (0, −0.75, 0) and ${show(bare[worst.k]!.pos)} with none at step ${worst.k}, ${fmt(worst.off)} m apart, the most of ${STEPS + 1} frames`);
  const failures = worst.off <= MM ? [] : [`${OUTPUT}: reads a position ${fmt(worst.off)} m from the one it reads with no centre_of_mass at step ${worst.k} (${show(low[worst.k]!.pos)} against ${show(bare[worst.k]!.pos)}), not the same within 1 mm`];
  return { failures, bare, low };
}

describe(`${ID} a pose output reads the body's own origin, with centre_of_mass written or not`, () => {
  it(`${ID} the box at rest on level ground reads the same pose position with and without centre_of_mass, within 1 mm`, () => {
    const { failures, bare } = judge();
    const moved = Math.max(...bare.map((p) => length(sub(p.pos, bare[0]!.pos))));
    expect(moved, 'the box with no centre_of_mass is at rest: its pose stays within 1 mm of where it was built').toBeLessThanOrEqual(MM);
    none(failures, 'the pose output with and without centre_of_mass');
  }, TIMEOUT);

  it(`${ID} (twin: pose_reads_centre_of_mass) an output that reads the centre of mass reads a position 0.75 m lower and fails, naming the output`, () => {
    const { failures, bare, low } = judge('pose_reads_centre_of_mass');
    caught(failures, 'pose_reads_centre_of_mass');
    naming(failures, /^box_pose: /, 'pose_reads_centre_of_mass\'s failure names the output');
    none(low.flatMap((p, k) => {
      const d = sub(p.pos, bare[k]!.pos);
      return Math.abs(d[1] - LOW[1]) <= MM && Math.hypot(d[0], d[2]) <= MM ? [] : [`step ${k}: the planted output reads ${show(p.pos)} against ${show(bare[k]!.pos)} with no centre_of_mass, not 0.75 m lower within 1 mm`];
    }), 'the planted output reads the centre of mass, 0.75 m under the origin');
  }, TIMEOUT);
});
