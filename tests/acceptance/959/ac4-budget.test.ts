// AC4 #959.5f8a3deb: "300 units with eye sensors on a 1,025² plate, rebuilt over 3 steps at 30 Hz, pass logic.budget
// with `on: [app, web]` (the step ceiling from the bake's fuel, Logic: work across steps, so every machine fails the
// same step) at every step, and two copies agree on every grid and every seen bit at each hash interval; a planted
// rebuild over 1 step fails logic.budget on the web, naming the step and the ceiling"
//
// This file holds the budget half, through `deep-logic first_party`, `about`, `bake` and `budget` (README: logic.budget);
// ac4-copies.test.ts holds the two copies. The fleet (fixtures.ts: fleetPlan): 300 units, each with an eye of range 27 m
// 2 m above its ground, two sides of 150, on the ridge plate (1,025 × 1,025 samples), each drifting half a metre a
// step; a rebuild over 3 steps; the item steps at 30 Hz in a `data_view` piece (README: Readings: the only frame CPU
// whose web ceiling at 30 Hz lies under the fuel one step may spend).
// Asserted on the reference library, over 12 steps (four rebuilds): every fog cell and seen bit equals the reference's;
// logic.budget on [app, web] with fuel_share 1 gives no failure, and its verdict is PASS or BLOCKED on the web's timed
// run alone (#546: the base's reply from fuel alone); the item is held, pipelined, to twice the 2 ms class's ceiling on
// each host, from `about`'s ns per fuel unit; and every step's fuel in the bake is at or under both ceilings.
// The wrong program: sense_rebuilds_in_one_step@1 (programs.ts: libraryText({spreadOne: true})), which rebuilds every
// row at every call. On the same piece logic.budget reads FAIL with a ceiling failure on host web at step 0 naming the
// web ceiling, and none on host app.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild, show } from '../190/helpers.ts';
import { FLEET, fleetParams, fleetPlan, ridgePlate } from './fixtures.ts';
import { AC, FUEL_CAP, IFACE, ITEM, bakeCall, budgetCall, budgetOf, findSense, fuelOf, judge, piece, run, type Fixture } from './helpers.ts';

prebuild(() => { logicBin(); });

const fixture = (): Fixture => ({ plate: ridgePlate(), params: fleetParams(), plan: fleetPlan() });
/** The budget class: 2 ms of frame CPU (Budget classes: data view). */
const CLASS = 'data_view';
const FRAME_NS = 2_000_000;
/** A pipelined item's ceiling on a host (#546): twice ⌊frame CPU × 3/4 ÷ ⌈60 ÷ 60⌉ ÷ ns per fuel unit⌋. */
const ceilingOf = (ns: number): number => 2 * Math.floor((FRAME_NS * 0.75) / 1 / ns);
interface Ceilings { app: number; web: number }
function ceilings(about: Record<string, unknown>): Ceilings {
  const ns = about['ns_per_fuel'] as { app?: unknown; web?: unknown } | undefined;
  expect([typeof ns?.app, typeof ns?.web], `about gives the ns per fuel unit on each host: ${show(about as never)}`).toEqual(['number', 'number']);
  const c = { app: ceilingOf(ns!.app as number), web: ceilingOf(ns!.web as number) };
  expect(c.web < FUEL_CAP, `the web ceiling of a 30 Hz item in a ${CLASS} piece, ${c.web}, lies under the fuel one step may spend, ${FUEL_CAP}, so a step can pass it`).toBe(true);
  return c;
}
const present = (): void => {
  const found = findSense();
  expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
};

describe(`${AC[4]} 300 eyes rebuilt over 3 steps within the step ceiling on the app and on the web`, () => {
  it(`${AC[4]} 300 units with eye sensors on a 1,025² plate, rebuilt over 3 steps at 30 Hz, pass logic.budget on [app, web] at every step`, () => {
    const f = fixture();
    expect([f.plan.units, f.plan.sensors, f.plate.cols, f.plate.rows, f.params.spread], '300 units, 300 eyes, a 1,025 × 1,025 plate, a rebuild over 3 steps').toEqual([300, 300, 1025, 1025, 3]);
    present();
    const p = piece(f, findSense().sense!, { class: CLASS, stepRate: FLEET.rate });
    const [about, baked, budget] = run([{ call: 'about' }, bakeCall(p, FLEET.budgetSteps), budgetCall(p, FLEET.budgetSteps)]);
    const want = ceilings(about!);
    // What the budget judges is the sight the criterion names: every grid and seen bit is the reference's.
    const j = judge(baked!, f, FLEET.budgetSteps, 'the fleet on the reference library');
    expect(j.misses.map((m) => m.message), 'every fog cell and seen bit at every step is the reference\'s').toEqual([]);
    const b = budgetOf(budget!, 'logic.budget on the fleet');
    expect([b.cls, b.pipelined, b.ceiling], `logic.budget holds the item, pipelined at 30 Hz in a ${CLASS} piece, to twice the class's ceiling on each host`).toEqual([CLASS, true, want]);
    expect(b.failures, 'logic.budget on [app, web] fails no step').toEqual([]);
    expect([b.verdict === 'PASS' || b.verdict === 'BLOCKED', b.blocked.filter((h) => h !== 'web')], `its verdict is PASS, or BLOCKED on the web's timed run alone: ${b.verdict}, blocked ${b.blocked.join(', ')}`).toEqual([true, []]);
    const fuel = fuelOf(baked!);
    expect(fuel.map((x) => x.step), `the bake holds the fuel of each of ${FLEET.budgetSteps} steps`).toEqual(Array.from({ length: FLEET.budgetSteps }, (_, k) => k));
    const over = fuel.filter((x) => !(x.fuel <= want.web && x.fuel <= want.app));
    expect(over, `every step's fuel is at or under the web ceiling ${want.web} and the app ceiling ${want.app}`).toEqual([]);
    expect(Math.min(...fuel.map((x) => x.fuel)) > 0, 'every step spends fuel').toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} a planted rebuild over 1 step fails logic.budget on the web, naming the step and the ceiling`, () => {
    present();
    const f = fixture();
    const [about, budget] = run([{ call: 'about' }, budgetCall(piece(f, 'spreadOne', { class: CLASS, stepRate: FLEET.rate }), FLEET.budgetSteps)]);
    const want = ceilings(about!);
    const b = budgetOf(budget!, 'logic.budget on the fleet rebuilt in one step');
    expect(b.verdict, 'logic.budget fails the rebuild over 1 step').toBe('FAIL');
    const onWeb = b.failures.filter((x) => x.rule === 'ceiling' && x.host === 'web' && x.item === ITEM);
    expect(onWeb.length, `it fails the web's step ceiling: ${show(b.failures as never)}`).toBeGreaterThan(0);
    const first = onWeb[0]!;
    expect([first.step, first.ceiling], 'the failure names the step, the first, and the web ceiling').toEqual([0, want.web]);
    expect(first.fuel !== null && first.fuel > want.web, `the step it names spent ${first.fuel} fuel, over the ceiling`).toBe(true);
    expect(b.failures.filter((x) => x.rule === 'ceiling' && x.host === 'app'), 'no step passes the app ceiling').toEqual([]);
  }, TIMEOUT);
});
