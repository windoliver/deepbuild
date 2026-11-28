import { createHash } from 'node:crypto';

export const PAGE = 65_536;
export interface Program { name: string; bytes: Buffer; b64: string; sha: string }
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const programOf = (name: string, bytes: number[]): Program => {
  const b = Buffer.from(bytes);
  return { name, bytes: b, b64: b.toString('base64'), sha: sha256(b) };
};

const unsignedLeb128 = (value: number): number[] => {
  const out: number[] = [];
  let n = value;
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const signedLeb128 = (value: bigint | number): number[] => {
  const out: number[] = [];
  let v = BigInt(value);
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
};
const vec = (items: number[][]): number[] => [...unsignedLeb128(items.length), ...items.flat()];
const name = (text: string): number[] => { const b = [...Buffer.from(text, 'utf8')]; return [...unsignedLeb128(b.length), ...b]; };
const section = (id: number, body: number[]): number[] => [id, ...unsignedLeb128(body.length), ...body];
const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const I32 = 0x7f;
const I64 = 0x7e;
const TYPES = section(1, vec([[0x60, ...vec([[I64]]), ...vec([])]]));
const FUNCTIONS = section(3, vec([[0], [0]]));
const memoryOf = (pages: number): number[] => section(5, vec([[0x01, ...unsignedLeb128(pages), ...unsignedLeb128(pages)]]));
const globalsOf = (readsAt: number, writesAt: number): number[] =>
  section(6, vec([[I32, 0x00, 0x41, ...signedLeb128(readsAt), 0x0b], [I32, 0x00, 0x41, ...signedLeb128(writesAt), 0x0b]]));
const EXPORTS = section(7, vec([
  [...name('memory'), 0x02, 0], [...name('reads_at'), 0x03, 0], [...name('writes_at'), 0x03, 1], [...name('init'), 0x00, 0], [...name('step'), 0x00, 1],
]));
const codeOf = (locals: number[][], step: number[]): number[] => {
  const init = [0x00, 0x0b];
  const body = [...vec(locals), ...step, 0x0b];
  return section(10, vec([[...unsignedLeb128(init.length), ...init], [...unsignedLeb128(body.length), ...body]]));
};

export const TWIN = { stores: 64, instructions: 203, iterations: 23_600 } as const;
export const TWIN_SHA = {
  bench: '431473630c12cbce8a27654dbaf0878477c08ceec8e2624348597da920748e3b',
  twin: '479ee43d7718b3b1abbceb6ce19ea8ffca60db1add9152a8e8dfebc6366111d4',
} as const;
export const twinFuel = (iterations: number): number => TWIN.instructions * iterations + 7;

export function writer(iterations: number): Program {
  const step = [0x41, ...signedLeb128(iterations), 0x21, 1, 0x42, ...signedLeb128(0x0123456789abcdefn), 0x21, 3, 0x03, 0x40];
  for (let j = 0; j < TWIN.stores; j++) step.push(0x20, 2, 0x20, 3, 0x37, 3, ...unsignedLeb128(8 * j));
  step.push(0x20, 2, 0x41, ...signedLeb128(8 * TWIN.stores), 0x6a, 0x41, ...signedLeb128(0xffff8), 0x71, 0x21, 2);
  step.push(0x20, 1, 0x41, ...signedLeb128(1), 0x6b, 0x22, 1, 0x0d, 0, 0x0b);
  const sub = (id: number, body: number[]): number[] => [id, ...unsignedLeb128(body.length), ...body];
  const locals = sub(2, vec([[...unsignedLeb128(1), ...vec([[1, ...name('n')], [2, ...name('p')], [3, ...name('q')]])]]));
  const labels = sub(3, vec([[...unsignedLeb128(1), ...vec([[0, ...name('l')]])]]));
  return programOf(iterations === 1 ? 'writes-one-iteration' : 'writes', [
    ...HEADER, ...TYPES, ...FUNCTIONS, ...memoryOf(32), ...globalsOf(0, 1024), ...EXPORTS,
    ...codeOf([[2, I32], [1, I64]], step), ...section(0, [...name('name'), ...locals, ...labels]),
  ]);
}

export const SEEDS = 1_000;
export const STEPS = 3;
export const READS_AT = 0;
const UNTOUCHED_FIRST_BYTES = 64;

const STORES = [
  { name: 'i32.store', code: 0x36, size: 4, type: 'i32' }, { name: 'i64.store', code: 0x37, size: 8, type: 'i64' },
  { name: 'f32.store', code: 0x38, size: 4, type: 'f32' }, { name: 'f64.store', code: 0x39, size: 8, type: 'f64' },
  { name: 'i32.store8', code: 0x3a, size: 1, type: 'i32' }, { name: 'i32.store16', code: 0x3b, size: 2, type: 'i32' },
  { name: 'i64.store8', code: 0x3c, size: 1, type: 'i64' }, { name: 'i64.store16', code: 0x3d, size: 2, type: 'i64' },
  { name: 'i64.store32', code: 0x3e, size: 4, type: 'i64' },
] as const;
type StoreKind = (typeof STORES)[number];

export interface Store { op: 'store'; kind: StoreKind['name']; base: number; offset: number; at: number; size: number }
export interface Fill { op: 'fill'; at: number; len: number }
export interface Copy { op: 'copy'; at: number; from: number; len: number }
export type Op = Store | Fill | Copy;
export type Family = 'one page' | 'stores' | 'mixed';
export interface Seeded {
  index: number;
  pages: number;
  family: Family;
  ops: Op[];
  program: Program;
  writtenPages: number[];
  storedPages: number[];
  onlyStoredPage: number | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const pagesOf = (at: number, len: number): number[] => {
  const out: number[] = [];
  for (let p = Math.floor(at / PAGE); len > 0 && p <= Math.floor((at + len - 1) / PAGE); p++) out.push(p);
  return out;
};
const ascending = (pages: Iterable<number>): number[] => [...new Set(pages)].sort((a, b) => a - b);
export const writtenSpan = (op: Op): [number, number] => (op.op === 'store' ? [op.at, op.size] : [op.at, op.len]);

const ONE_WORD_MEMORIES = [1, 2, 3, 5, 8, 16, 33, 64] as const;
const LARGER_MEMORIES = [65, 96, 128, 130] as const;

export function seeded(index: number): Seeded {
  const next = mulberry32(0x3530_0000 + index);
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  let pages: number = next() < 0.1 ? pick(LARGER_MEMORIES) : pick(ONE_WORD_MEMORIES);
  const drawn = next();
  const family: Family = drawn < 0.15 ? 'one page' : drawn < 0.4 ? 'stores' : 'mixed';
  if (family === 'one page' && pages === 1) pages = 2;
  const end = pages * PAGE;
  const onlyStoredPage = family === 'one page' ? int(1, pages - 1) : null;
  const ops: Op[] = [];

  const store = (): Store => {
    const kind = pick(STORES);
    const p = onlyStoredPage ?? int(0, pages - 1);
    const where = next();
    let at: number;
    if (onlyStoredPage === null && kind.size > 1 && p + 1 < pages && where < 0.3) at = (p + 1) * PAGE - int(1, kind.size - 1);
    else if (where < 0.4 && p > 0) at = p * PAGE;
    else if (where < 0.5) at = (p + 1) * PAGE - kind.size;
    else at = p * PAGE + int(p === 0 ? UNTOUCHED_FIRST_BYTES : 0, PAGE - kind.size);
    const split = next();
    const offset = split < 0.4 ? 0 : split < 0.7 ? int(1, Math.min(64, at)) : int(0, at);
    return { op: 'store', kind: kind.name, base: at - offset, offset, at, size: kind.size };
  };
  const place = (len: number): number => {
    const edge = (int(0, pages - 1) + 1) * PAGE - int(1, 64);
    return next() < 0.4 && edge >= UNTOUCHED_FIRST_BYTES && edge + len <= end ? edge : int(UNTOUCHED_FIRST_BYTES, end - len);
  };
  const length = (most: number): number => {
    const size = next();
    return Math.min(most, size < 0.08 ? 0 : size < 0.7 ? int(1, 300) : int(PAGE - 200, 2 * PAGE + 200));
  };
  const fill = (least: number): Fill => {
    const len = Math.max(least, length(end - UNTOUCHED_FIRST_BYTES));
    return { op: 'fill', at: place(len), len };
  };
  const copy = (): Op => {
    const sources = ops.map(writtenSpan).filter(([, len]) => len > 0);
    if (!sources.length) return fill(1);
    const [from, had] = pick(sources);
    const len = length(had);
    return { op: 'copy', at: place(len), from: from + int(0, had - len), len };
  };

  const count = family === 'one page' ? int(1, 5) : int(1, 10);
  for (let n = 0; n < count; n++) {
    const kind = next();
    ops.push(family !== 'mixed' || kind < 0.5 ? store() : kind < 0.75 ? fill(0) : copy());
  }

  const step = [0x20, 0, 0x42, ...signedLeb128(1), 0x7c, 0x42, ...signedLeb128(0x0101010101010101n), 0x7e, 0x21, 1];
  for (const op of ops) {
    if (op.op === 'store') {
      const kind = STORES.find((k) => k.name === op.kind)!;
      step.push(0x41, ...signedLeb128(op.base), 0x20, 1);
      if (kind.type === 'i32') step.push(0xa7);
      if (kind.type === 'f32') step.push(0xa7, 0xbe);
      if (kind.type === 'f64') step.push(0xbf);
      step.push(kind.code, 0x00, ...unsignedLeb128(op.offset));
    } else if (op.op === 'fill') step.push(0x41, ...signedLeb128(op.at), 0x20, 1, 0xa7, 0x41, ...signedLeb128(op.len), 0xfc, 11, 0x00);
    else step.push(0x41, ...signedLeb128(op.at), 0x41, ...signedLeb128(op.from), 0x41, ...signedLeb128(op.len), 0xfc, 10, 0x00, 0x00);
  }
  const program = programOf(`seeded-${index}`, [...HEADER, ...TYPES, ...FUNCTIONS, ...memoryOf(pages), ...globalsOf(READS_AT, 16), ...EXPORTS, ...codeOf([[1, I64]], step)]);
  return {
    index, pages, family, ops, program, onlyStoredPage,
    writtenPages: ascending(ops.flatMap((op) => pagesOf(...writtenSpan(op)))),
    storedPages: ascending(ops.flatMap((op) => (op.op === 'store' ? pagesOf(op.at, op.size) : []))),
  };
}

export function seededInALine(p: Seeded): string {
  const each = p.ops.map((op) => {
    const pages = pagesOf(...writtenSpan(op)).join(',') || 'none';
    if (op.op === 'store') return `${op.kind} at ${op.base}+${op.offset} (pages ${pages})`;
    return op.op === 'fill' ? `fill ${op.len} at ${op.at} (pages ${pages})` : `copy ${op.len} from ${op.from} to ${op.at} (pages ${pages})`;
  });
  return `seeded ${p.index}, ${p.pages} pages, ${p.family}: ${each.join('; ')}`;
}

export function changedPagesInNode(program: Program, steps: number): number[][] {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(program.bytes)), {});
  const memory = instance.exports['memory'] as WebAssembly.Memory;
  (instance.exports['init'] as (seed: bigint) => void)(0n);
  const run = instance.exports['step'] as (k: bigint) => void;
  const out: number[][] = [];
  for (let k = 0; k < steps; k++) {
    const before = Buffer.from(new Uint8Array(memory.buffer));
    run(BigInt(k));
    const after = Buffer.from(memory.buffer);
    const changed: number[] = [];
    for (let p = 0; p * PAGE < after.length; p++) if (before.compare(after, p * PAGE, (p + 1) * PAGE, p * PAGE, (p + 1) * PAGE) !== 0) changed.push(p);
    out.push(changed);
  }
  return out;
}

export const withReadRegion = (changed: readonly number[]): number[] => ascending([Math.floor(READS_AT / PAGE), ...changed]);
