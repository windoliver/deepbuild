// #1432 acceptance, AC3: a regression check on the canvas lint, `node scripts/canvas-lint.mjs --root
// <workspace>`, over a scratch Cargo workspace whose one crate has the deep-canvas prefix.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { root, show } from './helpers.mjs';

const CRATE = 'deep-canvas-fixture';
const LIB = `${CRATE}/src/lib.rs`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineOf = (source, marker) => source.split('\n').findIndex((line) => line.includes(marker)) + 1;

/** A dependency-free workspace on this checkout's pinned toolchain, removed after the test. */
function workspace(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-canvas-1432-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, CRATE, 'src'), { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[workspace]\nmembers = ["${CRATE}"]\nresolver = "2"\n`);
  writeFileSync(join(dir, CRATE, 'Cargo.toml'), `[package]\nname = "${CRATE}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[dependencies]\n`);
  copyFileSync(join(root, 'rust-toolchain.toml'), join(dir, 'rust-toolchain.toml'));
  return dir;
}

/** Writes the crate's lib.rs and runs the canvas lint on the workspace, its target dir inside it. */
function canvasLint(dir, source) {
  writeFileSync(join(dir, LIB), source);
  const env = { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') };
  const result = spawnSync(process.execPath, [join(root, 'scripts/canvas-lint.mjs'), '--root', dir], { env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  return { ...result, stdout: result.stdout ?? '' };
}

function assertPasses(result) {
  assert.equal(result.status, 0, show(result));
  assert.match(result.stdout, /^PASS canvas-lint: /m, show(result));
}

const HEAD = '//! A crate that must be pure: time comes from the input track, in flicks.\n\n';
const TWIN = `${HEAD}/// Time from the input track.\npub fn started(flicks: u64) -> u64 {\n    flicks // twin: no clock\n}\n`;

test('AC3: a planted Instant::now in a deep-canvas crate fails the canvas lint, naming its line; the clean twin passes', (t) => {
  const dir = workspace(t);
  assertPasses(canvasLint(dir, TWIN));
  const planted = `${HEAD}/// Time from the wall clock.\npub fn started() -> u64 {\n    let _now = std::time::Instant::now(); // plant: a wall clock\n    0\n}\n`;
  const result = canvasLint(dir, planted);
  assert.equal(result.status, 1, show(result));
  assert.match(result.stdout, new RegExp(`^FAIL canvas-lint: ${escape(LIB)}:${lineOf(planted, '// plant:')}:\\d+ .*Instant::now`, 'm'), show(result));
});

test('AC3: an Instant::now under an #[allow] with no reason still fails the canvas lint; the clean twin passes', (t) => {
  const dir = workspace(t);
  assertPasses(canvasLint(dir, TWIN));
  // The allow covers both lints the call trips, so a lint that honoured it would report nothing.
  const planted = `${HEAD}#[allow(clippy::disallowed_methods, clippy::disallowed_types)]\npub fn started() -> u64 {\n    let _now = std::time::Instant::now(); // plant: a wall clock under an allow\n    0\n}\n`;
  const result = canvasLint(dir, planted);
  assert.equal(result.status, 1, `the canvas lint's exit for a finding is 1 (2 is cargo couldn't run)\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^BLOCKED /m, show(result));
  const lines = [lineOf(planted, '#[allow('), lineOf(planted, '// plant:')];
  assert.match(result.stdout, new RegExp(`^FAIL canvas-lint: ${escape(LIB)}:(?:${lines.join('|')}):\\d+ `, 'm'), show(result));
});
