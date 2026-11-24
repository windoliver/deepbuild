// AC3 #3036.4fdba809: "The physics step hashes of the roll are the same with `tracks` on and off, and a second ball
// rolled across the groove takes the path it takes without it. A planted plate that feeds its heights to the physics
// shape fails, naming the step"
//
// Fixture (helpers.ts `yardDoc`, judges.ts for its numbers), shown by the working agent through deep_show: `ground`, a
// terrain plate 16 × 6 m at 0.1 m, level at 0.5 m, with criterion 1's tracks or with none; the balls `ball` and
// `crosser` (radius 0.25 m); the world `lab` (`physics.world@1`, 120 steps a second, 5 s), whose bodies `roller` and
// `crosser` are launched rolling, the first from (−7, 0.75, 0) along +x at 3.5 m/s, the second from (−4, 0.75, −2) along
// +z at 0.8 m/s, each held to its line by its body's `locks`, and whose outputs move the drawn balls; the collection
// `rollers` holding the first ball. The first ball's groove runs along z = 0; the second crosses it at x = −4 m a
// little over 2 s in.
//
// A world's ground is a shape the world writes (Shape: `heightfield`), and the plate's own physics shape is the one
// `terrain_rays` answers `physics` from (#2014). So the roll runs on the plate's physics shape in two steps (README:
// Criterion 3):
//   1. one process shows the yard with tracks and without, each world's ground the plate as built, and reads each
//      plate's physics shape at 4.5 s: a ray straight down beside each of its 159 × 59 inner samples (13 mm and 7 mm
//      off it, inside a triangle: the base answers only about half the rays cast exactly at a sample);
//   2. another shows both again, each world's `heightfield` now holding the heights step 1 read from that document's
//      plate, and reads each bake: its step hashes and both balls' positions after every step.
//
// asserts:
//   - without tracks the physics shape lies at 0.5 m at every node, and on it the first ball rolls 10 m or more in a
//     straight line with its lowest point within 2 cm of the plate, and the second crosses its line after it has passed;
//   - the groove is drawn in the runs that have it: at 4.5 s, at 20 points along the first ball's line, the drawn
//     surface is lowered by between half the depth and the depth with tracks, and lies as built without;
//   - the roll's step hashes with tracks on are those with tracks off, step for step, and the second ball's position is
//     the same after every step;
//   - planted `tracks_feed_physics_shape`: the step hashes differ, the failure naming the first step that does, and
//     so does the second ball's path.
//
// Wrong programs this fails on (the first planted, the rest not): a plate whose physics shape takes its drawn heights;
// the base (it refuses `tracks`, so no document with tracks is shown); a plate that draws no groove (equal hashes
// would prove nothing).
import { describe, expect, it } from 'vitest';
import {
  AC, CROSSER, CROSSER_BODY, GROUND, PLANTED, ROLLER_BODY, TIMEOUT, TRACKS, WORLD, YARD_AT, bakeOf, builtHeights, docId, drawnOf, metOf, none, pathFailures,
  physicsJudgesFailTheirPlants, presented, runShow, show, stepFailures, terrainRays, useBins, useFolders, world, yardDoc, yardFailures, yardLine, yardLineFailures, yardNodes,
  type Bake, type Height, type JsonObject, type ShowPlanted,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const ON = docId(3);
const OFF = docId(4);

interface Rolls {
  /** Step 1: each plate's physics shape at its nodes, and its drawn surface along the first ball's line. */
  shapeOff: number[]; firstOn: Height[]; firstOff: Height[];
  /** Step 2: each bake, and each plate's drawn surface along the first ball's line. */
  on: Bake; off: Bake; lineOn: Height[]; lineOff: Height[];
}

/** The two steps, under a planted program or none. */
function rolls(planted?: ShowPlanted): Rolls {
  const nodes = yardNodes().probes;
  const line = yardLine();
  const probes = [...nodes, ...line];
  const first = runShow(bin('deep-show'), folder(), [ON, OFF], [
    show(ON, yardDoc('The yard, tracks on', builtHeights(), TRACKS)), terrainRays(ON, YARD_AT, probes),
    show(OFF, yardDoc('The yard, tracks off', builtHeights(), null)), terrainRays(OFF, YARD_AT, probes),
  ], planted);
  presented(first[0]!, 'the yard whose plate keeps tracks, its world on the plate as built');
  presented(first[2]!, 'the yard without tracks, its world on the plate as built');
  const shape = (reply: JsonObject, what: string): { heights: number[]; line: Height[] } => {
    const met = metOf(reply, probes, what);
    const missed = nodes.filter((_, k) => met[k]!.physics === null);
    expect(missed.slice(0, 5), `${what}: a ray straight down beside each inner sample meets the plate's physics shape (${missed.length} of ${nodes.length} met nothing)`).toEqual([]);
    return { heights: nodes.map((_, k) => met[k]!.physics!), line: drawnOf(met.slice(nodes.length), line) };
  };
  const shapeOn = shape(first[1]!, 'the plate with tracks at 4.5 s');
  const shapeOff = shape(first[3]!, 'the plate without tracks at 4.5 s');

  const second = runShow(bin('deep-show'), folder(), [ON, OFF], [
    show(ON, yardDoc('The yard, tracks on', shapeOn.heights, TRACKS)), world(ON, WORLD), terrainRays(ON, YARD_AT, line),
    show(OFF, yardDoc('The yard, tracks off', shapeOff.heights, null)), world(OFF, WORLD), terrainRays(OFF, YARD_AT, line),
  ], planted);
  presented(second[0]!, 'the yard whose plate keeps tracks, its world on that plate\'s physics shape');
  presented(second[3]!, 'the yard without tracks, its world on that plate\'s physics shape');
  const bodies = [ROLLER_BODY, CROSSER_BODY];
  return {
    shapeOff: shapeOff.heights, firstOn: shapeOn.line, firstOff: shapeOff.line,
    on: bakeOf(second[1]!, bodies, 'the roll with tracks on'), off: bakeOf(second[4]!, bodies, 'the roll with tracks off'),
    lineOn: drawnOf(metOf(second[2]!, line, 'the first ball\'s line with tracks on'), line),
    lineOff: drawnOf(metOf(second[5]!, line, 'the first ball\'s line with tracks off'), line),
  };
}

/** What both tests hold the fixture to: without tracks the roll is the one the criterion describes, and step 1's plate with tracks draws its groove while the one without draws none. */
function fixture(r: Rolls): void {
  const off = r.shapeOff.reduce((m, y) => Math.max(m, Math.abs(y - GROUND)), 0);
  expect(off, 'without tracks the plate\'s physics shape lies at 0.5 m at every node, within 1e-4 m').toBeLessThanOrEqual(1e-4);
  none(yardFailures(r.off.paths[ROLLER_BODY]!, r.off.paths[CROSSER_BODY]!), 'without tracks the first ball rolls 10 m or more in a straight line on the plate, and the second crosses its line after it');
  expect(new Set(r.off.hashes).size, 'the roll\'s step hashes change from step to step: the balls move').toBeGreaterThan(r.off.hashes.length / 2);
  none(yardLineFailures(r.firstOn, true), 'the groove is drawn in the run that has tracks: along the first ball\'s line at 4.5 s');
  none(yardLineFailures(r.firstOff, false), 'no groove is drawn in the run without tracks');
}

describe(`${AC[3]} tracks are drawing only: the physics shape reads the plate as it was built`, () => {
  it(`${AC[3]} the physics step hashes of the roll are the same with tracks on and off, and a second ball rolled across the groove takes the path it takes without it`, () => {
    physicsJudgesFailTheirPlants();
    const r = rolls();
    fixture(r);
    none(yardLineFailures(r.lineOn, true), 'the groove is drawn in the roll whose step hashes are compared');
    none(yardLineFailures(r.lineOff, false), 'and not in the roll without tracks');
    none(stepFailures(r.on.hashes, r.off.hashes), 'the roll\'s step hashes with tracks on are those with tracks off');
    none(pathFailures(CROSSER, r.on.paths[CROSSER_BODY]!, r.off.paths[CROSSER_BODY]!), 'the second ball, rolled across the groove, takes the path it takes without it');
  }, TIMEOUT);

  it(`${AC[3]} a planted plate that feeds its heights to the physics shape (${PLANTED.feedsPhysics}) fails, naming the step`, () => {
    physicsJudgesFailTheirPlants();
    const r = rolls(PLANTED.feedsPhysics);
    fixture(r);
    const steps = stepFailures(r.on.hashes, r.off.hashes);
    expect(steps.length, `under ${PLANTED.feedsPhysics} the roll's step hashes with tracks on aren't those with tracks off`).toBe(1);
    expect(steps[0], 'the failure names the step').toMatch(/^step \d+: /);
    const path = pathFailures(CROSSER, r.on.paths[CROSSER_BODY]!, r.off.paths[CROSSER_BODY]!);
    expect(path.length, `under ${PLANTED.feedsPhysics} the second ball doesn't take the path it takes without tracks`).toBe(1);
    expect(path[0], 'the failure names the step').toMatch(/^step \d+: /);
    console.log(`${AC[3]}: under ${PLANTED.feedsPhysics}: ${steps[0]}; ${path[0]}`);
  }, TIMEOUT);
});
