// #185.f6c38595: two test implementations of test.sim@1, A (bit and canonical, the reference) and B (measured
// with backend_bytes state), each seal alone with the same interface digest; a build with both is refused at
// startup, naming test.sim@1, A and B; and a B whose one registered array changes type from f32 to f64 is
// refused at the seal, naming test.sim@1 and that array, though the same B with the array unchanged seals.
// Each implementation is a test canvas module behind its own Cargo feature (README: Names this suite chooses).
// At the base none of the features exists, so cargo refuses each build.
import { describe, expect, it } from 'vitest';
import { A, B, POS, SIM, SIM_MODULE, published, sorted, startupRefusal, theInterface, useBuilds, useEvidence, type Build } from './helpers.ts';

const ONLY_A: Build = { set: 'core', with: ['test-sim-a'] };
const ONLY_B: Build = { set: 'core', with: ['test-sim-b'] };
const BOTH: Build = { set: 'core', with: ['test-sim-a', 'test-sim-b'] };
const B_F64: Build = { set: 'core', with: ['test-sim-b-f64'] };

const builds = useBuilds([ONLY_A, ONLY_B, BOTH, B_F64]);
const evidence = useEvidence();

describe('#185.f6c38595 two implementations of test.sim@1 seal alone with one interface digest, never together, and a changed array type is refused at the seal', () => {
  it('#185.f6c38595 A (bit, canonical, the reference) and B (measured, backend_bytes) each seal alone in a test build, and deep://schedule names test.sim@1 with the same digest and the implementation each build chose', () => {
    const a = published(builds.bin(ONLY_A), evidence());
    const b = published(builds.bin(ONLY_B), evidence());
    for (const [what, p] of [['the A build', a], ['the B build', b]] as const) {
      expect(p.registry.state, `${what} is sealed`).toBe('sealed');
      expect(p.registry.modules, `${what} holds the canvas module ${SIM_MODULE}`).toContain(SIM_MODULE);
    }
    const ia = theInterface(a, SIM, 'the A build');
    const ib = theInterface(b, SIM, 'the B build');
    expect([ia.implementation.name, ia.implementation.equivalence, ia.implementation.state], 'the A build chose A, bit and canonical').toEqual([A, 'bit', 'canonical']);
    expect([ib.implementation.name, ib.implementation.equivalence, ib.implementation.state], 'the B build chose B, measured with backend_bytes state').toEqual([B, 'measured', 'backend_bytes']);
    expect([ia.reference, ib.reference], 'A is test.sim@1\'s reference implementation in both builds').toEqual([A, A]);
    expect([ia.module, ib.module], 'both implement test.sim@1 as the canvas module test.sim').toEqual([SIM_MODULE, SIM_MODULE]);
    expect(ib.digest, 'A and B seal with the same interface digest').toBe(ia.digest);
    expect(a.registry.digests[SIM_MODULE], 'the A build\'s module digest is its interface\'s digest').toBe(ia.digest);
    expect(b.registry.digests[SIM_MODULE], 'the B build\'s module digest is its interface\'s digest').toBe(ib.digest);
  }, 600_000);

  it('#185.f6c38595 a build with both A and B is refused at startup, naming test.sim@1, A and B', () => {
    const refusal = startupRefusal(builds.bin(BOTH));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('two_implementations');
    expect(refusal.interface, 'the refusal names the interface').toBe(SIM);
    expect(sorted(refusal.implementations), 'the refusal names both implementations').toEqual([A, B]);
  }, 600_000);

  it('#185.f6c38595 a B whose one registered array test.sim.pos changes type from f32 to f64 is refused at the seal, naming test.sim@1 and that array, though the same B with the array unchanged seals', () => {
    const refusal = startupRefusal(builds.bin(B_F64));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('interface_digest');
    expect(refusal.interface, 'the refusal names the interface').toBe(SIM);
    expect(refusal.arrays, 'the refusal names the array whose type changed, the first shape that differs').toEqual([POS]);
    const unchanged = published(builds.bin(ONLY_B), evidence());
    expect(unchanged.registry.state, 'the same B with test.sim.pos still f32 seals').toBe('sealed');
    expect(unchanged.registry.arrays[POS]?.['type'], 'and registers test.sim.pos as f32').toBe('f32');
  }, 600_000);
});
