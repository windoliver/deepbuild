// #185.2a8a1971: every canvas module the R2 build holds here names its interface and implementation, and that
// set seals: those the canvas modules task (#137) lays out, scene3d's Map's 3D and effects' shipped operators
// (#64), and cells (#95); and a test build with two GPU backends for macOS, two implementations of seam.gpu@1,
// is refused at the seal, naming the interface.
// The R2 build is `deep-show --features r2`; what each module names is read from deep://schedule's
// `interfaces` (README: The surface under test). At the base the plan names no interface, and the
// test-gpu-second-backend feature doesn't exist.
import { describe, expect, it } from 'vitest';
import { SEMVER, published, startupRefusal, useBuilds, useEvidence, type Build } from './helpers.ts';

const R2: Build = { set: 'r2' };
const TWO_GPU: Build = { set: 'core', with: ['test-gpu-second-backend'] };
/** The R2 canvas modules the criterion names: #137's (#388's core and r1 lists), scene3d and effects (#64), and cells (#95). */
const NAMED = ['cells', 'data', 'effects', 'graph', 'look', 'marks2d', 'motion', 'record', 'scene3d', 'sheet', 'text'];

const builds = useBuilds(process.platform === 'darwin' ? [R2, TWO_GPU] : [R2]);
const evidence = useEvidence();

describe('#185.2a8a1971 every R2 canvas module names its interface and implementation and the set seals; two GPU backends for macOS are refused at the seal', () => {
  it('#185.2a8a1971 the R2 build seals, and deep://schedule names each of its canvas modules\' interface, with its digest, and the implementation the build chose: the shipped module, its interface\'s bit and canonical reference', () => {
    const p = published(builds.bin(R2), evidence());
    expect([p.registry.state, p.registry.build_set], 'the R2 build seals').toEqual(['sealed', 'r2']);
    expect(p.registry.modules, 'the R2 build holds the canvas modules the criterion names').toEqual(expect.arrayContaining(NAMED));
    for (const m of p.registry.modules) {
      const named = Object.values(p.interfaces).filter((i) => i.module === m);
      expect(named.map((i) => i.name), `${m} implements exactly one interface the plan names`).toHaveLength(1);
      const i = named[0]!;
      const impl = i.implementation;
      expect(impl.name.length, `${m}: ${i.name} names the implementation the build chose`).toBeGreaterThan(0);
      expect(impl.version, `${m}: its implementation's version is semver`).toMatch(SEMVER);
      for (const [crate, pin] of Object.entries(impl.pins)) expect(pin.version, `${m}: its pin of ${crate} names a version`).not.toBe('');
      expect(i.reference, `${m} is ${i.name}'s reference implementation`).toBe(impl.name);
      expect([impl.equivalence, impl.state], `${m}: a shipped module other than physics is bit and canonical`).toEqual(['bit', 'canonical']);
      expect(i.digest, `${m}: ${i.name}'s digest is the module's own digest`).toBe(p.registry.digests[m]);
    }
  }, 600_000);

  it('#185.2a8a1971 a test build with two GPU backends for macOS, two implementations of seam.gpu@1, is refused at the seal, naming the interface', (ctx) => {
    if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: the GPU seam's macOS backends build only on macOS, and this is ${process.platform}`);
    const refusal = startupRefusal(builds.bin(TWO_GPU));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('two_implementations');
    expect(refusal.interface, 'the refusal names the interface').toBe('seam.gpu@1');
    expect(refusal.implementations.length, `the refusal names both GPU backends: ${JSON.stringify(refusal.raw)}`).toBe(2);
  }, 600_000);
});
