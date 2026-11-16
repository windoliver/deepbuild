// #2144 AC2: the canvas lint still fails a planted static item, a planted std float call and an unlisted dependency,
// so none of its rules was switched off to clear main's lines. One throwaway workspace, linted with --root as
// tests/canvas-lint.test.mjs does: a crate outside the canvas prefix that registers a check kind, and a workspace crate
// in its closure (as deep-text is to the canvas crates) holding the plants in the shapes main's own lines take. Its
// third-party crates are served offline from a vendor directory; its listing names one of them. README: AC2.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const lintScript = fileURLToPath(new URL('../../../scripts/canvas-lint.mjs', import.meta.url));

// The plants, each marked by a comment the test finds its line by.
const CLOSURE = `use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

static SEEN: Mutex<BTreeMap<u64, u64>> = Mutex::new(BTreeMap::new()); // plant: static at the top level

thread_local! { static SHAPER: RefCell<u64> = const { RefCell::new(0) }; } // plant: static in a thread local

pub fn made(key: u64) -> u64 {
    static MADE: OnceLock<Mutex<BTreeMap<u64, u64>>> = OnceLock::new(); // plant: static in a body
    let mut made = MADE.get_or_init(|| Mutex::new(BTreeMap::new())).lock().unwrap();
    let seen = SEEN.lock().unwrap().len() as u64;
    *made.entry(key).or_insert(seen) + SHAPER.with(|shaper| *shaper.borrow())
}

pub fn root(x: f64) -> f64 {
    x.sqrt() // plant: std float call
}

pub fn listed(n: u32) -> u32 {
    meshopt::simplify(n) + wasmparser::validate(n)
}
`;
const CHECK = 'pub fn reading(x: f64) -> f64 {\n    planted_closure::root(x) + planted_closure::made(1) as f64 + planted_closure::listed(2) as f64\n}\n';
// The registry crates, with the names and versions of main's three unlisted lines: meshopt directly (unlisted),
// float-cmp through it (unlisted), and semver through wasmparser (listed).
const REGISTRY = [
  { name: 'meshopt', version: '0.7.0', deps: { 'float-cmp': '0.10.0' }, source: 'pub fn simplify(n: u32) -> u32 {\n    float_cmp::ulps(n)\n}\n' },
  { name: 'float-cmp', version: '0.10.0', deps: {}, source: 'pub fn ulps(n: u32) -> u32 {\n    n\n}\n' },
  { name: 'wasmparser', version: '0.258.3', deps: { semver: '1.0.28' }, source: 'pub fn validate(n: u32) -> u32 {\n    semver::major(n)\n}\n' },
  { name: 'semver', version: '1.0.28', deps: {}, source: 'pub fn major(n: u32) -> u32 {\n    n\n}\n' },
];
const LISTING = { wasmparser: { version: '0.258.3', class: 'no float math', why: 'A stand-in the planted closure crate calls.' } };

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function plantedWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2144-'));
  const deps = (table) => Object.entries(table).map(([name, version]) => `${name} = "=${version}"\n`).join('');
  const pkg = (name, extra = '') => `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n${extra}`;
  write(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["planted-check", "planted-closure"]\nresolver = "2"\n');
  write(join(dir, '.cargo', 'config.toml'), '[source.crates-io]\nreplace-with = "vendored"\n\n[source.vendored]\ndirectory = "vendor"\n');
  write(join(dir, 'planted-check', 'Cargo.toml'), `${pkg('planted-check', '\n[package.metadata.deep]\ncheck_kinds = ["planted"]\n')}\n[dependencies]\nplanted-closure = { path = "../planted-closure" }\n`);
  write(join(dir, 'planted-check', 'src', 'lib.rs'), CHECK);
  write(join(dir, 'planted-closure', 'Cargo.toml'), `${pkg('planted-closure')}\n[dependencies]\n${deps({ meshopt: '0.7.0', wasmparser: '0.258.3' })}`);
  write(join(dir, 'planted-closure', 'src', 'lib.rs'), CLOSURE);
  for (const { name, version, deps: own, source } of REGISTRY) {
    const crate = join(dir, 'vendor', `${name}-${version}`);
    write(join(crate, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\n${deps(own)}`);
    write(join(crate, 'src', 'lib.rs'), source);
    write(join(crate, '.cargo-checksum.json'), '{"files":{}}\n');
  }
  write(join(dir, 'lint', 'canvas', 'crates.json'), `${JSON.stringify(LISTING, null, 2)}\n`);
  return dir;
}

test('#2144.ad4aea4d the lint still fails a planted static item, a planted std float call and an unlisted dependency', { timeout: 20 * 60_000 }, (t) => {
  const root = plantedWorkspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [lintScript, '--root', root], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...process.env },
  });
  assert.equal(run.error, undefined, `the lint could not run: ${run.error?.message}`);
  const output = `${run.stdout}\n${run.stderr}`;
  const at = (mark) => CLOSURE.split('\n').findIndex((line) => line.includes(mark)) + 1;
  const file = 'planted-closure/src/lib\\.rs';
  const expected = {
    'static at the top level': new RegExp(`^FAIL canvas-lint: ${file}:${at('// plant: static at the top level')}:\\d+ a static item`, 'm'),
    'static in a thread local': new RegExp(`^FAIL canvas-lint: ${file}:${at('// plant: static in a thread local')}:\\d+ a static item`, 'm'),
    'static in a body': new RegExp(`^FAIL canvas-lint: ${file}:${at('// plant: static in a body')}:\\d+ a static item`, 'm'),
    'std float call': new RegExp(`^FAIL canvas-lint: ${file}:${at('// plant: std float call')}:\\d+ use of a disallowed method \`f64::sqrt\``, 'm'),
    'unlisted direct dependency': /^FAIL canvas-lint: planted-closure depends on meshopt 0\.7\.0, which lint\/canvas\/crates\.json doesn't list$/m,
    'unlisted dependency of an unlisted crate': /^FAIL canvas-lint: meshopt depends on float-cmp 0\.10\.0, which lint\/canvas\/crates\.json doesn't list$/m,
    'unlisted dependency of a listed crate': /^FAIL canvas-lint: wasmparser depends on semver 1\.0\.28, which lint\/canvas\/crates\.json doesn't list$/m,
  };
  const missing = Object.entries(expected).filter(([, line]) => !line.test(run.stdout)).map(([plant]) => plant);
  assert.deepEqual(missing, [], `the lint did not fail these plants:\n${output}`);
  assert.equal(run.status, 1, `the lint exited ${run.status}, not 1 (a finding):\n${output}`);
});
