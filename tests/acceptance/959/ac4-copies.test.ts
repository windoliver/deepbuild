// AC4 #959.5f8a3deb: "300 units with eye sensors on a 1,025² plate, rebuilt over 3 steps at 30 Hz, pass logic.budget
// with `on: [app, web]` (the step ceiling from the bake's fuel, Logic: work across steps, so every machine fails the
// same step) at every step, and two copies agree on every grid and every seen bit at each hash interval; a planted
// rebuild over 1 step fails logic.budget on the web, naming the step and the ceiling"
//
// This file holds the two copies (ac4-budget.test.ts holds logic.budget and the planted rebuild). Through `deep-show
// run`'s `match` (#549's, #550's and #552's: every copy of a document's match in one process over the test relay, no
// view drawn, so no GPU). The piece (docs.ts: fleetDoc) is the same fleet: its logic item `sense` at 30 Hz links the
// first-party reference library by name and hash and calls `sight` through sense.lib@1; its net item plays two players
// in lockstep at 30 Hz with a full-state hash every 10 match steps. The match runs 41 steps.
// Asserted: both copies run every step and end nowhere; each reports a full-state hash at steps 0, 10, 20, 30 and 40,
// the same on both copies at each, and no two alike (the units drift, so each hash is of another state); every fog cell
// and seen bit in every step row of each copy is the reference's, so the copies agree on every grid and every seen bit;
// and from one hash step to the next the grid changes, and by steps 30 and 40 so do seen bits.
import { describe, expect, it } from 'vitest';
import { logicBin, prebuild } from '../190/helpers.ts';
import { FULL, Script, TIMEOUT, matchCall, pairOf, playedOnFailures, presented, putEvidence, run, scenario, useBuilds, useChildren, useTemp } from '../552/helpers.ts';
import { DOC, fleetDoc } from './docs.ts';
import { FLEET, fleetParams, fleetPlan, ridgePlate } from './fixtures.ts';
import { AC, IFACE, findSense, misses, type Fixture } from './helpers.ts';
import { runPlan } from './model.ts';

prebuild(() => { logicBin(); });
const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

const fixture = (): Fixture => ({ plate: ridgePlate(), params: fleetParams(), plan: fleetPlan() });
const HASH_STEPS = Array.from({ length: Math.floor((FLEET.matchSteps - 1) / FLEET.hashEvery) + 1 }, (_, i) => i * FLEET.hashEvery);
const differing = (a: Int32Array, b: Int32Array): number => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

describe(`${AC[4]} two copies of the fleet agree on every grid and every seen bit`, () => {
  it(`${AC[4]} two copies agree on every grid and every seen bit at each hash interval`, async () => {
    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    const f = fixture();
    // The states the hashes are of change: the reference's grid differs from one hash step to the next, and its seen bits by the later ones.
    const want = runPlan(f.plate, f.params, f.plan, FLEET.matchSteps);
    const moved = HASH_STEPS.slice(1).map((k) => [differing(want[k]!.out.fog, want[k - FLEET.hashEvery]!.out.fog) > 0, differing(want[k]!.out.seen, want[k - FLEET.hashEvery]!.out.seen) > 0]);
    expect(moved.map((m) => m[0]), 'the grid changes between every two hash steps').toEqual(moved.map(() => true));
    expect(moved.filter((m) => m[1]).length, 'seen bits change between hash steps too').toBeGreaterThan(0);

    const evidence = temp();
    const made = fleetDoc(f, found.sense!.ref);
    for (const bytes of made.evidence) putEvidence(evidence, bytes);
    const s = new Script();
    const shown = s.present(DOC.fleet, made.document);
    const m = s.add(matchCall(DOC.fleet, FLEET.matchSteps, { relay: { seed: 959 } }));
    const r = await run(builds.show(), scenario(evidence, [{ id: DOC.fleet, size: [640, 360] }], s.calls), 'AC4 the fleet\'s match');
    presented(r[shown], 'AC4: the fleet piece');
    const [one, two] = pairOf(r[m], 'AC4');
    expect(playedOnFailures([one, two], FLEET.matchSteps, 'AC4'), 'both copies play every step of the match').toEqual([]);
    expect([one.hashes.map((h) => h.step), two.hashes.map((h) => h.step)], `each copy reports a full-state hash every ${FLEET.hashEvery} match steps`).toEqual([HASH_STEPS, HASH_STEPS]);
    expect(one.hashes.map((h) => h.hash), 'the two copies\' full-state hashes agree at every hash step').toEqual(two.hashes.map((h) => h.hash));
    expect(new Set(one.hashes.map((h) => h.hash)).size, 'each hash is of another state').toBe(HASH_STEPS.length);
    for (const c of [one, two]) {
      const rows = Array.isArray(c.raw['steps']) ? c.raw['steps'] : [];
      expect(misses(rows, want, f, `copy ${c.player}`).map((x) => x.message), `every fog cell and seen bit of copy ${c.player}, at every step, is the reference's`).toEqual([]);
    }
  }, TIMEOUT);
});
