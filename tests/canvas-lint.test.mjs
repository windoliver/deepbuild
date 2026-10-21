// The canvas lint's libm boundary (issue #389; technical design: Seeded and replayable): in a scope
// crate only src/ops.rs may name libm, so a planted direct call elsewhere fails naming its file and
// line, and the twin that goes through the ops module passes. The seven clippy-side forms are the
// acceptance suite's (tests/acceptance/389/lint.test.ts); this covers the text scan those can't.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const lintScript = fileURLToPath(new URL('../scripts/canvas-lint.mjs', import.meta.url));

const OPS = 'pub fn sin(x: f64) -> f64 {\n    libm::sin(x)\n}\n';
// The planted call sits after a string holding `//`, which a line-based comment strip would take
// for a comment; the twin names libm only inside a string, a raw string, a char and comments.
const PLANTED = 'pub mod ops;\n\npub fn reading(x: f64) -> f64 {\n    let (_source, direct) = ("https://example", libm::sin(x)); // plant: direct libm\n    direct + ops::sin(x)\n}\n';
const TWIN = 'pub mod ops;\n\n/// Reads through libm::sin by way of the ops module.\npub fn reading(x: f64) -> f64 {\n    let _names = ("libm::sin", r#"use libm;"#, \'"\', b"libm::cos");\n    /* libm::tan, in a /* nested */ block */\n    let _inert = "include!(\\"../../outside.rs\\")"; // twin: inert text; #[path = "../../outside.rs"] in a comment\n    ops::sin(x) + ops::sin(x) // twin: through the ops module; libm::sin\n}\n';

/** A throwaway workspace: one canvas crate whose `libm` is a stub path crate, so it builds offline.
 * `rename` is the name the crate reaches libm by (`math = { package = "libm" }`); `build` plants a
 * build script. */
function workspace(lib, { rename = 'libm', build = false, libPath = 'src/lib.rs', helper = '', symlink = false, features = [], ops = OPS, extra = {}, stubs = {}, registry = [], listing = null, manifest = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-lint-'));
  // Registry (third-party) dependencies, served offline from a vendor directory that replaces
  // crates.io, so they resolve with a registry source and are not in the lint's scope. Each is
  // depended on by the planted crate, or by the stub or registry crate `via` names.
  const registryDeps = (via) => registry.filter((entry) => (entry.via ?? 'deep-canvas-planted') === via).map(({ name, version }) => `${name} = "=${version}"\n`).join('');
  if (registry.length) {
    mkdirSync(join(dir, '.cargo'), { recursive: true });
    writeFileSync(join(dir, '.cargo', 'config.toml'), '[source.crates-io]\nreplace-with = "vendored"\n\n[source.vendored]\ndirectory = "vendor"\n');
    for (const { name, version, source } of registry) {
      const crate = join(dir, 'vendor', `${name}-${version}`);
      mkdirSync(join(crate, 'src'), { recursive: true });
      writeFileSync(join(crate, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\n${registryDeps(name)}`);
      writeFileSync(join(crate, 'src', 'lib.rs'), source);
      writeFileSync(join(crate, '.cargo-checksum.json'), '{"files":{}}\n');
    }
  }
  // The linted tree's third-party listing, when the test gives one; without it the tree has
  // audited nothing, which is fine for the stubs, path crates the lint scans instead.
  if (listing) {
    mkdirSync(join(dir, 'lint', 'canvas'), { recursive: true });
    writeFileSync(join(dir, 'lint', 'canvas', 'crates.json'), JSON.stringify(listing));
  }
  // Path dependencies excluded from the workspace, each holding the given source: `helper`, and
  // any stand-in for a registry crate (`rand`) so the planted code builds offline.
  const paths = { ...(helper ? { helper } : {}), ...stubs };
  writeFileSync(join(dir, 'Cargo.toml'), `[workspace]\nmembers = ["deep-canvas-planted"]\nexclude = [${['libm', ...Object.keys(paths)].map((name) => `"stubs/${name}"`).join(', ')}]\nresolver = "2"\n`);
  mkdirSync(join(dir, 'deep-canvas-planted', 'src'), { recursive: true });
  const dep = rename === 'libm' ? 'libm = { path = "../stubs/libm" }' : `${rename} = { package = "libm", path = "../stubs/libm" }`;
  const target = libPath === 'src/lib.rs' ? '' : `\n[lib]\npath = "${libPath}"\n`;
  // Cargo features, each off by default, so code under them compiles only with features on.
  const featureTable = features.length ? `\n[features]\n${features.map((name) => `${name} = []`).join('\n')}\n` : '';
  writeFileSync(join(dir, 'deep-canvas-planted', 'Cargo.toml'), `[package]\nname = "deep-canvas-planted"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n${build ? 'build = "build.rs"\n' : ''}${target}${featureTable}\n[dependencies]\n${dep}\n${Object.keys(paths).map((name) => `${name} = { path = "../stubs/${name}" }\n`).join('')}${registryDeps('deep-canvas-planted')}${manifest}`);
  for (const [name, stub] of Object.entries(paths)) {
    // A stub is its lib.rs source, or `{ source, manifest }` with text appended to its Cargo.toml.
    const { source, manifest: stubManifest = '' } = typeof stub === 'string' ? { source: stub } : stub;
    mkdirSync(join(dir, 'stubs', name, 'src'), { recursive: true });
    writeFileSync(join(dir, 'stubs', name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n${stubManifest}\n[dependencies]\n${registryDeps(name)}`);
    writeFileSync(join(dir, 'stubs', name, 'src', 'lib.rs'), source);
  }
  // A symlinked module file inside the crate that points at a file outside it.
  if (symlink) symlinkSync(join(dir, 'outside.rs'), join(dir, 'deep-canvas-planted', 'src', 'linked.rs'));
  if (build) writeFileSync(join(dir, 'deep-canvas-planted', 'build.rs'), 'fn main() {\n    println!("cargo:rustc-env=PLANTED=1");\n}\n');
  mkdirSync(join(dir, 'deep-canvas-planted', dirname(libPath)), { recursive: true });
  writeFileSync(join(dir, 'deep-canvas-planted', libPath), lib);
  writeFileSync(join(dir, 'deep-canvas-planted', 'src', 'ops.rs'), ops.replaceAll('libm::', `${rename}::`));
  // Further files of the crate, by path under it.
  for (const [path, content] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, 'deep-canvas-planted', path)), { recursive: true });
    writeFileSync(join(dir, 'deep-canvas-planted', path), content);
  }
  writeFileSync(join(dir, 'outside.rs'), 'pub fn outside() {}\n');
  mkdirSync(join(dir, 'stubs', 'libm', 'src'), { recursive: true });
  writeFileSync(join(dir, 'stubs', 'libm', 'Cargo.toml'), '[package]\nname = "libm"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n');
  writeFileSync(join(dir, 'stubs', 'libm', 'src', 'lib.rs'), 'pub fn sin(x: f64) -> f64 {\n    x\n}\n');
  return dir;
}

function lint(t, lib, options) {
  const root = workspace(lib, options);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [lintScript, '--root', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.error, undefined);
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

test('a direct libm call outside src/ops.rs fails the canvas lint naming the file and line', (t) => {
  const line = PLANTED.split('\n').findIndex((text) => text.includes('// plant: direct libm')) + 1;
  const { status, output } = lint(t, PLANTED);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ libm reached outside the ops module`, 'm'), output);
  assert.doesNotMatch(output, /^FAIL .*ops\.rs/m, `ops.rs itself may name libm:\n${output}`);
});

test('a libm dependency renamed in Cargo.toml is caught under its new name outside src/ops.rs', (t) => {
  const lib = PLANTED.replaceAll('libm::', 'math::');
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: direct libm')) + 1;
  const { status, output } = lint(t, lib, { rename: 'math' });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ libm reached outside the ops module`, 'm'), output);
});

test('a use of libm split across lines, and a lib target outside src/, are both caught', (t) => {
  // `use\nlibm\nas math;` on three lines, then the call under the alias; the lib lives at code/lib.rs.
  // A lib outside src/ can't declare src/ops.rs (a #[path] to it would compile the privileged file
  // under another module), so it carries an inline stand-in and the planted call is its finding.
  const standIn = 'pub mod ops {\n    pub fn sin(x: f64) -> f64 {\n        x\n    }\n}';
  const lib = PLANTED.replace('pub mod ops;', `${standIn}\nuse\nlibm\nas math;`).replace('libm::sin(x)); // plant', 'math::sin(x)); // plant');
  const useLine = lib.split('\n').findIndex((text) => text === 'use') + 1;
  const { status, output } = lint(t, lib, { libPath: 'code/lib.rs' });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/code/lib\\.rs:${useLine}:1 libm reached outside the ops module`, 'm'), output);
});

test('a target root that is not a .rs file is refused, since the walk scans .rs files only', (t) => {
  // Cargo compiles `[lib] path = "src/lib.txt"` like any root, but the walk reads `.rs` files
  // only, so a static or an environment read in it would be compiled and never scanned.
  const standIn = 'pub mod ops {\n    pub fn sin(x: f64) -> f64 {\n        x\n    }\n}';
  const lib = `${standIn}\n\nuse std::sync::atomic::AtomicU64;\n\npub static STATE: AtomicU64 = AtomicU64::new(0); // plant: a static in an unscanned root\n\npub fn reading(x: f64) -> f64 {\n    ops::sin(x)\n}\n`;
  const { status, output } = lint(t, lib, { libPath: 'src/lib.txt' });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted compiles src\/lib\.txt as a target's root, which the scan never reads: not a \.rs file/m, output);
});

test('a libm token handed to a macro outside the ops module is caught', (t) => {
  // The definition names no libm; the invocation names it before a comma, which the earlier
  // scan's `::`, `;` and `as` lookahead never matched; the expansion calls libm::sin directly.
  const lib = `${TWIN}\nmacro_rules! call {\n    ($root:ident, $x:expr) => {\n        $root::sin($x)\n    };\n}\n\npub fn expanded(x: f64) -> f64 {\n    call!(libm, x) // plant: libm into a macro\n}\n`;
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: libm into a macro')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ libm reached outside the ops module`, 'm'), output);
});

test('an include! of source outside the crate fails the canvas lint', (t) => {
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\ninclude!("../../outside.rs"); // plant: include outside');
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: include outside')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:1 include! of source the lint can't read`, 'm'), output);
});

test('a #[path] module outside the crate fails the canvas lint', (t) => {
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\n#[path = "../../outside.rs"] // plant: path module outside\nmod external;');
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: path module outside')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:1 #\\[path\\] of source the lint can't read`, 'm'), output);
});

test('compiling src/ops.rs a second time, by include! or by #[path], fails the canvas lint', (t) => {
  // The privileged file under another module would be a second audited surface with its own name.
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\nmod alternate {\n    include!("ops.rs"); // plant: include of ops\n}\n#[path = "ops.rs"] // plant: path to ops\nmod alternate2;');
  const lines = ['// plant: include of ops', '// plant: path to ops'].map((mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[0]}:5 include! of the ops module`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[1]}:1 #\\[path\\] of the ops module`, 'm'), output);
});

test('a Cargo target rooted at src/ops.rs fails the canvas lint naming the crate', (t) => {
  // `[lib] path = "src/ops.rs"` compiles the privileged file as the crate root, so every call in
  // the crate would be "in the ops module".
  const { status, output } = lint(t, TWIN, { libPath: 'src/ops.rs' });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted compiles src\/ops\.rs as a target's root/m, output);
});

test('a Cargo target rooted under target/ or outside the crate fails the canvas lint as unscanned source', (t) => {
  // The walk skips the crate's build directory and never leaves the crate, but `[lib] path`
  // may point either place; clippy compiles the file and the text scan would never read it. The
  // root carries an inline ops stand-in, since src/ops.rs is not beside it.
  const standIn = 'pub mod ops {\n    pub fn sin(x: f64) -> f64 {\n        x\n    }\n}';
  const plant = `${TWIN.replace('pub mod ops;', standIn)}\n#[link(name = "m")]\nextern "C" {\n    fn sin(x: f64) -> f64;\n}\n\npub fn platform(x: f64) -> f64 {\n    unsafe { sin(x) }\n}\n`;
  for (const libPath of ['target/evil.rs', '../evil.rs']) {
    const { status, output } = lint(t, plant, { libPath });
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted compiles ${libPath.replace(/[./]/g, '\\$&')} as a target's root, which the scan never reads`, 'm'), output);
  }
});

test('sqrt as a method or an associated function is routed through the ops module too', (t) => {
  const lib = `${TWIN}\npub fn roots(x: f64) -> f64 {\n    x.sqrt() + f64::sqrt(x) // plant: direct sqrt\n}\n`;
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: direct sqrt')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  const findings = output.split('\n').filter((text) => new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ .*sqrt`).test(text));
  assert.equal(findings.length, 2, output);
});

test('a third-party crate is listed at the exact version resolved, or the lint fails naming both', (t) => {
  // A registry crate's source is outside the lint's reach (here it wraps the clock), so the
  // listing is its audit, and an audit holds for one version: the entry pins it.
  const tick = { name: 'tick', version: '0.1.0', source: 'pub fn tick() -> u128 {\n    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)\n}\n' };
  const lib = `${TWIN}\npub fn stamped() -> u128 {\n    tick::tick()\n}\n`;
  const entry = { class: 'clock', why: 'A test stand-in.' };
  const listed = lint(t, lib, { registry: [tick], listing: { tick: { ...entry, version: '0.1.0' } } });
  assert.equal(listed.status, 0, listed.output);
  assert.match(listed.output, /^PASS canvas-lint: .*1 third-party crate listed$/m, listed.output);
  const bumped = lint(t, lib, { registry: [tick], listing: { tick: { ...entry, version: '0.0.9' } } });
  assert.equal(bumped.status, 1, bumped.output);
  assert.match(bumped.output, /^FAIL canvas-lint: tick is listed at 0\.0\.9, but 0\.1\.0 is resolved/m, bumped.output);
  const unpinned = lint(t, lib, { registry: [tick], listing: { tick: entry } });
  assert.notEqual(unpinned.status, 0, unpinned.output);
  assert.match(unpinned.output, /tick has no version/m, unpinned.output);
  const unlisted = lint(t, lib, { registry: [tick] });
  assert.equal(unlisted.status, 1, unlisted.output);
  assert.match(unlisted.output, /^FAIL canvas-lint: deep-canvas-planted depends on tick 0\.1\.0, which lint\/canvas\/crates\.json doesn't list/m, unlisted.output);
  const stale = lint(t, `${TWIN}\n`, { listing: { tick: { ...entry, version: '0.1.0' } } });
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /^FAIL canvas-lint: lint\/canvas\/crates\.json lists tick, which no crate in scope depends on/m, stale.output);
});

test('a transitive third-party crate is listed at its exact version too, or the lint fails naming what pulls it', (t) => {
  // A listed crate's API can hand a scope crate whatever its own dependencies compute (here the
  // clock), and Cargo may move those under the pinned listing: every resolved package in the
  // normal closure is an audit of its own.
  const clock = 'pub fn now() -> u128 {\n    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)\n}\n';
  const registry = [
    { name: 'tick', version: '0.1.0', source: 'pub fn tick() -> u128 {\n    tock::now()\n}\n' },
    { name: 'tock', version: '0.1.0', source: clock, via: 'tick' },
  ];
  const lib = `${TWIN}\npub fn stamped() -> u128 {\n    tick::tick()\n}\n`;
  const entry = { class: 'clock', why: 'A test stand-in.' };
  const unlisted = lint(t, lib, { registry, listing: { tick: { ...entry, version: '0.1.0' } } });
  assert.equal(unlisted.status, 1, unlisted.output);
  assert.match(unlisted.output, /^FAIL canvas-lint: tick depends on tock 0\.1\.0, which lint\/canvas\/crates\.json doesn't list/m, unlisted.output);
  const bumped = lint(t, lib, { registry, listing: { tick: { ...entry, version: '0.1.0' }, tock: { ...entry, version: '0.0.9' } } });
  assert.equal(bumped.status, 1, bumped.output);
  assert.match(bumped.output, /^FAIL canvas-lint: tock is listed at 0\.0\.9, but 0\.1\.0 is resolved for tick/m, bumped.output);
  const both = lint(t, lib, { registry, listing: { tick: { ...entry, version: '0.1.0' }, tock: { ...entry, version: '0.1.0' } } });
  assert.equal(both.status, 0, both.output);
  assert.match(both.output, /^PASS canvas-lint: .*2 third-party crates listed$/m, both.output);
});

test('two resolved versions of one third-party crate fail the canvas lint, whichever is listed', (t) => {
  // Cargo resolves a crate twice when two crates in scope pin different versions. The listing
  // audits one version, so the second would reach a scope crate unaudited: both are named.
  const source = 'pub fn tick() -> u128 {\n    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)\n}\n';
  const registry = [{ name: 'tick', version: '0.1.0', source }, { name: 'tick', version: '0.2.0', source, via: 'helper' }];
  const lib = `${TWIN}\npub fn stamped() -> u128 {\n    tick::tick() + helper::stamped()\n}\n`;
  const helper = 'pub fn stamped() -> u128 {\n    tick::tick()\n}\n';
  for (const version of ['0.1.0', '0.2.0']) {
    const { status, output } = lint(t, lib, { registry, helper, listing: { tick: { version, class: 'clock', why: 'A test stand-in.' } } });
    assert.equal(status, 1, output);
    assert.match(output, /^FAIL canvas-lint: tick is resolved at 0\.1\.0 for deep-canvas-planted and 0\.2\.0 for helper, but the listing audits one version/m, output);
  }
});

test('a #[path] module under the build directory, which the walk skips, fails the canvas lint', (t) => {
  // target/ is skipped as build output, so a source file compiled from there is never scanned.
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\n#[path = "../target/evil.rs"] // plant: path module under target\nmod evil;');
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: path module under target')) + 1;
  const { status, output } = lint(t, lib, { extra: { 'target/evil.rs': 'pub fn hidden(x: f64) -> f64 {\n    libm::sin(x)\n}\n' } });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:1 #\\[path\\] of source the lint can't read`, 'm'), output);
});

test('a #[cfg_attr] path module outside the crate fails the canvas lint', (t) => {
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\n#[cfg_attr(all(), path = "../../outside.rs")] // plant: cfg_attr path outside\nmod external;');
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: cfg_attr path outside')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:1 #\\[path\\] of source the lint can't read`, 'm'), output);
});

test('an ops module that re-exports libm fails the canvas lint', (t) => {
  // `pub use libm as pinned;` would let every other file call pinned::sin without naming libm.
  const ops = `${OPS}pub use libm as pinned; // plant: re-export\n`;
  const line = ops.split('\n').findIndex((text) => text.includes('// plant: re-export')) + 1;
  const { status, output } = lint(t, TWIN, { ops });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${line}:1 the ops module re-exports libm`, 'm'), output);
});

test('a re-export of libm by absolute path or inside a use group is caught in the ops module', (t) => {
  const ops = `${OPS}pub use ::libm as leaked; // plant: absolute re-export\npub(crate) use {libm as grouped}; // plant: grouped re-export\n`;
  const lines = ['// plant: absolute re-export', '// plant: grouped re-export'].map((mark) => ops.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, TWIN, { ops });
  assert.equal(status, 1, output);
  for (const line of lines) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${line}:1 the ops module re-exports libm`, 'm'), output);
});

test('a macro in the ops module that could expand to a libm re-export is caught', (t) => {
  // The definition names no libm and the invocation no `use`, so only the expansion re-exports.
  const ops = `${OPS}macro_rules! leak { ($p:path) => { pub use $p as leaked; } } // plant: macro definition\nleak!(libm); // plant: libm into a macro\n`;
  const lines = ['// plant: macro definition', '// plant: libm into a macro'].map((mark) => ops.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, TWIN, { ops });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${lines[0]}:1 a macro definition`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${lines[1]}:1 the ops module passes libm to a macro`, 'm'), output);
});

test('a macro invocation in the ops module is read to its closing bracket, past any semicolon', (t) => {
  const helper = '#[macro_export]\nmacro_rules! leak { ($i:tt; $p:path) => { pub use $p as leaked; } }\n';
  const ops = `${OPS}use helper::leak;\nleak!(ignored; libm); // plant: libm after a semicolon\n`;
  const line = ops.split('\n').findIndex((text) => text.includes('// plant: libm after a semicolon')) + 1;
  const { status, output } = lint(t, TWIN, { ops, helper });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${line}:1 the ops module passes libm to a macro`, 'm'), output);
});

test('a foreign function block is refused, since it can import the platform math library', (t) => {
  const lib = `${TWIN}\n#[link(name = "m")]\nextern "C" { // plant: foreign block\n    fn sin(x: f64) -> f64;\n}\n\npub fn platform(x: f64) -> f64 {\n    unsafe { sin(x) }\n}\n`;
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: foreign block')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:1 a foreign function block`, 'm'), output);
});

test('an architecture intrinsic or inline assembly is refused, since it can read a hardware clock or entropy', (t) => {
  // `_rdtsc` on x86_64 and the counter register on aarch64, each behind its cfg so the plant
  // builds on either; every intrinsic and the asm macros live under `arch`, which the scan names.
  const lib = `${TWIN}\n#[cfg(target_arch = "x86_64")]\npub fn ticks() -> u64 {\n    unsafe { core::arch::x86_64::_rdtsc() } // plant: intrinsic\n}\n\n#[cfg(target_arch = "aarch64")]\npub fn ticks() -> u64 {\n    let value: u64;\n    unsafe { core::arch::asm!("mrs {}, cntvct_el0", out(reg) value) }; // plant: asm\n    value\n}\n`;
  const lines = ['// plant: intrinsic', '// plant: asm'].map((mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const line of lines) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ the arch module`, 'm'), output);
});

test('a raw identifier spells the same path: r#arch and r#libm are refused like arch and libm', (t) => {
  // `core::r#arch::x86_64::_rdtsc()` is the intrinsic under another spelling, and `r#libm::sin`
  // the pinned crate; every name scan starts at a word boundary, which `#` gives, so a raw
  // identifier is read as the identifier it spells (a scan anchored on whitespace would miss it).
  const lib = `${TWIN}\n#[cfg(target_arch = "x86_64")]\npub fn ticks() -> u64 {\n    unsafe { core::r#arch::x86_64::_rdtsc() } // plant: raw intrinsic\n}\n\n#[cfg(target_arch = "aarch64")]\npub fn ticks() -> u64 {\n    let value: u64;\n    unsafe { core::r#arch::asm!("mrs {}, cntvct_el0", out(reg) value) }; // plant: raw asm\n    value\n}\n\npub fn raw(x: f64) -> f64 {\n    r#libm::sin(x) // plant: raw libm\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: raw intrinsic', '// plant: raw asm']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ the arch module`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: raw libm')}:\\d+ libm reached outside the ops module`, 'm'), output);
});

test('ambient input through the filesystem, the environment, the network or a process is refused', (t) => {
  // `std::fs::read("/dev/urandom")` is entropy under another name, and an environment variable,
  // a socket or a child process is host state a check could read; a grouped import of the
  // module and a bare `fs::` after `use std::*` are the same reads.
  const lib = `${TWIN}\nuse std::{env, io::Write};\nuse std::*;\n\npub fn entropy() -> Vec<u8> {\n    std::fs::read("/dev/urandom").unwrap_or_default() // plant: fs\n}\n\npub fn setting() -> Option<String> {\n    env::var("DEEP_SEED").ok() // plant: env (grouped import above)\n}\n\npub fn bare() -> bool {\n    fs::metadata("/").is_ok() // plant: bare fs\n}\n\npub fn host() -> Option<u32> {\n    std::process::id().checked_add(0) // plant: process\n}\n\npub fn wire() -> bool {\n    std::net::TcpStream::connect("127.0.0.1:1").is_ok() // plant: net\n}\n\npub fn cores() -> usize {\n    std::thread::available_parallelism().map_or(1, usize::from) // plant: thread\n}\n\nuse std::thread as workers; // plant: thread alias\n\npub fn more_cores() -> usize {\n    workers::available_parallelism().map_or(1, usize::from)\n}\n\npub fn own(code: i32) -> usize {\n    if code != 0 {\n        std::process::exit(code); // plant: exit in a library\n    }\n    std::env::args().count() // plant: args in a library\n}\n`;
  // The command line and the exit code are a binary's own input and output, so they stay in a
  // binary target's root and nowhere else: a library reading them is a check reading its process.
  const main = 'fn main() {\n    if std::env::args().count() > 1 { // twin: command line\n        std::process::exit(2); // twin: exit code\n    }\n}\n';
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib, { extra: { 'src/main.rs': main } });
  assert.equal(status, 1, output);
  assert.doesNotMatch(output, /^FAIL canvas-lint: deep-canvas-planted\/src\/main\.rs:/m, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: exit in a library')}:\\d+ the process module`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: args in a library')}:\\d+ the env module`, 'm'), output);
  for (const mark of ['// plant: fs', '// plant: bare fs', '// plant: process', '// plant: net', '// plant: thread', '// plant: thread alias']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ (the|a grouped import of the) (fs|env|net|process|thread) module`, 'm'), output);
  const grouped = lib.split('\n').findIndex((text) => text.startsWith('use std::{env')) + 1;
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${grouped}:\\d+ a grouped import of the env module`, 'm'), output);
});

test('an aliased std module is the same module: use std::env as settings and use core::arch as hw are refused', (t) => {
  // The alias hides the name from every later path, so the import itself is the finding.
  const lib = `${TWIN}\nuse std::env as settings; // plant: env alias\nuse core::arch as hw; // plant: arch alias\n\npub fn setting() -> Option<String> {\n    settings::var("DEEP_SEED").ok()\n}\n\n#[cfg(target_arch = "x86_64")]\npub fn ticks() -> u64 {\n    unsafe { hw::x86_64::_rdtsc() }\n}\n\n#[cfg(target_arch = "aarch64")]\npub fn ticks() -> u64 {\n    let value: u64;\n    unsafe { hw::asm!("mrs {}, cntvct_el0", out(reg) value) };\n    value\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: env alias')}:\\d+ the env module`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: arch alias')}:\\d+ the arch module`, 'm'), output);
});

test('an alias of the std or core root is refused, since every path through it hides the module', (t) => {
  // `host::env::var` after `use std as host;` is still caught by the bare `env::` rule, but an
  // alias of the module through the aliased root (`use host::env as settings;`) spells neither
  // `std::env` nor `env::`, and the same holds for `core as machine` and `std::{self as sys}`.
  const lib = `${TWIN}\nuse std as host; // plant: std alias\nuse core as machine; // plant: core alias\nuse std::{self as sys, io::Write}; // plant: self alias\nuse host::env as settings;\nuse sys::env as other;\nuse machine::arch as hw;\n\npub fn setting() -> Option<String> {\n    settings::var("DEEP_SEED").ok()\n}\n\npub fn another() -> Option<String> {\n    other::var("DEEP_SEED").ok()\n}\n\n#[cfg(target_arch = "x86_64")]\npub fn ticks() -> u64 {\n    unsafe { hw::x86_64::_rdtsc() }\n}\n\n#[cfg(target_arch = "aarch64")]\npub fn ticks() -> u64 {\n    let value: u64;\n    unsafe { hw::asm!("mrs {}, cntvct_el0", out(reg) value) };\n    value\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: std alias', '// plant: core alias', '// plant: self alias']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ an alias of (std|core)`, 'm'), output);
});

test('a target predicate is refused, since code under it computes differently per platform', (t) => {
  // `cfg!(target_arch)`, `#[cfg(target_os)]`, `#[cfg(unix)]` and `cfg_attr(windows, …)` select
  // code by platform without naming `arch` or any disallowed method; the predicate is the finding.
  const lib = `${TWIN}\npub fn biased(x: f64) -> f64 {\n    if cfg!(target_arch = "x86_64") { x + 1.0 } else { x + 2.0 } // plant: cfg! macro\n}\n\n#[cfg(target_os = "macos")] // plant: cfg attribute\npub fn here() -> u8 {\n    1\n}\n\n#[cfg(not(target_os = "macos"))] // plant: negated cfg attribute\npub fn here() -> u8 {\n    2\n}\n\n#[cfg(unix)] // plant: unix family\npub fn family() -> u8 {\n    1\n}\n\n#[cfg(not(unix))] // plant: negated unix family\npub fn family() -> u8 {\n    2\n}\n\n#[cfg_attr(windows, inline)] // plant: cfg_attr\npub fn attr() -> u8 {\n    3\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn twin() {} // twin: cfg(test) is no target predicate\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: cfg! macro', '// plant: cfg attribute', '// plant: negated cfg attribute', '// plant: unix family', '// plant: negated unix family', '// plant: cfg_attr']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ a target predicate`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: cfg')}:`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('#[cfg(test)]')}:`, 'm'), output);
});

test('a build predicate is refused, since code under it computes differently per build', (t) => {
  // `cfg!(debug_assertions)`, `#[cfg(feature = …)]` and `cfg_attr(panic = …, …)` select code by
  // the build profile or feature set, and `debug_assert!` runs in one build and not the other;
  // the same document would check differently in debug and release. `test` alone stays: a test
  // module is never the shipped check.
  const lib = `${TWIN}\npub fn biased(x: f64) -> f64 {\n    if cfg!(debug_assertions) { x + 1.0 } else { x + 2.0 } // plant: cfg! macro\n}\n\n#[cfg(feature = "fast")] // plant: feature attribute\npub fn here() -> u8 {\n    1\n}\n\n#[cfg(not(feature = "fast"))] // plant: negated feature attribute\npub fn here() -> u8 {\n    2\n}\n\n#[cfg_attr(panic = "abort", inline)] // plant: cfg_attr\npub fn attr() -> u8 {\n    3\n}\n\npub fn checked(x: f64) -> f64 {\n    debug_assert!(x > 0.0); // plant: debug_assert\n    assert!(x > 0.0); // twin: assert in every build\n    x\n}\n\n#[cfg(not(test))] // twin: not(test)\npub fn shipped() -> u8 {\n    4\n}\n\n#[cfg_attr(test, inline)] // twin: cfg_attr(test)\npub fn same() -> u8 {\n    5\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn twin() {} // twin: cfg(test) is no build predicate\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const [mark, name] of [['// plant: cfg! macro', 'debug_assertions'], ['// plant: feature attribute', 'feature'], ['// plant: negated feature attribute', 'feature'], ['// plant: cfg_attr', 'panic']]) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ a build predicate \\(${name}\\)`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: debug_assert')}:\\d+ debug_assert!, a check that runs in one build and not the other`, 'm'), output);
  for (const mark of ['// twin: assert in every build', '// twin: not(test)', '// twin: cfg_attr(test)', '#[cfg(test)]']) assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:`, 'm'), output);
});

test('a backtrace is refused, since its frames are the process and the checkout, not the document', (t) => {
  // `Backtrace::force_capture()` reads stack addresses, symbol names and source paths with no
  // disallowed method and none of the other ambient module names; the module itself is the finding,
  // under a full path, a grouped import and an alias alike.
  const lib = `${TWIN}\nuse std::{backtrace::Backtrace, fmt::Write}; // plant: grouped import\n\npub fn frames() -> String {\n    std::backtrace::Backtrace::force_capture().to_string() // plant: full path\n}\n\npub fn aliased() -> String {\n    use std::backtrace as trace; // plant: alias\n    let mut out = String::new();\n    let _ = write!(out, "{}", trace::Backtrace::capture());\n    out\n}\n\npub fn same(x: f64) -> f64 {\n    x // twin: no backtrace\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: grouped import', '// plant: full path', '// plant: alias']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ the backtrace module`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: no backtrace')}:`, 'm'), output);
});

test('an observation of the pointer width is refused, and a fixed width passes', (t) => {
  // `usize::BITS`, `usize::MAX` and `size_of::<usize>()` are 32 on wasm32 and 64 on the
  // reference Macs with no target predicate in sight; `u64::BITS` is 64 everywhere.
  const lib = `${TWIN}\npub fn width() -> f64 {\n    usize::BITS as f64 // plant: usize::BITS\n}\n\npub fn top() -> f64 {\n    usize::MAX as f64 // plant: usize::MAX\n}\n\npub fn bytes() -> usize {\n    size_of::<usize>() // plant: size_of\n}\n\npub fn more_bytes() -> usize {\n    std::mem::size_of::<u64>() + std::mem::align_of::<u64>() // plant: mem::size_of\n}\n\npub fn fixed() -> f64 {\n    u64::BITS as f64 // twin: fixed width\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: usize::BITS', '// plant: usize::MAX', '// plant: size_of', '// plant: mem::size_of']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ the pointer width`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: fixed width')}:`, 'm'), output);
});

test('a pointer address is refused: a raw pointer, its address, or a function pointer cast to a number', (t) => {
  // `(&x as *const u8) as usize` is the stack address under ASLR, `.addr()` the same without a
  // cast, and `f as usize` a code address; a reference read through is a value and stays.
  const lib = `${TWIN}\npub fn stack() -> usize {\n    let x = 0u8;\n    (&x as *const u8) as usize // plant: raw pointer cast\n}\n\npub fn provenance(slice: &[u8]) -> usize {\n    slice.as_ptr().addr() // plant: as_ptr and addr\n}\n\npub fn code() -> usize {\n    let f: fn(f64) -> f64 = ops::sin;\n    f as usize // plant: fn pointer cast\n}\n\npub fn value(r: &f64) -> f64 {\n    *r + 1.0 // twin: a reference read through\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const mark of ['// plant: raw pointer cast', '// plant: as_ptr and addr']) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:\\d+ a raw pointer`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: fn pointer cast')}:\\d+ .*fn_to_numeric_cast_any`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: a reference')}:`, 'm'), output);
});

test('host state through std::io and std::os is refused, and the streams stay in a binary root only', (t) => {
  // `io::Error::last_os_error()` is the thread's errno, `is_terminal()` what stdout is attached
  // to, and `std::os` the handles beneath; reading a document line from stdin is the binary's
  // input in its root, and a check reading its process in a library.
  const lib = `${TWIN}\nuse std::io::{BufRead, IsTerminal};\n\npub fn errno() -> i32 {\n    let error = std::io::Error::last_os_error(); // plant: last_os_error\n    error.raw_os_error().unwrap_or_default() // plant: raw_os_error\n}\n\npub fn attached() -> bool {\n    std::io::stdout().is_terminal() // plant: is_terminal\n}\n\npub fn handle() -> i32 {\n    use std::os::fd::AsRawFd; // plant: os module\n    std::io::stdin().as_raw_fd()\n}\n\npub fn line() -> String {\n    let mut text = String::new();\n    let _ = std::io::stdin().lock().read_line(&mut text); // plant: stdin in a library\n    text\n}\n`;
  const main = 'use std::io::BufRead;\n\nfn main() {\n    let mut text = String::new();\n    let _ = std::io::stdin().lock().read_line(&mut text); // twin: the binary reads its document\n    println!("{}", text.len());\n}\n';
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib, { extra: { 'src/main.rs': main } });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: last_os_error')}:\\d+ .*last_os_error`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: raw_os_error')}:\\d+ .*raw_os_error`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: is_terminal')}:\\d+ .*is_terminal`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: os module')}:\\d+ the os module`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: stdin in a library')}:\\d+ the stdin stream`, 'm'), output);
  assert.doesNotMatch(output, /^FAIL canvas-lint: deep-canvas-planted\/src\/main\.rs:/m, output);
});

test('the compile-time environment macros are refused, since the building machine would pick a value', (t) => {
  // `env!` and `option_env!` read the compiler's process environment at build time: no `std::env`
  // path, no clippy item, yet the value differs per build host. `concat!` and `stringify!` are
  // twins that read only their operands, and an integration test's `env!("CARGO_BIN_EXE_<name>")`
  // is Cargo's handle to the binary it spawns; any other read in that test root still fails.
  const lib = `${TWIN}\npub fn host() -> &'static str {\n    option_env!("HOSTNAME").unwrap_or("") // plant: option_env\n}\n\npub fn crate_dir() -> &'static str {\n    env!("CARGO_MANIFEST_DIR") // plant: env\n}\n\npub fn label() -> &'static str {\n    concat!("deep-", stringify!(canvas)) // twin: operands only\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const cli = 'use std::process::Command;\n\npub fn run() -> Option<String> {\n    let _ = Command::new(env!("CARGO_BIN_EXE_deep-canvas-planted")).status(); // twin: the binary\n    option_env!("HOSTNAME").map(String::from) // plant: test root\n}\n';
  const { status, output } = lint(t, lib, { extra: { 'src/main.rs': 'fn main() {}\n', 'tests/cli.rs': cli } });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/tests/cli\\.rs:5:\\d+ the option_env! macro`, 'm'), output);
  assert.doesNotMatch(output, /^FAIL canvas-lint: deep-canvas-planted\/tests\/cli\.rs:4:/m, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: option_env')}:\\d+ the option_env! macro`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: env')}:\\d+ the env! macro`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: operands only')}:`, 'm'), output);
});

test('a procedural macro crate in scope is refused, since the scan never reads what it emits', (t) => {
  // The attribute's source holds `libm::sin` only inside a string, blanked by the scan, and the
  // item it replaces names no libm; the expansion calls libm outside the ops module.
  const plant = {
    source: 'use proc_macro::TokenStream;\n\n#[proc_macro_attribute]\npub fn plant(_attr: TokenStream, _item: TokenStream) -> TokenStream {\n    "pub fn hidden(x: f64) -> f64 { libm::sin(x) }".parse().unwrap()\n}\n',
    manifest: '\n[lib]\nproc-macro = true\n',
  };
  const lib = `${TWIN}\n#[plant::plant]\nfn replaced() {}\n`;
  const { status, output } = lint(t, lib, { stubs: { plant } });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: plant is a procedural macro crate, whose expansion the scan never reads/m, output);
});

test('a macro definition anywhere in scope is refused, since a predicate can hide in its expansion', (t) => {
  // `cfg!($p)` holds no predicate name where the scan reads it, and `platform!(unix)` holds no
  // `cfg`; expanded, the check reads a platform-dependent boolean. A macro call with no
  // definition in scope (`matches!`) is the twin.
  const lib = `${TWIN}\nmacro_rules! platform { // plant: macro definition\n    ($p:ident) => {\n        cfg!($p)\n    };\n}\n\npub fn here() -> bool {\n    platform!(unix)\n}\n\npub fn same(x: u8) -> bool {\n    matches!(x, 1) // twin: a call, no definition\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: macro definition')}:1 a macro definition`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: a call, no definition')}:`, 'm'), output);
});

test('include_bytes! and include_str! of a file outside the crate are refused, inside it they stay', (t) => {
  // A compile-time read is a read: of a file outside the crate it is host input baked into the
  // check. A file of the crate is part of it, and the twin.
  const lib = `${TWIN}\npub fn host() -> u8 {\n    include_bytes!("../../outside.rs")[0] // plant: bytes outside\n}\n\npub fn text() -> &'static str {\n    include_str!("../../outside.rs") // plant: text outside\n}\n\npub fn table() -> &'static str {\n    include_str!("table.txt") // twin: a file of the crate\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib, { extra: { 'src/table.txt': '1 2 3\n' } });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: bytes outside')}:\\d+ include_bytes! of a file the lint can't read`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: text outside')}:\\d+ include_str! of a file the lint can't read`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: a file of the crate')}:`, 'm'), output);
});

test('the source path at compile time is refused, through file! or a caller Location', (t) => {
  // `file!()` is the path the compiler saw, which differs per checkout and path remapping, and
  // `Location::caller().file()` the same at run time; `module_path!()` names the module, which
  // the source itself fixes, and `line!()` likewise, the twins.
  const lib = `${TWIN}\npub fn here() -> usize {\n    file!().len() // plant: file macro\n}\n\n#[track_caller]\npub fn from() -> usize {\n    std::panic::Location::caller().file().len() // plant: caller location\n}\n\npub fn fixed() -> usize {\n    module_path!().len() + line!() as usize // twin: fixed by the source\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: file macro')}:\\d+ the source path`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: caller location')}:\\d+ the source path`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: fixed by the source')}:`, 'm'), output);
});

test('the filesystem through std::path is refused, since Path::exists reads it without naming fs', (t) => {
  // `Path::new("/etc/hostname").exists()` asks the filesystem about a file outside the document
  // through the path module alone, so its types are disallowed; a string split on `/` is the
  // document's own path grammar, and a crate's own `Path` type (the grammar's) is another type.
  const lib = `${TWIN}\nuse std::path::PathBuf;\n\npub fn present() -> bool {\n    std::path::Path::new("/etc/hostname").exists() // plant: path exists\n}\n\npub fn root() -> usize {\n    PathBuf::from("/").components().count() // plant: path buffer\n}\n\npub fn parts(text: &str) -> usize {\n    text.split('/').count() // twin: the path grammar of the document\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: path exists')}:\\d+ .*std::path::Path`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: path buffer')}:\\d+ .*std::path::PathBuf`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: the path grammar of the document')}:`, 'm'), output);
});

test('unsafe code is refused, since a transmute or a union reads an address past every pointer token', (t) => {
  // `transmute::<&u8, usize>` and a union read hand out a process address with no `*const`,
  // `as_ptr` or `addr` to match, and only `unsafe` lets them compile; a scope crate needs none.
  const lib = `${TWIN}\npub fn address(value: &u8) -> usize {\n    unsafe { std::mem::transmute::<&u8, usize>(value) } // plant: transmute in unsafe\n}\n\nunion Bits { // plant: union\n    whole: u64,\n    halves: [u32; 2],\n}\n\npub unsafe fn low(bits: Bits) -> u32 { // plant: unsafe fn\n    bits.halves[0]\n}\n\npub fn safe(x: f64) -> u64 {\n    x.to_bits() // twin: bits by a safe method\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: transmute in unsafe')}:\\d+ unsafe code`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: union')}:1 a union`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// plant: unsafe fn')}:\\d+ unsafe code`, 'm'), output);
  assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at('// twin: bits by a safe method')}:`, 'm'), output);
});

test('a target-specific Cargo dependency is refused, since each platform compiles a different crate', (t) => {
  // Two clean path crates, one under `cfg(target_os = "macos")` and one under its negation
  // (Cargo refuses one name with two sources, so selecting between them in source would need a
  // target predicate, refused on its own; a target table can still give a dependency other
  // features or another version per platform). The manifest, not the source, is the finding.
  const manifest = '\n[target.\'cfg(target_os = "macos")\'.dependencies]\nmac = { path = "../stubs/mac" }\n\n[target.\'cfg(not(target_os = "macos"))\'.dependencies]\nother = { path = "../stubs/other" }\n';
  const { status, output } = lint(t, TWIN, { manifest, stubs: { mac: 'pub fn reading() -> f64 {\n    1.0\n}\n', other: 'pub fn reading() -> f64 {\n    2.0\n}\n' } });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted depends on mac only under cfg\(target_os = "macos"\)/m, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted depends on other only under cfg\(not\(target_os = "macos"\)\)/m, output);
});

test('an operating-system RNG and seeding from entropy are disallowed', (t) => {
  // A stand-in rand with the entry points the config names, so the plant builds offline.
  const rand = 'pub mod rngs {\n    pub struct OsRng;\n    impl OsRng {\n        pub fn next_u64(&mut self) -> u64 {\n            4\n        }\n    }\n    pub struct StdRng(pub u64);\n}\npub trait SeedableRng: Sized {\n    fn from_entropy() -> Self;\n}\nimpl SeedableRng for rngs::StdRng {\n    fn from_entropy() -> Self {\n        rngs::StdRng(4)\n    }\n}\n';
  const lib = `${TWIN}\npub fn entropy() -> u64 {\n    let mut os = rand::rngs::OsRng; // plant: os rng\n    let seeded = <rand::rngs::StdRng as rand::SeedableRng>::from_entropy(); // plant: from entropy\n    os.next_u64() + seeded.0\n}\n`;
  const lines = ['// plant: os rng', '// plant: from entropy'].map((mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, lib, { stubs: { rand } });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[0]}:\\d+ .*OsRng`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[1]}:\\d+ .*from_entropy`, 'm'), output);
});

test('every static item is refused, since a static with interior mutability is state between runs', (t) => {
  // `static mut` needs no reference to count; an atomic, a lock or a thread local counts without
  // `mut` and without `unsafe`, so the declaration itself is refused wherever it sits. A `const`
  // and a `&'static str` hold values with no address and stay.
  const lib = `${TWIN}\nuse std::sync::atomic::{AtomicU64, Ordering};\nuse std::sync::Mutex;\n\nstatic mut N: u64 = 0; // plant: static mut\nstatic CALLS: AtomicU64 = AtomicU64::new(0); // plant: atomic\nconst TABLE: [f64; 2] = [1.0, 2.0]; // twin: const\nthread_local! { static LOCAL: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; } // plant: thread local\n\npub fn counted() -> u64 {\n    static LAST: Mutex<u64> = Mutex::new(0); // plant: lock in a body\n    let mut last = LAST.lock().unwrap();\n    *last += 1;\n    unsafe {\n        N += 1;\n    }\n    CALLS.fetch_add(1, Ordering::Relaxed) + *last + TABLE.len() as u64 + LOCAL.with(|l| l.get())\n}\n\npub fn name() -> &'static str {\n    "slab" // twin: static lifetime\n}\n`;
  const at = (mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  for (const [mark, column] of [['// plant: static mut', 1], ['// plant: atomic', 1], ['// plant: thread local', 1], ['// plant: lock in a body', 5]]) assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:${column} a static item`, 'm'), output);
  for (const mark of ['// twin: const', '// twin: static lifetime']) assert.doesNotMatch(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${at(mark)}:`, 'm'), output);
});

test('an attribute macro, a derive or an import in the ops module is refused as a macro the lint cannot read', (t) => {
  // An attribute macro (`#[helper::leak(libm)]`) sees the item's tokens, libm included; every
  // path-qualified attribute is refused, so a tool attribute plants the form and still compiles.
  // An import can bring a macro in under a builtin's name; a derive is an attribute macro too.
  const ops = `${OPS}use helper::leak; // plant: import\n#[rustfmt::skip] // plant: qualified attribute\npub fn marked() {}\n#[derive(Clone)] // plant: derive\npub struct Marked;\n`;
  const lines = ['// plant: import', '// plant: qualified attribute', '// plant: derive'].map((mark) => ops.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, TWIN, { ops, helper: 'pub fn leak() {}\n' });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${lines[0]}:1 the ops module imports`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${lines[1]}:1 the ops module carries an attribute`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${lines[2]}:1 the ops module carries an attribute`, 'm'), output);
});

test('the ops module may include a file of the crate but not source outside it', (t) => {
  // An include! of an in-crate file: that file is walked and scanned like any other, so it passes
  // while it names no libm.
  const clean = lint(t, TWIN, { ops: `${OPS}include!("helpers.rs");\n`, extra: { 'src/helpers.rs': 'pub fn twice(x: f64) -> f64 {\n    x * 2.0\n}\n' } });
  assert.equal(clean.status, 0, clean.output);
  // The same directive reaching outside the crate would compile unscanned source into the one
  // file allowed to name libm.
  const ops = `${OPS}include!("../../outside.rs"); // plant: include outside, from ops\n`;
  const line = ops.split('\n').findIndex((text) => text.includes('// plant: include outside, from ops')) + 1;
  const { status, output } = lint(t, TWIN, { ops });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${line}:1 include! of source the lint can't read`, 'm'), output);
});

test('a macro under a std name, inherited from the parent module, still may not receive libm', (t) => {
  // A test comparing a wrapper to libm binds the libm value first, so no macro sees the name: inert.
  const inertOps = `${OPS}#[cfg(test)]\nmod tests {\n    #[test]\n    fn wraps() {\n        let expected = libm::sin(0.5);\n        assert_eq!(super::sin(0.5), expected);\n    }\n}\n`;
  const clean = lint(t, TWIN, { ops: inertOps });
  assert.equal(clean.status, 0, clean.output);
  // The crate root's #[macro_use] makes a dependency's assert_eq! the one ops.rs calls.
  const lib = TWIN.replace('pub mod ops;', '#[macro_use]\nextern crate helper;\npub mod ops;');
  const ops = `${OPS}assert_eq!(ignored, libm); // plant: libm into an inherited macro\n`;
  const line = ops.split('\n').findIndex((text) => text.includes('// plant: libm into an inherited macro')) + 1;
  const { status, output } = lint(t, lib, { ops, helper: '#[macro_export]\nmacro_rules! assert_eq { ($a:tt, $p:path) => { pub use $p as leaked; } }\n' });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/ops\\.rs:${line}:1 the ops module passes libm to a macro`, 'm'), output);
});

test('code behind a Cargo feature is linted with every feature on', (t) => {
  const lib = `${TWIN}\n#[cfg(feature = "fast")]\npub fn started() -> u64 {\n    std::time::Instant::now().elapsed().as_nanos() as u64 // plant: clock behind a feature\n}\n`;
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: clock behind a feature')) + 1;
  const { status, output } = lint(t, lib, { features: ['fast'] });
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ .*Instant::now`, 'm'), output);
});

test('an Instant handed in from outside still cannot be read against the clock', (t) => {
  const lib = `${TWIN}\npub fn since(start: std::time::Instant) -> u128 {\n    start.elapsed().as_nanos() // plant: instant elapsed\n}\n`;
  const line = lib.split('\n').findIndex((text) => text.includes('// plant: instant elapsed')) + 1;
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${line}:\\d+ .*Instant::elapsed`, 'm'), output);
});

test('the clock read through SystemTime::elapsed and the random hasher are caught', (t) => {
  const lib = `${TWIN}\npub fn since_epoch() -> u64 {\n    std::time::UNIX_EPOCH.elapsed().map(|d| d.as_nanos() as u64).unwrap_or(0) // plant: epoch elapsed\n}\n\npub fn salted(x: u8) -> u64 {\n    std::hash::BuildHasher::hash_one(&std::hash::RandomState::new(), x) // plant: random hasher\n}\n`;
  const lines = ['// plant: epoch elapsed', '// plant: random hasher'].map((mark) => lib.split('\n').findIndex((text) => text.includes(mark)) + 1);
  const { status, output } = lint(t, lib);
  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[0]}:\\d+ .*SystemTime::elapsed`, 'm'), output);
  assert.match(output, new RegExp(`^FAIL canvas-lint: deep-canvas-planted/src/lib\\.rs:${lines[1]}:\\d+ .*RandomState`, 'm'), output);
});

test('a path dependency outside the workspace is linted like the crate that reaches it', (t) => {
  const helper = 'pub fn started() -> u64 {\n    std::time::Instant::now().elapsed().as_nanos() as u64 // plant: instant-now in a helper\n}\n';
  const lib = TWIN.replace('ops::sin(x) + ops::sin(x)', 'ops::sin(x) + helper::started() as f64');
  const { status, output } = lint(t, lib, { helper });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: stubs\/helper\/src\/lib\.rs:2:\d+ .*Instant::now/m, output);
});

test('a symlinked module file that leaves the crate fails the canvas lint', (t) => {
  const lib = TWIN.replace('pub mod ops;', 'pub mod ops;\nmod linked;');
  const { status, output } = lint(t, lib, { symlink: true });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted\/src\/linked\.rs is a symlink/m, output);
});

test('a scope crate with a build script fails the canvas lint naming the crate', (t) => {
  const { status, output } = lint(t, TWIN, { build: true });
  assert.equal(status, 1, output);
  assert.match(output, /^FAIL canvas-lint: deep-canvas-planted has a build script/m, output);
});

test('the twin that reaches libm only through the ops module passes the canvas lint', (t) => {
  const { status, output } = lint(t, TWIN);
  assert.equal(status, 0, output);
  // The stub libm is a path crate, so it joins the scope.
  assert.match(output, /^PASS canvas-lint: 2 crates in scope \(deep-canvas-planted, libm\), 0 third-party crates listed$/m, output);
});
