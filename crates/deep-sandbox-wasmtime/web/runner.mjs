// sandbox@1 in the web player (#238): the browser's own WebAssembly engine runs the bytes the app's
// sandbox module checked and rewrote; nothing here checks or rewrites. Before each call it sets the
// rewrite's counters (fuel, stack in use, the stack's cap, the trap code); after a trap it reads the
// code the rewrite left, or maps the engine's own trap to its kind, and names the function and the
// offset in the program as written through the rewrite's offset map, as the app's runner does.

const RAISED = { 1: 'fuel', 2: 'stack', 3: 'grow' };

function bytesOf(base64) {
  const text = atob(base64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function hex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// The rewrite's offset map: per rewritten instruction, its offset, the offset of the program as
// written it stands for, that instruction's copy in the rewritten program, and the offset of its
// check's own unreachable (0 outside one).
function offsets(module) {
  const [section] = WebAssembly.Module.customSections(module, 'sandbox.offsets');
  if (!section) return [];
  const b = new Uint8Array(section);
  let at = 0;
  const leb = () => {
    let n = 0;
    let shift = 0;
    let byte;
    do {
      byte = b[at++];
      n += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return n;
  };
  const count = leb();
  const map = [];
  for (let i = 0; i < count; i++) map.push([leb(), leb(), leb(), leb()]);
  return map;
}

// Where a trap is counted, as the app's runner counts it: in the program as written, or in the
// rewritten program at the rewrite's own unreachable for a trap it raised and at the instruction's
// copy for the engine's own.
function locate(map, offset, written, raised) {
  let lo = 0;
  let hi = map.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid][0] <= offset) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return offset;
  const [, own, copy, raise] = map[found];
  if (written) return own;
  if (raised) return raise || offset;
  return copy;
}

// The kind of an engine's own trap, from its message.
function engineKind(e) {
  const m = String((e && e.message) || e);
  if (e instanceof RangeError || /call stack/i.test(m)) return 'stack';
  if (/divide by zero|remainder by zero/i.test(m)) return 'divide';
  if (/float unrepresentable|invalid conversion/i.test(m)) return 'conversion';
  if (/unrepresentable|integer overflow/i.test(m)) return 'overflow';
  if (/out of bounds memory|memory access out of bounds/i.test(m)) return 'bounds';
  if (/signature mismatch|null function|table index|indirect call/i.test(m)) return 'call';
  return 'unreachable';
}

function frameOf(e) {
  const m = /wasm-function\[(\d+)\]:0x([0-9a-f]+)/.exec(String(e && e.stack));
  return m ? [Number(m[1]), parseInt(m[2], 16)] : null;
}

export async function run(request) {
  const module = await WebAssembly.compile(bytesOf(request.rewritten));
  const map = offsets(module);
  // The kit's requests ask for offsets in the rewritten program, as sandbox@1's kit compares them.
  const written = request.offsets !== 'rewritten';
  const instance = await WebAssembly.instantiate(module, {});
  const ex = instance.exports;
  const budget = request.budget || {};
  const fuel = BigInt(budget.fuel ?? 1_000_000_000);
  const stack = budget.stack ?? 262_144;
  const calls = [];
  if (typeof ex['sandbox.start'] === 'function') calls.push(() => ex['sandbox.start']());
  if (request.role === 'validator') {
    const input = request.input ? bytesOf(request.input) : new Uint8Array(0);
    new Uint8Array(ex.memory.buffer).set(input, ex.in_at.value);
    calls.push(() => ex.validate(BigInt(input.length)));
  } else {
    calls.push(() => ex.gen(BigInt(request.seed ?? 0)));
  }
  let trap = null;
  let result = null;
  for (const call of calls) {
    ex['sandbox.fuel'].value = fuel;
    ex['sandbox.stack'].value = 0;
    ex['sandbox.stack_cap'].value = stack;
    ex['sandbox.trap'].value = 0;
    try {
      const r = call();
      result = typeof r === 'bigint' ? Number(r) : (r ?? null);
    } catch (e) {
      if (!(e instanceof WebAssembly.RuntimeError) && !(e instanceof RangeError)) throw e;
      const frame = frameOf(e);
      if (!frame) throw e;
      const raised = RAISED[ex['sandbox.trap'].value];
      trap = { kind: raised ?? engineKind(e), function: frame[0], offset: locate(map, frame[1], written, raised !== undefined) };
      result = null;
      break;
    }
  }
  const memory = new Uint8Array(ex.memory.buffer);
  const reads = (request.read || []).map(({ at, len }) => ({
    at, len, hex: hex(memory.subarray(Math.min(at, memory.length), Math.min(at + len, memory.length))),
  }));
  return { ok: true, trap, result, reads };
}
