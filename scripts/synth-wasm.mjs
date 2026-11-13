// The score tool's synth node code built to WebAssembly (issue #204; canvas primitives: Synth `synth@1`, As built):
// deep-synth-job's library, the media module's own preset and voice code, for wasm32-unknown-unknown in release,
// with the checkout's lockfile and flags (the caller's *RUSTFLAGS cleared), copied into the score plug-in's tool
// folder, where tool/synth.mjs loads it. One module is one build, so it gives the same bytes on every target triple;
// rebuild it when the media module's synth code changes, and the plug-in's digest changes with it.
//
// Usage: node scripts/synth-wasm.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'wasm32-unknown-unknown';
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const env = { ...process.env, CARGO_INCREMENTAL: '0' };
for (const k of Object.keys(env)) if (/^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k)) delete env[k];
// The media module reaches the 3D module, whose meshopt C++ calls float functions that wasm32's bare headers don't
// declare; the compiler's builtins stand in, and nothing the synth calls reaches that code.
env.CFLAGS_wasm32_unknown_unknown = ['floorf', 'ceilf', 'roundf', 'truncf', 'sqrtf', 'log2f', 'logf', 'expf', 'exp2f', 'powf', 'ldexpf', 'frexpf', 'fmodf', 'sinf', 'cosf', 'tanf', 'asinf', 'acosf', 'atanf', 'atan2f'].map((f) => `-D${f}=__builtin_${f}`).join(' ');

const build = spawnSync('cargo', ['rustc', '--locked', '--release', '-p', 'deep-synth-job', '--lib', '--crate-type', 'cdylib', '--target', TARGET, '--', '-C', 'strip=symbols'], {
  cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
});
if (build.status !== 0) {
  console.error(`cargo rustc for ${TARGET} failed:\n${(build.error?.message ?? build.stderr).slice(-4000)}`);
  process.exit(1);
}
const out = join(root, 'packages/jobs/score/tool/synth.wasm');
copyFileSync(join(target, TARGET, 'release', 'deep_synth_job.wasm'), out);
console.log(`${out} ${statSync(out).size} bytes`);
