// #387.ade81ba6: two stepping test canvas modules, a at 60 Hz and b at 120 Hz, run in time order with a
// first at a shared time; renaming them leaves that order; a planted scheduler that orders steps at one
// time by name swaps it and fails, naming the step; two modules that each read the other at one time are
// refused at the seal as a cycle; and every hash is the same under 8 shuffled legal orders. The step log
// is the `eval` reply's `steps` (README: eval). The wrong programs: the planted name order, and a result
// that depends on tie order. At the base none of the test-step features exist.
import { describe, expect, it } from 'vitest';
import {
  DOC, FLICKS, PHASES, REGISTRY, board, countFailures, evalCall, evaluated, label, nodeId, presented, rect, registry, requires, run, sameNodes,
  scenario, show, snapshotOf, sorted, startupRefusal, stepOrderFailures, useBuilds, useEvidence, type Build, type Evaluated, type JsonObject, type Registry,
} from './helpers.ts';

const STEP: Build = { set: 'core', with: ['test-step'] };
const RENAMED: Build = { set: 'core', with: ['test-step-renamed'] };
const CYCLE: Build = { set: 'core', with: ['test-step-cycle'] };
const builds = useBuilds([STEP, RENAMED, CYCLE]);
const evidence = useEvidence();

/** 1 s in flicks: a step time of both modules. */
const AT = FLICKS;
const stepper = (module: string): JsonObject => ({ id: module.replace(/\./g, '-'), kind: `${module}@1`, name: `Stepper ${module}`, order: 'z0', params: {} });
const steppers = (a: string, b: string, extra: JsonObject[] = []): JsonObject =>
  board('Steps', [stepper(a), { ...stepper(b), order: 'z1' }, ...extra], requires({ [a]: '^1', [b]: '^1' }));

/** The frame at 1 s of a fresh session: its step log. */
function frameAt1s(bin: string, document: JsonObject, sealPlanted?: string): Evaluated {
  const replies = run(bin, scenario(evidence(), [show(document), evalCall(DOC.a, { t: '1s' })]), sealPlanted);
  presented(replies[0]!, 'the steppers\' board');
  return evaluated(replies[1]!, 'the frame at 1 s');
}

/** Phases in the closed order, and on each item a writer's node before its reader's in one phase. */
function legalityFailures(reg: Registry, e: Evaluated, what: string): string[] {
  const failures: string[] = [];
  const index = new Map(e.nodes.map((n, i) => [nodeId(n), i]));
  for (let i = 1; i < e.nodes.length; i++) {
    const [p, q] = [PHASES.indexOf(e.nodes[i - 1]!.phase), PHASES.indexOf(e.nodes[i]!.phase)];
    if (q < p) failures.push(`${what}: ${nodeId(e.nodes[i]!)} (${e.nodes[i]!.phase}) runs after ${nodeId(e.nodes[i - 1]!)} (${e.nodes[i - 1]!.phase})`);
  }
  for (const reader of e.nodes) {
    for (const read of reg.operators[reader.operator]?.reads ?? []) {
      for (const writer of e.nodes) {
        if (writer.item !== reader.item || writer.phase !== reader.phase || writer === reader) continue;
        if (!(reg.operators[writer.operator]?.writes ?? []).includes(read)) continue;
        if (index.get(nodeId(writer))! > index.get(nodeId(reader))!) failures.push(`${what}: ${nodeId(reader)} reads ${read} before ${nodeId(writer)} writes it`);
      }
    }
  }
  return failures;
}

describe('#387.ade81ba6 two stepping test canvas modules run in time order with a first at a shared time; renaming keeps the order; a planted name order fails naming the step; a mutual read at one time is refused at the seal as a cycle; every hash is the same under 8 shuffled legal orders', () => {
  it('#387.ade81ba6 at 1 s, test.step.b\'s step reads test.step.a\'s count from a\'s step at 1 s, a\'s step reads b\'s count from b\'s step before 1 s, a runs first, and each counts its own steps', () => {
    const e = frameAt1s(builds.bin(STEP), steppers('test.step.a', 'test.step.b'));
    expect(countFailures(e.steps, 'test.step.a'), 'a counts one up per step, in time order').toEqual([]);
    expect(countFailures(e.steps, 'test.step.b'), 'b counts one up per step, in time order').toEqual([]);
    const within = (m: string) => e.steps.filter((s) => s.module === m && s.t > 0 && s.t <= AT).length;
    expect([within('test.step.a'), within('test.step.b')], 'in (0, 1 s] a steps 60 times and b 120 times').toEqual([60, 120]);
    expect(e.steps.every((s, i) => i === 0 || s.t >= e.steps[i - 1]!.t), 'the steps run in time order').toBe(true);
    expect(stepOrderFailures(e.steps, 'test.step.a', 'test.step.b', AT), 'the order at the shared time 1 s').toEqual([]);
  }, 600_000);

  it('#387.ade81ba6 renamed so b\'s name sorts first (a → test.step.y, b → test.step.x), the order at 1 s is the same: y first, x reading y\'s count from 1 s', () => {
    const e = frameAt1s(builds.bin(RENAMED), steppers('test.step.y', 'test.step.x'));
    expect(countFailures(e.steps, 'test.step.y')).toEqual([]);
    expect(countFailures(e.steps, 'test.step.x')).toEqual([]);
    expect(stepOrderFailures(e.steps, 'test.step.y', 'test.step.x', AT), 'the order at 1 s comes from declared reads, never from names').toEqual([]);
  }, 600_000);

  it('#387.ade81ba6 a planted scheduler that orders steps at one time by name (--planted orders_steps_by_name) swaps the renamed pair and fails, naming test.step.x\'s step at 1 s', () => {
    const e = frameAt1s(builds.bin(RENAMED), steppers('test.step.y', 'test.step.x'), 'orders_steps_by_name');
    const failures = stepOrderFailures(e.steps, 'test.step.y', 'test.step.x', AT);
    expect(failures.length, `the planted name order fails the order check: ${JSON.stringify(e.steps.filter((s) => s.t === AT))}`).toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the step: test.step.x at 1 s').toMatch(new RegExp(`test\\.step\\.x's step at ${AT}`));
  }, 600_000);

  it('#387.ade81ba6 two modules that each read the other\'s count at their own step\'s time are refused at the seal as a cycle, naming both', () => {
    const refusal = startupRefusal(builds.bin(CYCLE));
    expect(refusal.reason, `the refusal's reason: ${JSON.stringify(refusal.raw)}`).toBe('cycle');
    expect(sorted(refusal.modules), 'the refusal names both stepping modules').toEqual(['test.loop.p', 'test.loop.q']);
  }, 600_000);

  it('#387.ade81ba6 under 8 shuffled legal orders (seeds 1 to 8) every node\'s key and result, the step log and the frame\'s snapshot equal the unshuffled frame\'s, and each order is legal', () => {
    const bin = builds.bin(STEP);
    const document = steppers('test.step.a', 'test.step.b', [
      rect('back', [0, 0, 320, 200], 'a0', 'ground'), rect('r1', [16, 40, 40, 30], 'a1'), rect('r2', [64, 40, 40, 30], 'a2'), rect('r3', [112, 40, 40, 30], 'a3', 'ink'),
      rect('r4', [160, 40, 40, 30], 'a4'), rect('r5', [208, 40, 40, 30], 'a5'), label('l1', 'Shuffled', [16, 100], 'a6'), label('l2', 'Legal orders', [16, 130], 'a7'),
    ]);
    const frame = (shuffle?: number) => {
      const replies = run(bin, scenario(evidence(), [REGISTRY, show(document), evalCall(DOC.a, { t: '1s', pixels: true })], shuffle === undefined ? {} : { shuffle }));
      presented(replies[1]!, 'the shuffled board');
      return { reg: registry(replies[0]!), e: evaluated(replies[2]!, `the frame under shuffle ${shuffle ?? 'none'}`), snapshot: snapshotOf(replies[2]!, `the frame under shuffle ${shuffle ?? 'none'}`) };
    };
    const plain = frame();
    expect(legalityFailures(plain.reg, plain.e, 'the unshuffled order')).toEqual([]);
    const orders = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const s = frame(seed);
      expect(legalityFailures(s.reg, s.e, `shuffle ${seed}`), `shuffle ${seed} runs a legal order`).toEqual([]);
      expect(sameNodes(plain.e, s.e, `shuffle ${seed}`), `shuffle ${seed}: every node's key and result is the same`).toEqual([]);
      expect(s.e.steps, `shuffle ${seed}: the step log is the same`).toEqual(plain.e.steps);
      expect(s.snapshot, `shuffle ${seed}: the frame's snapshot is the same`).toBe(plain.snapshot);
      orders.add(s.e.nodes.map(nodeId).join(' '));
    }
    expect(orders.size, 'the eight shuffles are not all one order, so ties were shuffled').toBeGreaterThan(1);
  }, 900_000);
});
