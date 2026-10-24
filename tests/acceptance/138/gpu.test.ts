// GPU cases: a test module that registers a GPU pass (criterion 19), GPU goldens under an environment digest
// (16), re-blessing at the recorded commit (23) and a GPU golden's first blessing after its analytic and
// CPU-reference criteria (26). The GPU halves render on the reference Mac's GPU under the kit's GPU lease, so
// they run only on a reference Mac (`gpuProblem`), after their GPU-free preconditions; elsewhere they skip as
// INCONCLUSIVE and never pass by skipping. `environment` stands in for a driver update and `commit` for the
// commit a run renders at (README: Scenario fields added). At the base there is no `kit`, `manifest`,
// `golden`, `record` or `decide` call and no `test-kit-gpu-pass*` feature.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AS_YOU, MANIFEST, arr, decide, decided, failuresIn, golden, goldenCall, gpuProblem, kit, moduleOf, obj, outcome, partIn, recordCall,
  run, scenario, show, sorted, str, strs, useBuilds, useEvidence,
  type Build, type Case, type JsonObject, type ModuleResult,
} from './helpers.ts';

const GPU: Build = { set: 'full', with: ['test-kit-gpu-pass'] };
const SHIFTED: Build = { set: 'full', with: ['test-kit-gpu-pass-shifted'] };
const CPU_REF_FAILS: Build = { set: 'full', with: ['test-kit-gpu-pass-cpu-ref-fails'] };
const builds = useBuilds([GPU, SHIFTED, CPU_REF_FAILS]);
const evidence = useEvidence();
const problem = gpuProblem();

let store = '';
beforeEach(() => { store = mkdtempSync(join(tmpdir(), 'deep-138-gpu-goldens-')); });
afterEach(() => { if (store) rmSync(store, { recursive: true, force: true }); store = ''; });

const A = 'parity/scene/gpu-pass-a.board';
const B = 'parity/scene/gpu-pass-b.board';
const C1 = '1111111111111111111111111111111111111111';
const C2 = '2222222222222222222222222222222222222222';
const DRIVER_1 = { driver: 'test-driver-1' };
const DRIVER_2 = { driver: 'test-driver-2' };
const at = (build: Build, list: JsonObject[], environment: JsonObject, commit: string): JsonObject[] =>
  run(builds.bin(build), scenario(evidence(), list, { goldens: store, environment, commit }));

/** GPU-free precondition: the build's manifest lists both GPU fixtures with an analytic and a CPU-reference criterion. */
function gpuFixturesListed(build: Build): void {
  const [m] = run(builds.bin(build), scenario(evidence(), [MANIFEST]));
  const fixtures = arr(m!['fixtures'], 'manifest.fixtures').map((f) => obj(f, 'fixture'));
  for (const name of [A, B]) {
    const f = fixtures.find((x) => x['name'] === name);
    expect(f, `the manifest lists ${name}`).toBeDefined();
    expect(f!['module']).toBe('test.kit.gpu');
    const oracles = strs(obj(f!['sidecar'], 'sidecar')['oracles'], `${name}: oracles`);
    for (const o of ['analytic', 'cpu_reference']) expect(oracles, `${name} names the ${o} oracle`).toContain(o);
  }
}
const snapshotCases = (m: ModuleResult, backend: string): Case[] =>
  partIn(m, 'fixtures').cases.filter((c) => (c.fixture === A || c.fixture === B) && c.backend === backend && (c.probe !== undefined || c.raw['compared'] !== undefined));

/** Records and blesses both GPU goldens under driver 1 at commit C1. */
function blessBoth(): void {
  const recs = at(GPU, [recordCall(AS_YOU, A, 'gpu'), recordCall(AS_YOU, B, 'gpu')], DRIVER_1, C1);
  const blessed = at(GPU, recs.map((r, i) => decide(AS_YOU, { bless: { fixture: [A, B][i]!, digest: str(r['digest'], 'record.digest'), backend: 'gpu' } })), DRIVER_1, C1);
  for (const r of blessed) decided(r, 'your blessing');
}

describe('#138.19c7c27a a test module that registers a GPU pass: its snapshot case is BLOCKED on noop and passes on the reference Mac\'s GPU; a one-code shift fails, naming the case', () => {
  it('#138.19c7c27a on noop and Vello CPU, neither of which can make GPU pixels, the GPU pass\'s snapshot cases are BLOCKED naming the probe, and the module fails unproved', () => {
    const r = kit(builds.bin(GPU), evidence(), { modules: ['test.kit.gpu'], parts: ['fixtures'], backends: ['noop', 'vello_cpu'] });
    const m = moduleOf(r, 'test.kit.gpu');
    expect(r.lease['gpu'], 'no GPU lease without the gpu backend').toBe(false);
    for (const backend of ['noop', 'vello_cpu']) {
      const cases = snapshotCases(m, backend);
      expect(cases.length, `the snapshot cases ran on ${backend}`).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.verdict, `${c.case} on ${backend}`).toBe('BLOCKED');
        expect(str(c.probe, 'probe'), `${c.case} on ${backend} names its probe`).toMatch(/pixel|gpu/);
      }
    }
    expect(m.verdict, 'no backend proved the GPU cases').toBe('FAIL');
    expect(failuresIn(m).filter((f) => f.code === 'unproved').length, 'unproved, naming the cases').toBeGreaterThan(0);
  }, 1_800_000);

  it('#138.19c7c27a on the reference Mac\'s GPU under the lease it passes the kit, its snapshot cases BLOCKED on noop and PASS on the GPU', (ctx) => {
    gpuFixturesListed(GPU);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    const r = kit(builds.bin(GPU), evidence(), { modules: ['test.kit.gpu'], backends: ['noop', 'gpu'] });
    const m = moduleOf(r, 'test.kit.gpu');
    expect(r.lease['gpu'], 'the kit took the GPU lease').toBe(true);
    for (const c of snapshotCases(m, 'noop')) expect(c.verdict, `${c.case} on noop`).toBe('BLOCKED');
    const gpu = snapshotCases(m, 'gpu');
    expect(gpu.length, 'the snapshot cases ran on the GPU').toBeGreaterThan(0);
    for (const c of gpu) expect(c.verdict, `${c.case} on the GPU: ${show(c.raw)}`).toBe('PASS');
    expect(m.verdict, `the module passes the kit: ${show(failuresIn(m))}`).toBe('PASS');
  }, 1_800_000);

  it('#138.19c7c27a a planted one-code shift in the GPU pass\'s output fails the kit, naming the case', (ctx) => {
    gpuFixturesListed(SHIFTED);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    const r = kit(builds.bin(SHIFTED), evidence(), { modules: ['test.kit.gpu'], parts: ['fixtures'], backends: ['noop', 'gpu'] });
    const m = moduleOf(r, 'test.kit.gpu');
    expect(m.verdict).toBe('FAIL');
    const failed = snapshotCases(m, 'gpu').filter((c) => c.verdict === 'FAIL');
    expect(failed.length, 'the shifted snapshot fails on the GPU').toBeGreaterThan(0);
    for (const c of failed) expect(failuresIn(m).some((f) => f['case'] === c.case), `a failure names the case ${c.case}`).toBe(true);
  }, 1_800_000);
});

describe('#138.da9f7979 a GPU golden compares only under an equal environment digest; a pixel change under an unchanged digest fails; re-blessing after a driver update is one decision', () => {
  it('#138.da9f7979 blessed under driver 1 both goldens pass; the shifted pass fails under driver 1; under driver 2 they read BLOCKED; one rebless decision covers both and they pass', (ctx) => {
    gpuFixturesListed(GPU);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    blessBoth();
    const [a1, b1] = at(GPU, [goldenCall(A, 'gpu'), goldenCall(B, 'gpu')], DRIVER_1, C1);
    expect([golden(a1!, 'A').verdict, golden(b1!, 'B').verdict], 'both pass under the driver they were blessed under').toEqual(['PASS', 'PASS']);
    const [shifted] = at(SHIFTED, [goldenCall(A, 'gpu')], DRIVER_1, C1);
    const s = golden(shifted!, 'the shifted render');
    expect([s.verdict, s.reason, s.environment], 'a pixel change under an unchanged environment digest fails').toEqual(['FAIL', 'pixels_changed', golden(a1!, 'A').environment]);
    const [a2, b2] = at(GPU, [goldenCall(A, 'gpu'), goldenCall(B, 'gpu')], DRIVER_2, C1);
    for (const g of [golden(a2!, 'A under driver 2'), golden(b2!, 'B under driver 2')]) {
      expect([g.verdict, g.reason], 'under another environment digest the golden isn\'t compared').toEqual(['BLOCKED', 'environment_changed']);
      expect(g.environment, 'the environment digest moved with the driver').not.toBe(golden(a1!, 'A').environment);
    }
    const [re, a3, b3] = at(GPU, [decide(AS_YOU, { rebless: { cause: 'driver test-driver-2', backend: 'gpu' } }), goldenCall(A, 'gpu'), goldenCall(B, 'gpu')], DRIVER_2, C1);
    decided(re!, 'your rebless');
    expect(sorted(strs(re!['fixtures'], 'rebless.fixtures')), 'one decision for every fixture the cause changed').toEqual(sorted([A, B]));
    expect([golden(a3!, 'A').verdict, golden(b3!, 'B').verdict], 'both pass under driver 2 after the one decision').toEqual(['PASS', 'PASS']);
  }, 1_800_000);
});

describe('#138.d03b76eb re-blessing after a driver update re-renders each golden at the commit it was recorded at; a re-bless at a later commit is refused, naming the commit', () => {
  it('#138.d03b76eb under driver 2 a rebless at a later commit is refused wrong_commit naming it; at the recorded commit it is decided', (ctx) => {
    gpuFixturesListed(GPU);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    blessBoth();
    const rebless = decide(AS_YOU, { rebless: { cause: 'driver test-driver-2', backend: 'gpu' } });
    const [later] = at(GPU, [rebless], DRIVER_2, C2);
    expect([outcome(later!), later!['code'], later!['commit']], `a rebless at a later commit is refused, naming it: ${show(later)}`).toEqual(['refused', 'wrong_commit', C2]);
    expect(strs(later!['recorded'], 'refusal.recorded'), 'and naming the commit the goldens were recorded at').toEqual([C1]);
    const [ok] = at(GPU, [rebless], DRIVER_2, C1);
    decided(ok!, 'the rebless at the recorded commit');
  }, 1_800_000);
});

describe('#138.026a0dff a GPU golden\'s first blessing waits for the fixture\'s analytic and CPU-reference criteria to pass on the same commit', () => {
  it('#138.026a0dff with both criteria passing, the first golden raises a bless ask for the fixture', (ctx) => {
    gpuFixturesListed(GPU);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    const [g] = at(GPU, [goldenCall(A, 'gpu')], DRIVER_1, C1);
    const r = golden(g!, 'the first render');
    expect([r.verdict, r.reason], 'no golden yet').toEqual(['BLOCKED', 'no_golden']);
    expect(r.ask, 'a blessing ask is raised').not.toBeNull();
    expect([r.ask!['kind'], r.ask!['fixture'], r.ask!['digest']], 'for this fixture and this render').toEqual(['bless', A, r.digest]);
  }, 1_800_000);

  it('#138.026a0dff with a planted CPU-reference criterion failing, no ask is raised and the fixture reads BLOCKED, naming the criterion', (ctx) => {
    gpuFixturesListed(CPU_REF_FAILS);
    if (problem) ctx.skip(`INCONCLUSIVE (needs the reference Mac's GPU): ${problem}`);
    const [g] = at(CPU_REF_FAILS, [goldenCall(A, 'gpu')], DRIVER_1, C1);
    const r = golden(g!, 'the first render with its CPU reference failing');
    expect([r.verdict, r.reason, r.ask], 'BLOCKED, with no ask').toEqual(['BLOCKED', 'criterion_failed', null]);
    expect(str(r.criterion, 'criterion'), 'naming the CPU-reference criterion').toMatch(/cpu_reference/);
  }, 1_800_000);
});
