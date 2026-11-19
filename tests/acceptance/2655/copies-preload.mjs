// #2655 acceptance, AC4's counter. A preload for the hub's process (NODE_OPTIONS=--import=<this file>) that, on the
// main thread only (the event loop), appends `<what> <bytes>` to $DEEP_2655_COPIES for every call that copies at least
// 1 KiB of bytes into new memory:
//   Buffer.concat, Buffer.from(bytes), Buffer.copyBytesFrom, Uint8Array.from(bytes), %TypedArray%.prototype.slice,
//   %TypedArray%.prototype.set(bytes), Buffer.prototype.copy, ArrayBuffer.prototype.slice, structuredClone, and
//   MessagePort.prototype.postMessage (which Worker.prototype.postMessage sends through): for those two, the bytes of every
//   ArrayBuffer the message holds, whole (a view's clone carries its whole buffer), that is neither in the transfer list
//   nor shared. A buffer in the transfer list is handed over: no byte of it is copied, and it counts nothing.
// A primitive that runs inside another counted one is counted once, at the outer call. `new Uint8Array(bytes)` is not
// wrapped: a line copied only that way reads as no copy, which the test reports INCONCLUSIVE, never as a pass.
// It changes nothing a call returns. Worker threads load this file and do nothing.
import { appendFileSync } from 'node:fs';
import { isMainThread, MessagePort } from 'node:worker_threads';

const log = process.env.DEEP_2655_COPIES;
if (isMainThread && log) {
  const FLOOR = 1024;
  let inside = 0;
  const note = (what, bytes) => { if (Number.isFinite(bytes) && bytes >= FLOOR) appendFileSync(log, `${what} ${bytes}\n`); };
  const isBytes = (v) => ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof SharedArrayBuffer;
  const lengthOf = (v) => (isBytes(v) ? v.byteLength : Array.isArray(v) ? v.length : 0);
  /** Wraps holder[name]: `bytesOf(result, args, receiver)` is what the call copied. */
  const wrap = (holder, name, what, bytesOf) => {
    const real = holder?.[name];
    if (typeof real !== 'function') return;
    const counted = function (...args) {
      inside++;
      let out;
      try { out = Reflect.apply(real, this, args); } finally { inside--; }
      if (!inside) { let bytes = 0; try { bytes = bytesOf(out, args, this); } catch { /* an odd call copies nothing we can read */ } note(what, bytes); }
      return out;
    };
    Object.defineProperty(counted, 'name', { value: real.name });
    Object.defineProperty(counted, 'length', { value: real.length });
    Object.defineProperty(holder, name, { ...Object.getOwnPropertyDescriptor(holder, name), value: counted });
  };
  const TypedArray = Object.getPrototypeOf(Uint8Array);
  wrap(Buffer, 'concat', 'Buffer.concat', (out) => out.length);
  wrap(Buffer, 'from', 'Buffer.from', (out, [value]) => (ArrayBuffer.isView(value) || Array.isArray(value) ? out.length : 0));
  wrap(Buffer, 'copyBytesFrom', 'Buffer.copyBytesFrom', (out) => out.length);
  wrap(Uint8Array, 'from', 'Uint8Array.from', (out, [value]) => (isBytes(value) ? out.byteLength : 0));
  wrap(TypedArray.prototype, 'slice', 'TypedArray.slice', (out) => out.byteLength);
  wrap(TypedArray.prototype, 'set', 'TypedArray.set', (_out, [source]) => lengthOf(source));
  wrap(Buffer.prototype, 'copy', 'Buffer.copy', (out) => out);
  wrap(ArrayBuffer.prototype, 'slice', 'ArrayBuffer.slice', (out) => out.byteLength);

  /** The bytes a structured clone of `value` copies: each ArrayBuffer it holds, whole, unless transferred or shared. */
  const cloned = (value, options) => {
    const list = Array.isArray(options) ? options : Array.isArray(options?.transfer) ? options.transfer : [];
    const moved = new Set(list.map((t) => (ArrayBuffer.isView(t) ? t.buffer : t)));
    const buffers = new Set();
    const seen = new Set();
    const visit = (v, depth) => {
      if (v === null || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
      seen.add(v);
      if (ArrayBuffer.isView(v)) return void buffers.add(v.buffer);
      if (v instanceof ArrayBuffer) return void buffers.add(v);
      if (v instanceof SharedArrayBuffer) return;
      if (v instanceof Map) { for (const [k, x] of v) { visit(k, depth + 1); visit(x, depth + 1); } return; }
      if (v instanceof Set || Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
      for (const key of Object.keys(v)) visit(v[key], depth + 1);
    };
    visit(value, 0);
    let bytes = 0;
    for (const buffer of buffers) if (!(buffer instanceof SharedArrayBuffer) && !moved.has(buffer)) bytes += buffer.byteLength;
    return bytes;
  };
  /** A clone's bytes are read before the call: a transferred buffer reads empty after it. */
  const wrapClone = (holder, name, what) => {
    const real = holder?.[name];
    if (typeof real !== 'function') return;
    const counted = function (...args) {
      let bytes = 0;
      if (!inside) { try { bytes = cloned(args[0], args[1]); } catch { /* unreadable: nothing counted */ } }
      inside++;
      let out;
      try { out = Reflect.apply(real, this, args); } finally { inside--; }
      if (!inside) note(what, bytes);
      return out;
    };
    Object.defineProperty(counted, 'name', { value: real.name });
    Object.defineProperty(holder, name, { ...Object.getOwnPropertyDescriptor(holder, name), value: counted });
  };
  wrapClone(MessagePort.prototype, 'postMessage', 'postMessage');
  wrapClone(globalThis, 'structuredClone', 'structuredClone');
  appendFileSync(log, 'armed 0\n');
}
