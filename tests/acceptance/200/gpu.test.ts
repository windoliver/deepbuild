// AC9 #200.8a760791: "The registry: a pack that declares a gpu.step@1 entry is refused at its pack check, naming the
// registry and fill: module; and a canvas module that registers a step without an exactness fixture or a planted
// twin is refused at the seal, naming the step"
//
// AC10 #200.70cd4e69: "The GPU layer's registries are the core's from R2: a test build of the core and scene3d
// without the effects module seals with every base step of the op table in gpu.step@1 and today's outputs in
// gpu.output@1, each the core's entry with its since and digest, and gpu.function@1 declared with its kit; the core's
// own shadow and object-ID passes compile from those steps, a fixture of the Map's 3D gives the same pixel hash on one
// machine as before the lists opened, and every operator key stays the same; each base step's planted wrong twin, such
// as an i32 add that saturates instead of wrapping, is refused by its exactness fixture, naming the step; and a
// planted layout in which the effects module fills the base steps leaves that build's shadow pass with unresolved
// steps, so its seal refuses it, naming the first step, and fails this"
//
// asserts: AC9: test/steppack@1.0.0 (steppack.mul3 in gpu.step@1) is refused at pack check naming gpu.step@1 and
// module; `core,test-gpustep` seals with test.gpustep.mix@1 in gpu.step@1 from test.gpustep, while
// `test-gpustep-no-fixture` and `test-gpustep-no-twin` are refused naming the step and gpu.step@1. AC10: the
// `r2,test-leave-out-effects` build holds scene3d and not effects and seals; gpu.step@1 (owner core) holds every
// base step of the merge base's op table (crates/deep-canvas-effects/src/table.rs) as the core's first-party entry
// with since, digest, the base table's weight and exactness, a signature, an exactness fixture and a planted twin
// whose `twin_result` FAILs naming the step (add@1's naming the CTS's wrapped case, 2147483647 + 1 = -2147483648);
// gpu.output@1 (owner core) holds today's outputs (color, coverage, base_color, emission, alpha, metallic, roughness)
// as the core's entries; gpu.function@1 (owner core) has kit rules and a planted entry; the build's shadow and
// object-ID passes list their steps, all in gpu.step@1. `test-steps-in-effects` on that build is refused
// (`step_unresolved`) naming a base step and the shadow pass, so the seal check fails. Against the merge base's r2
// build: the Map's 3D fixture (fixtures/map3d.json) gives the same snapshot sha256 (macOS, on its GPU) in r2 and in
// the build without effects, and every eval node's content key (each operator × item: "every operator key") and
// written bytes are the merge base's.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, FIXTURES, GPUSTEP, GPUSTEP_MODULE, PACKS, STEPPACK, baseBuild, baseOpTable, evalAt, failsNaming, isObject, keyFailures, kitResult,
  listing, mentions, nodesOf, none, obj, packRefusedFailures, packRow, present, readJson, refusalFailures, refusalOf, registry, run, scenario,
  sealFailures, show, snapshotHash, startup, theEntry, theRegistry, useBuilds, useEvidence, type Build, type Listed,
} from './helpers.ts';

const STEPS: Build = { set: 'core', with: ['test-gpustep'] };
const NO_FIXTURE: Build = { set: 'core', with: ['test-gpustep-no-fixture'] };
const NO_TWIN: Build = { set: 'core', with: ['test-gpustep-no-twin'] };
const R2: Build = { set: 'r2' };
const NO_EFFECTS: Build = { set: 'r2', with: ['test-leave-out-effects'] };
const STEPS_IN_EFFECTS: Build = { set: 'r2', with: ['test-leave-out-effects', 'test-steps-in-effects'] };
const builds = useBuilds([STEPS, NO_FIXTURE, NO_TWIN, R2, NO_EFFECTS, STEPS_IN_EFFECTS]);
const evidence = useEvidence();

const OUTPUTS = ['color', 'coverage', 'base_color', 'emission', 'alpha', 'metallic', 'roughness'];
const MAP3D = obj(readJson(join(FIXTURES, 'map3d.json')), 'map3d.json');
const outputNamed = (l: Listed, name: string) => (l.entries ?? []).find((e) => e.name === name || e.name.endsWith(`.${name}`) || e.name === `${name}@1`);
const stepNames = (l: Listed): Set<string> => new Set((l.entries ?? []).map((e) => e.name));

describe('AC9 #200.8a760791 gpu.step@1 takes entries only from canvas modules, each with its exactness fixture and planted twin', () => {
  it('AC9 a pack that declares a gpu.step@1 entry is refused at its pack check, naming the registry and fill: module', () => {
    const [packs] = run(builds.bin(STEPS), scenario(evidence(), [PACKS], { packs: [STEPPACK] }));
    none(packRefusedFailures(packRow(packs!, STEPPACK), STEPPACK, ['gpu.step@1', 'module']), 'the pack check of a gpu.step@1 entry');
  }, 1_800_000);

  it('AC9 a canvas module\'s step with its exactness fixture and planted twin seals; without either it is refused at the seal, naming the step', () => {
    const step = theEntry(theRegistry(listing(builds.bin(STEPS), evidence()), 'gpu.step@1'), GPUSTEP);
    expect([step.module, step.kit.verdict], 'the control: test.gpustep\'s step is admitted').toEqual([GPUSTEP_MODULE, 'PASS']);
    none(refusalFailures(startup(builds.bin(NO_FIXTURE)), { reasons: ['entry_refused'], registry: 'gpu.step@1', entries: [GPUSTEP] }), 'a step without an exactness fixture');
    none(refusalFailures(startup(builds.bin(NO_TWIN)), { reasons: ['entry_refused'], registry: 'gpu.step@1', entries: [GPUSTEP] }), 'a step without a planted twin');
  }, 1_800_000);
});

describe('AC10 #200.70cd4e69 the GPU layer\'s registries are the core\'s, and a build without effects still compiles every base step', () => {
  it('AC10 a test build of the core and scene3d without effects seals with every base step in gpu.step@1, today\'s outputs in gpu.output@1, each the core\'s entry with since and digest, and gpu.function@1 with its kit', () => {
    const bin = builds.bin(NO_EFFECTS);
    none(sealFailures(startup(bin), 'the build without effects'), 'the seal');
    const reg = registry(run(bin, scenario(evidence(), [{ call: 'registry' }]))[0]!);
    expect([reg.modules.includes('scene3d'), reg.modules.includes('effects')], 'the build holds scene3d and not effects').toEqual([true, false]);
    const r = listing(bin, evidence());
    const steps = theRegistry(r, 'gpu.step@1');
    expect(steps.owner, 'gpu.step@1 is the core\'s').toBe('core');
    const table = baseOpTable();
    expect(table.length, 'the merge base\'s op table has its base steps').toBeGreaterThan(50);
    const problems: string[] = [];
    for (const base of table) {
      const e = (steps.entries ?? []).find((x) => x.name === base.name);
      if (!e) { problems.push(`${base.name} is not in gpu.step@1`); continue; }
      const v = isObject(e.value) ? e.value : {};
      if (e.module !== 'core' || e.origin !== 'first_party') problems.push(`${base.name} is ${e.origin} from ${e.module ?? 'no module'}, not the core's own entry`);
      if (!e.since || !DIGEST.test(e.digest)) problems.push(`${base.name} lacks since or digest`);
      if (v['weight'] !== base.weight) problems.push(`${base.name}'s weight is ${show(v['weight'])}, the op table's ${base.weight}`);
      if (v['exact'] !== base.exact) problems.push(`${base.name}'s exact is ${show(v['exact'])}, the op table's ${base.exact}`);
      for (const k of ['signature', 'fixture', 'twin']) if (v[k] === undefined || v[k] === null) problems.push(`${base.name} has no ${k}`);
    }
    none(problems, 'every base step as the core\'s gpu.step@1 entry');
    const outputs = theRegistry(r, 'gpu.output@1');
    expect(outputs.owner, 'gpu.output@1 is the core\'s').toBe('core');
    for (const name of OUTPUTS) {
      const e = outputNamed(outputs, name);
      expect(e, `today's output ${name} is in gpu.output@1; it holds ${(outputs.entries ?? []).map((x) => x.name).join(', ')}`).toBeDefined();
      expect([e!.module, e!.origin, e!.since.length > 0, DIGEST.test(e!.digest)], `${name} is the core's entry with since and digest`).toEqual(['core', 'first_party', true, true]);
    }
    const functions = theRegistry(r, 'gpu.function@1');
    expect(functions.owner, 'gpu.function@1 is the core\'s').toBe('core');
    expect([(functions.kit ?? []).length > 0, (functions.planted ?? []).length > 0], 'gpu.function@1 is declared with its kit and a planted entry').toEqual([true, true]);
  }, 1_800_000);

  it('AC10 each base step\'s planted wrong twin is refused by its exactness fixture, naming the step; add@1\'s twin saturates where i32 wraps', () => {
    const steps = theRegistry(listing(builds.bin(NO_EFFECTS), evidence()), 'gpu.step@1');
    const problems: string[] = [];
    for (const base of baseOpTable()) {
      const e = (steps.entries ?? []).find((x) => x.name === base.name);
      if (!e) { problems.push(`${base.name} is not in gpu.step@1`); continue; }
      if (!isObject(e.raw['twin_result'])) { problems.push(`${base.name} lists no twin_result`); continue; }
      const twin = kitResult(e.raw['twin_result'], `${base.name}.twin_result`);
      if (twin.verdict !== 'FAIL') problems.push(`${base.name}'s exactness fixture admits its planted twin: ${show(twin.raw)}`);
      else if (!mentions(twin.raw, base.name)) problems.push(`${base.name}'s exactness fixture refuses its twin without naming the step: ${show(twin.raw)}`);
    }
    none(problems, 'every base step\'s planted twin');
    const add = theEntry(steps, 'add@1');
    expect(mentions(add.value, '2147483647') && mentions(add.value, '-2147483648'), `add@1's exactness fixture holds the CTS's case, 2147483647 + 1 = -2147483648 as i32: ${show(add.value)}`).toBe(true);
  }, 1_800_000);

  it('AC10 the core\'s own shadow and object-ID passes compile from gpu.step@1\'s steps in the build without effects', () => {
    const bin = builds.bin(NO_EFFECTS);
    const names = stepNames(theRegistry(listing(bin, evidence()), 'gpu.step@1'));
    const reg = registry(run(bin, scenario(evidence(), [{ call: 'registry' }]))[0]!);
    for (const [label, pattern] of [['shadow', /shadow/i], ['object-ID', /object.?id/i]] as const) {
      const passes = Object.entries(reg.passes).filter(([name]) => pattern.test(name));
      expect(passes.length, `the build has a ${label} pass; its passes are ${Object.keys(reg.passes).join(', ')}`).toBeGreaterThan(0);
      for (const [name, pass] of passes) {
        const steps = Array.isArray(pass['steps']) ? pass['steps'].map(String) : [];
        expect(steps.length, `${name} lists the steps it compiles from: ${show(pass)}`).toBeGreaterThan(0);
        expect(steps.filter((s) => !names.has(s)), `${name}'s steps all resolve in gpu.step@1`).toEqual([]);
      }
    }
  }, 1_800_000);

  it('AC10 a planted layout in which the effects module fills the base steps leaves the shadow pass with unresolved steps, so the seal refuses it, naming the first step, and fails this', () => {
    const s = startup(builds.bin(STEPS_IN_EFFECTS));
    failsNaming(sealFailures(s, 'the build without effects whose base steps the effects module fills'), [], 'the planted layout');
    const r = refusalOf(s);
    expect(typeof r === 'string' ? r : r.reason, `the seal refuses the planted layout for unresolved steps: ${s.stdout.slice(0, 600)}`).toBe('step_unresolved');
    if (typeof r === 'string') return;
    const base = baseOpTable().map((b) => b.name);
    expect(base.some((name) => mentions(r.entries, name)), `the refusal names a base step: ${show(r.raw)}`).toBe(true);
    expect(mentions(r.raw, 'shadow'), `and the shadow pass: ${show(r.raw)}`).toBe(true);
  }, 1_800_000);

  it('AC10 the Map\'s 3D fixture gives the same pixel hash and every operator key as on the merge base, before the lists opened', (ctx) => {
    // The lists are open here first: a candidate without gpu.step@1 never reaches the merge base's build.
    theRegistry(listing(builds.bin(R2), evidence()), 'gpu.step@1');
    const measure = (bin: string): { snapshot: string | null; nodes: ReturnType<typeof nodesOf> } => {
      const [shown, evaluated] = run(bin, scenario(evidence(), [present(DOC.a, MAP3D, { pixels: true, size: [480, 320] }), evalAt(DOC.a)]));
      const unsupported = shown!['code'] === 'unsupported_platform' || (Array.isArray(shown!['issues']) && mentions(shown!['issues'], 'unsupported_platform'));
      return { snapshot: unsupported ? null : snapshotHash(shown!, 'the Map\'s 3D'), nodes: nodesOf(evaluated!, 'the Map\'s 3D: eval') };
    };
    const base = baseBuild('r2');
    const before = measure(base.bin);
    const here = measure(builds.bin(R2));
    const lean = measure(builds.bin(NO_EFFECTS));
    none(keyFailures(before.nodes, here.nodes, `r2 against the merge base ${base.sha.slice(0, 12)}`), 'every operator key on the Map\'s 3D');
    none(keyFailures(new Map([...before.nodes].filter(([k]) => lean.nodes.has(k))), lean.nodes, 'the build without effects against the merge base'), 'every operator key the build without effects runs');
    if (before.snapshot === null || here.snapshot === null || lean.snapshot === null) ctx.skip('INCONCLUSIVE: no GPU to draw the Map\'s 3D on here (unsupported_platform); the pixel hash is compared only on macOS');
    expect(here.snapshot, 'r2 draws the Map\'s 3D to the merge base\'s pixel hash').toBe(before.snapshot);
    expect(lean.snapshot, 'and so does the build without effects').toBe(before.snapshot);
  }, 1_800_000);
});
