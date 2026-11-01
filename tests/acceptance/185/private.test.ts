// #185.ade96791: a test implementation B of test.sim@1 that renames one of its arrays marked private seals with
// test.sim@1's digest unchanged, while the same rename of a public array is refused at the seal, naming test.sim@1
// and the array; a test module c that reads B's private array is refused at the seal, naming the array, B and c;
// and a planted digest that hashes private arrays refuses the first B and fails this, naming the array.
// B marks test.sim.scratch private and test.sim.pos public; the renames are their own Cargo features, and the
// planted digest is the startup argument `--planted digest_hashes_private` (README: Names this suite chooses).
// At the base none of the features exists, so cargo refuses each build.
import { describe, expect, it } from 'vitest';
import {
  B, C_MODULE, POS, POS_RENAMED, SCRATCH, SCRATCH_RENAMED, SIM, SIM_MODULE, published, startupRefusal, theInterface, useBuilds, useEvidence, type Build,
} from './helpers.ts';

const ONLY_B: Build = { set: 'core', with: ['test-sim-b'] };
const PRIVATE_RENAMED: Build = { set: 'core', with: ['test-sim-b-private-renamed'] };
const PUBLIC_RENAMED: Build = { set: 'core', with: ['test-sim-b-public-renamed'] };
const WITH_C: Build = { set: 'core', with: ['test-sim-b', 'test-sim-c'] };

const builds = useBuilds([ONLY_B, PRIVATE_RENAMED, PUBLIC_RENAMED, WITH_C]);
const evidence = useEvidence();

describe('#185.ade96791 a private array stays out of test.sim@1\'s digest and is read only by its owner', () => {
  it('#185.ade96791 B with its private array test.sim.scratch renamed test.sim.scratch2 seals with test.sim@1\'s digest unchanged', () => {
    const before = published(builds.bin(ONLY_B), evidence());
    const after = published(builds.bin(PRIVATE_RENAMED), evidence());
    expect(before.registry.arrays[SCRATCH]?.['visibility'], `B registers ${SCRATCH}, marked private`).toBe('private');
    expect(after.registry.state, 'the renamed B seals').toBe('sealed');
    expect(after.registry.arrays[SCRATCH_RENAMED]?.['visibility'], `the renamed B registers ${SCRATCH_RENAMED}, marked private`).toBe('private');
    expect(after.registry.arrays[SCRATCH], `and no longer registers ${SCRATCH}`).toBeUndefined();
    const ib = theInterface(before, SIM, 'the B build');
    const ir = theInterface(after, SIM, 'the renamed B build');
    expect(ir.implementation.name, 'the renamed build chose B').toBe(B);
    expect(ir.digest, 'test.sim@1\'s digest is unchanged by the private rename').toBe(ib.digest);
    expect(after.registry.digests[SIM_MODULE], 'and so is the module\'s digest').toBe(before.registry.digests[SIM_MODULE]);
  }, 600_000);

  it('#185.ade96791 the same rename of the public array test.sim.pos to test.sim.pos2 is refused at the seal, naming test.sim@1 and the array', () => {
    const refusal = startupRefusal(builds.bin(PUBLIC_RENAMED));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('interface_digest');
    expect(refusal.interface, 'the refusal names the interface').toBe(SIM);
    expect(refusal.arrays.filter((a) => a === POS || a === POS_RENAMED), `the refusal names the renamed public array: ${JSON.stringify(refusal.raw)}`).not.toEqual([]);
  }, 600_000);

  it('#185.ade96791 a test module c that reads B\'s private array test.sim.scratch is refused at the seal, naming the array, B and c', () => {
    const refusal = startupRefusal(builds.bin(WITH_C));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('private_read');
    expect(refusal.arrays, 'the refusal names the private array').toEqual([SCRATCH]);
    const named = [...refusal.modules, ...refusal.implementations];
    expect(named, `the refusal names the reader, c: ${JSON.stringify(refusal.raw)}`).toContain(C_MODULE);
    expect(named, `the refusal names the owner, B: ${JSON.stringify(refusal.raw)}`).toContain(B);
  }, 600_000);

  it('#185.ade96791 a planted digest that hashes private arrays refuses the B with its private array renamed, naming the array, so the private-rename proof fails on it', () => {
    const refusal = startupRefusal(builds.bin(PRIVATE_RENAMED), 'digest_hashes_private');
    expect(refusal.interface, `the planted digest refuses B, naming test.sim@1: ${JSON.stringify(refusal.raw)}`).toBe(SIM);
    expect(refusal.arrays.filter((a) => a === SCRATCH || a === SCRATCH_RENAMED), `the refusal names the private array: ${JSON.stringify(refusal.raw)}`).not.toEqual([]);
  }, 600_000);
});
