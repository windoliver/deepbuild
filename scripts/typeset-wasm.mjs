// The typeset job's tool built to WebAssembly (issue #220; canvas primitives: "Asset job: typeset"): deep-typeset's
// library for wasm32-unknown-unknown in release, with the checkout's lockfile and flags (the caller's *RUSTFLAGS
// cleared), copied into the typeset plug-in's tool folder, where its Node entry loads it. One module is one build,
// so it gives the same bytes on every target triple; it is rebuilt only when the crate changes, and the plug-in's
// digest changes with it.
//
// Usage: node scripts/typeset-wasm.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'wasm32-unknown-unknown';
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const env = { ...process.env, CARGO_INCREMENTAL: '0' };
for (const k of Object.keys(env)) if (/^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k)) delete env[k];

const build = spawnSync('cargo', ['rustc', '--locked', '--release', '-p', 'deep-typeset', '--lib', '--crate-type', 'cdylib', '--target', TARGET, '--', '-C', 'strip=symbols'], {
  cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
});
if (build.status !== 0) {
  console.error(`cargo rustc for ${TARGET} failed:\n${(build.error?.message ?? build.stderr).slice(-4000)}`);
  process.exit(1);
}
const out = join(root, 'packages/jobs/typeset/tool/typeset.wasm');
copyFileSync(join(target, TARGET, 'release', 'deep_typeset.wasm'), out);
console.log(`${out} ${statSync(out).size} bytes`);
