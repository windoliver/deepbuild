// A foley preset's voice for foley.render (#155; canvas primitives: Foley `foley.render@1`, Synth `synth@1`, As
// built): one voice rendered by the media module's own preset and voice code, built to WebAssembly from
// crates/deep-synth-job by scripts/synth-wasm.mjs, so a variant is the live synth's voice for the same preset, level,
// span and noise key.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let exports;

/** One voice's samples (mono f32): `{preset, rate, gate, length, hz, vel, key}`, as deep-synth-job reads it. */
export function note(request) {
  exports ??= new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(here, 'synth.wasm'))), {}).exports;
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const at = exports.deep_synth_alloc(bytes.length);
  new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
  const room = exports.deep_synth_note(at, bytes.length);
  const [ptr, len, failed] = [Number(room >> 32n), Number(room & 0x7fffffffn), (room >> 31n) & 1n];
  const view = new Uint8Array(exports.memory.buffer, ptr, len).slice();
  exports.deep_synth_free(ptr, len);
  if (failed) throw Error(new TextDecoder().decode(view));
  return new Float32Array(view.buffer, 0, len / 4);
}
