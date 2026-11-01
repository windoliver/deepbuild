// The wasm32 lane (issue #140; technical design: Platforms, "From R2 the canvas core's crates also build for
// wasm32 with threads off in the local preflight, so nothing native-only creeps in"). It builds every canvas
// core crate, each workspace crate named deep-canvas or deep-canvas-* but the test-only modules, plus deep-text,
// for wasm32-unknown-unknown as rustc ships it, without the atomics target feature. A crate that calls an API only
// native targets have fails to compile there. A crate that needs threads still compiles, since std's thread spawn
// on that target fails only when it runs, so the lane also reads every library the build produced for std's
// thread-starting functions, which a crate's own code instantiates when it spawns.
//
// Usage: node scripts/wasm32.mjs [--planted threads | native]
// Prints `PASS <crate>` per canvas core crate, or `FAIL <crate>: <reason>` naming the crate that broke the build,
// and exits 1 on a failure. `--planted` adds the planted dependency deep-planted-threads (it spawns a thread) or
// deep-planted-native (it calls std::os::unix) under a copy of deep-canvas, built apart from the workspace.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'wasm32-unknown-unknown';
// std's thread-starting functions as they appear in a library's symbols, in the legacy and the v0 mangling
// (where std is often a back-reference, so the path is matched from its thread module on): spawning and scopes.
const THREAD = /6thread[0-9A-Za-z_]{0,40}?(?:spawn_unchecked|6scoped|5scope)/;

// Reviewed crates that start threads only when std reports more than one core, which it never does on wasm32
// with threads off, so they run on one thread there and need none. The lane checks the guard is still the only
// thread use in the crate: every other source file of it, its test-only modules aside, names no std::thread.
const GUARDED = {
  'deep-canvas': {
    file: 'src/document/check.rs',
    why: "the document check splits a big document across scoped threads only when std::thread::available_parallelism reports more than one core (#306)",
  },
};

/** Why a guarded crate's thread use is not a need, or null when the guard no longer holds. */
function guarded(crate, manifest) {
  const entry = GUARDED[crate];
  if (!entry) return null;
  const crateDir = dirname(manifest);
  const guard = join(crateDir, entry.file);
  if (!existsSync(guard) || !/available_parallelism\(\)/.test(readFileSync(guard, 'utf8'))) return null;
  const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.rs') ? [join(dir, e.name)] : []));
  // A crate's `tests.rs` modules are test-only (`#[cfg(test)] mod tests;`), never in the build the lane checks.
  const elsewhere = sources(join(crateDir, 'src')).filter((f) => f !== guard && !f.endsWith('/tests.rs') && /\bthread\s*::/.test(readFileSync(f, 'utf8')));
  return elsewhere.length === 0 ? entry.why : null;
}

const args = process.argv.slice(2);
let planted = null;
if (args.length === 2 && args[0] === '--planted' && (args[1] === 'threads' || args[1] === 'native')) planted = args[1];
else if (args.length !== 0) {
  console.error('usage: node scripts/wasm32.mjs [--planted threads | native]');
  process.exit(2);
}

/** cargo with no flags from the caller's shell that could turn threads on. */
function cargo(cargoArgs, cwd) {
  const env = { ...process.env };
  for (const k of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS']) delete env[k];
  return spawnSync('cargo', cargoArgs, { cwd, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

const fail = (crate, reason) => {
  console.log(`FAIL ${crate}: ${reason}`);
  process.exit(1);
};

const cfg = spawnSync('rustc', ['--print', 'cfg', '--target', TARGET], { cwd: root, encoding: 'utf8' });
if (cfg.status !== 0) fail('toolchain', `rustc has no ${TARGET} target: ${cfg.stderr.trim()} (rustup target add ${TARGET})`);
if (/target_feature="atomics"/.test(cfg.stdout)) fail('toolchain', `${TARGET} is configured with atomics, so threads are on`);

const meta = cargo(['metadata', '--no-deps', '--format-version', '1', '--locked'], root);
if (meta.status !== 0) fail('workspace', `cargo metadata failed: ${meta.stderr.trim()}`);
const members = JSON.parse(meta.stdout).packages.map((p) => p.name);
const core = members.filter((n) => (n === 'deep-canvas' || n.startsWith('deep-canvas-')) && n !== 'deep-canvas-test-modules');
if (members.includes('deep-text')) core.push('deep-text');
core.sort();

/** Builds `packages` in `cwd` for wasm32 and fails the crate that broke it; returns each package's libraries. */
function build(cwd, packages, extra) {
  const r = cargo(['build', ...extra, '--target', TARGET, '--message-format', 'json-render-diagnostics', ...packages.flatMap((p) => ['-p', p])], cwd);
  const libs = new Map();
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const m = JSON.parse(line);
    if (m.reason !== 'compiler-artifact') continue;
    const name = m.target.name.replaceAll('_', '-');
    const files = m.filenames.filter((f) => f.endsWith('.rlib'));
    if (files.length) libs.set(name, { manifest: m.manifest_path, files: [...(libs.get(name)?.files ?? []), ...files] });
  }
  if (r.status !== 0) {
    const broke = /could not compile `([^`]+)`/.exec(r.stderr);
    const error = r.stderr.split('\n').find((l) => l.startsWith('error')) ?? 'the build failed';
    fail(broke ? broke[1] : packages.join(', '), `${error.trim()} (cargo build --target ${TARGET})`);
  }
  for (const [crate, { manifest, files }] of libs) {
    for (const file of files) {
      const found = THREAD.exec(readFileSync(file).toString('latin1'));
      if (found && !guarded(crate, manifest)) fail(crate, `needs threads: it starts one through std::thread (${found[0]}), which ${TARGET} with threads off can't`);
    }
  }
  return libs;
}

if (planted === null) {
  build(root, core, ['--locked']);
  for (const crate of core) console.log(`PASS ${crate}`);
  process.exit(0);
}

// The planted run: a copy of deep-canvas with the planted dependency, in its own workspace under target/.
const name = planted === 'threads' ? 'deep-planted-threads' : 'deep-planted-native';
const body = planted === 'threads'
  ? 'pub fn work() -> u32 {\n    std::thread::spawn(|| 1).join().unwrap_or(0)\n}\n'
  : 'pub fn mode(path: &str) -> u32 {\n    use std::os::unix::fs::PermissionsExt;\n    std::fs::metadata(path).map(|m| m.permissions().mode()).unwrap_or(0)\n}\n';
const ws = join(root, 'target', 'wasm32-planted', planted);
rmSync(join(ws, 'deep-canvas'), { recursive: true, force: true });
mkdirSync(join(ws, name, 'src'), { recursive: true });
cpSync(join(root, 'crates', 'deep-canvas'), join(ws, 'deep-canvas'), { recursive: true });
const manifest = readFileSync(join(ws, 'deep-canvas', 'Cargo.toml'), 'utf8');
writeFileSync(join(ws, 'deep-canvas', 'Cargo.toml'), manifest.replace('[dependencies]', `[dependencies]\n${name} = { path = "../${name}" }`));
writeFileSync(join(ws, name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n`);
writeFileSync(join(ws, name, 'src', 'lib.rs'), body);
writeFileSync(join(ws, 'Cargo.toml'), '[workspace]\nmembers = ["deep-canvas", "' + name + '"]\nresolver = "2"\n');
if (!existsSync(join(ws, 'Cargo.lock'))) cpSync(join(root, 'Cargo.lock'), join(ws, 'Cargo.lock'));
cpSync(join(root, 'rust-toolchain.toml'), join(ws, 'rust-toolchain.toml'));
build(ws, ['deep-canvas'], []);
for (const crate of ['deep-canvas', name]) console.log(`PASS ${crate}`);
