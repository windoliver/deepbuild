// #429.19822424: a same_machine operator that feeds a check makes the check refuse with not_exact.
// #429.776136eb: classes are computed: an operator of integer steps only computes as exact, and one with an f32
// multiply as same_machine; declared exact, the second is refused with not_exact naming the step, while declared
// live_only it checks and draws its fallback in canonical renders; and a planted check that takes the declared
// class instead of the computed one accepts the exact declaration and fails, naming the operator; an
// integer-only operator that reads object_id computes as same_machine, since a rasterized target is same
// machine, and declared exact it's refused with not_exact naming the input.
// #429.de9c4690: an integer graph with one f32 `lt`, and one with one f32 `floor`, compute as same_machine, and
// declared exact each is refused with not_exact naming that step; a planted op table that marks f32 compares or
// f32 floor exact accepts both and fails, naming the entry. Oracle (port; formula): the WebGPU CTS at
// e325d0bcc2 lets a GPU flush a subnormal f32 input, so binary/f32_comparison.cache.ts's makeCase accepts lt for
// the inputs as given or flushed, and floor.cache.ts's interval spans floor of a subnormal and of its flush
// (util/floating_point.ts:915-919, addFlushedIfNeeded); run here on our GPU through #380's `op` call.
//
// Through `check_operator` with `class`, the computed class, added to its reply, and #379's `canonical` (a
// headless canonical render, whose document check refuses a document with `{code: "refused", issues}`). Floats
// enter the integer graphs only as bits (bitcast), so each graph has exactly one f32 step. At the base the
// check names no step for not_exact, gives no class, has no check reading an operator and draws no operator item.
import { describe, expect, it } from 'vitest';
import {
  asItem, canonicalCall, canonicalOf, checkCall, checked, errors, figure, isObject, objs, payload, requireGpu, run, shown, useBins, useOut, writeJson,
  type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();

const E = { op: 'element@1', args: {} };
const asF32 = (x: string): JsonObject => ({ op: 'bitcast@1', args: { x, to: 'f32' } });
const asU32 = (x: string): JsonObject => ({ op: 'bitcast@1', args: { x, to: 'u32' } });
const graph = (id: string, steps: JsonObject, extra: JsonObject = {}): JsonObject => ({
  id, kind: 'compute', origin: 'composed', about: `The #429 class fixture ${id}.`, inputs: {}, steps,
  outputs: { out: { storage: { type: 'u32', count: 64 } } }, elements: 64, workgroup: 64, cost: { ns_per_element: 1000 }, ...extra,
});
const INTS = graph('ints', { e: E, a: { op: 'add@1', args: { a: 'e', b: 'e' } }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'a' } } });
const F32MUL_STEPS: JsonObject = { e: E, x: asF32('e'), m: { op: 'mul@1', args: { a: 'x', b: 'x' } }, b: asU32('m'), w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'b' } } };
const f32mul = (determinism?: string): JsonObject => graph('f32mul', F32MUL_STEPS, determinism ? { determinism } : {});
/** A pass whose one f32 step multiplies a color carried as bits: it paints the frame (0.25, 0, 0, 1). */
const SCALE_BITS = [0x3f000000, 0, 0, 0x3f800000];
const scale = (determinism: string): JsonObject => ({
  id: 'scale', kind: 'pass', origin: 'composed', about: 'Paints the frame (0.5, 0, 0, 1) squared, its one f32 step a multiply.', inputs: {},
  steps: { k: { op: 'const@1', args: { value: SCALE_BITS, type: 'vec4<u32>' } }, f: { op: 'bitcast@1', args: { x: 'k', to: 'vec4<f32>' } }, m: { op: 'mul@1', args: { a: 'f', b: 'f' } } },
  outputs: { color: 'm' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 50 }, fallback: 'look', determinism,
});
const ids = (determinism?: string): JsonObject => ({
  id: 'ids', kind: 'pass', origin: 'composed', about: 'Shows the object-ID target as bits, integer steps only.',
  inputs: { ids: { type: 'texture<u32>', from: { texture: { target: { op: 'core', output: 'object_id' } } } } },
  steps: { px: { op: 'pixel@1', args: {} }, l: { op: 'load@1', args: { tex: 'ids', ixy: 'px' } }, b: { op: 'bitcast@1', args: { x: 'l', to: 'vec4<f32>' } } },
  outputs: { color: 'b' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 50 }, fallback: 'look', ...(determinism ? { determinism } : {}),
});

/** The criterion's class checks; each problem names the operator. */
function classProblems(planted?: Planted): string[] {
  const calls = [checkCall(INTS), checkCall(f32mul()), checkCall(f32mul('exact')), checkCall(f32mul('live_only')), checkCall(ids()), checkCall(ids('exact'))];
  const [ints, mul, mulExact, mulLive, idsAny, idsExact] = run(bins.bin(), out(), calls, planted).map((r, i) => checked(r, `call ${i}`));
  const p: string[] = [];
  if (ints!.outcome !== 'accepted' || ints!.cls !== 'exact') p.push(`ints (integer steps only) computes as ${ints!.cls} (${ints!.outcome}), not exact`);
  if (mul!.outcome !== 'accepted' || mul!.cls !== 'same_machine') p.push(`f32mul computes as ${mul!.cls} (${mul!.outcome}), not same_machine`);
  if (mulExact!.outcome !== 'refused') p.push(`f32mul declared exact was ${mulExact!.outcome}`);
  else if (!errors(mulExact!, 'not_exact').some((e) => e['step'] === 'm')) p.push(`f32mul declared exact: no not_exact names step m: ${shown(mulExact!.issues)}`);
  if (mulLive!.outcome !== 'accepted') p.push(`f32mul declared live_only was ${mulLive!.outcome}: ${shown(mulLive!.issues)}`);
  if (idsAny!.outcome !== 'accepted' || idsAny!.cls !== 'same_machine') p.push(`ids (reads object_id) computes as ${idsAny!.cls} (${idsAny!.outcome}), not same_machine`);
  if (idsExact!.outcome !== 'refused') p.push(`ids declared exact was ${idsExact!.outcome}`);
  else if (!errors(idsExact!, 'not_exact').some((e) => e['path'] === 'inputs/ids')) p.push(`ids declared exact: no not_exact names the input ids (path inputs/ids): ${shown(idsExact!.issues)}`);
  return p;
}

describe('#429.776136eb classes are computed from the steps and inputs, never taken from the declaration', () => {
  it('#429.776136eb integer steps compute exact, an f32 multiply same_machine (refused declared exact, naming step m; accepted declared live_only), object_id same_machine (refused declared exact, naming the input)', () => {
    requireGpu();
    expect(classProblems()).toEqual([]);
  }, 1_800_000);

  it('#429.776136eb declared live_only, the f32 multiply draws its fallback in a canonical render: equal to the figure without it, while declared same_machine it draws', () => {
    requireGpu();
    const docs = {
      without: writeJson(out(), 'without.json', payload(figure('classes-429'))),
      live: writeJson(out(), 'live.json', payload(figure('classes-429', { scale: asItem(scale('live_only')) }))),
      drawn: writeJson(out(), 'drawn.json', payload(figure('classes-429', { scale: asItem(scale('same_machine')) }))),
    };
    const [without, live, drawn] = run(bins.bin(), out(), [canonicalCall(docs.without, 61, 'export'), canonicalCall(docs.live, 61, 'export'), canonicalCall(docs.drawn, 61, 'export')])
      .map((r, i) => canonicalOf(r, ['without', 'live_only', 'same_machine'][i]!));
    expect(without!.pixel_hash, 'the figure draws').not.toBeNull();
    expect(drawn!.pixel_hash, 'declared same_machine, the operator draws in the canonical render').not.toBe(without!.pixel_hash);
    expect(live!.pixel_hash, 'declared live_only, the canonical render draws its fallback: the figure without it').toBe(without!.pixel_hash);
  }, 1_800_000);

  it('#429.776136eb a planted check that takes the declared class (--planted takes_declared_class) accepts f32mul declared exact and fails, naming the operator', () => {
    requireGpu();
    expect(classProblems('takes_declared_class').join('\n')).toMatch(/f32mul declared exact was accepted/);
  }, 1_800_000);
});

const LT = graph('ltg', {
  e: E, x: asF32('e'), z: { op: 'const@1', args: { value: 0, type: 'u32' } }, one: { op: 'const@1', args: { value: 1, type: 'u32' } }, zf: asF32('z'),
  lt: { op: 'lt@1', args: { a: 'x', b: 'zf' } }, s: { op: 'select@1', args: { f: 'z', t: 'one', cond: 'lt' } }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 's' } },
});
const FLOOR = graph('floorg', { e: E, x: asF32('e'), fl: { op: 'floor@1', args: { x: 'x' } }, b: asU32('fl'), w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'b' } } });
const declared = (g: JsonObject): JsonObject => ({ ...g, determinism: 'exact' });

function compareProblems(planted?: Planted): string[] {
  const [lt, fl, ltExact, flExact] = run(bins.bin(), out(), [checkCall(LT), checkCall(FLOOR), checkCall(declared(LT)), checkCall(declared(FLOOR))], planted).map((r, i) => checked(r, `call ${i}`));
  const p: string[] = [];
  for (const [c, entry] of [[lt!, 'lt@1'], [fl!, 'floor@1']] as const) if (c.cls !== 'same_machine') p.push(`the graph with one f32 ${entry} computes as ${c.cls}, not same_machine (op table entry ${entry})`);
  for (const [c, step, entry] of [[ltExact!, 'lt', 'lt@1'], [flExact!, 'fl', 'floor@1']] as const) {
    if (c.outcome !== 'refused') p.push(`declared exact, the graph with one f32 ${entry} was ${c.outcome} (op table entry ${entry})`);
    else if (!errors(c, 'not_exact').some((e) => e['step'] === step)) p.push(`declared exact, no not_exact names step ${step}: ${shown(c.issues)}`);
  }
  return p;
}

const f32Bits = (x: number): number => { const f = new Float32Array([x]); return new Uint32Array(f.buffer)[0]!; };
const f32Of = (b: number): number => new Float32Array(new Uint32Array([b >>> 0]).buffer)[0]!;

describe('#429.de9c4690 one f32 lt or one f32 floor makes an integer graph same_machine', () => {
  it('#429.de9c4690 each computes as same_machine and declared exact is refused with not_exact naming step lt or fl; on this GPU CTS accepts either reading of a subnormal', () => {
    requireGpu();
    expect(compareProblems()).toEqual([]);
    // The CTS port: lt(-2^-149, 0) is true as given and false flushed; floor(-2^-149) lies in [floor(-2^-149), floor(0)] = [-1, 0].
    const sub = -(2 ** -149);
    const [lt, fl] = run(bins.bin(), out(), [
      { call: 'op', op: 'lt@1', types: ['f32', 'f32'], rows: [[f32Bits(sub), f32Bits(0)]] },
      { call: 'op', op: 'floor@1', types: ['f32'], rows: [[f32Bits(sub)]] },
    ]);
    const ltBit = (lt!['gpu'] as number[])[0];
    expect([0, 1], `CTS f32_comparison accepts either lt(-2^-149, 0): this GPU gave ${shown(lt!)}`).toContain(ltBit);
    const floorValue = f32Of((fl!['gpu'] as number[])[0]!);
    expect(floorValue >= -1 && floorValue <= 0, `CTS floor's interval for -2^-149 is [-1, 0]: this GPU gave ${floorValue}`).toBe(true);
  }, 1_800_000);

  it('#429.de9c4690 a planted op table that marks f32 compares and floor exact (--planted f32_compare_floor_exact) accepts both and fails, naming the entry', () => {
    requireGpu();
    const p = compareProblems('f32_compare_floor_exact').join('\n');
    expect(p, 'names the compare entry').toMatch(/op table entry lt@1/);
    expect(p, 'names the floor entry').toMatch(/op table entry floor@1/);
  }, 1_800_000);
});

// A check whose result holds on any machine, probing an operator's readback.
const total = (exact: boolean): JsonObject => ({
  id: 'sum', kind: 'compute', origin: 'composed', about: 'One word for a check to read back.', inputs: {},
  steps: exact
    ? { e: E, a: { op: 'add@1', args: { a: 'e', b: 'e' } }, w: { op: 'write@1', args: { buf: 'total', i: 'e', v: 'a' } } }
    : { ...F32MUL_STEPS, w: { op: 'write@1', args: { buf: 'total', i: 'e', v: 'b' } } },
  outputs: { total: { readback: { type: 'u32', count: 1, bytes: 4 } } }, elements: 1, workgroup: 64, cost: { ns_per_element: 1000 },
  determinism: exact ? 'exact' : 'same_machine',
});
const withCheck = (exact: boolean): JsonObject => {
  const doc = figure('check-429', { sum: asItem(total(exact)) });
  doc['checks'] = { total_ok: { kind: 'honest_numbers', probe: 'items/sum/outputs/total', expect: 0, machines: 'any' } };
  return payload(doc);
};

describe('#429.19822424 a same_machine operator that feeds a check makes the check refuse with not_exact', () => {
  it('#429.19822424 the check total_ok reading a same_machine readback is refused with not_exact; reading the exact one it is not', () => {
    requireGpu();
    const [same, exact] = run(bins.bin(), out(), [
      canonicalCall(writeJson(out(), 'same.json', withCheck(false)), 1, 'export'),
      canonicalCall(writeJson(out(), 'exact.json', withCheck(true)), 1, 'export'),
    ]);
    const issuesOf = (r: JsonObject): JsonObject[] => objs(r['issues'] ?? [], 'issues');
    const notExact = issuesOf(same!).filter((i) => i['code'] === 'not_exact' && typeof i['path'] === 'string' && i['path'].startsWith('checks/total_ok'));
    expect(same!['code'], `the document whose check reads a same_machine readback is refused: ${shown(same!)}`).toBe('refused');
    expect(notExact.length, `with not_exact naming the check (path checks/total_ok): ${shown(same!)}`).toBeGreaterThan(0);
    expect(issuesOf(exact!).filter((i) => i['code'] === 'not_exact'), `reading the exact operator's readback raises no not_exact: ${shown(exact!)}`).toEqual([]);
    expect(isObject(exact!) && exact!['code'], 'and the document renders').toBeUndefined();
  }, 1_800_000);
});
