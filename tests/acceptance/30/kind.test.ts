// AC4: the command check kind passes check.kind@1 (#13's kit, shipped by #314 in @deepbuild/conformance), run
// through the supervisor as host@1. On the kit's six named suites it returns what the issue says, with testsRun
// and each failure's place from the tool's own report; and the kit's four planted runners, built from this
// check kind as the kit builds them from its reference, each fail the kit with their own message.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandCheckKind } from '../../../packages/checks-command/src/index.ts';
import { runKit, slotKits, type CheckResult, type CheckRunnerFill, type CheckSpec, type SlotKit, type SlotReport } from '../../../packages/conformance/src/index.ts';
import { openWorld, type World } from './helpers.ts';
import { bent, BENDS, remembering } from './wrong.ts';

let world: World;
let fill: CheckRunnerFill;
beforeAll(async () => {
  world = await openWorld();
  fill = remembering(commandCheckKind(world.sup));
});
afterAll(async () => { await world?.close(); });

const kit = (): SlotKit<CheckRunnerFill> => {
  const found = slotKits().find((k) => k.slot === 'check.kind@1');
  if (!found) throw Error('BLOCKED: @deepbuild/conformance ships no check.kind@1 kit');
  return found as SlotKit<CheckRunnerFill>;
};
interface Input { spec: CheckSpec; checkout: string; deadline: number }
const fixture = (word: string): Input => {
  const found = kit().fixtures.find((f) => f.id === word);
  if (!found) throw Error(`BLOCKED: check.kind@1 ships no ${word} fixture`);
  return found.input as unknown as Input;
};
const runOn = async (f: CheckRunnerFill, word: string): Promise<CheckResult> => {
  const input = fixture(word);
  return f.run(input.spec, { checkout: input.checkout, deadline: input.deadline, now: () => Date.now() });
};
const notPassing = (report: SlotReport): string[] => report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id} (${c.part}): ${c.outcome} ${c.message}`);

describe('AC4 #30.e698983f passes check.kind@1 (#13), and its planted runners each fail it with their own message', () => {
  it('AC4 the command check kind fills check.kind@1 for the kind `command`, and passes every fixed and seeded case of the kit', async () => {
    expect(fill.slot).toBe('check.kind@1');
    expect(fill.kind).toBe('command');
    const report = await runKit(kit(), fill, { seed: 30 });
    expect(notPassing(report), 'every case of the kit passes').toEqual([]);
    expect(report.verdict).toBe('PASS');
    expect(report.cases.some((c) => c.part === 'seeded'), 'the seeded part ran').toBe(true);
  }, 600_000);

  it('AC4 the known-pass suite passes with its 2 tests; the known-fail suite fails with an assertion failure at its assert line, spec/cart.test.mjs:10', async () => {
    const pass = await runOn(fill, 'known-pass');
    expect(pass).toMatchObject({ outcome: 'passed', testsRun: 2, failures: [], mask: null });
    const fail = await runOn(fill, 'known-fail');
    expect(fail.outcome).toBe('failed');
    expect(fail.testsRun).toBe(2);
    expect(fail.failures, 'the one failure the tool reported').toHaveLength(1);
    expect(fail.failures[0]).toMatchObject({ file: 'spec/cart.test.mjs', line: 10, assertion: true });
  }, 180_000);

  it('AC4 the fail-elsewhere suite fails with an error, not an assertion failure, at its call into a module that throws on load, carrying the error\'s stack', async () => {
    const r = await runOn(fill, 'fail-elsewhere');
    expect(r.outcome).toBe('failed');
    expect(r.testsRun, 'nothing ran before the crash').toBe(0);
    expect(r.failures.length).toBeGreaterThan(0);
    const f = r.failures[0]!;
    expect(f.assertion, 'a TypeError on load is no assertion failure').toBe(false);
    expect(['spec/cart.test.mjs', 'src/cart.mjs'], `placed in the suite's own files: ${f.file}:${f.line}`).toContain(f.file);
    expect(f.stack, 'the caught error\'s stack').toBeTypeOf('string');
    expect(`${f.message}\n${f.stack}`).toMatch(/TypeError/);
  }, 180_000);

  it('AC4 the ran-nothing suite ran nothing; the masked-exit suite names its mask `|| true`; the past-deadline suite overran', async () => {
    expect(await runOn(fill, 'ran-nothing')).toMatchObject({ outcome: 'ran_nothing', testsRun: 0 });
    const masked = await runOn(fill, 'masked-exit');
    expect(masked.mask, 'the mask is named').toMatch(/\|\| true/);
    expect(masked.outcome).not.toBe('passed');
    expect((await runOn(fill, 'past-deadline')).outcome).toBe('overran');
  }, 180_000);

  for (const bend of BENDS) {
    it(`AC4 (wrong program) the planted runner ${bend}, built from the command check kind, fails the kit with its own message`, async () => {
      const planted = kit().planted.find((p) => p.name === bend);
      if (!planted) throw Error(`BLOCKED: check.kind@1 ships no planted runner ${bend}`);
      const report = await runKit(kit(), bent(fill, bend), { seed: 30 });
      expect(report.verdict).toBe('FAIL');
      const own = report.cases.filter((c) => c.outcome === 'FAIL' && c.message.includes(planted.message));
      expect(own.length, `a FAIL carries "${planted.message}" (failures: ${notPassing(report).join(' | ')})`).toBeGreaterThan(0);
      const others = kit().planted.filter((p) => p.name !== bend && p.message !== planted.message);
      for (const other of others) {
        expect(report.cases.some((c) => c.message.includes(other.message)), `${bend} fails with ${other.name}'s message`).toBe(false);
      }
    }, 600_000);
  }

  it('AC4 (wrong program) the crashed-suite runner returns passed with 12 tests on the fail-elsewhere suite, which the command check kind never does', async () => {
    const wrong = await runOn(bent(fill, 'crashed-suite'), 'fail-elsewhere');
    expect(wrong).toMatchObject({ outcome: 'passed', testsRun: 12 });
    expect((await runOn(fill, 'fail-elsewhere')).outcome).not.toBe('passed');
  }, 180_000);
});
