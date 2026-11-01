// #185.da9aab76: while test.sim@1 holds no behavior part, a release build refuses B, declared measured, naming
// the interface; with a behavior part of three fixtures with analytic answers and tolerances, B passes and
// seals; a planted B that declares bit while one kit fixture's hash differs from A's fails the kit, naming the
// fixture and the first field; and a planted B that lands 2% off an answer whose tolerance is 1% fails, naming
// the fixture, the answer and the tolerance.
// The kit is #138's `kit` call; a release build embeds the ledger the kit wrote (DEEP_KIT_LEDGER at build
// time, #138) and its seal refuses at startup. Release builds are slow, so the timeouts are long. At the base
// none of this suite's test features exists, so cargo refuses each build.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  B, POS, SIM, SIM_MODULE, kit, kitFailures, kitModule, num, obj, published, releaseBuild, run, scenario, show, startupRefusal, str,
  theInterface, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const MEASURED: Build = { set: 'core', with: ['test-sim-b'] };
const WITH_BEHAVIOR: Build = { set: 'core', with: ['test-sim-b', 'test-sim-behavior'] };
const FALSE_BIT: Build = { set: 'core', with: ['test-sim-b-false-bit'] };
const OFF: Build = { set: 'core', with: ['test-sim-b-off', 'test-sim-behavior'] };
/** The behavior answer the planted B lands 2% off: its tolerance, relative. */
const ONE_PERCENT = 0.01;

const builds = useBuilds([MEASURED, WITH_BEHAVIOR, FALSE_BIT, OFF]);
const evidence = useEvidence();

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-185-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

/** The kit over every module of a debug build, writing the ledger a release build of the same features embeds. */
function ledgerOf(build: Build, name: string): { ledger: string; sim: ReturnType<typeof kitModule> } {
  const ledger = join(dir, `${name}.json`);
  const report = kit(builds.bin(build), evidence(), { ledger });
  expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
  return { ledger, sim: kitModule(report, SIM_MODULE) };
}

/** A behavior case's answers: `{answer, expected, got, tolerance}` each (README: The kit's behavior part). */
function answersOf(c: { raw: JsonObject }, what: string): { answer: string; expected: number; got: number; tolerance: number }[] {
  const list = c.raw['answers'];
  expect(Array.isArray(list) && list.length > 0, `${what} lists its analytic answers: ${show(c.raw)}`).toBe(true);
  return (list as JsonObject[]).map((a, i) => {
    const o = obj(a, `${what}.answers[${i}]`);
    return { answer: str(o['answer'], `${what}.answers[${i}].answer`), expected: num(o['expected'], `${what}.answers[${i}].expected`), got: num(o['got'], `${what}.answers[${i}].got`), tolerance: num(o['tolerance'], `${what}.answers[${i}].tolerance`) };
  });
}
const off = (a: { expected: number; got: number }): number => Math.abs(a.got - a.expected) / Math.abs(a.expected);

describe('#185.da9aab76 the kit admits B only by the interface\'s behavior part, and a planted B that claims bit or lands outside a tolerance fails, naming what differs', () => {
  it('#185.da9aab76 while test.sim@1 holds no behavior part, a release build refuses B, declared measured, naming the interface', () => {
    const p = published(builds.bin(MEASURED), evidence());
    const i = theInterface(p, SIM, 'the measured B build');
    expect([i.implementation.name, i.implementation.equivalence], 'the build chose B, declared measured').toEqual([B, 'measured']);
    expect(i.behavior, 'test.sim@1 holds no behavior part in this build').toBe('none');
    const { ledger } = ledgerOf(MEASURED, 'measured');
    const built = releaseBuild(MEASURED, ledger, dir);
    expect(built.error, 'the release build compiles').toBe('');
    const refusal = startupRefusal(built.bin);
    expect(refusal.interface, `the release build's refusal names the interface: ${show(refusal.raw)}`).toBe(SIM);
  }, 7_200_000);

  it('#185.da9aab76 with a behavior part of three fixtures with analytic answers and tolerances, B passes the kit and its release build seals', () => {
    const p = published(builds.bin(WITH_BEHAVIOR), evidence());
    const i = theInterface(p, SIM, 'the B build with a behavior part');
    expect(i.behavior, 'test.sim@1 now holds a behavior part').not.toBe('none');
    const { ledger, sim } = ledgerOf(WITH_BEHAVIOR, 'behavior');
    const part = sim.parts.find((x) => x.part === i.behavior);
    expect(part, `the kit ran test.sim@1's behavior part ${i.behavior} on B; it ran ${sim.parts.map((x) => x.part).join(', ')}`).toBeDefined();
    const fixtures = new Set(part!.cases.map((c, k) => str(c.fixture, `${i.behavior}.cases[${k}].fixture`)));
    expect(fixtures.size, 'the behavior part holds three fixtures').toBe(3);
    for (const [k, c] of part!.cases.entries()) {
      for (const a of answersOf(c, `${i.behavior}.cases[${k}] (${c.fixture})`)) {
        expect(off(a), `${c.fixture} ${a.answer}: B lands within its tolerance (expected ${a.expected}, got ${a.got}, tolerance ${a.tolerance})`).toBeLessThanOrEqual(a.tolerance);
      }
    }
    expect(part!.verdict, 'B passes the behavior part').toBe('PASS');
    expect(sim.verdict, `B passes its interface's kit: ${show(kitFailures(sim))}`).toBe('PASS');
    const built = releaseBuild(WITH_BEHAVIOR, ledger, dir);
    expect(built.error, 'the release build compiles').toBe('');
    const [reg, sch] = run(built.bin, scenario(evidence(), [{ call: 'registry' }, { call: 'schedule' }]));
    expect(reg!['state'], 'the release build seals').toBe('sealed');
    const chosen = obj(obj(obj(sch!['interfaces'], 'schedule: interfaces')[SIM], `schedule: interfaces["${SIM}"]`)['implementation'], 'implementation');
    expect(chosen['name'], 'with B as test.sim@1\'s implementation').toBe(B);
  }, 7_200_000);

  it('#185.da9aab76 a planted B that declares bit while one kit fixture\'s hash differs from A\'s fails the kit, naming the fixture and the first field', () => {
    const i = theInterface(published(builds.bin(FALSE_BIT), evidence()), SIM, 'the planted bit B build');
    expect(i.implementation.equivalence, 'the planted B declares bit').toBe('bit');
    const sim = kitModule(kit(builds.bin(FALSE_BIT), evidence(), { modules: [SIM_MODULE] }), SIM_MODULE);
    expect(sim.verdict, 'the planted B fails its interface\'s kit').toBe('FAIL');
    const named = kitFailures(sim).filter((f) => typeof f['fixture'] === 'string' && typeof f['field'] === 'string' && (f['field'] as string).includes(POS));
    expect(named.length, `a failure names the fixture and the first field that differs from A's, in ${POS}: ${show(kitFailures(sim) as JsonObject[])}`).toBeGreaterThan(0);
    const ran = new Set(sim.parts.flatMap((p) => p.cases.flatMap((c) => (c.fixture ? [c.fixture] : []))));
    expect(ran, `the fixture it names (${String(named[0]!['fixture'])}) is one the kit ran`).toContain(named[0]!['fixture']);
  }, 1_800_000);

  it('#185.da9aab76 a planted B that lands 2% off an answer whose tolerance is 1% fails, naming the fixture, the answer and the tolerance', () => {
    const i = theInterface(published(builds.bin(OFF), evidence()), SIM, 'the planted off B build');
    expect([i.implementation.equivalence, i.behavior !== 'none'], 'the planted B is measured, against test.sim@1\'s behavior part').toEqual(['measured', true]);
    const sim = kitModule(kit(builds.bin(OFF), evidence(), { modules: [SIM_MODULE] }), SIM_MODULE);
    expect(sim.verdict, 'the planted B fails its interface\'s kit').toBe('FAIL');
    const part = sim.parts.find((x) => x.part === i.behavior);
    expect(part?.verdict, 'it fails the behavior part').toBe('FAIL');
    const failures = kitFailures(sim, i.behavior).filter((f) => typeof f['fixture'] === 'string' && typeof f['answer'] === 'string' && typeof f['tolerance'] === 'number');
    expect(failures.length, `a behavior failure names the fixture, the answer and the tolerance: ${show(kitFailures(sim, i.behavior) as JsonObject[])}`).toBeGreaterThan(0);
    const f = failures.find((x) => x['tolerance'] === ONE_PERCENT);
    expect(f, `the failure names the 1% tolerance: ${show(failures as JsonObject[])}`).toBeDefined();
    const c = part!.cases.find((x) => x.fixture === f!['fixture']);
    expect(c, `the failure's fixture ${String(f!['fixture'])} is one of the behavior part's fixtures`).toBeDefined();
    const a = answersOf(c!, `the case ${String(f!['fixture'])}`).find((x) => x.answer === f!['answer']);
    expect(a, `the failure's answer ${String(f!['answer'])} is one of that fixture's answers`).toBeDefined();
    expect(a!.tolerance, 'that answer\'s tolerance is 1%').toBe(ONE_PERCENT);
    expect(off(a!), `B lands 2% off it (expected ${a!.expected}, got ${a!.got})`).toBeGreaterThan(0.015);
    expect(off(a!), `B lands 2% off it (expected ${a!.expected}, got ${a!.got})`).toBeLessThan(0.025);
    expect(c!.verdict, 'and that fixture\'s case fails').toBe('FAIL');
  }, 1_800_000);
});
