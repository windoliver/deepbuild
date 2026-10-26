// #380.639458be (the exact half, and the Oracle lane): every exact operator gives identical bits on two GPUs
// of different families (an M1 and an M3); with one GPU that comparison is BLOCKED with one unblock ask,
// never PASS. The CPU-reference half is reference.test.ts.
// The Oracle page links one upstream family for this criterion: the WebGPU CTS expression tests at gpuweb/cts
// e325d0bcc2cb785c4eab1d908339019215bd9462 (src/webgpu/shader/execution/expression/{binary,unary,call/builtin}),
// "port; formula". They run each WGSL operation on the GPU against values the CPU computes: integers and
// bools exactly, f32 within the interval each operation's accuracy gives. Ported here against our output, as
// #136 requires: the `op` call builds a compute operator from the public step it names, runs it through the
// core's check, compile and dispatch on this GPU, and also through the step graph's CPU interpreter (the one
// the CPU references are built on), one result per row. Ported: binary/{i32,u32}_arithmetic (+ - * / % with
// the non-const rules: x / 0 = x, MIN / -1 = MIN, x % 0 = 0, MIN % -1 = 0, the remainder_negative values),
// bitwise, bitwise_shift (the shift masked to 5 bits), {i32,u32}_comparison, bool_logical, f32_addition,
// f32_subtraction, f32_multiplication (correctly rounded), f32_division (2.5 ULP for |y| in [2^-126, 2^126]),
// f32_comparison; unary/{i32,f32}_arithmetic (negation), bool_logical, {i32,u32}_complement;
// call/builtin/{abs, min, max, clamp, floor, ceil, trunc, countOneBits, firstLeadingBit, firstTrailingBit,
// inversesqrt (2 ULP), exp2 (3 + 2|x| ULP), log2 (2^-21 absolute on [0.5, 2], else 3 ULP), sin and cos
// (2^-11 absolute on [-π, π])}, over CTS's sparse value lists (sparseI32Range with i32's min and -2^30
// appended, as CTS lets a test append values of interest; sparseU32Range; sparseScalarF32Range, subnormals
// included, where WGSL lets a GPU flush them, so either reading passes, as CTS's intervals allow). Each
// check's own twin (one bit flipped in a result; a correctly rounded result moved two ULP) fails it, naming
// the operation and the row.
// The exact operators: the `exact` call runs every shipped exact operator on its exactness fixture and
// writes this GPU's record (its name and Metal family, each operator's output bits by hash); `cross_gpu`
// compares records. One family alone is BLOCKED with exactly one unblock ask; the record of another family
// with equal bits passes and one with an operator's bits changed fails naming it (the check's twins, from
// this machine's record); `--planted passes_one_gpu` reads one family as PASS. The real M1 against M3 run
// needs a record made on an M1: DEEPBUILD_M1_RECORD names its file; without it that test skips as BLOCKED,
// never passing. At the base `deep-gpu` has no op, exact or cross_gpu call.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATORS, arr, chipName, isObject, num, obj, operatorsReply, requireGpu, run, run1, shown, str, useBin, useOut, type JsonObject, type JsonValue, type Startup } from './helpers.ts';

const bins = useBin();
const out = useOut();

// ---------------------------------------------------------------------------------------------------
// Values and bits

const F = new Float32Array(1); const U = new Uint32Array(F.buffer);
const bitsOf = (x: number): number => { F[0] = x; return U[0]!; };
const fromBits = (b: number): number => { U[0] = b >>> 0; return F[0]!; };
const MIN_NORMAL = 2 ** -126;
const F32_MAX = fromBits(0x7f7fffff);
const nextUp = (x: number): number => (x === Infinity ? x : x === 0 ? 2 ** -149 : x > 0 ? fromBits(bitsOf(x) + 1) : fromBits(bitsOf(x) - 1));
const nextDown = (x: number): number => -nextUp(-x);
const roundDown = (v: number): number => { const r = Math.fround(v); return r > v ? nextDown(r) : r; };
const roundUp = (v: number): number => { const r = Math.fround(v); return r < v ? nextUp(r) : r; };
const ulp = (v: number): number => { const a = roundDown(v); const b = roundUp(v); return a !== b ? b - a : Math.min(a - nextDown(a), nextUp(a) - a); };
const isSubnormal = (x: number): boolean => x !== 0 && Math.abs(x) < MIN_NORMAL;
/** The readings a GPU may take of an input: itself, or flushed to zero when subnormal. */
const readings = (x: number): number[] => (isSubnormal(x) ? [x, 0] : [x]);

const I32_MIN = -2147483648;
// CTS sparseI32Range (kValue.i32.negative.max is 0 there), deduplicated, with i32's min and -2^30 appended.
const I32 = [...new Set([0, Math.trunc(0 / 2), -256, -10, -1, 0, 1, 10, 256, Math.trunc(2147483647 / 2), 2147483647, I32_MIN, -1073741824])];
const U32 = [0, 1, 10, 256, Math.trunc(4294967295 / 2), 4294967295];
const SHIFTS = [0, 1, 5, 31, 32, 33];
// CTS sparseScalarF32Range.
const F32S = [-F32_MAX, -10, -1, -0.125, -MIN_NORMAL, -(MIN_NORMAL - 2 ** -149), -(2 ** -149), -0, 0, 2 ** -149, MIN_NORMAL - 2 ** -149, MIN_NORMAL, 0.125, 1, 10, F32_MAX];
const REM_NEG: [number[], number[]] = [[-1, -2, -5, -255, -256, -768, -769, -1000, -1234567], [3, 7, 100, 256, 768, 1000]];

type Ty = 'i32' | 'u32' | 'f32' | 'bool';
const toBits = (ty: Ty, v: number | boolean): number => (ty === 'f32' ? bitsOf(v as number) : ty === 'bool' ? (v ? 1 : 0) : (v as number) >>> 0);
const pairs = (a: number[], b: number[]): [number, number][] => a.flatMap((x) => b.map((y): [number, number] => [x, y]));

// ---------------------------------------------------------------------------------------------------
// The exact cases: integer and bool results the CTS computes on the CPU.

interface ExactCase { op: string; types: Ty[]; result: Ty; rows: number[][]; expect: (r: number[]) => number; family: string }
const i = (x: number): number => x | 0;
const u = (x: number): number => x >>> 0;
const popcount = (x: number): number => { let v = x >>> 0; let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
const leadingI32 = (x: number): number => (x === 0 || x === -1 ? -1 : x > 0 ? 31 - Math.clz32(x) : 31 - Math.clz32(~x));
const leadingU32 = (x: number): number => (x === 0 ? 0xffffffff : 31 - Math.clz32(x));
const trailing = (x: number, ty: 'i32' | 'u32'): number => (x === 0 ? (ty === 'i32' ? -1 : 0xffffffff) : 31 - Math.clz32((x & -x) >>> 0));
const ib = (f: (a: number, b: number) => number): ((r: number[]) => number) => (r) => f(r[0]!, r[1]!);
const EXACT: ExactCase[] = [
  { op: 'add@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib((a, b) => i(a + b)), family: 'binary/i32_arithmetic addition' },
  { op: 'sub@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib((a, b) => i(a - b)), family: 'binary/i32_arithmetic subtraction' },
  { op: 'mul@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib((a, b) => Math.imul(a, b)), family: 'binary/i32_arithmetic multiplication' },
  { op: 'div@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib((a, b) => (b === 0 || (a === I32_MIN && b === -1) ? a : i(Math.trunc(a / b)))), family: 'binary/i32_arithmetic division_non_const' },
  { op: 'rem@1', types: ['i32', 'i32'], result: 'i32', rows: [...pairs(I32, I32), ...pairs(...REM_NEG)], expect: ib((a, b) => (b === 0 || (a === I32_MIN && b === -1) ? 0 : i(a % b))), family: 'binary/i32_arithmetic remainder_non_const, remainder_negative_non_const' },
  { op: 'add@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => u(a + b)), family: 'binary/u32_arithmetic addition' },
  { op: 'sub@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => u(a - b)), family: 'binary/u32_arithmetic subtraction' },
  { op: 'mul@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => u(Math.imul(a, b))), family: 'binary/u32_arithmetic multiplication' },
  { op: 'div@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => (b === 0 ? a : Math.floor(a / b))), family: 'binary/u32_arithmetic division_non_const' },
  { op: 'rem@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => (b === 0 ? 0 : a % b)), family: 'binary/u32_arithmetic remainder_non_const' },
  { op: 'neg@1', types: ['i32'], result: 'i32', rows: I32.map((a) => [a]), expect: (r) => i(-r[0]!), family: 'unary/i32_arithmetic negation' },
  { op: 'and@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => u(a & b)), family: 'binary/bitwise bitwise_and' },
  { op: 'or@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib((a, b) => u(a | b)), family: 'binary/bitwise bitwise_or' },
  { op: 'xor@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib((a, b) => a ^ b), family: 'binary/bitwise bitwise_exclusive_or' },
  { op: 'not@1', types: ['u32'], result: 'u32', rows: U32.map((a) => [a]), expect: (r) => u(~r[0]!), family: 'unary/u32_complement' },
  { op: 'not@1', types: ['i32'], result: 'i32', rows: I32.map((a) => [a]), expect: (r) => ~r[0]!, family: 'unary/i32_complement' },
  { op: 'shl@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, SHIFTS), expect: ib((a, b) => u(a << (b & 31))), family: 'binary/bitwise_shift shift_left_concrete' },
  { op: 'shr@1', types: ['i32', 'u32'], result: 'i32', rows: pairs(I32, SHIFTS), expect: ib((a, b) => a >> (b & 31)), family: 'binary/bitwise_shift shift_right_concrete (i32, arithmetic)' },
  { op: 'shr@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, SHIFTS), expect: ib((a, b) => a >>> (b & 31)), family: 'binary/bitwise_shift shift_right_concrete (u32)' },
  ...(['lt', 'le', 'gt', 'ge', 'eq', 'ne'] as const).flatMap((c) => (['i32', 'u32'] as const).map((ty): ExactCase => ({
    op: `${c}@1`, types: [ty, ty], result: 'bool', rows: ty === 'i32' ? pairs(I32, I32) : pairs(U32, U32),
    expect: ib((a, b) => Number(c === 'lt' ? a < b : c === 'le' ? a <= b : c === 'gt' ? a > b : c === 'ge' ? a >= b : c === 'eq' ? a === b : a !== b)), family: `binary/${ty}_comparison ${c}`,
  }))),
  { op: 'and@1', types: ['bool', 'bool'], result: 'bool', rows: pairs([0, 1], [0, 1]), expect: ib((a, b) => a & b), family: 'binary/bool_logical and' },
  { op: 'or@1', types: ['bool', 'bool'], result: 'bool', rows: pairs([0, 1], [0, 1]), expect: ib((a, b) => a | b), family: 'binary/bool_logical or' },
  { op: 'not@1', types: ['bool'], result: 'bool', rows: [[0], [1]], expect: (r) => 1 - r[0]!, family: 'unary/bool_logical negation' },
  { op: 'abs@1', types: ['i32'], result: 'i32', rows: I32.map((a) => [a]), expect: (r) => (r[0] === I32_MIN ? I32_MIN : Math.abs(r[0]!)), family: 'call/builtin/abs (i32)' },
  { op: 'min@1', types: ['i32', 'i32'], result: 'i32', rows: pairs(I32, I32), expect: ib(Math.min), family: 'call/builtin/min (i32)' },
  { op: 'max@1', types: ['u32', 'u32'], result: 'u32', rows: pairs(U32, U32), expect: ib(Math.max), family: 'call/builtin/max (u32)' },
  { op: 'clamp@1', types: ['i32', 'i32', 'i32'], result: 'i32', rows: I32.flatMap((x) => [[x, -10, 10], [x, -256, 256], [x, 0, 1]]), expect: (r) => Math.min(Math.max(r[0]!, r[1]!), r[2]!), family: 'call/builtin/clamp (i32)' },
  { op: 'count_ones@1', types: ['u32'], result: 'u32', rows: U32.map((a) => [a]), expect: (r) => popcount(r[0]!), family: 'call/builtin/countOneBits (u32)' },
  { op: 'first_leading_bit@1', types: ['i32'], result: 'i32', rows: I32.map((a) => [a]), expect: (r) => leadingI32(r[0]!), family: 'call/builtin/firstLeadingBit (i32)' },
  { op: 'first_leading_bit@1', types: ['u32'], result: 'u32', rows: U32.map((a) => [a]), expect: (r) => leadingU32(r[0]!), family: 'call/builtin/firstLeadingBit (u32)' },
  { op: 'first_trailing_bit@1', types: ['u32'], result: 'u32', rows: U32.map((a) => [a]), expect: (r) => trailing(r[0]!, 'u32'), family: 'call/builtin/firstTrailingBit (u32)' },
  { op: 'first_trailing_bit@1', types: ['i32'], result: 'i32', rows: I32.map((a) => [a]), expect: (r) => trailing(r[0]!, 'i32'), family: 'call/builtin/firstTrailingBit (i32)' },
];

// ---------------------------------------------------------------------------------------------------
// The f32 cases: each row's acceptance intervals (null: any result, as CTS allows there).

type Interval = [number, number];
interface FloatCase { op: string; arity: number; rows: number[][]; intervals: (r: number[]) => Interval[] | null; family: string; result?: 'f32' | 'bool' }
const rounded = (v: number): Interval[] | null => (Math.abs(v) > F32_MAX ? null : [[roundDown(v), roundUp(v)]]);
const ulps = (v: number, n: number): Interval[] | null => (Math.abs(v) > F32_MAX || !Number.isFinite(v) ? null : [[v - n * ulp(v), v + n * ulp(v)]]);
/** Every reading of the inputs (subnormals flushed or not), and a result near zero may also be flushed. */
function over(r: number[], f: (x: number[]) => Interval[] | null): Interval[] | null {
  const variants = r.reduce<number[][]>((acc, x) => acc.flatMap((a) => readings(x).map((y) => [...a, y])), [[]]);
  const all: Interval[] = [];
  for (const v of variants) {
    const got = f(v);
    if (got === null) return null;
    for (const [lo, hi] of got) all.push(hi > -MIN_NORMAL && lo < MIN_NORMAL ? [Math.min(lo, 0), Math.max(hi, 0)] : [lo, hi]);
  }
  return all;
}
const unary = (op: string, family: string, f: (x: number) => Interval[] | null, domain: number[] = F32S): FloatCase => ({ op, arity: 1, rows: domain.map((x) => [x]), intervals: (r) => over(r, (v) => f(v[0]!)), family });
const binary = (op: string, family: string, f: (a: number, b: number) => Interval[] | null): FloatCase => ({ op, arity: 2, rows: pairs(F32S, F32S), intervals: (r) => over(r, (v) => f(v[0]!, v[1]!)), family });
const exactly = (v: number): Interval[] => [[v, v]];
const FLOAT: FloatCase[] = [
  binary('add@1', 'binary/f32_addition', (a, b) => rounded(a + b)),
  binary('sub@1', 'binary/f32_subtraction', (a, b) => rounded(a - b)),
  binary('mul@1', 'binary/f32_multiplication', (a, b) => rounded(a * b)),
  binary('div@1', 'binary/f32_division', (a, b) => (Math.abs(b) < MIN_NORMAL || Math.abs(b) > 2 ** 126 ? null : ulps(a / b, 2.5))),
  binary('min@1', 'call/builtin/min (f32)', (a, b) => exactly(Math.min(a, b))),
  binary('max@1', 'call/builtin/max (f32)', (a, b) => exactly(Math.max(a, b))),
  unary('neg@1', 'unary/f32_arithmetic negation', (x) => exactly(-x)),
  unary('abs@1', 'call/builtin/abs (f32)', (x) => exactly(Math.abs(x))),
  unary('floor@1', 'call/builtin/floor (f32)', (x) => exactly(Math.floor(x))),
  unary('ceil@1', 'call/builtin/ceil (f32)', (x) => exactly(Math.ceil(x))),
  unary('trunc@1', 'call/builtin/trunc (f32)', (x) => exactly(Math.trunc(x))),
  unary('inverse_sqrt@1', 'call/builtin/inversesqrt (f32)', (x) => (x <= 0 ? null : ulps(1 / Math.sqrt(x), 2))),
  unary('exp2@1', 'call/builtin/exp2 (f32)', (x) => (2 ** x > F32_MAX ? null : ulps(2 ** x, 3 + 2 * Math.abs(x))), [...F32S.filter((x) => Math.abs(x) <= 10), -3.5, 0.5, 2.25, 7.75]),
  unary('log2@1', 'call/builtin/log2 (f32)', (x) => (x <= 0 ? null : x >= 0.5 && x <= 2 ? [[Math.log2(x) - 2 ** -21, Math.log2(x) + 2 ** -21]] : ulps(Math.log2(x), 3))),
  unary('sin@1', 'call/builtin/sin (f32)', (x) => (Math.abs(x) > Math.PI ? null : [[Math.sin(x) - 2 ** -11, Math.sin(x) + 2 ** -11]]), [...F32S, Math.fround(Math.PI / 2), Math.fround(-Math.PI / 3), Math.fround(3.1)]),
  unary('cos@1', 'call/builtin/cos (f32)', (x) => (Math.abs(x) > Math.PI ? null : [[Math.cos(x) - 2 ** -11, Math.cos(x) + 2 ** -11]]), [...F32S, Math.fround(Math.PI / 2), Math.fround(-Math.PI / 3), Math.fround(3.1)]),
];
const FLOAT_COMPARE = (['lt', 'le', 'gt', 'ge', 'eq', 'ne'] as const).map((c) => ({
  op: `${c}@1`, family: `binary/f32_comparison ${c}`, rows: pairs(F32S, F32S),
  ok: (r: number[]): Set<number> => {
    const set = new Set<number>();
    for (const a of readings(r[0]!)) for (const b of readings(r[1]!)) set.add(Number(c === 'lt' ? a < b : c === 'le' ? a <= b : c === 'gt' ? a > b : c === 'ge' ? a >= b : c === 'eq' ? a === b : a !== b));
    return set;
  },
}));

// ---------------------------------------------------------------------------------------------------
// The op call

interface OpResult { gpu: number[]; cpu: (number | null)[] }
function opCall(op: string, types: Ty[], rows: number[][]): JsonObject {
  return { call: 'op', op, types, rows: rows.map((r) => r.map((v, k) => toBits(types[k]!, v))) };
}
function opResult(reply: JsonObject, rows: number, what: string): OpResult {
  expect(reply['code'], `${what} was answered: ${shown(reply)}`).toBeUndefined();
  const gpu = arr(reply['gpu'], `${what}: gpu`).map((v, k) => num(v, `${what}: gpu[${k}]`));
  const cpu = arr(reply['cpu'], `${what}: cpu`).map((v) => (v === null ? null : num(v, `${what}: cpu`)));
  expect([gpu.length, cpu.length], `${what}: one GPU and one CPU result per row`).toEqual([rows, rows]);
  return { gpu, cpu };
}
function exactProblems(c: ExactCase, r: OpResult): string[] {
  const problems: string[] = [];
  c.rows.forEach((row, k) => {
    const want = c.expect(row);
    if ((r.gpu[k]! >>> 0) !== (want >>> 0)) problems.push(`${c.op} on ${c.types.join(', ')} (${c.family}), row ${k} (${row.join(', ')}): the GPU gives ${r.gpu[k]! >>> 0}, CTS expects ${want >>> 0}`);
    const cpu = r.cpu[k];
    const signed = c.result === 'i32' ? want | 0 : c.result === 'u32' ? want >>> 0 : want;
    if (cpu !== signed) problems.push(`${c.op} on ${c.types.join(', ')} (${c.family}), row ${k} (${row.join(', ')}): the CPU interpreter gives ${cpu}, CTS expects ${signed}`);
  });
  return problems;
}
function floatProblems(c: FloatCase, r: OpResult): string[] {
  const problems: string[] = [];
  c.rows.forEach((row, k) => {
    const ok = c.intervals(row);
    if (ok === null) return;
    const g = fromBits(r.gpu[k]!);
    const inside = (v: number): boolean => ok.some(([lo, hi]) => v >= lo && v <= hi);
    if (!inside(g)) problems.push(`${c.op} on f32 (${c.family}), row ${k} (${row.join(', ')}): the GPU gives ${g}, outside ${ok.map(([lo, hi]) => `[${lo}, ${hi}]`).join(' ∪ ')}`);
    const cpu = r.cpu[k];
    if (cpu === null || cpu === undefined || !inside(cpu)) problems.push(`${c.op} on f32 (${c.family}), row ${k} (${row.join(', ')}): the CPU interpreter gives ${cpu}, outside ${ok.map(([lo, hi]) => `[${lo}, ${hi}]`).join(' ∪ ')}`);
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// The exact record and the cross-GPU comparison

interface Record3 { path: string; body: JsonObject; gpu: { name: string; family: string }; operators: Map<string, string> }
function exactRecord(startup: Startup = {}): { record: Record3; exactOps: string[] } {
  const [ops, reply] = run(bins.bin(), out(), [OPERATORS, { call: 'exact' }], startup);
  const exactOps = operatorsReply(ops!).filter((o) => o.origin === 'shipped' && o.determinism === 'exact').map((o) => o.name).sort();
  expect(reply!['code'], `the exact call was answered: ${shown(reply)}`).toBeUndefined();
  const path = join(out(), `${str(reply!['record'], 'exact: record')}.json`);
  const body = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, 'the record file');
  const gpu = obj(body['gpu'], 'the record: gpu');
  const operators = new Map(Object.entries(obj(body['operators'], 'the record: operators')).map(([k, v]) => [k, str(v, `the record: operators.${k}`)]));
  return { record: { path, body, gpu: { name: str(gpu['name'], 'the record: gpu.name'), family: str(gpu['family'], 'the record: gpu.family') }, operators }, exactOps };
}
function doctored(r: Record3, name: string, gpu: { name: string; family: string }, change?: string): string {
  const body = JSON.parse(JSON.stringify(r.body)) as JsonObject;
  body['gpu'] = gpu;
  if (change) (body['operators'] as JsonObject)[change] = '0'.repeat(64);
  const path = join(out(), `${name}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}
interface Cross { result: string; families: string[]; asks: JsonObject[]; raw: JsonObject }
function cross(records: string[], startup: Startup = {}): Cross {
  const reply = run1(bins.bin(), out(), { call: 'cross_gpu', records }, startup);
  expect(reply['code'], `cross_gpu was answered: ${shown(reply)}`).toBeUndefined();
  return { result: str(reply['result'], 'cross_gpu: result'), families: arr(reply['families'] ?? [], 'cross_gpu: families').map((f) => str(f, 'a family')), asks: arr(reply['asks'] ?? [], 'cross_gpu: asks').filter(isObject), raw: reply };
}
const M1 = { name: 'Apple M1', family: 'apple7' };

describe('#380.639458be every exact operator gives identical bits on two GPUs of different families (an M1 and an M3); with one GPU that comparison is BLOCKED with one unblock ask, never PASS', () => {
  it('#380.639458be the CTS integer and bool expression cases, ported to our operators: the GPU and the CPU interpreter give exactly the bits CTS computes; a flipped bit fails, naming the operation and the row', () => {
    requireGpu();
    const replies = run(bins.bin(), out(), EXACT.map((c) => opCall(c.op, c.types, c.rows)));
    const results = EXACT.map((c, k) => opResult(replies[k]!, c.rows.length, `${c.op} on ${c.types.join(', ')}`));
    expect(EXACT.flatMap((c, k) => exactProblems(c, results[k]!)), 'the integer and bool cases').toEqual([]);
    const twin = { ...results[0]!, gpu: results[0]!.gpu.map((b, k) => (k === 3 ? (b ^ 1) >>> 0 : b)) };
    expect(exactProblems(EXACT[0]!, twin).join('\n'), 'a flipped bit fails, named').toMatch(/^add@1 on i32, i32 \(binary\/i32_arithmetic addition\), row 3 /);
  }, 1_800_000);

  it('#380.639458be the CTS f32 expression cases, ported to our operators: each GPU result and the CPU interpreter\'s lie in the interval CTS gives; a result two ULP off fails, naming the operation and the row', () => {
    requireGpu();
    const calls = [...FLOAT.map((c) => opCall(c.op, Array(c.arity).fill('f32') as Ty[], c.rows)), ...FLOAT_COMPARE.map((c) => opCall(c.op, ['f32', 'f32'], c.rows))];
    const replies = run(bins.bin(), out(), calls);
    const problems = FLOAT.flatMap((c, k) => floatProblems(c, opResult(replies[k]!, c.rows.length, `${c.op} on f32`)));
    FLOAT_COMPARE.forEach((c, k) => {
      const r = opResult(replies[FLOAT.length + k]!, c.rows.length, `${c.op} on f32`);
      c.rows.forEach((row, j) => { if (!c.ok(row).has(r.gpu[j]!)) problems.push(`${c.op} on f32 (${c.family}), row ${j} (${row.join(', ')}): the GPU gives ${r.gpu[j]}`); if (!c.ok(row).has(r.cpu[j] ?? -1)) problems.push(`${c.op} on f32 (${c.family}), row ${j}: the CPU interpreter gives ${r.cpu[j]}`); });
    });
    expect(problems, 'the f32 cases').toEqual([]);
    const add = FLOAT[0]!;
    const row = add.rows.findIndex((r) => r[0] === 1 && r[1] === 1);
    const real = opResult(replies[0]!, add.rows.length, 'add@1 on f32');
    const twin = { ...real, gpu: real.gpu.map((b, k) => (k === row ? bitsOf(nextUp(nextUp(2))) : b)) };
    expect(floatProblems(add, twin).join('\n'), 'a sum two ULP off fails, named').toMatch(new RegExp(`^add@1 on f32 \\(binary/f32_addition\\), row ${row} \\(1, 1\\)`));
  }, 1_800_000);

  it('#380.639458be with one GPU family the exact comparison is BLOCKED with one unblock ask, never PASS; another family\'s equal bits pass and an operator\'s changed bits fail, naming it; a planted comparison that passes one family (--planted passes_one_gpu) fails', () => {
    requireGpu();
    const { record, exactOps } = exactRecord();
    expect(exactOps.length, 'the shipped library has exact operators (the GPU pixel hash at least)').toBeGreaterThan(0);
    expect([...record.operators.keys()].sort(), 'the record holds every shipped exact operator\'s bits').toEqual(exactOps);
    expect(record.gpu.name, 'the record names this machine\'s GPU').toContain(chipName());
    expect(record.gpu.family, 'and its Metal GPU family').toMatch(/^apple\d+$/);
    const one = cross([record.path]);
    expect(one.result, `one GPU family alone is BLOCKED: ${shown(one.raw)}`).toBe('BLOCKED');
    expect(one.asks.length, 'with exactly one ask').toBe(1);
    expect(one.asks[0]!['kind'], 'an unblock ask').toBe('unblock');
    const sameFamily = cross([record.path, doctored(record, 'same-family', { name: `${record.gpu.name} (second)`, family: record.gpu.family })]);
    expect([sameFamily.result, sameFamily.asks.length], 'two GPUs of one family are still BLOCKED with one unblock ask').toEqual(['BLOCKED', 1]);
    // The check's twins: this machine's record standing in for another family's.
    const equal = cross([record.path, doctored(record, 'm1-equal', M1)]);
    expect(equal.result, `another family's equal bits pass: ${shown(equal.raw)}`).toBe('PASS');
    expect(equal.families.sort(), 'naming both families').toEqual([M1.family, record.gpu.family].sort());
    const changedOp = exactOps[0]!;
    const changed = cross([record.path, doctored(record, 'm1-changed', M1, changedOp)]);
    expect(changed.result, 'an operator whose bits differ fails').toBe('FAIL');
    expect(JSON.stringify(changed.raw), 'naming it').toContain(changedOp);
    const planted = cross([record.path], { planted: 'passes_one_gpu' });
    expect(planted.result === 'BLOCKED' && planted.asks.length === 1, `the planted comparison reads one family as ${planted.result}, so the check fails it`).toBe(false);
  }, 1_800_000);

  it('#380.639458be on an M1 and an M3: every exact operator\'s bits from a record an M1 made equal this M3\'s (DEEPBUILD_M1_RECORD); without that record this is BLOCKED, never PASS', (ctx) => {
    requireGpu();
    const m1 = process.env['DEEPBUILD_M1_RECORD'];
    if (!m1) ctx.skip('BLOCKED: no record from an M1 (unblock: run `deep-gpu run` with {"call": "exact"} on an M1 Mac and set DEEPBUILD_M1_RECORD to the record file it writes); this is not a pass');
    const { record } = exactRecord();
    expect(record.gpu.family, 'this machine is an M3 (Metal family apple9)').toBe('apple9');
    const theirs = obj(JSON.parse(readFileSync(m1!, 'utf8')) as JsonValue, 'the M1 record');
    expect(obj(theirs['gpu'], 'the M1 record: gpu')['family'], 'the record was made on an M1 (Metal family apple7)').toBe('apple7');
    const result = cross([record.path, m1!]);
    expect(result.result, `every exact operator gives identical bits on the M1 and the M3: ${shown(result.raw)}`).toBe('PASS');
  }, 1_800_000);
});
