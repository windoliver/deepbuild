// #138.417c9663: the read-set and order parts. `test.kit.sneak.out` declares only its item but reads the
// array `test.kit.sneak.src` through a static; `test.kit.order.b` writes what `test.kit.order.a` left in a
// static, so its result depends on the order the two run in. The failing order's seed is checked against #387's
// `shuffle` on `eval`. At the base there is no `kit` call and no `test-kit-sneak` or `test-kit-order` feature.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FIXTURES, SHUFFLED_ORDERS, arr, expectFailure, failuresIn, kit, moduleOf, num, obj, partIn, run, scenario, show, str,
  useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const SNEAK: Build = { set: 'full', with: ['test-kit-sneak'] };
const ORDER: Build = { set: 'full', with: ['test-kit-order'] };
const builds = useBuilds([SNEAK, ORDER]);
const evidence = useEvidence();

/** Each node of `operator` in a clean evaluation of the module's first fixture, under an optional shuffle seed: item → result. */
function results(build: Build, module: string, operator: string, shuffle?: number): Map<string, string> {
  const bin = builds.bin(build);
  const [listed] = run(bin, scenario(evidence(), [FIXTURES]));
  const fx = arr(listed!['fixtures'], 'fixtures').map((f) => obj(f, 'fixture')).find((f) => f['module'] === module);
  expect(fx, `${module} registers a fixture`).toBeDefined();
  const calls: JsonObject[] = [
    { call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: obj(fx!['document'], 'fixture document'), include: ['issues'] },
    { call: 'eval', doc: DOC.a, clean: true },
  ];
  const [, evaluated] = run(bin, scenario(evidence(), calls, shuffle === undefined ? {} : { shuffle }));
  const out = new Map<string, string>();
  for (const n of arr(evaluated!['nodes'], 'eval.nodes').map((x) => obj(x, 'node')).filter((x) => x['operator'] === operator)) {
    out.set(String(n['item']), str(n['result'], 'node.result'));
  }
  expect(out.size, `${operator} has nodes in the fixture`).toBeGreaterThan(0);
  return out;
}

describe('#138.417c9663 an operator reading outside its declared reads through a static fails the read-set part; a result that changes under a shuffled legal order fails the order part', () => {
  it('#138.417c9663 test.kit.sneak fails read_set, undeclared_read, naming the operator test.kit.sneak.out and the array test.kit.sneak.src', () => {
    const r = kit(builds.bin(SNEAK), evidence(), { modules: ['test.kit.sneak'], parts: ['read_set'] });
    const m = moduleOf(r, 'test.kit.sneak');
    expect(m.verdict).toBe('FAIL');
    expectFailure(failuresIn(m, 'read_set'), 'undeclared_read', { operator: 'test.kit.sneak.out', array: 'test.kit.sneak.src' }, 'the static reader');
  }, 1_800_000);

  it('#138.417c9663 test.kit.sneak passes the order part: its fault is a read, not an order', () => {
    const r = kit(builds.bin(SNEAK), evidence(), { modules: ['test.kit.sneak'], parts: ['order'] });
    expect(partIn(moduleOf(r, 'test.kit.sneak'), 'order').verdict).toBe('PASS');
  }, 1_800_000);

  it(`#138.417c9663 test.kit.order fails order, naming test.kit.order.b and one of its ${SHUFFLED_ORDERS} seeds, and eval under that shuffle seed gives b another result`, () => {
    const r = kit(builds.bin(ORDER), evidence(), { modules: ['test.kit.order'], parts: ['order', 'read_set'] });
    const m = moduleOf(r, 'test.kit.order');
    expect(m.verdict).toBe('FAIL');
    const p = partIn(m, 'order');
    const seeds = arr(p.raw['seeds'], 'order.seeds').map((s, i) => num(s, `seeds[${i}]`));
    expect(new Set(seeds).size, `${SHUFFLED_ORDERS} distinct shuffled orders`).toBe(SHUFFLED_ORDERS);
    const f = expectFailure(failuresIn(m, 'order'), 'order', { operator: 'test.kit.order.b' }, 'the order-dependent operator');
    const seed = num(f['seed'], 'order.seed');
    expect(seeds, 'the failure names one of the part\'s seeds').toContain(seed);
    const straight = results(ORDER, 'test.kit.order', 'test.kit.order.b');
    const shuffled = results(ORDER, 'test.kit.order', 'test.kit.order.b', seed);
    expect([...straight].some(([item, res]) => shuffled.get(item) !== res), `under shuffle ${seed} some test.kit.order.b node gives another result: ${show([...straight])} vs ${show([...shuffled])}`).toBe(true);
    expect(partIn(m, 'read_set').verdict, 'its reads are its own: the read-set part passes').toBe('PASS');
  }, 1_800_000);
});
