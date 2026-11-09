// #499.6b5a4e6c (scope): "The media module's interface `media@1` (#185): its manifest names the implementation, and
// its conformance kit is every part of the canvas kit (#138) on this module's fixtures, the carried-state part over
// processors' checkpointed tails among them, with no behavior part, so it seals only bit, canonical implementations;
// a planted implementation whose reverb checkpoint leaves out its tail fails the kit's carried-state part, naming the
// module and the first step whose hash differs from a straight run, and a release build refuses it"
//
// asserts, shipped (`full`): deep://schedule names media@1 as the media module's interface, its implementation named
// with a semver version, the reference, bit and canonical; media@1's kit lists every part of #138's canvas kit and no
// behavior part. The kit over the media module tests it at media@1's digest, runs only parts that kit lists, each
// running every case it declares with at least one, and passes; its carried_state part runs, on a media fixture whose
// document holds a reverb processor.
// asserts, planted (`full,test-media-checkpoint-without-tail`): the build chose another implementation of media@1,
// declared bit; the kit fails the media module in carried_state with step_hash failures naming `module: "media"` and
// a step, each the step of the checkpoint it sought from (a tail left out changes the state from the first step
// played); the whole kit's ledger records media FAIL, and a release build embedding it refuses to start, naming media.
// Wrong programs: a media@1 with a behavior part, or measured; a kit that never runs carried_state on media (no
// processor checkpoints); a seek that never restores processor tails; a release gate that admits a kit failure.
// At the base the media module (#427's strips and emitters, read as data) implements media@1, but none of its fixtures
// holds a processor and it declares no checkpoints, so carried_state runs nothing on it and the first test fails; the
// planted feature doesn't exist, so cargo refuses the second test's build.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SLOW, fixturesOf, interfaceIn, kitCall, kitModule, num, obj, partFailures, releaseBuild, run, scenario, show, startupRefusal,
  str, useBuilds, useDir, type Build,
} from './helpers.ts';

const MEDIA = 'media';
const INTERFACE = 'media@1';
/** Every part of the canvas conformance kit (#138), by the names its `kit` call reports. */
const CANVAS_KIT = [
  'fixtures', 'clean_rebuild', 'patch_fuzz', 'read_set', 'order', 'schedule', 'repair_loop', 'carried_state',
  'late_entry', 'time_order', 'contribution', 'catalog', 'migration',
];
const FULL: Build = ['full'];
const PLANTED: Build = ['full', 'test-media-checkpoint-without-tail'];
const builds = useBuilds([FULL, PLANTED]);
const evidence = useDir();
let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-499-module-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

/** A fixture document holds a reverb processor when a processor's `kind` is, or is keyed, `reverb`. */
const holdsReverb = (doc: unknown): boolean => /"kind":\s*(\{\s*)?"reverb"/.test(JSON.stringify(doc));

describe('#499.6b5a4e6c media@1 seals only bit, canonical implementations, by every part of the canvas kit, carried state over processors\' tails among them', () => {
  it('#499.6b5a4e6c the plan names media@1 with the shipped media module as its bit, canonical reference and the whole canvas kit with no behavior part, and the media module passes it, carried state over a reverb\'s checkpoints included', () => {
    const [schedule, manifest, reply] = run(builds.bin(FULL), scenario(evidence(), [{ call: 'schedule' }, { call: 'manifest' }, kitCall({ modules: [MEDIA] })]));
    const i = interfaceIn(schedule!, INTERFACE);
    expect(i.module, 'media@1 is implemented by the canvas module media').toBe(MEDIA);
    expect(i.implementation.name.length, 'the manifest names the implementation').toBeGreaterThan(0);
    expect(i.implementation.version, 'with a semver version').toMatch(/^\d+\.\d+\.\d+/);
    expect(i.reference, 'the shipped implementation is media@1\'s reference').toBe(i.implementation.name);
    expect([i.implementation.equivalence, i.implementation.state], 'the shipped implementation is bit and canonical').toEqual(['bit', 'canonical']);
    expect(i.behavior, 'media@1 holds no behavior part').toBe('none');
    expect(CANVAS_KIT.filter((p) => !i.kit.includes(p)), `media@1's kit lists every part of the canvas kit: ${show(i.kit)}`).toEqual([]);
    expect(i.kit, 'media@1\'s kit lists no behavior part').not.toContain('behavior');

    const reverbFixtures = new Set(fixturesOf(manifest!, MEDIA).filter((f) => holdsReverb(f['document'])).map((f) => String(f['name'])));
    expect(reverbFixtures.size, 'the media module has a fixture of its own whose document holds a reverb processor').toBeGreaterThan(0);

    const m = kitModule(reply!, MEDIA);
    expect(m.digest, 'the kit tests the media module at media@1\'s digest').toBe(i.digest);
    for (const p of m.parts) {
      expect(i.kit, `${p.part}: a part media@1's kit lists`).toContain(p.part);
      expect(p.ran, `${p.part}: ran every case it declares`).toBe(p.declared);
      expect(p.cases.length, `${p.part}: ran at least one case`).toBeGreaterThan(0);
      expect(p.cases.filter((c) => c.verdict === 'FAIL' || c.verdict === 'INVALID').map((c) => `${c.case}: ${c.verdict}`), `${p.part}: no case failed or is INVALID`).toEqual([]);
      expect(p.verdict, `${p.part} passes on media: ${show(p.failures)}`).toBe('PASS');
    }
    const carried = m.parts.find((p) => p.part === 'carried_state');
    expect(carried, `the kit ran carried_state on media; it ran ${m.parts.map((p) => p.part).join(', ')}`).toBeDefined();
    expect(carried!.cases.filter((c) => c.fixture !== undefined && reverbFixtures.has(c.fixture)).length,
      `carried_state sought from checkpoints of a fixture holding a reverb (${[...reverbFixtures].join(', ')}): ${show(carried!.cases.map((c) => c.raw))}`).toBeGreaterThan(0);
    expect(m.verdict, `the media module passes media@1's kit: ${show(m.failures)}`).toBe('PASS');
  }, SLOW);

  it('#499.6b5a4e6c a planted implementation whose reverb checkpoint leaves out its tail fails the kit\'s carried-state part, naming the module and the first step whose hash differs from a straight run, and a release build refuses it', () => {
    const bin = builds.bin(PLANTED);
    const ledger = join(dir, 'planted-ledger.json');
    const [schedule, alone, whole] = run(bin, scenario(evidence(), [{ call: 'schedule' }, kitCall({ modules: [MEDIA] }), kitCall({ ledger })]));
    const i = interfaceIn(schedule!, INTERFACE);
    expect(i.implementation.name, 'the build chose the planted implementation of media@1, not the reference').not.toBe(i.reference);
    expect([i.implementation.equivalence, i.implementation.state], 'the planted implementation declares bit and canonical').toEqual(['bit', 'canonical']);

    const m = kitModule(alone!, MEDIA);
    expect(m.verdict, 'the planted implementation fails media@1\'s kit').toBe('FAIL');
    const carried = m.parts.find((p) => p.part === 'carried_state');
    expect(carried?.verdict, `it fails the carried-state part: ${show(m.parts.map((p) => [p.part, p.verdict]))}`).toBe('FAIL');
    const steps = partFailures(carried!).filter((f) => f['code'] === 'step_hash');
    expect(steps.length, `carried_state names the step whose hash differs: ${show(partFailures(carried!))}`).toBeGreaterThan(0);
    for (const f of steps) {
      expect(f['module'], `the failure names the module: ${show(f)}`).toBe(MEDIA);
      const step = num(f['step'], 'step_hash.step');
      const from = num(f['checkpoint'], 'step_hash.checkpoint');
      str(f['fixture'], 'step_hash.fixture');
      expect(step, `the first step whose hash differs from a straight run is the step the seek restored (checkpoint ${from}): a tail left out shows there`).toBe(from);
    }

    expect(kitModule(whole!, MEDIA).verdict, 'the whole kit records the media module FAIL').toBe('FAIL');
    expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
    const record = obj(obj(JSON.parse(readFileSync(ledger, 'utf8')), 'the ledger')[MEDIA], 'the ledger\'s record of media');
    expect([record['verdict'], obj(record['parts'], 'media parts')['carried_state']], 'the ledger records media and its carried_state FAIL').toEqual(['FAIL', 'FAIL']);
    const release = releaseBuild(PLANTED, ledger, dir);
    expect(release.error, 'the release build compiles').toBe('');
    const r = startupRefusal(release.bin);
    expect(r.modules.includes(MEDIA) || r.interface === INTERFACE, `the release build refuses the planted implementation, naming media: ${show(r.raw)}`).toBe(true);
  }, 2 * SLOW);
});
