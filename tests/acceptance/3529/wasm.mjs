import { createHash } from 'node:crypto';

function unsignedLeb(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    out.push(b);
  } while (v !== 0n);
  return out;
}
function signedLeb(n) {
  const out = [];
  let v = BigInt(n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
    out.push(done ? b : b | 0x80);
    if (done) return out;
  }
}
const nameBytes = (name) => {
  const bytes = [...Buffer.from(name, 'utf8')];
  return [...unsignedLeb(bytes.length), ...bytes];
};
const vector = (items) => [...unsignedLeb(items.length), ...items.flat()];
const section = (id, bytes) => [id, ...unsignedLeb(bytes.length), ...bytes];
const functionBody = (locals, code) => {
  const bytes = [...vector(locals), ...code, END];
  return [...unsignedLeb(bytes.length), ...bytes];
};

const I32 = 0x7f, I64 = 0x7e;
const END = 0x0b, NO_RESULT = 0x40;
const op = {
  unreachable: [0x00], loop: [0x03, NO_RESULT], if: [0x04, NO_RESULT], end: [END], br: (label) => [0x0c, ...unsignedLeb(label)], brIf: (label) => [0x0d, ...unsignedLeb(label)],
  localGet: (i) => [0x20, ...unsignedLeb(i)], localSet: (i) => [0x21, ...unsignedLeb(i)], globalGet: (i) => [0x23, ...unsignedLeb(i)], globalSet: (i) => [0x24, ...unsignedLeb(i)],
  i32Load: [0x28, 2, 0], i64Load: [0x29, 3, 0], f64Load: [0x2b, 3, 0], i32Store: [0x36, 2, 0], f64Store: [0x39, 3, 0],
  i32: (n) => [0x41, ...signedLeb(n)], i64: (n) => [0x42, ...signedLeb(n)],
  i32Eq: [0x46], i32Ne: [0x47], i32LtU: [0x49], i32Add: [0x6a], i32Mul: [0x6c],
  i64Add: [0x7c], i64Mul: [0x7e], i64And: [0x83], i64Xor: [0x85],
  i32TruncF64S: [0xaa], i64ExtendI32U: [0xad], f64ConvertI64U: [0xba],
};

export const WRITES_AT = 4096;
export const STATE_AT = 8192;
const FIRST_ENTRY_COUNT_AT = 0;
const FIRST_ENTRY_VALUE_AT = 16;
const STATE_GLOBAL = 2;
const STEP_ARGUMENT = 0, STEP_LOCAL = 1;
export const TOLD_TO_WRITE = 1, TOLD_TO_SPIN = 2, TOLD_TO_TRAP = 3;
const WRITE_ADDS_TO_MEMORY = 1000, WRITE_ADDS_TO_GLOBAL = 7;

function logicItemModule({ stateType, stateStart, init, step, nameSection = [] }) {
  const global = (type, mutable, value) => [type, mutable, ...value, END];
  const exported = (name, kind, index) => [...nameBytes(name), kind, ...unsignedLeb(index)];
  const MEMORY = 2, GLOBAL = 3, FUNCTION = 0;
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vector([[0x60, ...vector([[I64]]), ...vector([])]])),
    ...section(3, vector([unsignedLeb(0), unsignedLeb(0)])),
    ...section(5, vector([[0x01, ...unsignedLeb(1), ...unsignedLeb(1)]])),
    ...section(6, vector([global(I32, 0, op.i32(0)), global(I32, 0, op.i32(WRITES_AT)), global(stateType, 1, stateStart)])),
    ...section(7, vector([exported('memory', MEMORY, 0), exported('reads_at', GLOBAL, 0), exported('writes_at', GLOBAL, 1), exported('init', FUNCTION, 0), exported('step', FUNCTION, 1)])),
    ...section(10, vector([init, step])),
    ...nameSection,
  ]);
}

export function twinProgram() {
  const loadState = [...op.i32(STATE_AT), ...op.i32Load];
  const ifTold = (value) => [...op.localGet(STEP_LOCAL), ...op.i32(value), ...op.i32Eq, ...op.if];
  const step = functionBody([[...unsignedLeb(1), I32]], [
    ...op.i32(FIRST_ENTRY_COUNT_AT), ...op.i32Load, ...op.i32(0), ...op.i32Ne, ...op.if,
    ...op.i32(FIRST_ENTRY_VALUE_AT), ...op.f64Load, ...op.i32TruncF64S, ...op.localSet(STEP_LOCAL),
    ...op.end,
    ...ifTold(TOLD_TO_WRITE),
    ...op.i32(STATE_AT), ...loadState, ...op.i32(WRITE_ADDS_TO_MEMORY), ...op.i32Add, ...op.i32Store,
    ...op.globalGet(STATE_GLOBAL), ...op.i32(WRITE_ADDS_TO_GLOBAL), ...op.i32Add, ...op.globalSet(STATE_GLOBAL),
    ...op.end,
    ...ifTold(TOLD_TO_SPIN),
    ...op.loop, ...op.br(0), ...op.end,
    ...op.end,
    ...ifTold(TOLD_TO_TRAP),
    ...op.unreachable,
    ...op.end,
    ...op.i32(STATE_AT), ...loadState, ...op.i32(1), ...op.i32Add, ...op.i32Store,
    ...op.globalGet(STATE_GLOBAL), ...op.i32(1), ...op.i32Add, ...op.globalSet(STATE_GLOBAL),
    ...op.i32(WRITES_AT), ...loadState, ...op.i32Store,
    ...op.i32(WRITES_AT + 4), ...op.globalGet(STATE_GLOBAL), ...op.i32Store,
  ]);
  return logicItemModule({ stateType: I32, stateStart: op.i32(0), init: functionBody([], []), step });
}

export const twinStateAtStep = (step, wroteAtStep) => (wroteAtStep !== null && step >= wroteAtStep
  ? [step + 1 + WRITE_ADDS_TO_MEMORY, step + 1 + WRITE_ADDS_TO_GLOBAL]
  : [step + 1, step + 1]);

export function mixerProgramOf2662(readBytes, writeCount) {
  const init = functionBody([], [...op.localGet(STEP_ARGUMENT), ...op.i64(1023), ...op.i64And, ...op.globalSet(STATE_GLOBAL)]);
  const step = functionBody([[...unsignedLeb(1), I32]], [
    ...op.loop,
    ...op.globalGet(STATE_GLOBAL), ...op.i64(1099511628211n), ...op.i64Mul, ...op.localGet(STEP_LOCAL), ...op.i64Load, ...op.i64Add, ...op.globalSet(STATE_GLOBAL),
    ...op.localGet(STEP_LOCAL), ...op.i32(8), ...op.i32Add, ...op.localSet(STEP_LOCAL),
    ...op.localGet(STEP_LOCAL), ...op.i32(readBytes), ...op.i32LtU, ...op.brIf(0),
    ...op.end,
    ...op.globalGet(STATE_GLOBAL), ...op.localGet(STEP_ARGUMENT), ...op.i64Xor, ...op.globalSet(STATE_GLOBAL),
    ...op.i32(0), ...op.localSet(STEP_LOCAL),
    ...op.loop,
    ...op.i32(WRITES_AT), ...op.localGet(STEP_LOCAL), ...op.i32(8), ...op.i32Mul, ...op.i32Add,
    ...op.globalGet(STATE_GLOBAL), ...op.i64(1048575), ...op.i64And, ...op.localGet(STEP_LOCAL), ...op.i64ExtendI32U, ...op.i64Add, ...op.f64ConvertI64U,
    ...op.f64Store,
    ...op.localGet(STEP_LOCAL), ...op.i32(1), ...op.i32Add, ...op.localSet(STEP_LOCAL),
    ...op.localGet(STEP_LOCAL), ...op.i32(writeCount), ...op.i32LtU, ...op.brIf(0),
    ...op.end,
  ]);
  const indexedNames = (pairs) => vector(pairs.map(([index, name]) => [...unsignedLeb(index), ...nameBytes(name)]));
  const namesByFunction = (functions) => vector(functions.map(([index, pairs]) => [...unsignedLeb(index), ...indexedNames(pairs)]));
  const subsection = (id, bytes) => [id, ...unsignedLeb(bytes.length), ...bytes];
  const LOCAL_NAMES = 2, LABEL_NAMES = 3, GLOBAL_NAMES = 7;
  const nameSectionAsWatWritesIt = section(0, [
    ...nameBytes('name'),
    ...subsection(LOCAL_NAMES, namesByFunction([[0, [[0, 'seed']]], [1, [[0, 'k'], [1, 'j']]]])),
    ...subsection(LABEL_NAMES, namesByFunction([[1, [[0, 'read'], [1, 'write']]]])),
    ...subsection(GLOBAL_NAMES, indexedNames([[2, 'g']])),
  ]);
  return logicItemModule({ stateType: I64, stateStart: op.i64(7), init, step, nameSection: nameSectionAsWatWritesIt });
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
