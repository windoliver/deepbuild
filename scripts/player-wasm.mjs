// The web player built to WebAssembly (issue #172; canvas primitives: Export: web player): deep-player's library for
// wasm32-unknown-unknown in release, on one thread (no atomics, so its memory is never shared), with the checkout's
// lockfile and only this script's flags (the caller's *RUSTFLAGS cleared), its source paths written relative so no
// machine's home or checkout enters it, then bound to the page by wasm-bindgen at the lockfile's version. The result
// is committed under crates/deep-player/web/dist/ with player.json, and the export embeds those bytes, so nothing
// compiles per export and bundles are byte-identical on every machine. Rebuild it when a crate the player links
// changes; the bytes' sha256 is the receipt's `player.hash`.
//
// It builds once per module set (#1490), each the deep-player feature of its name, into dist/<set>/, and records each
// set's compressed size (Brotli at quality 11 of its WebAssembly and page glue, as the player's budget measures them)
// in dist/sets.json: the export takes the smallest set that holds a document's modules.
//
// The full set reaches the 3D module, whose meshopt C++ the build compiles for wasm32: the compiler's builtins stand in
// for the float functions wasm32's bare headers don't declare, and LLVM's own archiver (the pinned toolchain's
// llvm-tools component) packs its objects, since the system archiver drops wasm objects.
//
// Usage: node scripts/player-wasm.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

// The module sets, smallest first: figure (text, look, marks2d, data, motion and input), game2d (adds physics and
// logic on sandbox) and full (every module the player carries).
const SETS = ['figure', 'game2d', 'full'];

const root = fileURLToPath(new URL('../', import.meta.url));
const TARGET = 'wasm32-unknown-unknown';
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const dist = join(root, 'crates/deep-player/web/dist');
const env = { ...process.env, CARGO_INCREMENTAL: '0' };
for (const k of Object.keys(env)) if (/^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_TARGET_\w+_RUSTFLAGS)$/.test(k)) delete env[k];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} failed:\n${(r.error?.message ?? r.stderr).slice(-4000)}`);
    process.exit(1);
  }
  return r.stdout;
};

// LLVM's archiver from the pinned toolchain.
const sysroot = run('rustc', ['--print', 'sysroot']).trim();
const host = run('rustc', ['-vV']).match(/^host: (.+)$/m)[1];
const ar = join(sysroot, 'lib/rustlib', host, 'bin/llvm-ar');
if (!existsSync(ar)) {
  console.error(`BLOCKED: no llvm-ar at ${ar}. Unblock: rustup component add llvm-tools --toolchain ${sysroot.split('/').pop()}`);
  process.exit(2);
}
env.AR_wasm32_unknown_unknown = ar;
env.CFLAGS_wasm32_unknown_unknown = ['floorf', 'ceilf', 'roundf', 'truncf', 'sqrtf', 'log2f', 'logf', 'expf', 'exp2f', 'powf', 'ldexpf', 'frexpf', 'fmodf', 'sinf', 'cosf', 'tanf', 'asinf', 'acosf', 'atanf', 'atan2f'].map((f) => `-D${f}=__builtin_${f}`).join(' ');
// No machine's paths in the bytes: the checkout, cargo's home and the toolchain written as fixed names.
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
const remap = [[root.replace(/\/$/, ''), '.'], [cargoHome, '/cargo'], [sysroot, '/rustc']];
env.CARGO_ENCODED_RUSTFLAGS = remap.map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join('\x1f');

// wasm-bindgen at the version the lockfile resolves, or no build.
const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
const locked = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)[1];
const bindgen = spawnSync('wasm-bindgen', ['--version'], { env, encoding: 'utf8' });
const have = bindgen.stdout?.trim().split(' ')[1];
if (have !== locked) {
  console.error(`BLOCKED: wasm-bindgen ${have ?? 'missing'}, the lockfile's is ${locked}. Unblock: cargo install wasm-bindgen-cli --version ${locked} --locked`);
  process.exit(2);
}

// Every set is built into a scratch folder first, and the committed folder replaced only once all of them are.
const built = join(target, 'player-dist');
rmSync(built, { recursive: true, force: true });
const fonts = join(root, 'crates/deep-text/fonts');
const brotli = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
const record = {};
for (const set of SETS) {
  run('cargo', ['rustc', '--locked', '--release', '-p', 'deep-player', '--lib', '--crate-type', 'cdylib', '--target', TARGET, '--no-default-features', '--features', set, '--', '-C', 'strip=symbols'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const out = join(built, set);
  mkdirSync(out, { recursive: true });
  run('wasm-bindgen', ['--target', 'web', '--no-typescript', '--out-name', 'player', '--out-dir', out, join(target, TARGET, 'release', 'deep_player.wasm')]);
  const files = Object.fromEntries(readdirSync(out).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(out, f))).digest('hex')]));
  const wasm = readFileSync(join(out, 'player_bg.wasm'));
  const js = readFileSync(join(out, 'player.js'));
  // What the built player is (its core version, module set digest, runtime digest and modules), read from the built
  // bytes themselves in this Node's WebAssembly engine, so the export's receipt names the player as it runs.
  const glue = await import(pathToFileURL(join(out, 'player.js')).href);
  await glue.default({ module_or_path: wasm });
  // The bundled faces first, as a page gives them from its bundle: the text module's kit sets text in them when it seals.
  for (const f of readdirSync(fonts).filter((n) => /\.(ttf|otf)$/.test(n))) glue.provide_font(f, readFileSync(join(fonts, f)));
  const about = JSON.parse(glue.about());
  writeFileSync(join(out, 'player.json'), `${JSON.stringify({ wasm_bindgen: locked, set, files, ...about }, null, 2)}\n`);
  const at = (f) => `crates/deep-player/web/dist/${set}/${f}`;
  record[set] = {
    modules: about.modules,
    module_set_digest: about.set_digest,
    wasm: { path: at('player_bg.wasm'), sha256: files['player_bg.wasm'] },
    glue: { path: at('player.js'), sha256: files['player.js'] },
    compressed: brotli(wasm) + brotli(js),
  };
  console.log(`${set}: player_bg.wasm ${wasm.length} bytes sha256 ${files['player_bg.wasm']}, ${record[set].compressed} bytes Brotli-11`);
}
writeFileSync(join(built, 'sets.json'), `${JSON.stringify({ compression: 'brotli-11', sets: record }, null, 2)}\n`);
rmSync(dist, { recursive: true, force: true });
renameSync(built, dist);
const sizes = Object.entries(record).map(([n, r]) => `${n} ${r.compressed} B (${((1 - r.compressed / record.full.compressed) * 100).toFixed(1)}% under full)`);
console.log(`${dist}: ${sizes.join(', ')}`);
