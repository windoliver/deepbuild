// #399.7d35b13d (scope): "The data, graph and vector modules' interfaces `data@1`, `graph@1` and `vector@1` (#185):
// each manifest names its implementation, and each conformance kit is every part of the canvas kit (#138) on that
// module's fixtures, with no behavior part, so each seals only bit, canonical implementations; a planted graph
// implementation declared bit whose layered layout breaks a tie by registration order instead of by ID, a planted data
// implementation whose m4 decimation drops each column's last row, and a planted vector implementation that maps
// `currentColor` to ink instead of through `colors` each fail the kit, naming the fixture and the first field, and a
// release build refuses each; vector registers through the registry (#305) from the start, and data and graph extend
// the modules the canvas modules task (#137) laid out".
//
// `deep-show` in the shipped `full` build set, and with each of this suite's three test features (README: The kits):
// the published plan's `interfaces` (#185), the `manifest` and `kit` calls (#138), and release builds embedding the
// kit's ledger (DEEP_KIT_LEDGER at build time), whose seal refuses at startup. Release builds are slow.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_KIT, interfaceIn, kitCall, kitFailures, kitFixtures, kitModule, moduleFixtures, releaseBuild, show, showRun, startupRefusal, strings,
  useShowBuilds,
} from './helpers.ts';

const ID = '#399.7d35b13d';
const FULL = ['full'];
const PLANTS = [
  { iface: 'graph@1', module: 'graph', feature: 'test-graph-tie-by-registration', what: 'whose layered layout breaks a tie by registration order instead of by ID' },
  { iface: 'data@1', module: 'data', feature: 'test-data-m4-drops-last', what: 'whose m4 decimation drops each column\'s last row' },
  { iface: 'vector@1', module: 'vector', feature: 'test-vector-currentcolor-ink', what: 'that maps currentColor to ink instead of through colors' },
] as const;
const builds = useShowBuilds([FULL, ...PLANTS.map((p) => ['full', p.feature])]);
let dir = '';
let evidence = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-399-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
beforeEach(() => { evidence = mkdtempSync(join(tmpdir(), 'deep-399-ev-')); });
afterEach(() => { if (evidence) rmSync(evidence, { recursive: true, force: true }); evidence = ''; });

describe(`${ID} data@1, graph@1 and vector@1 sealed with their kits`, () => {
  it(`${ID} the shipped data, graph and vector modules are the bit, canonical references of their interfaces, whose kits are every part of the canvas kit with no behavior part, and each passes on its own fixtures`, () => {
    const [schedule, manifest, kit] = showRun(builds.bin(FULL), evidence, [{ call: 'schedule' }, { call: 'manifest' }, kitCall({ modules: ['data', 'graph', 'vector'] })]);
    for (const { iface, module } of PLANTS) {
      const i = interfaceIn(schedule!, iface);
      // Vector seals through the registry like the others; data and graph are the modules #137 laid out, by name.
      expect(i.module, `${iface} is implemented by the canvas module ${module}`).toBe(module);
      expect(i.implementation.name.length, `${iface}: the manifest names its implementation`).toBeGreaterThan(0);
      expect(i.implementation.version, `${iface}: the implementation has a semver version`).toMatch(/^\d+\.\d+\.\d+/);
      expect(i.reference, `${iface}: the shipped implementation is its reference`).toBe(i.implementation.name);
      expect([i.implementation.equivalence, i.implementation.state], `${iface}: bit and canonical`).toEqual(['bit', 'canonical']);
      expect(i.behavior, `${iface} holds no behavior part`).toBe('none');
      expect(CANVAS_KIT.filter((p) => !i.kit.includes(p)), `${iface}'s kit lists every part of the canvas kit: ${show(i.kit)}`).toEqual([]);

      const m = kitModule(kit!, module);
      expect(m.digest, `the kit tests ${module} at ${iface}'s digest`).toBe(i.digest);
      expect(m.parts.map((p) => p.part).filter((p) => !i.kit.includes(p)), `every part run on ${module} is one ${iface}'s kit lists`).toEqual([]);
      for (const p of m.parts) {
        expect(p.ran === p.declared && p.cases.length > 0, `${module}.${p.part} ran every case it declares, at least one (${p.ran} of ${p.declared})`).toBe(true);
        expect(p.verdict, `${module}.${p.part} passes: ${show(p.failures, 1200)}`).toBe('PASS');
      }
      const own = moduleFixtures(manifest!, module);
      expect(own.length, `${module} has fixtures of its own`).toBeGreaterThan(0);
      const fixturesRun = new Set(m.parts.find((p) => p.part === 'fixtures')?.cases.map((c) => String(c['fixture'])) ?? []);
      expect(own.filter((f) => !fixturesRun.has(f)), `the fixtures part ran each of ${module}'s own fixtures`).toEqual([]);
      expect(m.verdict, `${module} passes ${iface}'s kit: ${show(kitFailures(m), 1500)}`).toBe('PASS');
    }
  }, 7_200_000);

  for (const plant of PLANTS) {
    it(`${ID} a planted ${plant.iface} implementation declared bit ${plant.what} fails the kit, naming the fixture and the first field, and a release build refuses it`, () => {
      const features = ['full', plant.feature];
      const ledger = join(dir, `${plant.module}-ledger.json`);
      const [schedule, manifest, alone, whole] = showRun(builds.bin(features), evidence, [{ call: 'schedule' }, { call: 'manifest' }, kitCall({ modules: [plant.module] }), kitCall({ ledger })]);
      const i = interfaceIn(schedule!, plant.iface);
      expect(i.implementation.equivalence, 'the planted implementation declares bit').toBe('bit');
      expect(i.implementation.name, 'the build chose the planted implementation, not the reference').not.toBe(i.reference);

      const m = kitModule(alone!, plant.module);
      expect(m.verdict, `the planted implementation fails the ${plant.iface} kit`).toBe('FAIL');
      const own = new Set(moduleFixtures(manifest!, plant.module));
      const ran = kitFixtures(m);
      // A kit that takes bit on trust, or names no fixture or field, fails here.
      const named = kitFailures(m).filter((f) => typeof f['fixture'] === 'string' && ran.has(f['fixture']) && own.has(f['fixture']) && typeof f['field'] === 'string' && f['field'] !== '');
      expect(named.length, `a failure names one of ${plant.module}'s fixtures the kit ran and the first field that differs: ${show(kitFailures(m).slice(0, 5), 2000)}`).toBeGreaterThan(0);
      expect(kitModule(whole!, plant.module).verdict, `the whole kit records ${plant.module} FAIL in its ledger`).toBe('FAIL');

      expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
      const release = releaseBuild(features, ledger, dir);
      expect(release.error, 'the release build compiles').toBe('');
      const refusal = startupRefusal(release.bin, evidence);
      expect(strings(refusal), `the release build refuses the planted implementation, naming ${plant.iface}: ${show(refusal)}`).toContain(plant.iface);
      expect(strings(refusal['modules']), `and naming the module ${plant.module}`).toContain(plant.module);
    }, 7_200_000);
  }
});
