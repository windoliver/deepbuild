// AC3 #959.7485f12b: "A cloaked unit stays unseen until a detect sensor comes within its decloak radius of 4 cells, and
// is seen at that step on every copy; a structure seen at step 100 and out of sight from step 200 stays a ghost at its
// step-100 position until its cell is seen again at step 400, when the ghost row clears; a planted cloak that ignores
// the decloak radius stays unseen at that step and fails, naming the unit and the step, and a planted ghost that clears
// when a radar cell covers it fails, naming the row"
//
// Through `deep-logic first_party` and `bake` (README: The surface). A flat 128 × 128 m plate, side 0 (player 1)
// watching side 1 (player 2), one bake of 402 steps (fixtures.ts: cloakPlan), a rebuild over 1 step so a cell's state
// at a step is the rows' at that step (README: Readings: 100, 200 and 400 leave different remainders by 3).
// - The cloak, in the west: side 0's eye sees the cells of a cloaked unit (unit 0, decloak radius 4 sight cells) and of
//   a plain one (unit 1) from step 0. Side 0's detect sensor starts 47.5 m from the cloaked unit and comes 1 m a step
//   nearer: 4.0625 cells away at step 15, 3.9375 at step 16.
// - The ghost, in the east: a structure (unit 2, kind 7) at (36, 20). Side 0's eye there is placed at step 100, taken
//   away at step 200 and placed again at step 400. The structure's row is emptied at step 250 (destroyed out of
//   sight), and side 0's radar covers its cell from step 300.
// Asserted: every fog cell, seen bit, blip bit and ghost row at every step equals the reference's; and, from the
// criterion's own numbers, player 1's bit of the cloaked unit is clear through step 15 and set at step 16, the plain
// unit's set throughout; the structure is seen at step 100, not from step 200; ghost row 4 (unit 2, side 0) holds a
// ghost at (36, 20) of kind 7 at every step from 200 to 399, through the structure's end and the radar, and none
// before 200 or from 400.
// The wrong programs: sense_cloak_ignores_radius@1 (the cloaked unit stays unseen at step 16: the judgement names unit
// 0 and step 16) and sense_ghost_clears_on_radar@1 (the ghost is gone at step 300: the judgement names row 4).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild } from '../190/helpers.ts';
import { CLOAK, GHOST, cloakParams, cloakPlan, flatPlate } from './fixtures.ts';
import { AC, IFACE, bakeAndJudge, findSense, type Fixture, type Judged } from './helpers.ts';
import { RADAR, gridsOf, stateOf } from './model.ts';

prebuild(() => { logicBin(); });

const fixture = (): Fixture => ({ plate: flatPlate(), params: cloakParams(), plan: cloakPlan() });
/** The ghost row of the structure for side 0: unit × sides + side. */
const ROW = GHOST.unit * 2 + 0;
let shipped: Judged | undefined;
const onShipped = (): Judged => (shipped ??= bakeAndJudge(fixture(), findSense().sense!, GHOST.steps, `the cloak and the ghost on ${findSense().sense!.ref.name}`));
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
const present = (): void => {
  const found = findSense();
  expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
};

describe(`${AC[3]} a cloak a detect sensor lifts, and a last-seen ghost`, () => {
  it(`${AC[3]} a cloaked unit stays unseen until a detect sensor comes within its decloak radius of 4 cells and is seen at that step; a structure seen at step 100 and out of sight from step 200 stays a ghost at its place until its cell is seen again at step 400`, () => {
    present();
    const j = onShipped();
    expect(j.misses.map((m) => m.message), 'every fog cell, seen bit, blip bit and ghost row at every step is the reference\'s').toEqual([]);
    const out = (k: number) => j.want[k]!.out;
    // The cloak: player 1's bit, step by step. The plain unit beside it shows the cell is in sight all along.
    const one = (k: number, unit: number): number => out(k).seen[unit]! & 1;
    expect(range(0, 40).map((k) => one(k, CLOAK.units.cloaked)), `player 1 doesn't see the cloaked unit through step ${CLOAK.within - 1} and sees it from step ${CLOAK.within}, the step the detect sensor comes within ${CLOAK.radius} cells`)
      .toEqual(range(0, 40).map((k) => (k < CLOAK.within ? 0 : 1)));
    expect(range(0, 40).map((k) => one(k, CLOAK.units.plain)), 'player 1 sees the plain unit beside it at every step').toEqual(range(0, 40).map(() => 1));
    expect(range(0, 40).map((k) => out(k).seen[CLOAK.units.cloaked]! & 2), 'its own side (player 2) sees the cloaked unit throughout').toEqual(range(0, 40).map(() => 2));
    // The ghost.
    const steps = range(0, GHOST.steps);
    expect(steps.filter((k) => one(k, GHOST.unit) === 1), `player 1 sees the structure from step ${GHOST.seenAt} to step ${GHOST.lostAt - 1}`).toEqual(range(GHOST.seenAt, GHOST.lostAt));
    expect(steps.filter((k) => out(k).ghost[ROW] !== 0), `ghost row ${ROW} holds a ghost from step ${GHOST.lostAt} to step ${GHOST.seenAgainAt - 1}, and none at step ${GHOST.seenAgainAt}`).toEqual(range(GHOST.lostAt, GHOST.seenAgainAt));
    const held = range(GHOST.lostAt, GHOST.seenAgainAt).map((k) => [out(k).ghost[ROW], out(k).ghostPos[2 * ROW], out(k).ghostPos[2 * ROW + 1], out(k).ghostKind[ROW]].join(' '));
    expect([...new Set(held)], `the ghost is player 1's, at the structure's place (${GHOST.at.join(', ')}) and of its kind ${GHOST.kind}, at every one of those steps`).toEqual([`1 ${GHOST.at[0]} ${GHOST.at[1]} ${GHOST.kind}`]);
    // The structure is gone from step 250 and a radar cell covers the ghost from step 300: neither clears it.
    const fc = gridsOf(fixture().plate, fixture().params).fc;
    const cell = (k: number): number => stateOf(out(k).fog[GHOST.cell[1] * fc + GHOST.cell[0]]!, 1);
    expect([out(GHOST.destroyedAt).seen[GHOST.unit], cell(GHOST.radarAt - 1), cell(GHOST.radarAt), cell(GHOST.seenAgainAt - 1)], `the structure's row is empty from step ${GHOST.destroyedAt}, and its cell reads radar for player 1 from step ${GHOST.radarAt}`).toEqual([0, 0, RADAR, RADAR]);
    expect(steps.filter((k) => out(k).ghost.some((g, r) => g !== 0 && r !== ROW)), 'no other ghost row is ever held').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a planted cloak that ignores the decloak radius stays unseen at that step and fails, naming the unit and the step`, () => {
    present();
    expect(onShipped().misses.map((m) => m.message), 'the reference library passes the judgement the planted one fails').toEqual([]);
    const wrong = bakeAndJudge(fixture(), 'cloakAlways', GHOST.steps, 'the cloak on sense_cloak_ignores_radius@1').misses;
    expect(wrong.length, 'the judgement fails the cloak that ignores the decloak radius').toBeGreaterThan(0);
    const first = wrong[0]!;
    expect([first.array, first.unit, first.step, first.expected, first.actual], `it leaves the cloaked unit unseen by player 1 at step ${CLOAK.within}: ${first.message}`).toEqual(['seen', CLOAK.units.cloaked, CLOAK.within, '0b11', '0b10']);
    for (const named of [`unit ${CLOAK.units.cloaked}`, `step ${CLOAK.within}`]) expect(first.message, `the failure names ${named}`).toContain(named);
  }, TIMEOUT);

  it(`${AC[3]} a planted ghost that clears when a radar cell covers it fails, naming the row`, () => {
    present();
    expect(onShipped().misses.map((m) => m.message), 'the reference library passes the judgement the planted one fails').toEqual([]);
    const wrong = bakeAndJudge(fixture(), 'ghostRadar', GHOST.steps, 'the ghost on sense_ghost_clears_on_radar@1').misses;
    expect(wrong.length, 'the judgement fails the ghost that clears under radar').toBeGreaterThan(0);
    const first = wrong[0]!;
    expect([first.array, first.row, first.step, first.actual], `its ghost is gone at step ${GHOST.radarAt}, when the radar covers its cell: ${first.message}`).toEqual(['ghost', ROW, GHOST.radarAt, 'no ghost']);
    expect(first.message, 'the failure names the row').toContain(`ghost row ${ROW}`);
  }, TIMEOUT);
});
