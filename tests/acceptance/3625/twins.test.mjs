import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC, PLANTED_VARIANT, README, TEST_SUPPORT, VERSION, checkVendoredTrees, copyTrees, judgeCatchAlls, judgeCheck, judgePlantedVariant, releases, runCheck, walkRust } from './support.mjs';

function edit(trees, path, change) {
  const file = join(trees, path), text = readFileSync(file, 'utf8'), planted = change(text);
  assert.notEqual(planted, text, `the twin found nothing to plant in ${path}`);
  writeFileSync(file, planted);
}

const lineOf = (trees, path, pattern) => readFileSync(join(trees, path), 'utf8').split('\n').findIndex((line) => pattern.test(line)) + 1;

test(`AC1 ${AC[1]} twin: a gpui-fast copy of a hitbox that leaves out Hitbox::element fails the test-support check, naming the file`, { timeout: 120 * 60_000 }, () => {
  const trees = copyTrees(), path = 'vendor/gpui-fast/src/fast/layers/input.rs';
  edit(trees, path, (text) => text.replace(/\n[ \t]*#\[cfg\(any\(test, feature = "test-support"\)\)\]\n([ \t]*element: hitbox\.element\.clone\(\),[^\n]*)/, ''));
  const problems = checkVendoredTrees(trees, [TEST_SUPPORT]);
  console.log(`# twin judged, ${problems.length} problems; those naming ${path}: ${problems.filter((problem) => problem.includes(path)).join(' | ') || 'none'}`);
  assert.ok(problems.some((problem) => problem.includes(path)), `the compile judge passed a copy of a hitbox with no element field: ${problems.join('\n')}`);
});

test(`AC1 ${AC[1]} twin: a touched src/fast/ file with no carried-patch row fails vendor-rebase check, naming the file and line`, { timeout: 30 * 60_000 }, async () => {
  const trees = copyTrees(), rel = await releases(), listed = readFileSync(join(trees, README), 'utf8');
  const inner = walkRust(join(trees, 'vendor/gpui-fast'), 'src/fast').sort().find((each) => {
    const from = join(rel, `gpui-fast-${VERSION}`, each);
    return existsSync(from) && readFileSync(from).equals(readFileSync(join(trees, 'vendor/gpui-fast', each))) && !listed.includes(`vendor/gpui-fast/${each}`);
  });
  assert.ok(inner, 'no untouched src/fast/ file of vendor/gpui-fast to plant in');
  const path = `vendor/gpui-fast/${inner}`;
  edit(trees, path, (text) => text.split('\n').toSpliced(3, 0, 'const _: () = ();').join('\n'));
  const problems = judgeCheck(runCheck(trees, rel).out);
  console.log(`# twin judged: ${problems.join(' | ')}`);
  assert.ok(problems.some((problem) => problem.includes(`${path}:4`)), `the check judge passed ${path} touched at line 4 with no row: ${problems.join('\n')}`);
});

test(`AC2 ${AC[2]} twin: frame.rs's PrimitiveBatch::Chrome arm turned into a catch-all fails the arm judge, naming its line`, { timeout: 10 * 60_000 }, async () => {
  const trees = copyTrees(), path = 'vendor/gpui-fast-apple/src/fast/frame.rs';
  edit(trees, path, (text) => text.replace(/PrimitiveBatch::Chrome\([^)]*\)\s*=>/, '_ =>'));
  const line = lineOf(trees, path, /^\s*_ =>/);
  const arms = judgeCatchAlls(trees, await releases());
  console.log(`# twin judged, arms: ${arms.join(' | ')}`);
  assert.ok(arms.some((problem) => problem.startsWith(`${path}:${line}:`)), `the arm judge passed a catch-all at ${path}:${line}: ${arms.join('\n')}`);
});

const message = (crate, file, line, code, text) => ({ reason: 'compiler-message', manifest_path: `/w/${crate}/Cargo.toml`, message: { level: 'error', code: { code }, message: text, spans: [{ is_primary: true, file_name: `${crate}/${file}`, line_start: line }] } });
const finished = (success) => ({ reason: 'build-finished', success });
const swallowed = `non-exhaustive patterns: \`PrimitiveBatch::${PLANTED_VARIANT}\` not covered`;

test(`AC2 ${AC[2]} twin: the planted-variant judge fails a gpui-fast-apple whose frame.rs swallows the variant, and one that stops before frame.rs`, () => {
  assert.deepEqual(judgePlantedVariant([message('gpui-fast-apple', 'src/fast/frame.rs', 152, 'E0004', swallowed), finished(false)]), []);
  const builds = judgePlantedVariant([finished(true)]);
  const elsewhere = judgePlantedVariant([message('gpui-fast-apple', 'src/metal_renderer.rs', 900, 'E0004', swallowed), finished(false)]);
  const stops = judgePlantedVariant([message('gpui-fast-apple', 'src/metal_renderer/chrome_layers.rs', 36, 'E0432', 'unresolved import'), finished(false)]);
  console.log(`# twin judged: ${[...builds, ...elsewhere, ...stops].join(' | ')}`);
  assert.ok(builds.some((problem) => problem.includes('compiles in vendor/gpui-fast-apple/src/fast/frame.rs')), 'the judge passed a frame.rs that swallows the planted variant');
  assert.ok(elsewhere.length && stops.length && ![...elsewhere, ...stops].some((problem) => problem.startsWith('INCONCLUSIVE')), 'the judge passed errors outside frame.rs');
});
