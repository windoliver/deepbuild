import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CRATES, TABLE, cargoCheckArgs, carriedRows, judgeRun, judgeVendorCheck, repoRoot } from './vendored.mjs';

const work = '/scratch/ws';
const artifact = (crate, testProfile) => ({ reason: 'compiler-artifact', manifest_path: `${work}/${crate}/Cargo.toml`, target: { kind: ['lib'], name: crate }, profile: { test: testProfile } });
const cleanBuild = () => [...CRATES.flatMap((crate) => [artifact(crate, false), artifact(crate, true)]), { reason: 'build-finished', success: true }];
const compileError = (file, line, code, message) => ({ reason: 'compiler-message', manifest_path: `${work}/gpui-fast/Cargo.toml`, message: { level: 'error', message, code: { code }, spans: [{ file_name: file, line_start: line, is_primary: true }] } });
const failedBuild = (...errors) => [...errors, { reason: 'build-finished', success: false }];
const run = (messages) => ({ messages, tail: "tail" });

test("twins: the compile judge passes a clean check of the three crates and fails each planted wrong program, naming what failed", () => {
  assert.deepEqual(judgeRun(run(cleanBuild()), work), []);
  const frame = judgeRun(run(failedBuild(compileError("gpui-fast-apple/src/fast/frame.rs", 212, "E0004", "non-exhaustive patterns: `&PrimitiveBatch::Chrome(_)` not covered"))), work);
  assert.deepEqual(frame, ["vendor/gpui-fast-apple/src/fast/frame.rs:212: error[E0004]: non-exhaustive patterns: `&PrimitiveBatch::Chrome(_)` not covered"]);
  const hitbox = judgeRun(run(failedBuild(compileError(`${work}/gpui-fast/src/fast/layers/input.rs`, 88, "E0063", "missing field `element` in initializer of `Hitbox`"))), work);
  assert.deepEqual(hitbox, ["vendor/gpui-fast/src/fast/layers/input.rs:88: error[E0063]: missing field `element` in initializer of `Hitbox`"]);
  const libOnly = cleanBuild().filter((m) => !m.profile?.test);
  assert.ok(judgeRun(run(libOnly), work).some((line) => line.includes("gpui-fast-apple's library tests")));
  const noMacos = cleanBuild().filter((m) => !m.manifest_path?.includes("gpui-fast-macos"));
  assert.ok(judgeRun(run(noMacos), work).some((line) => line === "cargo check never checked gpui-fast-macos's library"));
  const noGrant = judgeRun(run(failedBuild()), work);
  assert.ok(noGrant[0].startsWith("INCONCLUSIVE") && noGrant.includes("tail"), noGrant.join("\n"));
  assert.ok(judgeRun(run([]), work)[0].startsWith("INCONCLUSIVE"));
});

test("twins: the cargo run is the criterion's command with default features and every crate's test-support feature enabled", () => {
  const args = cargoCheckArgs();
  assert.deepEqual(args.slice(0, 8), ["check", "-p", "gpui-fast", "-p", "gpui-fast-apple", "-p", "gpui-fast-macos", "--all-targets"]);
  assert.ok(!args.includes("--no-default-features") && !args.includes("--all-features"), args.join(" "));
  for (const crate of CRATES) assert.ok(args.at(-1).split(",").includes(`${crate}/test-support`), args.join(" "));
});

const rows = carriedRows(readFileSync(join(repoRoot, TABLE), 'utf8'));
const touched = [...new Set(rows.flatMap((row) => row.files.filter((file) => /^vendor\/gpui-fast(?:-apple|-macos)?\/src\/fast\//.test(file))))];
const rowOf = (file) => rows.find((row) => row.files.includes(file));
const rowLines = rows.map((row) => `ROW ${row.name}: 1 marked, 0 over budget`);
const checkOut = (...lines) => [...rowLines, ...lines].join('\n');

test('twins: the check judge passes a clean check and fails each planted fault on a touched src/fast/ file, naming the file', () => {
  assert.ok(touched.includes('vendor/gpui-fast/src/fast/scene.rs') && touched.includes('vendor/gpui-fast/src/fast/layers/input.rs') && touched.includes('vendor/gpui-fast-apple/src/fast/frame.rs'), touched.join('\n'));
  assert.deepEqual(judgeVendorCheck(checkOut(), touched, rows), []);
  assert.deepEqual(judgeVendorCheck(checkOut(`FAIL row ${rows.find((row) => !row.files.some((file) => touched.includes(file))).name}: no marked hunks`, 'FAIL vendor/gpui-pre/src/window.rs:10: a carried hunk with no mark'), touched, rows), []);
  const named = (out, file, files = touched) => judgeVendorCheck(out, files, rows).some((line) => line.startsWith('check fails on') && line.includes(file));
  assert.ok(named(checkOut('FAIL vendor/gpui-fast/src/fast/scene.rs:812: a carried hunk with no mark'), 'vendor/gpui-fast/src/fast/scene.rs'));
  assert.ok(named(checkOut('FAIL vendor/gpui-fast-apple/src/fast/frame.rs:40: hunk of 9 lines, over the budget of 8'), 'vendor/gpui-fast-apple/src/fast/frame.rs'));
  assert.ok(named(checkOut('FAIL vendor/gpui-fast/src/fast/layers/input.rs: 52 added, over the budget of 40 a file'), 'vendor/gpui-fast/src/fast/layers/input.rs'));
  const fresh = 'vendor/gpui-fast-apple/src/fast/chrome_pass.rs';
  assert.ok(named(checkOut(`FAIL ${fresh}:1: no row in the carried-patch table`), fresh, [...touched, fresh]));
  const input = rowOf('vendor/gpui-fast/src/fast/layers/input.rs');
  assert.ok(named(checkOut(`FAIL row ${input.name}: vendor/gpui-fast/src/fast/layers/input.rs holds none of its marked hunks`), 'vendor/gpui-fast/src/fast/layers/input.rs'));
  assert.ok(named(checkOut(`FAIL row ${input.name}: no removal condition; name the upstream change that would retire it, or none: <reason>`), 'vendor/gpui-fast/src/fast/layers/input.rs'));
});

test('twins: the check judge fails a check that never compared a tree, never judged a touched row, judged nothing, or couldn\'t list a row\'s test', () => {
  assert.ok(judgeVendorCheck(checkOut('BLOCKED gpui-fast-apple 0.1.19: no pinned release to compare with'), touched, rows).some((line) => line.includes('never compared vendor/gpui-fast-apple')));
  const frameRow = rowOf('vendor/gpui-fast-apple/src/fast/frame.rs');
  const died = rowLines.filter((line) => !line.startsWith(`ROW ${frameRow.name}: `)).join('\n');
  assert.ok(judgeVendorCheck(died, touched, rows).some((line) => line.startsWith('check never judged the row carrying') && line.includes('frame.rs')));
  assert.ok(judgeVendorCheck('', touched, rows).length >= 1);
  assert.equal(judgeVendorCheck(checkOut(), [], rows).length, 1);
  const unlisted = judgeVendorCheck(checkOut(`FAIL row ${frameRow.name}: the test tests/x.test.ts › y can't be checked: its suite gave no list`), touched, rows);
  assert.ok(unlisted.length === 1 && unlisted[0].startsWith('INCONCLUSIVE'), unlisted.join('\n'));
});
