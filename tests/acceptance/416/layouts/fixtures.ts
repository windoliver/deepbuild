// This suite's programs (as WebAssembly text), data assets, packs and documents (README: The surface). Every program
// is this job's fixture, written from the issue and the design; none is the implementation's. `checkFixtures` runs the
// validators and the provider in Node's own WebAssembly first, so a fixture fault fails as one and never as the
// implementation's.

import { expect } from 'vitest';
import { assemble, provideInNode, sha256, validateInNode, writePack, type JsonObject, type PackDir, type Program } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The nn.weights layout's bytes (README: The nn.weights layout), little-endian: `magic` "NNWT" at 0, `count` u32 at 4,
// then `weights[i]` f32 at 8 + 4i. Valid when the bytes are exactly 8 + 4 × count long and no weight is a NaN.

/** "NNWT" read as a little-endian u32. */
const MAGIC = 0x54_57_4e_4e;
/** The f32 bits of the NaN the tests plant: the canonical quiet NaN. */
export const NAN_BITS = 0x7f_c0_00_00;
/** The criterion's NaN: the weight whose first byte is byte 4,096 (weights[1022]). */
export const NAN_AT = 4_096;
/** The weights of the 8,200-byte asset criterion 5 names. */
export const COUNT = 2_048;
export const MIB = 1024 * 1024;
/** A 16 MiB weights file (criterion 7): 8 + 4 × 4,194,302 = 16,777,216 bytes. */
export const COUNT_16_MIB = (16 * MIB - 8) / 4;

/** An nn.weights asset of `count` weights, weights[i] = i ÷ 1024 (exact in f32), `first` in weights[0] when given, and the canonical NaN's bits at byte `nanAt` when given. */
export function weights(count: number, opts: { nanAt?: number; first?: number } = {}): Buffer {
  const b = Buffer.alloc(8 + 4 * count);
  b.writeUInt32LE(MAGIC, 0);
  b.writeUInt32LE(count, 4);
  for (let i = 0; i < count; i++) b.writeFloatLE(i / 1024, 8 + 4 * i);
  if (opts.first !== undefined) b.writeFloatLE(opts.first, 8);
  if (opts.nanAt !== undefined) b.writeUInt32LE(NAN_BITS, opts.nanAt);
  return b;
}

/** The criterion's file without the NaN, and with it (weights[1022], whose first byte is 4,096, a NaN). */
export const GOOD = weights(COUNT);
export const WITH_NAN = weights(COUNT, { nanAt: NAN_AT });
/** The layout's malformed twins: two weights, the second a NaN (bad at byte 12); and GOOD cut to 4,100 bytes, its count still 2,048 (bad at byte 4, the count). */
export const TWIN_NAN = weights(2, { nanAt: 12 });
export const TWIN_TRUNCATED = GOOD.subarray(0, 4_100);

/** Where a validator reads its asset. */
const IN_AT = 1_024;
/**
 * The nn.weights validator: `validate(len) → i64`, −1 when valid, else the first bad byte's offset: 0 for bytes shorter
 * than the header or another magic, 4 (the count) when the bytes aren't exactly 8 + 4 × count long, 8 + 4i for a NaN at
 * weights[i] (an f32 whose bits past the sign are above 0x7f800000). Its memory is one page here; the sandbox module's
 * runner sizes a validator's memory to its asset plus 4 MiB. `planted`: the same validator without the count check,
 * so it reads the weights the bytes hold, whatever the count says, and accepts its own truncated twin (criterion 5).
 */
export const weightsValidator = (planted: boolean): string => `
(module
  (memory (export "memory") 1 1)
  (global (export "in_at") i32 (i32.const ${IN_AT}))
  (func (export "validate") (param $len i64) (result i64) (local $at i32) (local $end i32)
    (if (i64.lt_u (local.get $len) (i64.const 8)) (then (return (i64.const 0))))
    (if (i32.ne (i32.load (i32.const ${IN_AT})) (i32.const ${MAGIC})) (then (return (i64.const 0))))${planted ? '' : `
    (if (i64.ne (local.get $len) (i64.add (i64.const 8) (i64.shl (i64.extend_i32_u (i32.load (i32.const ${IN_AT + 4}))) (i64.const 2))))
      (then (return (i64.const 4))))`}
    (local.set $at (i32.const ${IN_AT + 8}))
    (local.set $end (i32.add (i32.const ${IN_AT}) (i32.wrap_i64 (local.get $len))))
    (block $done
      (loop $next
        (br_if $done (i32.gt_u (i32.add (local.get $at) (i32.const 4)) (local.get $end)))
        (if (i32.gt_u (i32.and (i32.load (local.get $at)) (i32.const 0x7fffffff)) (i32.const 0x7f800000))
          (then (return (i64.extend_i32_u (i32.sub (local.get $at) (i32.const ${IN_AT}))))))
        (local.set $at (i32.add (local.get $at) (i32.const 4)))
        (br $next)))
    (i64.const -1)))`;

/** The provider's memory: its params (one i64, `nan`), its assets (none) and its output, a u32 length then the asset. */
const GEN = { params_at: 1_024, assets_at: 2_048, out_at: 4_096 } as const;
/**
 * The weights provider (gen@1): `gen(seed)` writes GOOD at out_at (after its u32 length), and with its bool param `nan`
 * (an i64 at params_at, 1 for true) the canonical NaN's bits at the asset's byte 4,096, so it writes WITH_NAN.
 */
export const weightsProvider = (): string => `
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const ${GEN.params_at}))
  (global (export "assets_at") i32 (i32.const ${GEN.assets_at}))
  (global (export "out_at") i32 (i32.const ${GEN.out_at}))
  (func (export "gen") (param $seed i64) (result i32) (local $i i32)
    (i32.store (i32.const ${GEN.out_at}) (i32.const ${8 + 4 * COUNT}))
    (i32.store (i32.const ${GEN.out_at + 4}) (i32.const ${MAGIC}))
    (i32.store (i32.const ${GEN.out_at + 8}) (i32.const ${COUNT}))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (i32.const ${COUNT})))
        (f32.store (i32.add (i32.const ${GEN.out_at + 12}) (i32.shl (local.get $i) (i32.const 2)))
          (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 0.0009765625)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (if (i64.ne (i64.load (i32.const ${GEN.params_at})) (i64.const 0))
      (then (i32.store (i32.const ${GEN.out_at + 4 + NAN_AT}) (i32.const ${NAN_BITS}))))
    (i32.const 0)))`;

/**
 * The reader (logic@1): a logic item whose first data asset is copied to assets_at (8192) as a u32 length then its
 * bytes; each step it writes `head` (i32 × 2): the asset's length and its count.
 */
export const reader = (): string => `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "assets_at") i32 (i32.const 8192))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (i32.store (i32.const 4096) (i32.load (i32.const 8192)))
    (i32.store (i32.const 4100) (i32.load (i32.const 8200)))))`;

export const program = {
  validator: (): Program => assemble('nn_weights_validator', weightsValidator(false)),
  planted: (): Program => assemble('nn_weights_planted', weightsValidator(true)),
  provider: (): Program => assemble('nn_weights_provider', weightsProvider()),
  reader: (): Program => assemble('reader', reader()),
};

/**
 * The fixtures' own answers, in Node's WebAssembly: the validator admits GOOD and refuses WITH_NAN at 4,096, the NaN twin
 * at 12 and the truncated twin at 4 (the count); the planted validator gives the same but admits the truncated twin;
 * the provider writes GOOD, and WITH_NAN with `nan`.
 */
export function checkFixtures(): void {
  const fault = (what: string): string => `this suite's ${what} (a fixture fault, not the implementation's)`;
  const shipped = [GOOD, WITH_NAN, TWIN_NAN, TWIN_TRUNCATED].map((b) => validateInNode(program.validator(), b));
  expect(shipped, fault('validator gives GOOD −1, WITH_NAN 4,096, the NaN twin 12, the truncated twin 4')).toEqual([-1, NAN_AT, 12, 4]);
  const planted = [GOOD, WITH_NAN, TWIN_NAN, TWIN_TRUNCATED].map((b) => validateInNode(program.planted(), b));
  expect(planted, fault('planted validator gives GOOD −1, WITH_NAN 4,096, the NaN twin 12 and accepts the truncated twin')).toEqual([-1, NAN_AT, 12, -1]);
  expect(sha256(provideInNode(program.provider(), [0n])), fault('provider writes GOOD')).toBe(sha256(GOOD));
  expect(sha256(provideInNode(program.provider(), [1n])), fault('provider writes WITH_NAN with nan')).toBe(sha256(WITH_NAN));
}

// ---------------------------------------------------------------------------------------------------
// Packs (README: Test packs), each a folder with pack.json listing its assets by sha256.

export const LAYOUT = 'nnweights.nn.weights@1';
export const PLANTED_LAYOUT = 'nnplanted.nn.weights@1';
export const PROVIDER = 'nnweights.weights';
const WEIGHTS_DOC = 'Weights for a small network, little-endian: the magic NNWT, a u32 count, then count f32 weights, none a NaN: '
  + 'exactly 8 + 4 × count bytes. A refusal names the first bad byte: 0 for the header, 4 for a count the bytes do not hold, '
  + '8 + 4i for a NaN at weights[i].';
const layoutOf = (validator: Program): JsonObject => ({
  validator: validator.sha, max_bytes: 16 * MIB, twins: [sha256(TWIN_NAN), sha256(TWIN_TRUNCATED)], doc: WEIGHTS_DOC,
});
const twins = { 'twin_nan.bin': TWIN_NAN, 'twin_truncated.bin': TWIN_TRUNCATED };

/** `test/nnweights@1.0.0`: the layout nnweights.nn.weights@1 and the provider nnweights.weights writing data in it. */
export function weightsPack(root: string): PackDir {
  return writePack(root, 'test', {
    name: 'nnweights', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #416 layouts acceptance suite: a weights layout whose validator refuses NaN, and a provider writing it.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    layouts: { [LAYOUT]: layoutOf(program.validator()) },
    providers: {
      weights: {
        program: program.provider().sha, params: { nan: { type: 'bool', default: false } },
        out: { data: { layout: LAYOUT, max_bytes: 16 * MIB } },
      },
    },
  }, { 'nn_weights_validator.wasm': program.validator().bytes, 'nn_weights_provider.wasm': program.provider().bytes, ...twins });
}

/** `test/nnplanted@1.0.0`: the same layout and twins under the planted validator, which accepts the truncated twin. */
export function plantedPack(root: string): PackDir {
  return writePack(root, 'test', {
    name: 'nnplanted', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #416 layouts acceptance suite: a weights layout whose validator skips the count check.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    layouts: { [PLANTED_LAYOUT]: layoutOf(program.planted()) },
  }, { 'nn_weights_planted.wasm': program.planted().bytes, ...twins });
}

/** Criterion 6's plug-in: a data.layout@1 entry of the plug-in test.weights, its kit passed, filled outside any pack. */
export function pluginLayout(): JsonObject {
  return {
    plugin: 'test.weights', registry: 'data.layout@1',
    entry: { name: 'test.weights.nn@1', ...layoutOf(program.validator()) },
    kit: { verdict: 'PASS', rules: [] },
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents in the agent's form (#393: no `id`, no `layers`), each item given its ID, name and order key.

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test data made by the #416 layouts acceptance tests.' };
/** The envelope's data asset: `{sha256, license}`, and `layout` when given (README: A data asset's layout). */
export const dataAsset = (bytes: Buffer, layout?: string): JsonObject => ({ sha256: sha256(bytes), license: LICENSE, ...(layout ? { layout } : {}) });

export function board(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}: a #416 layouts acceptance fixture.`, size: [640, 360], seed: 416,
    requires: { modules: { logic: '^1' } }, ...extra,
    items: Object.fromEntries(Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }])),
  };
}
/** The reader as a logic item at 60 Hz naming `assets`: asset IDs, or a provider use `{gen, params}` (#192). */
export const readerItem = (assets: (string | JsonObject)[]): JsonObject =>
  ({ kind: 'logic@1', params: { program: program.reader().sha, step_rate: 60, writes: { head: { type: 'i32', count: 2 } }, assets } });
/** A rect whose x a channel moves from 20 to 400 px over the 2 s span, so every frame differs. */
export const MOVING: JsonObject = {
  transport: { span: '2s' },
  channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 20, interp: 'linear' }, k1: { t: '2s', value: 400, interp: 'linear' } } } },
};
export const mover = (): JsonObject => ({ kind: 'rect@1', params: { box: [20, 40, 120, 80], paint: { fill: { role: 'muted' } } } });
