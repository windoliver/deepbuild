// #855.4c02dddc: a typed result's digest is the same from two builds whose Debug output for it differs;
// a planted result that digests its Debug text differs between them and fails, naming the operator.
//
// The two builds are `full` and `full` with the test feature `test-debug-alt`, which changes the Debug
// output of every typed value an operator writes and nothing else (README: The test builds). `eval` with
// `debug_text: true` gives each node `debug`, the SHA-256 of the Debug text of the typed values it wrote,
// so the tests see that the two builds' Debug output differs node by node, beside `result`, the node's
// result digest. The planted result is `test.dbg.out` of the test canvas module `test.dbg` (feature
// `test-debug-digest`), whose canonical bytes are its Debug text. The wrong programs: the base, whose
// text.status, look.palette, marks2d.frame and motion.compile results digest their Debug text; the planted
// result; a feature that leaves Debug output as it was (then `debug` doesn't differ).
import { describe, expect, it } from 'vitest';
import {
  DOC, FIXTURES, board, byId, evalCall, evaluated, fixturesOf, isFramePhase, nodeDifferences, nodeId, presented, rect, requires, run, scenario,
  show, sorted, text, useBuilds, useTemp, type Build, type Evaluated, type Fixture, type JsonObject,
} from './helpers.ts';

const ID = '#855.4c02dddc';
const FULL: Build = { set: 'full' };
const FULL_ALT: Build = { set: 'full', with: ['test-debug-alt'] };
const PLANTED: Build = { set: 'full', with: ['test-debug-digest'] };
const PLANTED_ALT: Build = { set: 'full', with: ['test-debug-digest', 'test-debug-alt'] };
const builds = useBuilds([FULL, FULL_ALT, PLANTED, PLANTED_ALT]);
const temp = useTemp();

/** The base's operators whose typed results took their digest bytes from Debug formatting, and text.shape's typed run. */
const TYPED_AT_BASE = ['look.palette', 'marks2d.frame', 'motion.compile', 'text.shape', 'text.status'];
const T = '0.5s';

/** One document shown and evaluated clean at `T` with each node's Debug digest. */
function evalOf(bin: string, document: JsonObject, record?: JsonObject): Evaluated {
  const replies = run(bin, scenario(temp(), [show(document), evalCall(DOC.a, { t: T, clean: true, debug_text: true })], record ? { record } : {}));
  presented(replies[0]!, `${String(document['title'])}`);
  return evaluated(replies[1]!, `${String(document['title'])} at ${T}`, true);
}

/** Typed nodes (a non-null `debug` in the first) whose Debug digest is the same in the second build: each names the operator and item. */
function sameDebug(a: Evaluated, b: Evaluated, what: string): string[] {
  const right = byId(b);
  return a.nodes.filter((n) => n.debug != null && right.get(nodeId(n))?.debug === n.debug).map((n) => `${what}: ${n.operator} on ${n.item ?? 'the document'} has the same Debug text in both builds`);
}

describe(`${ID} a typed result's digest is the same from two builds whose Debug output for it differs; a planted result that digests its Debug text differs and fails, naming the operator`, () => {
  let cache: { fixtures: Fixture[]; pairs: { fixture: Fixture; a: Evaluated; b: Evaluated }[] } | undefined;
  function shipped(): NonNullable<typeof cache> {
    if (cache) return cache;
    const [fx] = run(builds.bin(FULL), scenario(temp(), [FIXTURES]));
    const fixtures = fixturesOf(fx!);
    cache = { fixtures, pairs: fixtures.map((fixture) => ({ fixture, a: evalOf(builds.bin(FULL), fixture.document, fixture.record), b: evalOf(builds.bin(FULL_ALT), fixture.document, fixture.record) })) };
    return cache;
  }

  it(`${ID} over every shipped fixture, every node's key and result digest are the same in full and in full with test-debug-alt`, () => {
    const failures = shipped().pairs.flatMap(({ fixture, a, b }) => nodeDifferences(a, b, `${fixture.module}/${fixture.name}`).failures);
    expect(failures, 'no key or result digest moves when only Debug output changes').toEqual([]);
  }, 3_600_000);

  it(`${ID} the two builds' Debug output differs for every typed result: each node that wrote a typed value has another Debug digest in the second build, and the base's Debug-digested operators are among them`, () => {
    const { pairs } = shipped();
    const failures = pairs.flatMap(({ fixture, a, b }) => sameDebug(a, b, `${fixture.module}/${fixture.name}`));
    expect(failures, 'test-debug-alt changes the Debug output of every typed value, so a digest that read it would move').toEqual([]);
    const typed = new Set(pairs.flatMap(({ a }) => a.nodes.filter((n) => n.debug != null).map((n) => n.operator)));
    expect(sorted(TYPED_AT_BASE.filter((op) => !typed.has(op))), 'the fixtures hold a typed result of each operator that digested its Debug text at the base').toEqual([]);
    const frameJson = pairs.flatMap(({ fixture, a }) => a.nodes.filter((n) => isFramePhase(n.phase) && n.run === 'ran' && n.debug === null && ['look.palette', 'marks2d.frame', 'text.status'].includes(n.operator)).map((n) => `${fixture.module}/${fixture.name}: ${nodeId(n)}`));
    expect(frameJson, 'the base\'s frame-phase Debug-digested operators write typed values').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted result that digests its Debug text: test.dbg.out's digest differs between the two builds, and the comparison fails naming test.dbg.out and nothing else`, () => {
    const doc = board('Planted Debug digest', [
      rect('r0', 0), text('t1', 1),
      { id: 'd0', kind: 'test.dbg@1', name: 'Planted', order: 'a000002', params: { box: [10, 10, 40, 20] } },
    ], requires({ 'test.dbg': '^1' }));
    const a = evalOf(builds.bin(PLANTED), doc);
    const b = evalOf(builds.bin(PLANTED_ALT), doc);
    const planted = a.nodes.filter((n) => n.operator === 'test.dbg.out');
    expect(planted.length, 'the planted operator has a node for its item').toBe(1);
    expect(planted[0]!.debug, 'the planted result is a typed value with Debug text').not.toBeNull();
    expect(byId(b).get(nodeId(planted[0]!))?.debug, 'the planted result\'s Debug text differs between the builds').not.toBe(planted[0]!.debug);
    const { failures, operators } = nodeDifferences(a, b, 'the planted board, test-debug-digest without and with test-debug-alt');
    expect(operators, `the comparison fails and names the operator whose digest read its Debug text: ${failures.join('; ')}`).toEqual(['test.dbg.out']);
    expect(failures.some((f) => f.includes('test.dbg.out') && f.includes('result digest')), 'the failure is its result digest').toBe(true);
  }, 1_800_000);
});
