// Criterion 5: "Six vehicles given 500 seeded random tasks between 20 bays over 8 simulated hours: `lanes.clear` and
// `lanes.stuck` pass at every step, and no vehicle's footprint centre is ever more than 0.05 m off its graph, as the
// geometry audit (#405) measures."
//
// Through `deep-logic first_party` and `judge` (README: The surface): the fleet scene (scenes.ts: FLEET), a one-way
// loop round a 75 m square with 20 spur bays, six of them the vehicles' park bays, at 2 Hz for 8 hours (57,600 steps:
// motion is worked in closed form within a step, so a coarse step loses no position, and 2 Hz keeps the run to minutes
// on a loaded machine). The 500 tasks are seeded (scenes.ts: fleetLegs), two legs each between the 14 work bays, task t
// to vehicle t mod 6, each vehicle home to its park bay at the end. The judge evaluates both rules at every step and
// the audit's on_graph measure, the largest distance of any vehicle's centre from its graph's paths. The scene is built
// so that no correct library can be stuck in it: each spur is one zone, so no vehicle enters a held spur, and the loop
// holds at least two zones between junctions, so a vehicle leaving a spur never waits on one waiting to enter the next.
// Exercise: every leg is sent and every vehicle is home at the end, so the run did the 500 tasks. The wrong program
// shown failing the audit: the same run with vehicle 0's written position moved 0.06 m in x and y after each step.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { AC, INTERFACE, carry, gap, judgeCall, judged, lanes, layout, piece, rule } from './helpers.ts';
import { fleetProgram, lanesWrites } from './programs.ts';
import { FLEET, FLEET_STEPS, FLEET_TASKS, STATE, TOL, bayNames, fleetLegs, fleetParks, unreachableBays, zonesOf } from './scenes.ts';

prebuild(() => { logicBin(); });

const writes = lanesWrites(6, { next: { type: 'i32', count: 6 } });

/** The scene's own guarantees, from its zones: every spur one zone, at least two loop zones between junctions, every bay reached. */
function sceneHolds(): void {
  const z = zonesOf(FLEET);
  expect(z.junctions.length, '20 junctions, one per spur').toBe(20);
  expect(z.paths.filter((p) => p.path.startsWith('s')).every((p) => p.zones.length === 1), 'each spur is one zone').toBe(true);
  // Along the loop, from one junction to the next, through any corner between them.
  let between = 0;
  const counts: number[] = [];
  for (const p of z.paths.filter((x) => x.path.startsWith('l'))) {
    between += p.zones.length;
    if (p.endJunction) { counts.push(between); between = 0; }
  }
  counts[0]! += between;
  expect(Math.min(...counts), 'at least two loop zones between consecutive junctions').toBeGreaterThanOrEqual(2);
  expect(unreachableBays(FLEET), 'every bay is reached from another').toEqual([]);
  expect(bayNames(FLEET).length, '20 bays').toBe(20);
}

describe(`${AC[5]} six vehicles over eight seeded hours`, () => {
  it(`${AC[5]} six vehicles given 500 seeded random tasks between 20 bays over 8 simulated hours: lanes.clear and lanes.stuck pass at every step, and no footprint centre is ever more than 0.05 m off its graph`, () => {
    sceneHolds();
    const legs = fleetLegs(), parks = fleetParks();
    expect(legs.reduce((n, l) => n + (l.length - 1) / 2, 0), '500 tasks of two legs each').toBe(FLEET_TASKS);
    expect(legs.every((l, v) => l[l.length - 1] === parks[v] && l.slice(0, -1).every((b, i) => !parks.includes(b) && b !== (i ? l[i - 1] : parks[v]))), 'legs between work bays, none to where the vehicle is, each list ending home').toBe(true);

    const L = lanes();
    const program = fleetProgram(INTERFACE, layout(writes), legs, parks);
    const p = piece({ fleet: { program, writes, scene: FLEET, checkpoint: 3600 * FLEET.rate, links: [L.ref] } }, [], carry({ ...L.assets }, program));
    const [reply] = onHost([judgeCall(p, FLEET_STEPS)]);
    const j = judged(reply!, 'fleet');
    for (const code of ['lanes.clear', 'lanes.stuck']) {
      const r = rule(j, code);
      expect([r.verdict, r.steps, r.fails.slice(0, 5)], `${code} passes at every one of the ${FLEET_STEPS} steps`).toEqual(['PASS', FLEET_STEPS, []]);
    }
    expect(j.audit.max, `no centre is more than 0.05 m off the graph (largest ${j.audit.max} m, vehicle ${j.audit.vehicle} at step ${j.audit.step})`).toBeLessThanOrEqual(0.05);
    // Exercise: all 500 tasks were done, every vehicle back home.
    expect(j.last['next'], 'every leg was sent').toEqual(legs.map((l) => l.length));
    const pos = j.last['pos']! as number[][], state = j.last['state']!;
    parks.forEach((b, v) => {
      expect(gap(pos[v]!, FLEET.bays[bayNames(FLEET)[b]!]!), `vehicle ${v} is home at ${bayNames(FLEET)[b]} after 8 hours`).toBeLessThanOrEqual(TOL);
      expect(state[v], `vehicle ${v} is parked`).toBe(STATE.parked);
    });
  }, TIMEOUT);

  it(`${AC[5]} the audit measures a vehicle off its graph: the same run with vehicle 0 written 0.06 m off is over 0.05 m, naming it`, () => {
    const L = lanes();
    const program = fleetProgram(INTERFACE, layout(writes), fleetLegs(), fleetParks(), true);
    const p = piece({ fleet: { program, writes, scene: FLEET, links: [L.ref] } }, [], carry({ ...L.assets }, program));
    const [reply] = onHost([judgeCall(p, 200)]);
    const j = judged(reply!, 'fleet');
    expect([j.audit.max > 0.05, j.audit.vehicle], `the audit's largest distance is past 0.05 m and names vehicle 0: ${JSON.stringify(j.audit)}`).toEqual([true, 0]);
  }, TIMEOUT);
});
