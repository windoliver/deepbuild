// #1920.d626ec86: the physics module names physics@1 and its implementation, declared measured with backend_bytes
// state, and the shipped set seals with it; the runtime digest covers the physics implementation and its pins and
// nothing else; a test build that changes only Rapier's pinned patch version changes it, naming physics@1; and a
// planted seal that leaves the physics implementation out of the runtime digest gives both builds one digest and
// fails this.
//
// The surface is `deep-show run` (README: The surface under test): the `full` build and the test build
// `full,test-physics-rapier-patch`, each one's `registry` reply and the plan it publishes at deep://schedule, whose
// `interfaces` name each implementation and whose `runtime_digest` is the seal's; and the startup argument
// `--planted runtime_digest_omits_physics`.
//
// The wrong program each test fails on:
// 1. a shipped set without the physics module (the base); a physics module declared bit or canonical; a Rapier pin
//    off 0.36.1; an implementation that isn't physics@1's reference.
// 2. a digest that covers every implementation; one that covers the implementation's name but not its version or
//    its pins; one without the pins; one that reads the pins' versions but not their features; one over registered
//    shapes; one that leaves physics out; the module-set digest published in its place (a digest that isn't over
//    what the plan names); a physics module declared bit and canonical.
// 3. a digest blind to a pin's version (names only, no pins, shapes only, physics left out): one digest for both
//    builds; and a test build that changes more than Rapier's pinned version.
// 4. the criterion's planted seal: the judge that passes the real seal's two builds fails its two, naming physics@1
//    and its implementation.
// At the base the full set holds no physics module, its plan carries no runtime_digest, the test feature doesn't
// exist (cargo refuses the build) and the planted name is unknown.
import { describe, expect, it } from 'vitest';
import {
  AC1, OMITS_PHYSICS, PHYSICS, PHYSICS_MODULE, RAPIER, RAPIER_VERSION, WRONG_SEALS, buildName, declared, judgeCovers, judgeFollows,
  planDifferences, published, sealOf, str, theInterface, underWrongSeal, useBuilds, useEvidence, withDigest, type Build, type Published,
  type WrongSeal,
} from './helpers.ts';

/** The shipped set that holds every canvas module, the physics module among them. */
const FULL: Build = { set: 'full' };
/** The same set with only Rapier's pinned patch version changed (README: Names this suite chooses). */
const RAPIER_PATCH: Build = { set: 'full', with: ['test-physics-rapier-patch'] };
const RAPIER_PIN = `interfaces/${PHYSICS}/implementation/pins/${RAPIER}/version`;

const bin = useBuilds([FULL, RAPIER_PATCH]);
const evidence = useEvidence();
const plan = (build: Build, planted?: string): Published => published(bin(build), buildName(build), evidence(), planted);
/** A pin's version as cargo writes an exact requirement (`=0.36.1`) or as resolved (`0.36.1`). */
const exact = (version: string): string => version.replace(/^=/, '');

describe(`${AC1} the physics module seals as physics@1's measured, backend_bytes implementation, and the runtime digest covers it, its pins and nothing else`, () => {
  it(`${AC1} the shipped full set seals with the physics module, which names physics@1 and its implementation, declared measured with backend_bytes state and pinning Rapier 0.36.1`, () => {
    const p = plan(FULL);
    expect([p.buildSet, p.state], 'the full build seals').toEqual(['full', 'sealed']);
    expect(p.modules, 'the full build holds the canvas module physics').toContain(PHYSICS_MODULE);
    const physics = theInterface(p, PHYSICS);
    expect(physics.module, `${PHYSICS} is the physics module's interface`).toBe(PHYSICS_MODULE);
    expect(physics.reference, `the physics module's implementation (${physics.implementation.name}) is ${PHYSICS}'s reference implementation`).toBe(physics.implementation.name);
    expect([physics.implementation.equivalence, physics.implementation.state], 'it is declared measured with backend_bytes state').toEqual(['measured', 'backend_bytes']);
    const pin = physics.implementation.pins[RAPIER];
    expect(pin, `its pins name ${RAPIER}; they name ${Object.keys(physics.implementation.pins).join(', ') || 'none'}`).toBeDefined();
    expect(exact(pin!.version), `it pins Rapier at ${RAPIER_VERSION}`).toBe(RAPIER_VERSION);
  }, 600_000);

  it(`${AC1} the runtime digest published with the sealed plan covers the physics implementation and its pins and nothing else`, () => {
    const p = plan(FULL);
    const seal = sealOf(p);
    const real = judgeCovers(seal, [PHYSICS]);
    expect(real.ok, real.why).toBe(true);
    // The same judge on what each wrong seal would publish for this plan: it must fail every one.
    for (const name of Object.keys(WRONG_SEALS) as WrongSeal[]) {
      const wrong = judgeCovers(underWrongSeal(name, seal), [PHYSICS]);
      expect(wrong.ok, `the judge fails the digest of a seal that ${WRONG_SEALS[name].what}: ${wrong.why}`).toBe(false);
    }
    const notOverThePlan = judgeCovers(withDigest(seal, str(p.schedule['set_digest'], 'schedule.set_digest')), [PHYSICS]);
    expect(notOverThePlan.ok, `the judge fails the module-set digest published as the runtime digest: ${notOverThePlan.why}`).toBe(false);
    const declaredBit = judgeCovers(declared(seal, PHYSICS, 'bit', 'canonical'), [PHYSICS]);
    expect(declaredBit.ok, `the judge fails a physics module declared bit and canonical: ${declaredBit.why}`).toBe(false);
    expect(declaredBit.why, 'and that failure names physics@1').toContain(PHYSICS);
  }, 600_000);

  it(`${AC1} a test build that changes only Rapier's pinned patch version changes the runtime digest, naming physics@1`, () => {
    const patched = plan(RAPIER_PATCH);
    const shipped = plan(FULL);
    const [before, after] = [theInterface(shipped, PHYSICS), theInterface(patched, PHYSICS)];
    expect(exact(before.implementation.pins[RAPIER]?.version ?? ''), `the shipped build pins Rapier at ${RAPIER_VERSION}`).toBe(RAPIER_VERSION);
    const moved = exact(after.implementation.pins[RAPIER]?.version ?? '');
    expect(moved, 'the test build pins a Rapier 0.36 patch').toMatch(/^0\.36\.\d+$/);
    expect(moved, `the test build pins another patch than ${RAPIER_VERSION}`).not.toBe(RAPIER_VERSION);
    expect(planDifferences(shipped, patched), 'the test build changes only Rapier\'s pinned version: the runtime digest apart, the two published plans differ there and nowhere else').toEqual([RAPIER_PIN]);

    const [a, b] = [sealOf(shipped), sealOf(patched)];
    const real = judgeFollows(a, b);
    expect([real.ok, real.moved], `the test build's runtime digest is another one: ${real.why}`).toEqual([true, true]);
    expect(real.names, 'the difference names physics@1 and its implementation').toEqual([{ interface: PHYSICS, implementation: after.implementation.name }]);
    const covers = judgeCovers(b, [PHYSICS]);
    expect(covers.ok, covers.why).toBe(true);
    // The same judge on the digests of seals blind to a pin's version: one digest for both builds, and it fails.
    for (const name of ['names_only', 'without_pins', 'only_shapes', 'omits_physics'] as const) {
      const wrong = judgeFollows(underWrongSeal(name, a), underWrongSeal(name, b));
      expect([wrong.ok, wrong.moved], `the judge fails a seal that ${WRONG_SEALS[name].what}, which gives both builds one digest: ${wrong.why}`).toEqual([false, false]);
      expect(wrong.names.map((n) => n.interface), 'and that failure names physics@1').toEqual([PHYSICS]);
    }
  }, 600_000);

  it(`${AC1} the planted seal that leaves the physics implementation out of the runtime digest gives both builds one digest and fails this, naming physics@1's implementation`, () => {
    const plantedShipped = plan(FULL, OMITS_PHYSICS);
    const plantedPatched = plan(RAPIER_PATCH, OMITS_PHYSICS);
    const [shipped, patched] = [plan(FULL), plan(RAPIER_PATCH)];
    const implementation = theInterface(patched, PHYSICS).implementation.name;

    // The real seal: two digests, and the judge passes, naming physics@1.
    const real = judgeFollows(sealOf(shipped), sealOf(patched));
    expect([real.ok, real.moved], `the real seal gives the two builds two digests: ${real.why}`).toEqual([true, true]);
    expect(real.names, 'naming physics@1 and its implementation').toEqual([{ interface: PHYSICS, implementation }]);

    // The planted seal changes nothing else the plan publishes.
    expect(planDifferences(shipped, plantedShipped), 'the runtime digest apart, the planted seal publishes the full build\'s plan unchanged').toEqual([]);
    expect(planDifferences(patched, plantedPatched), 'the runtime digest apart, the planted seal publishes the test build\'s plan unchanged').toEqual([]);
    // It gives both builds one digest, and the same judge fails it, naming physics@1 and its implementation.
    const [a, b] = [sealOf(plantedShipped), sealOf(plantedPatched)];
    expect(b.digest, 'the planted seal gives both builds one digest').toBe(a.digest);
    const planted = judgeFollows(a, b);
    expect(planted.ok, `the judge fails the planted seal: ${planted.why}`).toBe(false);
    expect(planted.names, 'its failure names physics@1 and its implementation').toEqual([{ interface: PHYSICS, implementation }]);
    expect(planted.why, 'in words too').toContain(`${PHYSICS}'s implementation ${implementation}`);
    const covers = judgeCovers(a, [PHYSICS]);
    expect(covers.ok, `and its digest doesn't cover the physics implementation: ${covers.why}`).toBe(false);
  }, 600_000);
});
