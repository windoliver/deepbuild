// AC2 #959.9f68d843: "A unit inside a radar sensor's range and inside an enemy jammer's range stays unseen on the
// radar side's grid, and becomes `radar` the step after the jammer dies; a planted jammer that clears its own side's
// radar fails, naming the cell and the side"
//
// Through `deep-logic first_party` and `bake` (README: The surface). A flat 128 × 128 m plate (fixtures.ts: jamPlan):
// side 0 (player 1) has a radar at (−20, 0) of range 40 m; side 1 (players 2 and 3) has a jammer at (10, 0) of range
// 24 m and a radar of its own at (20, 10) of range 16 m, inside its jammer's range. Unit 0 (side 1) stands at (6, 2),
// inside side 0's radar and inside its own side's jammer; unit 1 (side 1) at (−30, 20), inside the radar and outside
// the jammer; unit 2 (side 0) at (20, 12), inside side 1's radar and inside side 1's jammer. The jammer's row is live
// through step 5 and gone from step 6. The fixture asks a rebuild over 1 step, so a cell's state at a step is the
// rows' at that step (README: Readings).
// Asserted: every fog cell, seen bit and blip bit at every step equals the reference's; and, from the fixture's own
// numbers, the cell holding unit 0 reads unseen for player 1 through step 5 and radar from step 6, while a cell in the
// radar and outside the jammer reads radar throughout (the radar and the jammer each change a cell the check reads),
// and unit 0 becomes a blip, never seen.
// The wrong program: sense_jams_own_side@1 (programs.ts: libraryText({jamOwn: true})), whose jammer clears every
// side's radar in its range: the cells of side 1's own radar read unseen for side 1 while its jammer lives, and the
// same judgement fails on it naming the cell and side 1.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { JAM, flatPlate, jamParams, jamPlan } from './fixtures.ts';
import { AC, IFACE, bakeAndJudge, findSense, type Fixture, type Judged } from './helpers.ts';
import { RADAR, UNSEEN, gridsOf, stateOf } from './model.ts';

prebuild(() => { logicBin(); });

const fixture = (): Fixture => ({ plate: flatPlate(), params: jamParams(), plan: jamPlan() });
const STEPS = Array.from({ length: JAM.steps }, (_, k) => k);
let shipped: Judged | undefined;
const jamOnShipped = (): Judged => (shipped ??= bakeAndJudge(fixture(), findSense().sense!, JAM.steps, `the jammer on ${findSense().sense!.ref.name}`));

describe(`${AC[2]} radar that an enemy jammer clears, and only an enemy's`, () => {
  it(`${AC[2]} a unit inside a radar's range and an enemy jammer's stays unseen on the radar side's grid, and becomes radar the step after the jammer dies`, () => {
    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    const j = jamOnShipped();
    expect(j.misses.map((m) => m.message), 'every fog cell, seen bit and blip bit at every step is the reference\'s').toEqual([]);
    // The criterion's own values, read from the reference the library equals: player 1 is the radar side.
    const fc = gridsOf(fixture().plate, fixture().params).fc;
    const state = (k: number, cell: readonly [number, number], player: number): number => stateOf(j.want[k]!.out.fog[cell[1] * fc + cell[0]]!, player);
    const after = JAM.dies + 1;
    expect(STEPS.map((k) => state(k, JAM.jammedCell, 1)), `the jammed unit's cell (${JAM.jammedCell.join(', ')}) is unseen for player 1 through step ${JAM.dies}, the jammer's last, and radar from step ${after}`)
      .toEqual(STEPS.map((k) => (k < after ? UNSEEN : RADAR)));
    expect(STEPS.map((k) => state(k, JAM.clearCell, 1)), `a cell in the radar's range and outside the jammer's, (${JAM.clearCell.join(', ')}), reads radar at every step`).toEqual(STEPS.map(() => RADAR));
    expect(STEPS.map((k) => [state(k, JAM.ownCell, 2), state(k, JAM.ownCell, 3)]), `side 1's own radar, under its own jammer, reads radar for both of its players at cell (${JAM.ownCell.join(', ')})`).toEqual(STEPS.map(() => [RADAR, RADAR]));
    // Radar shows a blip, never the unit: its seen bits stay its own side's (players 2 and 3).
    const u = JAM.units.jammed;
    expect(STEPS.map((k) => [j.want[k]!.out.seen[u], j.want[k]!.out.blip[u]]), `unit ${u} is never seen by player 1, and is its blip from step ${after}`).toEqual(STEPS.map((k) => [6, k < after ? 0 : 1]));
  }, TIMEOUT);

  it(`${AC[2]} a planted jammer that clears its own side's radar fails, naming the cell and the side`, () => {
    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    expect(jamOnShipped().misses.map((m) => m.message), 'the reference library passes the judgement the planted one fails').toEqual([]);
    const wrong = bakeAndJudge(fixture(), 'jamOwn', JAM.steps, 'the jammer on sense_jams_own_side@1').misses;
    expect(wrong.length, 'the judgement fails the jammer that clears its own side\'s radar').toBeGreaterThan(0);
    const fog = wrong.filter((m) => m.array === 'fog');
    expect(fog.length > 0 && fog.every((m) => m.side === 1 && m.expected === 'radar' && m.actual === 'unseen' && m.step <= JAM.dies), `every wrong cell is one side 1's own radar holds, cleared while its jammer lives: ${fog.slice(0, 3).map((m) => m.message).join('; ')}`).toBe(true);
    const first = fog[0]!;
    expect(first.message, 'the failure names the cell').toContain(`fog cell (${first.cell!.join(', ')})`);
    expect(first.message, 'and the side').toContain('for side 1');
  }, TIMEOUT);
});
