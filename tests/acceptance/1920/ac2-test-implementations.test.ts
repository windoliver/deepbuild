// #1920.73d8b8e7: with the canvas interfaces task's test implementations A and B of test.sim@1 (#185), the runtime
// digest of a build with B changes when B's version moves from 1.0.0 to 1.0.1 and when one of its pins changes a
// feature, and stays the same when A's version moves in a build with A whose kit fixtures still give the reference
// hashes; a planted seal that hashes only registered shapes gives B's two versions one digest and fails this,
// naming B.
//
// The surface is `deep-show run` (README: The surface under test): #185's test builds `core,test-sim-a` (A: bit,
// canonical, test.sim@1's reference) and `core,test-sim-b` (B: measured, backend_bytes), this suite's
// `core,test-sim-b-1-0-1`, `core,test-sim-b-pin-feature` and `core,test-sim-a-1-0-1`, each one's published plan with
// its `runtime_digest`; the `fixtures`, `deep_show` and `eval` calls for a build's kit fixtures and their hashes;
// and the startup argument `--planted runtime_digest_hashes_only_shapes`.
//
// The wrong program each test fails on:
// 1. a digest that covers B's name but not its version; one over registered shapes: one digest for B's two
//    versions. And a digest that isn't over what the plan names, in either build.
// 2. a digest that reads pins' versions but not their features; one without the pins; one of names only: one
//    digest for both builds.
// 3. a digest that covers every implementation: it moves with A, which is bit and canonical. And a build with A
//    whose kit fixtures don't give the reference's hashes: the judge of those hashes fails B's build, whose results
//    are a hair off A's.
// 4. the criterion's planted seal: the judge that passes the real seal's two versions of B fails its two, naming
//    test.sim@1 and B.
// At the base `core,test-sim-a` and `core,test-sim-b` build and seal, their plans carry no runtime_digest, this
// suite's three test features don't exist (cargo refuses each build) and the planted name is unknown.
import { describe, expect, it } from 'vitest';
import {
  A, AC2, B, HASHES_ONLY_SHAPES, SIM, SIM_MODULE, WRONG_SEALS, buildName, judgeCovers, judgeFollows, judgeReferenceHashes, kitFixtureHashes,
  planDifferences, published, sealOf, sorted, theInterface, underWrongSeal, useBuilds, useEvidence, type Build, type Published,
  type Seal,
} from './helpers.ts';

/** #185's builds: A alone and B alone, each at version 1.0.0. */
const A_100: Build = { set: 'core', with: ['test-sim-a'] };
const B_100: Build = { set: 'core', with: ['test-sim-b'] };
/** This suite's: each is that implementation with one change, built in its place (README: Names this suite chooses). */
const A_101: Build = { set: 'core', with: ['test-sim-a-1-0-1'] };
const B_101: Build = { set: 'core', with: ['test-sim-b-1-0-1'] };
const B_PIN_FEATURE: Build = { set: 'core', with: ['test-sim-b-pin-feature'] };
const VERSION = `interfaces/${SIM}/implementation/version`;

const bin = useBuilds([A_100, B_100, A_101, B_101, B_PIN_FEATURE]);
const evidence = useEvidence();
const plan = (build: Build, planted?: string): Published => published(bin(build), buildName(build), evidence(), planted);
/** The build's digest is over what its plan names: the d1 digest of the implementations it must cover, those of `only`. */
function covers(seal: Seal, only: string[]): void {
  const judged = judgeCovers(seal, only);
  expect(judged.ok, judged.why).toBe(true);
}
/** What the plan says of test.sim@1's implementation: its name, version, equivalence and state. */
function sim(p: Published): string[] {
  const i = theInterface(p, SIM);
  expect([i.module, i.reference], `${p.what}: ${SIM} is the canvas module ${SIM_MODULE}'s, and A is its reference`).toEqual([SIM_MODULE, A]);
  return [i.implementation.name, i.implementation.version, i.implementation.equivalence, i.implementation.state];
}

describe(`${AC2} the runtime digest moves with B, measured with backend_bytes state, and never with A, bit and canonical`, () => {
  it(`${AC2} in a build with B, the runtime digest changes when B's version moves from 1.0.0 to 1.0.1`, () => {
    const b100 = plan(B_100);
    const a = sealOf(b100);
    const b101 = plan(B_101);
    expect(sim(b100), 'the first build holds B at 1.0.0, measured with backend_bytes state').toEqual([B, '1.0.0', 'measured', 'backend_bytes']);
    expect(sim(b101), 'the second holds B at 1.0.1').toEqual([B, '1.0.1', 'measured', 'backend_bytes']);
    expect(planDifferences(b100, b101), 'only B\'s version moves: the runtime digest apart, the two published plans differ there and nowhere else').toEqual([VERSION]);
    const b = sealOf(b101);
    const real = judgeFollows(a, b);
    expect([real.ok, real.moved], `B's two versions give two runtime digests: ${real.why}`).toEqual([true, true]);
    expect(real.names, 'the difference names test.sim@1 and B').toEqual([{ interface: SIM, implementation: B }]);
    covers(a, [SIM]);
    covers(b, [SIM]);
    // The same judge on the digests of seals blind to a version: one digest for both, and it fails, naming B.
    for (const name of ['names_only', 'only_shapes'] as const) {
      const wrong = judgeFollows(underWrongSeal(name, a), underWrongSeal(name, b));
      expect([wrong.ok, wrong.moved], `the judge fails a seal that ${WRONG_SEALS[name].what}, which gives B's two versions one digest: ${wrong.why}`).toEqual([false, false]);
      expect(wrong.names, 'and that failure names B').toEqual([{ interface: SIM, implementation: B }]);
    }
  }, 600_000);

  it(`${AC2} in a build with B, the runtime digest changes when one of B's pins changes a feature`, () => {
    const changed = plan(B_PIN_FEATURE);
    const b100 = plan(B_100);
    expect(sim(changed), 'the test build holds B at 1.0.0, measured with backend_bytes state').toEqual([B, '1.0.0', 'measured', 'backend_bytes']);
    const [before, after] = [theInterface(b100, SIM).implementation.pins, theInterface(changed, SIM).implementation.pins];
    const moved = Object.keys(before).filter((crate) => sorted(before[crate]!.features).join(',') !== sorted(after[crate]?.features ?? []).join(','));
    expect(moved.length, `exactly one of B's pins (${Object.keys(before).join(', ') || 'none'}) changes a feature; these do: ${moved.join(', ') || 'none'}`).toBe(1);
    expect(planDifferences(b100, changed), 'only that pin\'s features change: the runtime digest apart, the two published plans differ there and nowhere else').toEqual([`interfaces/${SIM}/implementation/pins/${moved[0]}/features`]);
    const [a, b] = [sealOf(b100), sealOf(changed)];
    const real = judgeFollows(a, b);
    expect([real.ok, real.moved], `the pin's changed feature gives another runtime digest: ${real.why}`).toEqual([true, true]);
    expect(real.names, 'the difference names test.sim@1 and B').toEqual([{ interface: SIM, implementation: B }]);
    covers(a, [SIM]);
    covers(b, [SIM]);
    // The same judge on the digests of seals blind to a pin's features: one digest for both, and it fails, naming B.
    for (const name of ['pin_versions_only', 'without_pins', 'names_only'] as const) {
      const wrong = judgeFollows(underWrongSeal(name, a), underWrongSeal(name, b));
      expect([wrong.ok, wrong.moved], `the judge fails a seal that ${WRONG_SEALS[name].what}, which gives both builds one digest: ${wrong.why}`).toEqual([false, false]);
      expect(wrong.names, 'and that failure names B').toEqual([{ interface: SIM, implementation: B }]);
    }
  }, 600_000);

  it(`${AC2} the runtime digest stays the same when A's version moves in a build with A whose kit fixtures still give the reference's hashes`, () => {
    // The judge of kit fixture hashes, first on real input it must fail: B is measured, and its results aren't A's bits.
    const reference = kitFixtureHashes(bin(A_100), buildName(A_100), evidence(), SIM_MODULE);
    const measured = judgeReferenceHashes(reference.hashes, kitFixtureHashes(bin(B_100), buildName(B_100), evidence(), SIM_MODULE).hashes);
    expect(measured.ok, `the judge fails B's build, whose kit fixtures don't give the reference's hashes: ${measured.why}`).toBe(false);
    expect(measured.why, 'naming a fixture and an operator of the module').toMatch(/^fixture \S+: test\.sim\.\S+ /);

    const movedBin = bin(A_101);
    const [a100, a101] = [plan(A_100), plan(A_101)];
    expect(sim(a100), 'the first build holds A at 1.0.0, bit and canonical').toEqual([A, '1.0.0', 'bit', 'canonical']);
    expect(sim(a101), 'the second holds A at 1.0.1, still bit and canonical').toEqual([A, '1.0.1', 'bit', 'canonical']);
    // That build's kit fixtures still give the reference's hashes: A at 1.0.0 is test.sim@1's reference.
    const moved = kitFixtureHashes(movedBin, buildName(A_101), evidence(), SIM_MODULE);
    expect(moved.documents, 'the build with A at 1.0.1 holds the kit fixtures the reference\'s build holds').toEqual(reference.documents);
    const same = judgeReferenceHashes(reference.hashes, moved.hashes);
    expect(same.ok, `the kit fixtures of the build with A at 1.0.1 give the reference's hashes: ${same.why}`).toBe(true);

    // The runtime digest stays: nothing in a build with A is measured or keeps backend bytes.
    expect(planDifferences(a100, a101), 'only A\'s version moves: the runtime digest apart, the two published plans differ there and nowhere else').toEqual([VERSION]);
    const [a, b] = [sealOf(a100), sealOf(a101)];
    expect(b.digest, 'the runtime digest stays the same when A\'s version moves').toBe(a.digest);
    const real = judgeFollows(a, b);
    expect([real.ok, real.moved], real.why).toEqual([true, false]);
    covers(a, []);
    covers(b, []);
    // The same judge on the digests of a seal that covers every implementation: it moves with A, and the judge fails, naming A.
    const wrong = judgeFollows(underWrongSeal('covers_every_implementation', a), underWrongSeal('covers_every_implementation', b));
    expect([wrong.ok, wrong.moved], `the judge fails a seal that ${WRONG_SEALS.covers_every_implementation.what}, whose digest moves with A: ${wrong.why}`).toEqual([false, true]);
    expect(wrong.names, 'and that failure names A').toEqual([{ interface: SIM, implementation: A }]);
  }, 600_000);

  it(`${AC2} the planted seal that hashes only registered shapes gives B's two versions one digest and fails this, naming B`, () => {
    const planted100 = plan(B_100, HASHES_ONLY_SHAPES);
    const planted101 = plan(B_101, HASHES_ONLY_SHAPES);
    const [b100, b101] = [plan(B_100), plan(B_101)];

    // The real seal: two digests, and the judge passes, naming B.
    const real = judgeFollows(sealOf(b100), sealOf(b101));
    expect([real.ok, real.moved], `the real seal gives B's two versions two digests: ${real.why}`).toEqual([true, true]);
    expect(real.names, 'naming test.sim@1 and B').toEqual([{ interface: SIM, implementation: B }]);

    // The planted seal changes nothing else the plan publishes.
    expect(planDifferences(b100, planted100), 'the runtime digest apart, the planted seal publishes the plan of the build with B at 1.0.0 unchanged').toEqual([]);
    expect(planDifferences(b101, planted101), 'the runtime digest apart, the planted seal publishes the plan of the build with B at 1.0.1 unchanged').toEqual([]);
    // It gives B's two versions one digest, and the same judge fails it, naming B.
    const [a, b] = [sealOf(planted100), sealOf(planted101)];
    expect(b.digest, 'the planted seal gives B\'s two versions one digest').toBe(a.digest);
    const planted = judgeFollows(a, b);
    expect(planted.ok, `the judge fails the planted seal: ${planted.why}`).toBe(false);
    expect(planted.names, 'its failure names test.sim@1 and B').toEqual([{ interface: SIM, implementation: B }]);
    expect(planted.why, 'in words too').toContain(`${SIM}'s implementation ${B}`);
    const covers = judgeCovers(a, [SIM]);
    expect(covers.ok, `and its digest isn't over B's version and pins: ${covers.why}`).toBe(false);
  }, 600_000);
});
