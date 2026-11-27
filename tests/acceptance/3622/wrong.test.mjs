// The judges against wrong programs and wrong trees, so each test proves something: on a synthetic tree made from the
// pristine 0.1.19 releases with a few carried hunks, wrong/reference-check.mjs passes every judge, and each one-fault
// mutant of it fails the judge its fault concerns. Needs the network for the releases; it passes at the base.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BASE_GPUI_ISSUES, CRATES, README, SCRIPT, VERSION, judgeMessages, judgeMetalRs, judgePins, judgePlants, judgeRetired, judgeRowRemoval, judgeRows, markLine, portedFiles, releases, scratch, walk } from './common.mjs';

const reference = readFileSync(new URL('./wrong/reference-check.mjs', import.meta.url), 'utf8');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `the mutant's text isn't in the reference: ${from}`);
  return text.split(from).join(to);
};
const MUTANTS = {
  'skips-gpui-fast': (text) => swap(text, "if (!existsSync(join(dir, 'Cargo.toml'))) continue;", "if (!existsSync(join(dir, 'Cargo.toml')) || name.startsWith('gpui-fast')) continue;"),
  'no-mark-rule': (text) => swap(text, 'if (!owners.length) fail(`${path}:${hunk.line}: a carried hunk with no mark`);', ''),
  'no-budget': (text) => swap(text, 'const BUDGET = 8;', 'const BUDGET = Infinity;'),
  'no-line': (text) => swap(swap(text, '${path}:${hunk.line}', '${path}'), '${path}:${found[0]?.line ?? 1}', '${path}'),
  'no-row-rule': (text) => swap(text, 'if (!listed.length) { fail(`${path}:${found[0]?.line ?? 1}: no row in the carried-patch table`); continue; }', 'if (!listed.length) continue;'),
  silent: () => 'process.exitCode = 0;\n',
};

const insert = (file, line, lines) => {
  const text = readFileSync(file, 'utf8').split('\n');
  text.splice(line - 1, 0, ...lines);
  writeFileSync(file, text.join('\n'));
};
const firstRs = (root, crate) => `vendor/${crate}/${walk(join(root, 'vendor', crate)).filter((inner) => /^src\/.*\.rs$/.test(inner) && readFileSync(join(root, 'vendor', crate, inner), 'utf8').split('\n').length > 80).sort()[0]}`;
const row = (issue, files, removal = 'upstream adds the same behavior') => `| Planted behavior ${issue} | #${issue} | ${files.map((file) => `\`${file}\``).join(', ')} | \`tests/stub.test.mjs › stub\` | — | ${removal} |`;

/** The pristine releases as vendored trees, with an empty table: a tree that carries nothing. */
function pristine(rel) {
  const root = scratch('da3622-pristine-');
  for (const crate of CRATES) cpSync(join(rel, `${crate}-${VERSION}`), join(root, 'vendor', crate), { recursive: true });
  mkdirSync(join(root, 'vendor/gpui-pre-apple/upstream'), { recursive: true });
  writeFileSync(join(root, README), '## Carried patches\n\n| Behavior | Issue | Files | Test | Budget | Removal |\n|---|---|---|---|---|---|\n');
  return root;
}

/** The releases with a carried hunk in gpui-fast (#1), one in gpui-fast-apple and a ported file there (#2). */
function synthetic(rel, { program = reference, rows, extra = '' } = {}) {
  const root = scratch('da3622-wrong-');
  for (const crate of CRATES) cpSync(join(rel, `${crate}-${VERSION}`), join(root, 'vendor', crate), { recursive: true });
  const fast = firstRs(root, 'gpui-fast'), apple = firstRs(root, 'gpui-fast-apple'), port = 'vendor/gpui-fast-apple/src/carried_port.rs';
  insert(join(root, fast), 20, [markLine(1), '// carried line 2', '// carried line 3']);
  insert(join(root, apple), 20, [markLine(2), '// carried line 2']);
  writeFileSync(join(root, port), `${markLine(2)}\nuse objc2_metal::MTLDevice;\n`);
  mkdirSync(join(root, 'vendor/gpui-pre-apple/upstream'), { recursive: true });
  const table = rows ?? [row(1, [fast]), row(2, [apple, port])];
  writeFileSync(join(root, README), `# Carried\n\n## Carried patches\n\n| Behavior | Issue | Files | Test | Budget | Removal |\n|---|---|---|---|---|---|\n${table.join('\n')}\n${extra}`);
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests/stub.test.mjs'), "import test from 'node:test';\ntest('stub', () => {});\n");
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, SCRIPT), program);
  return { root, fast, apple, port };
}

test('wrong: the plant judges pass the reference check and fail each mutant on its fault', { timeout: 30 * 60_000 }, async () => {
  const rel = await releases();
  const run = (program) => { const { root } = synthetic(rel, { program }); return { plants: judgePlants(root, rel), removal: judgeRowRemoval(root, rel) }; };
  assert.deepEqual(run(reference), { plants: [], removal: [] });
  const expect = { 'skips-gpui-fast': ['plants', 'removal'], 'no-mark-rule': ['plants'], 'no-budget': ['plants'], 'no-line': ['plants'], 'no-row-rule': ['plants', 'removal'], silent: ['plants', 'removal'] };
  for (const [name, mutate] of Object.entries(MUTANTS)) {
    const result = run(mutate(reference));
    for (const judge of expect[name]) assert.notDeepEqual(result[judge], [], `${name}: the ${judge} judge passed it`);
  }
});

test('wrong: the AC1 judges fail an unpinned tree, a changed file with no row and a row with no removal condition', async () => {
  const rel = await releases();
  const good = synthetic(rel);
  assert.deepEqual(judgePins(good.root), []);
  assert.deepEqual(judgeRows(good.root, rel), []);
  assert.notDeepEqual(judgeRows(pristine(rel), rel), [], 'a tree carrying nothing passed');
  const manifest = join(good.root, 'vendor/gpui-fast-macos/Cargo.toml');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(`version = "${VERSION}"`, 'version = "0.1.18"'));
  assert.notDeepEqual(judgePins(good.root), [], 'a tree at 0.1.18 passed');
  const unlisted = synthetic(rel);
  insert(join(unlisted.root, firstRs(unlisted.root, 'gpui-fast-macos')), 10, [markLine(1)]);
  assert.notDeepEqual(judgeRows(unlisted.root, rel), [], 'a changed file with no row passed');
  const noRemoval = synthetic(rel);
  writeFileSync(join(noRemoval.root, README), readFileSync(join(noRemoval.root, README), 'utf8').replace('| upstream adds the same behavior |', '| — |'));
  assert.notDeepEqual(judgeRows(noRemoval.root, rel), [], 'a row with no removal condition passed');
});

test('wrong: the AC3 judges fail a metal-rs import, a metal dependency, no port, and a compile error in a carried file', async () => {
  const rel = await releases();
  const good = synthetic(rel);
  assert.deepEqual(judgeMetalRs(good.root), []);
  assert.deepEqual(portedFiles(good.root, rel), ['src/carried_port.rs']);
  writeFileSync(join(good.root, good.port), `${markLine(2)}\nuse metal::Device;\n`);
  assert.notDeepEqual(judgeMetalRs(good.root), [], 'a use of metal passed');
  const dependency = synthetic(rel), manifest = join(dependency.root, 'vendor/gpui-fast-apple/Cargo.toml');
  writeFileSync(manifest, `${readFileSync(manifest, 'utf8')}\n[target.'cfg(target_os = "macos")'.dependencies.metal]\nversion = "0.29"\n`);
  assert.notDeepEqual(judgeMetalRs(dependency.root), [], 'a metal dependency passed');
  assert.deepEqual(portedFiles(pristine(rel), rel), [], 'the pristine release counted as ported');
  const apple = '/x/gpui-fast-apple/Cargo.toml', carried = ['src/carried_port.rs'];
  const error = (manifest_path, file_name) => ({ reason: 'compiler-message', manifest_path, message: { level: 'error', message: 'planted', code: { code: 'E0004' }, spans: [{ is_primary: true, file_name, line_start: 3 }] } });
  assert.deepEqual(judgeMessages([{ reason: 'build-finished', success: true }], apple, carried), []);
  assert.deepEqual(judgeMessages([error(apple, 'src/fast/frame.rs'), { reason: 'build-finished', success: false }], apple, carried), []);
  for (const messages of [[error(apple, 'src/carried_port.rs')], [error('/x/gpui-fast/Cargo.toml', 'src/scene.rs')], [error(apple, 'src/metal_atlas.rs')], [{ reason: 'build-finished', success: false }], []]) {
    assert.notDeepEqual(judgeMessages(messages, apple, carried), [], `passed: ${JSON.stringify(messages)}`);
  }
});

test('wrong: the AC4 judge fails a GPUI row carried nowhere and a retired row naming no upstream change', async () => {
  const rel = await releases();
  assert.notDeepEqual(judgeRetired(synthetic(rel).root), [], 'the base GPUI rows carried nowhere passed');
  const retired = (rows) => `\n## Retired for ${VERSION}\n\n| Behavior | Issue | Upstream change |\n|---|---|---|\n${rows.join('\n')}\n`;
  const all = BASE_GPUI_ISSUES.filter((issue) => issue !== '#1550').map((issue) => `| Planted | ${issue} | example/upstream#7 |`);
  const left = '\n#1550\'s line-break row is left to #3624.\n';
  assert.deepEqual(judgeRetired(synthetic(rel, { extra: retired(all) + left }).root), []);
  assert.notDeepEqual(judgeRetired(synthetic(rel, { extra: retired(all) }).root), [], '#1550 carried nowhere and left to no follow-up passed');
  assert.notDeepEqual(judgeRetired(synthetic(rel, { extra: retired([...all, '| Planted | #1 | none upstream |']) + left }).root), [], 'a retired row naming no upstream change passed');
  assert.notDeepEqual(judgeRetired(synthetic(rel, { extra: retired([...all.slice(1), '| Planted | #140 | windoliver/deepbuild#140 |']) + left }).root), [], 'a retired row naming only this repo passed');
});
