// #421: scene3d@1 seals only bit, canonical implementations. The shipped module passes the kit's parts on its
// fixtures; a planted implementation declared bit whose light policy breaks a tie by registration order
// instead of by ID (`test-scene3d-tie-by-order`) fails the kit's `bit` part on the `lights` fixture, naming the
// fixture and the first field, scene3d.lights; and a release build holding it, with the kit's ledger embedded,
// refuses it at startup. Builds and calls go through #185's helpers. Release builds are slow, so the timeouts
// are long.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  kit, kitFailures, kitModule, releaseBuild, show, startupRefusal, useBuilds, useEvidence, type Build, type JsonObject,
} from './acceptance/185/helpers.ts';

const SCENE3D = 'scene3d';
const INTERFACE = 'scene3d@1';
const PLANTED_IMPLEMENTATION = 'scene3d.tie_by_order';
/** scene3d's tied-suns fixture, as the kit names it. */
const LIGHTS = 'parity/scene3d/lights.figure';
const SHIPPED: Build = { set: 'r2' };
const PLANTED = { set: 'r2', with: ['test-scene3d-tie-by-order'] } as unknown as Build;

const builds = useBuilds([SHIPPED, PLANTED]);
const evidence = useEvidence();

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-421-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('#421 scene3d@1: the kit fails a planted bit implementation whose light policy ties by registration order, and a release build refuses it', () => {
  it('the shipped scene3d passes the kit on its fixtures, the tied suns among them', () => {
    const scene3d = kitModule(kit(builds.bin(SHIPPED), evidence(), { modules: [SCENE3D] }), SCENE3D);
    expect(scene3d.verdict, `scene3d passes the kit: ${show(kitFailures(scene3d) as JsonObject[])}`).toBe('PASS');
    const fixtures = scene3d.parts.find((p) => p.part === 'fixtures');
    expect(fixtures?.cases.some((c) => c.fixture === LIGHTS && c.verdict === 'PASS'), `the fixtures part passed the lights fixture: ${show(fixtures?.cases.map((c) => c.raw) as JsonObject[])}`).toBe(true);
  }, 3_600_000);

  it('the planted implementation fails the bit part, naming the lights fixture and scene3d.lights, and its release build refuses it', () => {
    const ledger = join(dir, 'planted.json');
    const scene3d = kitModule(kit(builds.bin(PLANTED), evidence(), { ledger }), SCENE3D);
    expect(scene3d.verdict, 'the kit fails the planted scene3d').toBe('FAIL');
    const named = kitFailures(scene3d, 'bit').filter((f) => f['fixture'] === LIGHTS);
    expect(named.length, `a bit failure names the lights fixture: ${show(kitFailures(scene3d) as JsonObject[])}`).toBeGreaterThan(0);
    expect(String(named[0]!['field']), 'the first field that differs is the light policy\'s array').toMatch(/^scene3d\.lights@/);
    expect(named[0]!['interface'], 'the failure names the interface').toBe(INTERFACE);

    expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
    const built = releaseBuild(PLANTED, ledger, dir);
    expect(built.error, 'the release build compiles').toBe('');
    const refusal = startupRefusal(built.bin);
    expect(refusal.modules, `the release build refuses scene3d: ${show(refusal.raw)}`).toContain(SCENE3D);
    expect(refusal.interface, 'the refusal names the interface').toBe(INTERFACE);
    expect(refusal.implementations, 'the refusal names the planted implementation').toContain(PLANTED_IMPLEMENTATION);
  }, 5_400_000);
});
