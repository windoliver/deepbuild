// #2306.b6a098d0: "The same car, braked at 4,000 N, parked with its centre 2.5 m from the pivot of a level 10 m beam of
// 200 kg hinged at its middle to the world with limits of ±15°: the beam's hinge reads 15° toward the car within 0.1° by
// 0.5 s and at every step after. The planted wrapper leaves it at 0° and fails, naming the beam"
//
// The beam (README: The fixtures, the beam) runs along z, its middle hinged to the world about x by `pivot`, limits
// ±15°; the car, heading +Z, is set down settled on it with its centre 2.5 m from the pivot on the +z side, and a brake of
// 4,000 N is stamped at step 0. Baked 3 s. The hinge's reading is its output `tilt` (joint_coordinate, deg, #523's
// readings); "toward the car" is read from the beam's own pose, its +z end below the pivot, so the reading's sign
// convention is the program's. From step 60 (0.5 s) to the last, the reading's size must be 15° within 0.1° with the beam
// tipped toward the car. `controller_as_is` pushes nothing down on the beam, so the balanced beam stays level.
import { describe, expect, it } from 'vitest';
import {
  BEAM_HALF, CRITERIA, PIVOT_Y, TIMEOUT, ask, bakeOf, beamWorld, bodyOf, brake, caught, fmt, naming, none, prebuild, readingsOf, stepAt,
  worldPoint, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const BY = stepAt(0.5);
const RUN = stepAt(3);
const LIMIT = 15;

/** The hinge's reading at every step, and the judge's failures. */
function tipped(planted?: Planted): { failures: string[]; angles: number[] } {
  const [r] = ask([bakeOf(beamWorld(), RUN, [brake(0, 4000)], ['kart', 'beam'])], planted, 'the car parked on the beam');
  const angles = readingsOf(r!, 'tilt', RUN + 1, 'the car parked on the beam').map((s) => s.value);
  const beam = bodyOf(r, 'beam', RUN, 'the car parked on the beam');
  const off: string[] = [];
  for (let k = BY; k <= RUN; k++) {
    const toward = worldPoint(beam[k]!, [0, 0, BEAM_HALF])[1] < PIVOT_Y;
    if (!(Math.abs(Math.abs(angles[k]!) - LIMIT) <= 0.1 && toward)) off.push(`${fmt(angles[k]!)}° at step ${k}${toward ? '' : ', tipped away from the car or level'}`);
  }
  const failures = off.length ? [`beam: its hinge pivot reads ${off[0]} (${off.length} of steps ${BY} to ${RUN} off), not 15° toward the car within 0.1° from 0.5 s on`] : [];
  return { failures, angles };
}

describe(`${ID} a parked car tips a balanced beam to its limit`, () => {
  it(`${ID} the beam's hinge reads 15° toward the car within 0.1° by 0.5 s and at every step after`, () => {
    none(tipped().failures, 'the beam\'s hinge from 0.5 s on');
  }, TIMEOUT);

  it(`${ID} (twin: controller_as_is) the planted wrapper leaves the beam at 0° and fails, naming the beam`, () => {
    const { failures, angles } = tipped('controller_as_is');
    caught(failures, 'controller_as_is');
    naming(failures, /^beam: /, 'controller_as_is\'s failure names the beam');
    const most = Math.max(...angles.map(Math.abs));
    expect(most, `the planted wrapper leaves the beam at 0° (its hinge reads at most ${fmt(most)}°, within 0.1°)`).toBeLessThanOrEqual(0.1);
  }, TIMEOUT);
});
