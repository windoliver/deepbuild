// The physics backend built for wasm32 (issue #2012; canvas primitives: Golden, "verifies ... in the web player's
// wasm32"). It builds deep-physics-rapier's library for wasm32-unknown-unknown, the target rust-toolchain.toml pins
// for the canvas core, with the build's own lockfile, features and flags (the caller's *RUSTFLAGS cleared), as a module
// with no imports, on one thread, and answers
// deep-physics JSON lines on stdin with that module, one reply a line, in this Node's WebAssembly engine. A wasm32 run
// has no files, so a golden_verify there names the first differing step alone, never the field.
//
// Usage: node scripts/physics-wasm32.mjs < calls
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'wasm32-unknown-unknown';
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
// The build's flags are the checkout's cargo configuration alone, never the caller's shell's.
for (const k of Object.keys(env)) if (/^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k)) delete env[k];

const build = spawnSync('cargo', ['rustc', '--locked', '-p', 'deep-physics-rapier', '--lib', '--crate-type', 'cdylib', '--target', TARGET], {
  cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
});
if (build.status !== 0) {
  console.error(`cargo rustc for ${TARGET} failed:\n${(build.error?.message ?? build.stderr).slice(-4000)}`);
  process.exit(1);
}
const module = new WebAssembly.Module(readFileSync(join(target, TARGET, 'debug', 'deep_physics_rapier.wasm')));
const { exports } = new WebAssembly.Instance(module, {});
const { memory, deep_physics_alloc: alloc, deep_physics_call: call, deep_physics_free: free } = exports;

for (const line of readFileSync(0, 'utf8').split('\n').filter((l) => l.trim())) {
  const bytes = new TextEncoder().encode(line);
  const at = alloc(bytes.length);
  new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
  const room = call(at, bytes.length);
  const [ptr, len] = [Number(room >> 32n), Number(room & 0xffffffffn)];
  process.stdout.write(`${new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len))}\n`);
  free(ptr, len);
}
