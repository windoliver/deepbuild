// #213.b4f8dc3a, a blind redraft of criterion 3: "A step that writes 257 ray requests with max_per_step 256 traps
// services, naming physics.cast@1 and 257, and the item's arrays keep the last good step's; and each answered request
// adds 4,000 fuel to the next step in the bake".
//
// Both tests run a logic item with services {physics.cast@1: {max_per_step: 256}} on the first suite's range (its world
// `range`: a static wall whose face is at x = 10 m, and a post off the ray) through `deep-show run`, and read the item's
// bake through deep_query's logic read (#548's): each asked step's arrays and fuel, and the item's trap (README: The
// surface under test). A request names its world by the handle the first suite's `handles` gives, read from a probe run of
// the same document whose program asks nothing.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, REQUEST_BYTES, SESSION, TIMEOUT, arr, assemble, binOf, handleOf, handlesOf, int, isObject, logicCall, obj,
  rayBytes, requestAt, resultCountAt, runShow, scenario, show, showCall, useBuilds, useTemp,
  type JsonObject, type JsonValue, type LogicItem, type Program,
} from '../213/helpers.ts';
import { RANGE, castParams, rangeScene } from '../213/fixtures.ts';

const AC = CRITERIA[3];
/** The criterion's max_per_step, physics.cast@1's own most (256 a step), and its fuel_per_request. */
const MAX = 256;
const FUEL_PER_REQUEST = 4_000;
/** The step that writes 257 requests. */
const TRAP_STEP = 20;
/** A step after 256 answered requests pays 1,024,000 more than its own, past the default 1,000,000. */
const FUEL_BUDGET = 4_000_000;

// The programs' memory: 8 pages; the read region (the seed) at 0, the write region at 4,096, the services block at
// 65,536 (the first suite's layout: a u32 count, 4 zero bytes, 256 requests of 160 bytes, a u32 result count, 4 zero
// bytes, 256 results), the program's own ray requests at 262,144 and the meter's counts at 393,216.
const PAGES = 8;
const W = 4_096;
const S = 65_536;
const RAYS_AT = 262_144;
const COUNTS_AT = 393_216;

/** Bytes as a WebAssembly text data string. */
const data = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');
/** A program that asks physics.cast@1: `step(k)` is `body`, with one i32 local `$c`. */
const program = (name: string, body: string, segments = ''): Program => assemble(name, `
(module
  (memory (export "memory") ${PAGES} ${PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (global (export "services_at") i32 (i32.const ${S}))
  (func (export "init") (param $seed i64))${segments}
  (func (export "step") (param $k i64) (local $c i32)${body}))`);

/**
 * `n` ray requests in world `world` (its handle), every group, 100 m from the origin: the even ones along +x, hitting
 * the wall, the odd ones along -x, hitting nothing, so some answers hold no hit.
 */
const rays = (world: number, n: number): Buffer =>
  Buffer.concat(Array.from({ length: n }, (_, i) => rayBytes(world, -1, 100, [0, 0, 0], i % 2 === 0 ? [1, 0, 0] : [-1, 0, 0])));

/** The probe's program: asks nothing (the request count stays 0) and writes nothing. */
const idle = (): Program => program('ac3_redraft_idle', '');

/**
 * The flood: every step `n` = k and `asked` = its request count, then its requests copied from its own: 256 at every
 * step but step 20, which writes 257 (the 257th past the region's 256 slots) and the count 257.
 */
const flood = (world: number): Program => program(`ac3_redraft_flood_${world}`, `
    (local.set $c (select (i32.const ${MAX + 1}) (i32.const ${MAX}) (i64.eq (local.get $k) (i64.const ${TRAP_STEP}))))
    (i32.store (i32.const ${W}) (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${W + 8}) (local.get $c))
    (memory.copy (i32.const ${requestAt(S, 0)}) (i32.const ${RAYS_AT}) (i32.mul (local.get $c) (i32.const ${REQUEST_BYTES})))
    (i32.store (i32.const ${S}) (local.get $c))`, `
  (data (i32.const ${RAYS_AT}) "${data(rays(world, MAX + 1))}")`);
const FLOOD_WRITES: JsonObject = { n: { type: 'i32' }, asked: { type: 'i32' } };

/** The meter's request counts, step k asking COUNTS[k mod 8]: none, a few, the most and one short of it. */
const COUNTS = [3, 0, 1, 256, 2, 255, 0, 7];
/**
 * The meter: every step the same instructions, so the same own fuel: `answered` = the result count it reads (the
 * requests the step before had answered), `asked` = COUNTS[k mod 8], the same 256 requests copied into the region and
 * the count COUNTS[k mod 8].
 */
const meter = (world: number): Program => {
  const counts = Buffer.alloc(4 * COUNTS.length);
  COUNTS.forEach((c, i) => counts.writeUInt32LE(c, 4 * i));
  return program(`ac3_redraft_meter_${world}`, `
    (i32.store (i32.const ${W + 8}) (i32.load (i32.const ${resultCountAt(S, MAX)})))
    (local.set $c (i32.load (i32.add (i32.const ${COUNTS_AT})
      (i32.shl (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const ${COUNTS.length}))) (i32.const 2)))))
    (i32.store (i32.const ${W}) (local.get $c))
    (memory.copy (i32.const ${requestAt(S, 0)}) (i32.const ${RAYS_AT}) (i32.const ${MAX * REQUEST_BYTES}))
    (i32.store (i32.const ${S}) (local.get $c))`, `
  (data (i32.const ${RAYS_AT}) "${data(rays(world, MAX))}")
  (data (i32.const ${COUNTS_AT}) "${data(counts)}")`);
};
const METER_WRITES: JsonObject = { asked: { type: 'i32' }, answered: { type: 'i32' } };

useBuilds(['show']);
const temp = useTemp();

/** The logic item: physics.cast@1 at max_per_step 256, its writes, and a fuel budget 256 answers fit in. */
const item = (p: Program, writes: JsonObject): LogicItem => ({ program: p, params: castParams(MAX, { writes, budget: { fuel: FUEL_BUDGET } }) });

/** A `deep_show` reply that presented its document with no error issue; the message shows the issues when it didn't. */
function isPresented(reply: JsonObject | undefined, what: string): void {
  const issues = reply?.['issues'];
  const errors = (Array.isArray(issues) ? issues : []).filter((i) => isObject(i) && i['severity'] === 'error');
  expect({ outcome: reply?.['outcome'], errors }, `${what} is presented with no error`).toEqual({ outcome: 'presented', errors: [] });
}

interface BakeStep { step: number; arrays: Record<string, JsonValue>; fuel: JsonValue }
interface Bake { steps: BakeStep[]; trap: JsonObject | null }
/** deep_query's logic read (#548's): the item's bake over the document's span, at `steps`. */
const queryLogic = (doc: string, id: string, steps: number[]): JsonObject => ({ call: 'deep_query', session: SESSION, doc, what: 'logic', items: [id], steps });

/**
 * Item `id` of the range, made by `make` from its world's handle, presented and its bake read at `steps`. The handle is
 * read first, from the same document with the idle program in its place, presented and stepped once.
 */
function baked(id: string, make: (world: number) => Program, writes: JsonObject, doc: string, steps: number[], what: string): Bake {
  const bin = binOf('show');
  const ev = temp();
  const [probe, ran] = runShow(bin, scenario(ev, [doc], [showCall(doc, rangeScene(ev, { [id]: item(idle(), writes) })), logicCall(doc, 1)]), `${what}: the handle probe`);
  isPresented(probe, `${what}: the range with ${id} asking physics.cast@1 (its program asking nothing)`);
  expect(isObject(ran?.['handles']), `${what}: the logic reply gives the handles the range's world is interned to: ${show(ran)}`).toBe(true);
  const world = handleOf(handlesOf(ran, what), RANGE, null, what);

  const [shown, read] = runShow(bin, scenario(ev, [doc], [showCall(doc, rangeScene(ev, { [id]: item(make(world), writes) })), queryLogic(doc, id, steps)]), what);
  isPresented(shown, `${what}: the range with ${id}`);
  expect(read?.['code'] ?? read?.['error'], `${what}: deep_query reads the item's bake: ${show(read)}`).toBeUndefined();
  const one = obj(obj(read!['logic'], `${what}: logic`)[id], `${what}: logic.${id}`);
  const list = arr(one['steps'], `${what}: logic.${id}.steps`).map((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    return { step: int(o['step'], `${what}: steps[${i}].step`), arrays: obj(o['arrays'], `${what}: steps[${i}].arrays`), fuel: o['fuel'] ?? null };
  });
  expect(list.map((s) => s.step), `${what}: one answer per step asked, in order`).toEqual(steps);
  return { steps: list, trap: isObject(one['trap']) ? one['trap'] : null };
}

const span = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe(`${AC} physics.cast@1 past its max_per_step traps services, and each answered request costs the next step 4,000 fuel`, () => {
  it(`${AC} a step that writes 257 ray requests with max_per_step 256 traps services, naming physics.cast@1 and 257, and the item's arrays keep the last good step's`, () => {
    const steps = [...span(0, TRAP_STEP + 4), 60, 119];
    const bake = baked('flood', flood, FLOOD_WRITES, DOC(31), steps, 'the flood');

    expect(bake.trap, 'the flood traps once it asks 257').not.toBeNull();
    const t = bake.trap!;
    expect({ item: t['item'], step: t['step'], kind: t['kind'], service: t['service'], count: t['count'] },
      `the trap: step 20's, kind services, naming physics.cast@1 and the count 257 (${show(t)})`)
      .toEqual({ item: 'flood', step: TRAP_STEP, kind: 'services', service: 'physics.cast@1', count: MAX + 1 });

    // Steps 0 to 19 each asked 256, the most, without a trap; from step 20 on the arrays are step 19's, not the n = 20
    // and asked = 257 step 20 wrote.
    const got = bake.steps.map((s) => ({ step: s.step, n: s.arrays['flood.n'], asked: s.arrays['flood.asked'] }));
    const want = steps.map((k) => (k < TRAP_STEP ? { step: k, n: [k], asked: [MAX] } : { step: k, n: [TRAP_STEP - 1], asked: [MAX] }));
    expect(got, 'the bake\'s arrays: k and 256 to step 19, then step 19\'s at step 20 and every step after').toEqual(want);
  }, TIMEOUT);

  it(`${AC} each answered request adds 4,000 fuel to the next step in the bake`, () => {
    const steps = span(0, 40);
    const bake = baked('meter', meter, METER_WRITES, DOC(32), steps, 'the meter');
    expect(bake.trap, `the meter never traps: ${show(bake.trap)}`).toBeNull();

    // Step 0 follows no answered request, so its fuel is the program's own, the same at every step.
    const own = int(bake.steps[0]!.fuel, 'the meter: step 0\'s fuel');
    const asked = (k: number): number => COUNTS[k % COUNTS.length]!;
    const got = bake.steps.map((s) => ({
      step: s.step, asked: s.arrays['meter.asked'], answered: s.arrays['meter.answered'],
      added: int(s.fuel, `the meter: step ${s.step}'s fuel`) - own,
    }));
    const want = steps.map((k) => ({
      step: k, asked: [asked(k)], answered: [k === 0 ? 0 : asked(k - 1)], added: k === 0 ? 0 : FUEL_PER_REQUEST * asked(k - 1),
    }));
    expect(got, 'step k asks COUNTS[k mod 8], all are answered, and step k + 1 pays 4,000 fuel for each, past its own').toEqual(want);
  }, TIMEOUT);
});
