// The canvas lint (technical design: Seeded and replayable), run by the lint lane. Anything a check reads
// is computed in f64 or scalar code with every transcendental through the ops module on pinned libm,
// so this refuses std's platform-dependent float methods, clocks, thread RNG, glam's f32 SIMD types,
// std::arch vector types, HashMap iteration and references to mutable statics in every crate in scope.
//
// Scope: every workspace crate whose name starts with the canvas prefix `deep-canvas`, plus every
// workspace crate in the dependency closure of a crate whose Cargo.toml says
// `[package.metadata.deep] check_kinds = [...]` with at least one entry (it registers a check kind),
// computed from cargo metadata. Every third-party package in those crates' normal-dependency
// closure (from a registry or a git source, transitive ones included, since a listed crate's API
// hands on what its own dependencies compute; not build or dev dependencies, which never ship in
// checked output, and not path crates, which join the scope themselves, workspace members or
// not) must be listed in the linted tree's lint/canvas/crates.json with its equivalence class,
// why, and the exact version the audit read: a listing is an audit of that package's source,
// which the lint never scans (it's outside the scope), so the entry pins the version, a resolved
// version that differs fails until the listing is re-audited and bumped, and one crate resolved
// at two versions fails outright. Clippy then runs per
// scope crate with the config in
// lint/canvas/clippy.toml (CLIPPY_CONF_DIR, so a workspace's own clippy.toml is never used; the
// config lives outside scripts/, which the preflight entry test copies as flat files)
// and these lints forced on: clippy::disallowed_methods, clippy::disallowed_types,
// clippy::iter_over_hash_type and rustc's static_mut_refs, which catches every reference to a
// `static mut` (a direct read or write of one with no reference is not caught, and is called out below).
// Clippy runs with every target and every feature on. Before it, a text scan of every .rs file
// under each scope crate fails any file but src/ops.rs that names libm, under its own name or a
// Cargo rename, so the pinned functions keep one caller, and fails src/ops.rs itself when it
// re-exports libm, defines a macro, hands a libm token to any macro invocation (a macro is
// never known by its spelling), carries a derive or a path-qualified attribute, or imports
// anything beyond std and core (so every bare attribute there is a builtin); a `static mut`
// declaration, any `unsafe` or `union`, a foreign function block or a path through the `arch` module (intrinsics such
// as `_rdtsc` and `_rdrand64_step`, and the `asm!` macros) fails in any file, and so does
// ambient input through std's `fs`, `env`, `net`, `process`, `thread` and `os` modules (and, in the
// clippy config, io's `last_os_error`, `raw_os_error` and `is_terminal`, the streams outside a
// binary root and an integration test, the source path through `file!` or a caller `Location`, and the compile-time
// `env!` and `option_env!` macros), but for a binary root's own
// command line, exit code and output file (`fs::write` of a path its input names; nothing
// is read) and an integration test spawning the binary, an alias of the `std`
// or `core` root, a target predicate (`target_*`, `unix`, `windows` in a cfg), since clippy
// compiles only the host's selection, any other build predicate in a cfg (`debug_assertions`,
// `feature`, `panic`; `test` alone stays) and `debug_assert!`, since one source would check
// differently per build, an observation of the pointer width (`usize::BITS`,
// `usize::MAX`, `size_of`, `align_of`), and a raw pointer or its address (`*const`, `*mut`,
// `as_ptr`, `addr`, `expose_provenance`, the `ptr` module; a function pointer cast to a number
// is clippy's `fn_to_numeric_cast_any`, forced on);
// an include! or #[path] module (bare or inside cfg_attr) outside the crate, an include_bytes!
// or include_str! of a file outside it, or
// any symlink under it, fails as unread code; and a
// scope crate with a build script or a procedural macro fails, since what either generates is never
// linted. A path crate
// outside the workspace is in scope too and gets its own clippy run, since cargo wraps only
// members (tests/canvas-lint.test.mjs plants and twins these).
//
// Usage: node scripts/canvas-lint.mjs [--root <workspace dir>]   (default: this repo)
// Prints one line per finding and one PASS line on success; exits 1 on a finding, 2 when cargo can't run.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const repo = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const configDir = join(repo, 'lint', 'canvas');
const cratesList = 'lint/canvas/crates.json';
const canvasPrefix = 'deep-canvas';
// `fn_to_numeric_cast_any` refuses a function pointer cast to a number: a code address.
const lints = ['clippy::disallowed_methods', 'clippy::disallowed_types', 'clippy::iter_over_hash_type', 'clippy::fn_to_numeric_cast_any', 'static_mut_refs'];
// The one file in a scope crate that may name libm: everything else reaches it through this module.
const opsFile = 'src/ops.rs';
const fixes = {
  finding: 'Route the math through the ops module on pinned libm in f64, take time from the input track, draw from the document seed through hash@1, iterate a BTreeMap or a sorted Vec, and keep state out of statics.',
  unlisted: `Audit the crate's source at the resolved version, then add it to ${cratesList} with that version, its equivalence class (what of its output a check could read) and why it's needed.`,
  stale: `Remove the ${cratesList} entry, or make a scope crate depend on it.`,
  bumped: `Audit the crate's source at the resolved version and set the ${cratesList} entry's version to it, or pin the dependency back to the listed version.`,
  split: 'Pin every crate in scope to the one listed version of the dependency.',
  config: `Repair ${cratesList}: a JSON object mapping each crate name to { "version": "<exact resolved version>", "class": "…", "why": "…" }.`,
  cargo: 'Install Rust with Cargo and clippy, which preflight already needs, and make the workspace build.',
  scope: `Name a canvas crate with the ${canvasPrefix} prefix, or mark a crate that registers a check kind with [package.metadata.deep] check_kinds = ["<kind>"].`,
  libm: `Call the function through the crate's ${opsFile} module, the one audited math surface on pinned libm, and add a wrapper there if it has none.`,
  target: 'Declare the dependency under [dependencies] for every platform, or drop it: a scope crate compiles with the same crates, versions and features everywhere.',
  macro: 'Keep procedural macros out of scope: write the code the macro would emit, or take an audited third-party macro crate through the listing.',
  build: 'Remove the build script from the crate in scope: generate nothing at build time, or move the generation to a crate a check never reads.',
  include: 'Include or #[path] only a literal path to a .rs file inside the crate (include_bytes! and include_str! a file inside it), keep no symlinks under it, or make the code a plain module of the crate.',
};
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
// Two paths naming one file, through symlinks or not; a path that doesn't exist matches nothing.
const samePath = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const toPosix = (path) => path.split(sep).join(posix.sep);

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
if (rootIndex >= 0 && !args[rootIndex + 1]) {
  console.log('BLOCKED canvas-lint: --root needs a directory');
  process.exit(2);
}
const root = rootIndex >= 0 ? realpathSync(args[rootIndex + 1]) : repo;
const results = [];
const report = (state, message, fix) => results.push({ state, line: `${state} canvas-lint: ${message}`, fix });
const relativeFile = (file) => toPosix(isAbsolute(file) ? relative(root, file) : file);

function cargo(cargoArgs) {
  const result = spawnSync('cargo', cargoArgs, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CLIPPY_CONF_DIR: configDir } });
  if (result.error) throw Error(`cargo ${cargoArgs[0]} could not run (spawn ${result.error.path} ${result.error.code})`);
  return result;
}

function readList() {
  let list;
  try {
    // The listing lives in the tree it describes, so a linted tree brings its own audits; a tree
    // without one has audited nothing, and each third-party dependency it has fails as unlisted.
    list = JSON.parse(readFileSync(join(root, cratesList), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { list: {} };
    return { error: `${cratesList}: ${error.code ? `cannot be read (${error.code})` : error.message}` };
  }
  if (!list || typeof list !== 'object' || Array.isArray(list)) return { error: `${cratesList} is not an object` };
  for (const [name, entry] of Object.entries(list))
    for (const field of ['version', 'class', 'why']) if (typeof entry?.[field] !== 'string' || !entry[field].trim()) return { error: `${cratesList}: ${name} has no ${field}` };
  return { list };
}

// The scope crates, the workspace and path crates in their closure, and every third-party
// package their normal-dependency closure resolves, from one cargo metadata run with the
// resolve graph.
function readScope() {
  const result = cargo(['metadata', '--format-version', '1']);
  if (result.status !== 0) throw Error(`cargo metadata exited ${result.status}: ${result.stderr.trim().split('\n').at(-1)}`);
  const metadata = JSON.parse(result.stdout);
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const members = new Set(metadata.workspace_members);
  const marked = metadata.workspace_members.filter((id) => {
    const kinds = packages.get(id).metadata?.deep?.check_kinds;
    return packages.get(id).name.startsWith(canvasPrefix) || (Array.isArray(kinds) && kinds.length > 0);
  });
  const closure = new Set();
  const thirdParty = new Map();
  const walk = (id) => {
    if (closure.has(id) || thirdParty.has(id)) return;
    const pkg = packages.get(id);
    // A path crate is in scope whether or not it's a workspace member: its code compiles into
    // the crate just the same, and it's listed nowhere. A sourced package is listed instead, and
    // keyed by package, not name: Cargo can resolve one crate at two versions for two crates in
    // scope, and each version is its own source to audit.
    if (members.has(id) || !pkg.source) closure.add(id);
    else thirdParty.set(id, { name: pkg.name, version: pkg.version, via: null });
    for (const dep of nodes.get(id).deps) {
      // Build and dev dependencies never ship in checked output; the rest of the closure does,
      // whichever package reaches it, since a listed crate's API hands on what its own compute.
      if (!dep.dep_kinds.some((kind) => kind.kind === null)) continue;
      walk(dep.pkg);
      const reached = thirdParty.get(dep.pkg);
      if (reached && reached.via === null) reached.via = pkg.name;
    }
  };
  for (const id of marked) walk(id);
  const scope = [...closure].map((id) => {
    const pkg = packages.get(id);
    return {
      name: pkg.name,
      member: members.has(id),
      root: dirname(pkg.manifest_path),
      // The names this crate reaches the libm package by: `libm`, or a Cargo rename (`math = { package = "libm" }`).
      libmNames: nodes.get(id).deps.filter((dep) => packages.get(dep.pkg).name === 'libm').map((dep) => dep.name),
      depNames: nodes.get(id).deps.map((dep) => dep.name),
      buildScript: pkg.targets.some((target) => target.kind.includes('custom-build')),
      // A procedural macro crate's output is code the scan never reads: `libm::sin` emitted
      // from a string in its source reaches a scope crate past the ops module.
      procMacro: pkg.targets.some((target) => target.kind.includes('proc-macro')),
      // Each Cargo target's root file: `[lib] path = "src/ops.rs"` would make the privileged file
      // the whole crate.
      targetRoots: pkg.targets.map((target) => target.src_path),
      // The roots of its integration tests, which drive a binary as a process and never ship.
      testRoots: pkg.targets.filter((target) => target.kind.includes('test')).map((target) => target.src_path),
      // The roots of its binaries, the one place the command line and the exit code are its own.
      binRoots: pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.src_path),
      // Normal dependencies declared under a `[target.'cfg(…)'.dependencies]` table: what the
      // crate compiles with then differs per platform (another crate, version or feature set).
      targetDeps: pkg.dependencies.filter((dep) => dep.target && dep.kind === null),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { crates: scope.map((crate) => crate.name), scope, thirdParty };
}

// libm is pinned so every check reads one implementation of each function; that holds only while
// one module calls it, so any other source file in a scope crate that names libm (by its own name
// or a Cargo rename) is a finding. A text scan, since clippy's disallowed paths can't be scoped to
// a file. A build script is refused outright: its output and its build dependencies compile into
// the crate, and neither clippy nor this scan reads them.
function scanLibm(scope) {
  for (const { name, root: crateRoot, libmNames, depNames, buildScript, procMacro, targetRoots, testRoots, binRoots, targetDeps } of scope) {
    if (buildScript) report('FAIL', `${name} has a build script, whose generated code and build dependencies the lint can't read`, fixes.build);
    if (procMacro) report('FAIL', `${name} is a procedural macro crate, whose expansion the scan never reads`, fixes.macro);
    for (const dep of targetDeps) report('FAIL', `${name} depends on ${dep.rename ?? dep.name}${dep.rename ? ` (${dep.name})` : ''} only under ${dep.target}, so what it compiles with differs per platform`, fixes.target);
    if (targetRoots.some((file) => samePath(file, join(crateRoot, opsFile)))) report('FAIL', `${name} compiles ${opsFile} as a target's root, so the whole target would be the ops module`, fixes.include);
    const names = libmNames.length ? libmNames : ['libm'];
    const alt = names.map((text) => text.replace(/[^\w]/g, '\\$&')).join('|');
    // Any libm token at all outside the ops module: a macro can turn a bare `libm` argument
    // (`call!(libm, x)`) into `libm::sin`, so no form of the name is inert. Over the whole
    // blanked source, so a `use` split across lines is one match, reported at the `use`.
    const libmUse = new RegExp(`\\b(use|extern\\s+crate)\\s+(${alt})\\b|\\b(${alt})\\b`, 'g');
    // In the ops module itself, a `pub use libm …` or `pub extern crate libm` would hand libm to
    // every other file under another name, so the module may call libm but never re-export it.
    // Any `pub … use`/`extern crate` statement that names libm before its `;` counts, whatever
    // the path's form (`::libm`, `{libm as x}`, `libm::{sin, cos}`).
    const libmReexport = new RegExp(`\\bpub\\b(\\s*\\([^)]*\\))?\\s*(use|extern\\s+crate)\\b[^;]*?\\b(${alt})\\b`, 'g');
    // A macro can build that re-export out of pieces the scan never sees together
    // (`macro_rules! leak { ($p:path) => { pub use $p as leaked; } } leak!(libm);`), so the ops
    // module defines no macro and hands libm to none.
    // No macro is known by its spelling (a crate root's #[macro_use] can put a dependency's
    // `assert_eq!` in scope), so no invocation at all may receive a libm token; a test that
    // compares a wrapper against libm binds the libm value first.
    const macroDefinition = /\bmacro_rules!\s*[A-Za-z_]\w*/g;
    const macroCall = /\b[A-Za-z_]\w*!\s*[(\[{]/g;
    const libmName = new RegExp(`\\b(${alt})\\b`);
    // An attribute macro or a derive sees the whole item it marks, libm tokens included. With no
    // `use` or `extern crate` in the ops module beyond std, core and an alias of the parent
    // module itself (`use super as ops;`, through which every name is path-qualified), and no
    // dependency under those names, a bare attribute can only be a builtin, so one with a path
    // (`#[helper::leak]`) or a `derive` is refused, as is any other import.
    const attribute = /#!?\s*\[/g;
    const anyUse = /\b(use|extern\s+crate)\b/g;
    const stdRoot = /^(use|extern\s+crate)\s+(::)?(std|core)\b|^use\s+(super)\s+as\s+[A-Za-z_]\w*\s*;$/;
    // An invocation's tokens run from its opening bracket to the matching close, whatever
    // separators (a `;` included) sit between.
    const macroTokens = (text, open) => {
      let depth = 0;
      for (let i = open; i < text.length; i++) {
        if ('([{'.includes(text[i])) depth++;
        else if (')]}'.includes(text[i]) && --depth === 0) return text.slice(open, i + 1);
      }
      return text.slice(open);
    };
    // `static_mut_refs` catches a reference to a mutable static, not its declaration or a direct
    // read or write, and an atomic, a lock, a cell or a thread local counts with neither `mut`
    // nor `unsafe`, so every static declaration is refused, wherever it sits: an address state a
    // check could carry between runs. A `const` and the `'static` lifetime stay.
    const staticItem = /(?<!')\bstatic\b|\bthread_local\s*!/g;
    // `unsafe` is what lets a transmute of a reference, a union read or a pointer dereference
    // compile, each an address with no pointer token to match; a check needs none of it.
    const unsafeCode = /\bunsafe\b/g;
    const unionDecl = /\bunion\s+[A-Za-z_]\w*\s*[<{]/g;
    // A foreign function block (`extern "C" { fn sin(x: f64) -> f64; }`, the ABI string blanked
    // here) imports the platform's own symbols, its math library first among them, past both
    // the libm scan and clippy's method paths; an `extern "C" fn` definition is not a block.
    const foreignBlock = /\bextern\s*\{/g;
    // The OS entropy source as a value (`rand::rngs::OsRng.next_u64()`) is no type position, so
    // clippy's disallowed type never sees it; the name in a path is. An import under another
    // name is a type path clippy does see.
    const entropySource = /\bOsRng\b/g;
    // Every architecture intrinsic (`_rdtsc`, `_rdrand64_step`, the SIMD sets) and the `asm!`
    // macros live under `std::arch`/`core::arch`; any path through that module, imported or
    // spelled out, is a hardware clock, entropy or platform-specific arithmetic past every
    // method path clippy sees. A module of the crate's own named `arch` is refused with them.
    // The module right after `std::`/`core::` counts whatever follows (`use core::arch as hw;`
    // is the module under an alias), and a bare `arch::` is a path through it.
    const archModule = /\b(?:std|core)\s*::\s*arch\b|\barch\s*::/g;
    // Ambient input (technical design: a check reads no clock, setting or file): the filesystem
    // (`/dev/urandom` is entropy by another name), the environment, the network and processes
    // are host state, so any path through those std modules fails, as does a grouped import
    // that names one (`use std::{env, io::Write}`). What a binary is stays, in its root only: its command line
    // (`env::args`, `env::args_os`), its exit code (`process::exit`), stdin and stdout, which are
    // the document itself, and a process spawned from an integration test's root, which drives
    // the binary. A module of the crate's own under one of these names is refused with them.
    // As with `arch`: `std::env` counts whatever follows (an alias included), `env::` as well.
    // `thread` is host state too (`available_parallelism`, a thread's ID, its name), and `os`
    // the raw handles beneath std's streams, and `backtrace` the stack's addresses, symbols and
    // source paths; the io host-state reads (`last_os_error`,
    // `raw_os_error`, `is_terminal`) are clippy's disallowed methods, since stdin and stdout stay;
    // `last_os_error`, the thread's errno, is scanned here because clippy's path lookup never
    // matched it (tested against `std::io::Error::last_os_error`).
    const lastOsError = /\blast_os_error\s*\(/g;
    // `env!` and `option_env!` read the compiler's process environment when the crate builds:
    // no `std::env` path, no clippy item, and a value the building machine picks. The one
    // read that stays is an integration test's `env!("CARGO_BIN_EXE_<name>")`, Cargo's handle
    // to the binary the test spawns.
    // The process's streams are a binary root's own (its document in, its answer out) and an
    // integration test's pipes to the binary; in any other file they are a check reading or
    // writing its process, so the names themselves are refused there.
    const streamName = /\b(stdin|stdout|stderr)\b/g;
    const envMacro = /\b(option_env|env)\s*!\s*\(/g;
    // `file!()` is the path the compiler saw and `Location::caller().file()` the same at run
    // time: the checkout's layout, not the document. `line!`, `column!` and `module_path!`
    // are fixed by the source itself and stay.
    const sourcePath = /\bfile\s*!|\bLocation\s*::\s*caller\b|\bpanic\s*::\s*Location\b/g;
    const binaryHandle = /^\(\s*"CARGO_BIN_EXE_/;
    const ambientModule = /\bstd\s*::\s*(fs|env|net|process|thread|os|backtrace)\b(?:\s*::\s*([A-Za-z_]\w*))?|\b(fs|env|net|process|thread|os|backtrace)\s*::\s*([A-Za-z_]\w*)?/g;
    const ownInput = (module, item, { binary, integrationTest }) =>
      (binary && module === 'env' && /^args(_os)?$/.test(item ?? '')) || (binary && module === 'fs' && item === 'write') || (module === 'process' && ((binary && item === 'exit') || integrationTest));
    const ambientGroup = /\bstd\s*::\s*\{/g;
    const ambientName = /\b(fs|env|net|process|thread|os|backtrace)\b/;
    // An alias of the root itself (`use std as host;`, `extern crate core as machine;`,
    // `use std::{self as sys}`) would hide every module behind it from the scans above.
    // A target predicate (`cfg!(target_arch = "x86_64")`, `#[cfg(target_os = …)]`, `#[cfg(unix)]`,
    // `cfg_attr(windows, …)`) selects code by platform, so one source computes differently per
    // machine with nothing disallowed in it; clippy sees only the host's selection. Any cfg
    // predicate name (`target_arch` and the rest) fails wherever it appears, and so does a cfg
    // whose tokens name the `unix` or `windows` family.
    const targetPredicate = /\btarget_(?:arch|os|family|env|endian|pointer_width|vendor|has_atomic|feature|abi)\b/g;
    const cfgCall = /\bcfg(?:_attr)?!?\s*\(/g;
    const familyPredicate = /\b(unix|windows)\b/;
    // Any other predicate (`debug_assertions`, `feature = …`, `panic = …`) selects code by the
    // build profile or feature set, so one source checks differently in debug and release; only
    // `test` stays, since a test module is never the shipped check. For `cfg_attr` the predicate
    // ends at the first top-level comma; what follows is the attribute it gates.
    const predicateName = /\b[A-Za-z_]\w*\b/g;
    const predicateWord = /^(?:test|not|all|any|true|false|target_\w+|unix|windows)$/;
    const cfgPredicate = (tokens) => {
      let depth = 0;
      for (let i = 0; i < tokens.length; i++) {
        if ('([{'.includes(tokens[i])) depth++;
        else if (')]}'.includes(tokens[i])) depth--;
        else if (tokens[i] === ',' && depth === 1) return tokens.slice(0, i);
      }
      return tokens;
    };
    // `debug_assert!` runs in one build and not the other: a check that panics in debug passes in
    // release.
    const debugAssert = /\bdebug_assert(?:_eq|_ne)?\s*!/g;
    // The pointer width is 32 on wasm32 and 64 on the reference Macs, and `usize::BITS`,
    // `usize::MAX`, `isize::MIN` and `size_of`/`align_of` (of anything: layouts follow the
    // target) observe it with no predicate in sight. Fixed widths (`u64::BITS`) are the same
    // everywhere and stay.
    const pointerWidth = /\b(?:usize|isize)\s*::\s*(?:BITS|MAX|MIN)\b|\b(?:size_of|align_of)(?:_val)?\b/g;
    // A raw pointer is an address: `(&x as *const u8) as usize` is the stack under ASLR,
    // `.addr()` and `expose_provenance()` the same without a cast, `as_ptr()` the way to one,
    // and the `ptr` module the rest. None of it is a value a check reads; a function pointer
    // cast to a number is clippy's `fn_to_numeric_cast_any`, forced below.
    const rawPointer = /\*\s*(?:const|mut)\b|\bas_(?:mut_)?ptr\s*\(|\.\s*(?:addr|expose_provenance)\s*\(|\bptr\s*::/g;
    const rootAlias = /\b(std|core)\s+as\b/g;
    const rootGroup = /\b(std|core)\s*::\s*\{/g;
    const selfAlias = /\bself\s+as\b/;
    // Every Rust file under the crate, whatever Cargo target paths point at, but not its build output.
    // A symlink is refused: rustc follows it, the walk doesn't, and it can leave the crate.
    const crateReal = realpathSync(crateRoot);
    // Inside the crate, and not under its build directory, which the walk below never reads.
    const inside = (real) => (real === crateReal || real.startsWith(crateReal + sep)) && !real.startsWith(join(crateReal, 'target') + sep);
    // A Cargo target may be rooted anywhere (`[lib] path = "target/evil.rs"`, `"../evil.rs"`) and
    // under any name (`"src/lib.txt"`); clippy compiles it, so a root the walk below never
    // reads, by place or by extension, is unscanned source.
    for (const file of targetRoots) {
      let real = file;
      try { real = realpathSync(file); } catch { /* a missing root: cargo metadata named it, so clippy will say */ }
      if (!inside(real)) report('FAIL', `${name} compiles ${toPosix(relative(crateRoot, file))} as a target's root, which the scan never reads: outside the crate, or under its target/ directory`, fixes.include);
      else if (!real.endsWith('.rs')) report('FAIL', `${name} compiles ${toPosix(relative(crateRoot, file))} as a target's root, which the scan never reads: not a .rs file`, fixes.include);
    }
    for (const file of readdirSync(crateRoot, { recursive: true, withFileTypes: true })) {
      const path = join(file.parentPath ?? file.path, file.name);
      const inCrate = toPosix(relative(crateRoot, path));
      if (inCrate.startsWith('target/')) continue;
      if (file.isSymbolicLink()) { report('FAIL', `${relativeFile(path)} is a symlink, which the lint can't follow`, fixes.include); continue; }
      if (!file.isFile() || !file.name.endsWith('.rs')) continue;
      const source = readFileSync(path, 'utf8');
      const where = (index) => {
        const before = source.slice(0, index);
        return `${relativeFile(path)}:${before.split('\n').length}:${index - before.lastIndexOf('\n')}`;
      };
      // The blanked text has the source's length, so an index in it reads the source too.
      const code = stripRust(source);
      // A macro defined in scope expands to code the scan never reads: `cfg!($p)` names no
      // predicate where the scan looks, and `platform!(unix)` holds no `cfg`.
      for (const match of code.matchAll(macroDefinition)) report('FAIL', `${where(match.index)} a macro definition, whose expansion the scan never reads`, fixes.finding);
      for (const match of code.matchAll(staticItem)) report('FAIL', `${where(match.index)} a static item, state a check could carry between runs`, fixes.finding);
      for (const match of code.matchAll(unsafeCode)) report('FAIL', `${where(match.index)} unsafe code, whose reads (an address, a transmute, a union) the scan can't bound`, fixes.finding);
      for (const match of code.matchAll(unionDecl)) report('FAIL', `${where(match.index)} a union, whose fields alias one address`, fixes.finding);
      for (const match of code.matchAll(foreignBlock)) report('FAIL', `${where(match.index)} a foreign function block, which can import the platform's math library`, fixes.libm);
      for (const match of code.matchAll(entropySource)) report('FAIL', `${where(match.index)} OsRng, the OS entropy source; draw from the document's seed through hash@1`, fixes.finding);
      for (const match of code.matchAll(archModule)) report('FAIL', `${where(match.index)} the arch module, whose intrinsics and asm! read hardware clocks and entropy and compute per platform`, fixes.finding);
      const integrationTest = testRoots.some((file) => samePath(file, path));
      const binary = binRoots.some((file) => samePath(file, path));
      if (!binary && !integrationTest) {
        for (const match of code.matchAll(streamName)) report('FAIL', `${where(match.index)} the ${match[1]} stream, the process's own input and output, which a binary root alone reads and writes`, fixes.finding);
      }
      for (const match of code.matchAll(ambientModule)) {
        const [module, item] = match[1] ? [match[1], match[2]] : [match[3], match[4]];
        if (!ownInput(module, item, { binary, integrationTest })) report('FAIL', `${where(match.index)} the ${module} module, ambient input a check never reads`, fixes.finding);
      }
      for (const match of code.matchAll(targetPredicate)) report('FAIL', `${where(match.index)} a target predicate (${match[0]}), code that computes differently per platform`, fixes.finding);
      for (const match of code.matchAll(cfgCall)) {
        const tokens = macroTokens(code, match.index + match[0].length - 1);
        const family = familyPredicate.exec(tokens);
        if (family) report('FAIL', `${where(match.index)} a target predicate (${family[1]}), code that computes differently per platform`, fixes.finding);
        const predicate = match[0].includes('_attr') ? cfgPredicate(tokens) : tokens;
        const other = [...predicate.matchAll(predicateName)].map((name) => name[0]).find((name) => !predicateWord.test(name));
        if (other) report('FAIL', `${where(match.index)} a build predicate (${other}), code that computes differently per build`, fixes.finding);
      }
      for (const match of code.matchAll(debugAssert)) report('FAIL', `${where(match.index)} debug_assert!, a check that runs in one build and not the other`, fixes.finding);
      for (const match of code.matchAll(pointerWidth)) report('FAIL', `${where(match.index)} the pointer width (${match[0].replace(/\s+/g, '')}), 32 on wasm32 and 64 on the reference Macs`, fixes.finding);
      for (const match of code.matchAll(lastOsError)) report('FAIL', `${where(match.index)} last_os_error, the thread's OS error state, host state a check never reads`, fixes.finding);
      for (const match of code.matchAll(sourcePath)) report('FAIL', `${where(match.index)} the source path (${match[0].replace(/\s+/g, '')}), the compiler's view of the checkout rather than the document`, fixes.finding);
      for (const match of code.matchAll(envMacro)) {
        if (integrationTest && match[1] === 'env' && binaryHandle.test(macroTokens(source, match.index + match[0].length - 1))) continue;
        report('FAIL', `${where(match.index)} the ${match[1]}! macro, the building machine's environment compiled into the check`, fixes.finding);
      }
      for (const match of code.matchAll(rawPointer)) report('FAIL', `${where(match.index)} a raw pointer (${match[0].replace(/\s+/g, '')}), an address that differs per process and target`, fixes.finding);
      for (const match of code.matchAll(rootAlias)) report('FAIL', `${where(match.index)} an alias of ${match[1]}, which would hide its modules from the scan`, fixes.finding);
      for (const match of code.matchAll(rootGroup)) {
        if (selfAlias.test(macroTokens(code, match.index + match[0].length - 1))) report('FAIL', `${where(match.index)} an alias of ${match[1]}, which would hide its modules from the scan`, fixes.finding);
      }
      for (const match of code.matchAll(ambientGroup)) {
        const named = ambientName.exec(macroTokens(code, match.index + match[0].length - 1));
        if (named) report('FAIL', `${where(match.index)} a grouped import of the ${named[1]} module, ambient input a check never reads`, fixes.finding);
      }
      // Source pulled in by include! or a #[path] module attribute (bare, or inside cfg_attr) is
      // read only when it's a file of this crate, which the walk above covers; anything else (a
      // computed path, a file outside the crate, a path through a symlink) is unread code, in
      // the ops module as much as anywhere. A file read at compile time by include_bytes! or
      // include_str! is data of the crate when inside it, and host input baked into the check
      // when outside. The form is found in the blanked text (so a comment or a string holding
      // one is inert) and the path literal is then read from the source.
      for (const match of code.matchAll(/\binclude(_bytes|_str)?!\s*\(|#\s*\[\s*path\s*=|#\s*\[\s*cfg_attr\s*\([^\]]*?\bpath\s*=/g)) {
        const kind = match[0].startsWith('#') ? '#[path]' : `include${match[1] ?? ''}!`;
        const data = Boolean(match[1]);
        const literal = /^\s*("([^"\\]|\\.)*")?/.exec(source.slice(match.index + match[0].length))[1];
        let target = null;
        try { target = literal && realpathSync(join(dirname(path), JSON.parse(literal))); } catch { target = null; }
        if (data) {
          if (!target || !inside(target)) report('FAIL', `${where(match.index)} ${kind} of a file the lint can't read: outside the crate, or not a literal path`, fixes.include);
        } else if (!target || !inside(target) || !target.endsWith('.rs')) report('FAIL', `${where(match.index)} ${kind} of source the lint can't read`, fixes.include);
        // The privileged file compiled again under another module would be a second ops module.
        else if (target === join(crateReal, opsFile)) report('FAIL', `${where(match.index)} ${kind} of the ops module, which is compiled once as src/ops.rs`, fixes.include);
      }
      if (inCrate === opsFile) {
        for (const match of code.matchAll(libmReexport)) report('FAIL', `${where(match.index)} the ops module re-exports libm`, fixes.libm);
        for (const match of code.matchAll(macroCall)) if (libmName.test(macroTokens(code, match.index + match[0].length - 1))) report('FAIL', `${where(match.index)} the ops module passes libm to a macro, whose expansion the lint can't read`, fixes.libm);
        for (const match of code.matchAll(attribute)) {
          const tokens = macroTokens(code, match.index + match[0].length - 1);
          if (tokens.includes('::') || /\bderive\b/.test(tokens)) report('FAIL', `${where(match.index)} the ops module carries an attribute that is a macro, whose expansion the lint can't read`, fixes.libm);
        }
        for (const match of code.matchAll(anyUse)) {
          const statement = code.slice(match.index, code.indexOf(';', match.index) + 1 || undefined);
          const found = stdRoot.exec(statement);
          const root = found?.[3] ?? found?.[4];
          if (!root || depNames.includes(root)) report('FAIL', `${where(match.index)} the ops module imports a name that could be a macro, which the lint can't read`, fixes.libm);
        }
        continue;
      }
      for (const match of code.matchAll(libmUse)) report('FAIL', `${where(match.index)} libm reached outside the ops module`, fixes.libm);
    }
  }
}

function checkList(thirdParty, list) {
  const before = results.length;
  const byName = new Map();
  for (const entry of thirdParty.values()) byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
  for (const [name, resolved] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    resolved.sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true }));
    const [{ version, via }] = resolved;
    if (resolved.length > 1) report('FAIL', `${name} is resolved at ${resolved.map((entry) => `${entry.version} for ${entry.via}`).join(' and ')}, but the listing audits one version`, fixes.split);
    else if (!Object.hasOwn(list, name)) report('FAIL', `${via} depends on ${name} ${version}, which ${cratesList} doesn't list`, fixes.unlisted);
    else if (list[name].version !== version) report('FAIL', `${name} is listed at ${list[name].version}, but ${version} is resolved for ${via}; the listing audited another version`, fixes.bumped);
  }
  // The list describes the linted tree's closure, so an entry no scope crate depends on is stale.
  for (const name of Object.keys(list))
    if (!byName.has(name)) report('FAIL', `${cratesList} lists ${name}, which no crate in scope depends on`, fixes.stale);
  return results.length === before;
}

// One clippy run over every scope crate, read as JSON compiler messages. A message of one of the lint's
// own lints is a finding; any other error means clippy couldn't lint the crate, which blocks. The lints
// are forbidden (-F), which an #[allow] in the code can't switch off; a finding is then a compile error,
// so a crate with findings hides its dependents' until it's fixed. The run fails either way.
function runClippy(scope) {
  const members = scope.filter((crate) => crate.member).map((crate) => crate.name);
  if (members.length) clippyRun(members.flatMap((name) => ['-p', name]), root);
  // Cargo puts clippy only on workspace members (its workspace wrapper), so a path crate outside
  // the workspace is linted as the root of its own, into the same target directory.
  // Inside the crate a disallowed path names (a vendored glam, a stub rand), that path is the
  // definition, not a use, so those findings are the crate's own and skipped.
  for (const { name, root: crateRoot, member } of scope) if (!member) clippyRun(['--manifest-path', join(crateRoot, 'Cargo.toml'), '--target-dir', join(root, 'target')], crateRoot, name);
}

function clippyRun(cargoArgs, base, own = null) {
  // Every target and every feature, so code behind a Cargo feature or a cfg is read too.
  const result = cargo(['clippy', ...cargoArgs, '--all-targets', '--all-features', '--message-format=json', '--', ...lints.flatMap((lint) => ['-F', lint])]);
  const seen = new Set();
  let messages = 0;
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const event = JSON.parse(line);
    if (event.reason !== 'compiler-message') continue;
    const { message } = event;
    const code = message.code?.code;
    const span = message.spans.find((candidate) => candidate.is_primary) ?? message.spans[0];
    const where = span ? `${relativeFile(isAbsolute(span.file_name) ? span.file_name : join(base, span.file_name))}:${span.line_start}:${span.column_start} ` : '';
    if (lints.includes(code)) {
      messages++;
      if (own && /`([A-Za-z0-9_]+)::/.exec(message.message)?.[1] === own) continue;
      const key = `${where}${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report('FAIL', `${where}${message.message} (${code})`, fixes.finding);
    } else if (message.level === 'error' && !/^aborting due to|^could not compile/.test(message.message)) {
      messages++;
      report('BLOCKED', `${where}${message.message.split('\n')[0]}${code ? ` (${code})` : ''}`, fixes.cargo);
    }
  }
  if (result.status !== 0 && !messages) report('BLOCKED', `cargo clippy exited ${result.status}: ${result.stderr.trim().split('\n').filter((line) => /error/.test(line)).at(-1) ?? result.stderr.trim().split('\n').at(-1)}`, fixes.cargo);
}

try {
  if (!existsSync(join(root, 'Cargo.toml'))) throw Error(`${root} has no Cargo.toml`);
  const { crates, scope, thirdParty } = readScope();
  const { list, error } = readList();
  if (error) report('INVALID', error, fixes.config);
  if (!crates.length) report('INVALID', `no workspace crate has the ${canvasPrefix} prefix or registers a check kind`, fixes.scope);
  else {
    const listed = list ? checkList(thirdParty, list) : false;
    scanLibm(scope);
    runClippy(scope);
    if (!results.length && listed) report('PASS', `${plural(crates.length, 'crate')} in scope (${crates.join(', ')}), ${plural(thirdParty.size, 'third-party crate')} listed`);
  }
} catch (error) {
  report('BLOCKED', error.message, fixes.cargo);
}

const order = ['FAIL', 'INVALID', 'BLOCKED', 'PASS'];
results.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.line.localeCompare(b.line));
for (const { line } of results) console.log(line);
const fix = [...new Set(results.filter(({ fix }) => fix).map(({ fix }) => fix))].join(' ');
if (fix) console.log(`  Fix: ${fix}`);
process.exitCode = results.some(({ state }) => state === 'BLOCKED') ? 2 : results.some(({ state }) => state !== 'PASS') ? 1 : 0;
