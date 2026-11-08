// #1426 a17e5e56, the real-tree judge against wrong tables: each planted table that misses the Scope line fails, naming
// the row (and the test, where one is named); the control passes; a list this run can't read is INCONCLUSIVE, never
// PASS; and no run builds gpui. These test the test, not #1426, so they pass at the base and carry no criterion tag.
// The plant is a tree under /tmp/da1426-real-*: a node test file, a vitest file (with the repo's node_modules linked
// in), a Rust crate with no dependencies, and a stub gpui-pre whose build script leaves a mark if anything builds it.
// Run: node --test tests/acceptance/1426/added-real/wrong.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { COLUMNS, README, TABLE_HEADING, judgeTable, remove, repoRoot, tempRoot } from './real-judge.mjs';

const NODE = 'tests/planted/carried.test.mjs';
const TS = 'tests/planted/carried.test.ts';
const RS = 'crates/planted/src/lib.rs';
const GPUI = 'vendor/gpui-pre/src/lib.rs';
const VIA_GPUI = 'crates/uses-gpui/src/lib.rs';

const FILES = {
  [NODE]: `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import test, { describe, it } from 'node:test';
// test('gradient keeps every stop', () => {});
export const said = 'gradient keeps its colors';
test('gradient keeps its stops', () => {});
describe('surface', () => {
  it('keeps its alpha', () => {
    const cargo = spawnSync('cargo', ['build'], { encoding: 'utf8' });
    writeFileSync(new URL('../../CARGO_STATUS', import.meta.url), String(cargo.status ?? cargo.error?.code));
  });
});
test('reports', async (t) => {
  await t.test('each frame', () => {});
});
`,
  [TS]: `import { describe, it } from 'vitest';
// it('denies native code', () => {});
describe('switch', () => {
  it('denies the engine', () => {});
});
`,
  'tests/planted/helper.mjs': 'export const x = 1;\n',
  'tests/planted/broken.test.mjs': "import test from 'node:test';\nimport './not-here.mjs';\ntest('loads', () => {});\n",
  'crates/planted/Cargo.toml': '[package]\nname = "planted"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n',
  [RS]: `pub fn switch() -> bool {
    true
}

#[cfg(test)]
mod tests {
    // fn switch_in_a_comment() {}
    fn helper_not_a_test() -> bool {
        super::switch()
    }

    #[test]
    fn switch_denies_the_engine() {
        assert!(helper_not_a_test());
    }
}
`,
  'crates/nolock/Cargo.toml': '[package]\nname = "nolock"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n',
  'crates/nolock/src/lib.rs': '#[cfg(test)]\nmod tests {\n    #[test]\n    fn listed() {}\n}\n',
  'vendor/gpui-pre/Cargo.toml': '[package]\nname = "gpui-pre"\nversion = "0.3.9"\nedition = "2021"\nbuild = "build.rs"\n\n[workspace]\n',
  'vendor/gpui-pre/build.rs': 'fn main() {\n    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../../BUILT_GPUI"), "").unwrap();\n}\n',
  [GPUI]: '#[cfg(test)]\nmod tests {\n    #[test]\n    fn draws() {}\n}\n',
  'crates/uses-gpui/Cargo.toml': '[package]\nname = "uses-gpui"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ngpui-pre = { path = "../../vendor/gpui-pre" }\n\n[workspace]\n',
  [VIA_GPUI]: '#[cfg(test)]\nmod tests {\n    #[test]\n    fn draws_through_gpui() {}\n}\n',
};

const put = (root, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

function plant({ nodeModules }) {
  const root = tempRoot('plant');
  put(root, FILES);
  for (const crate of ['crates/planted', 'crates/uses-gpui']) {
    const lock = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: join(root, crate), encoding: 'utf8' });
    if (lock.status !== 0) {
      remove(root);
      assert.fail(`the plant needs cargo on PATH for ${crate}: ${lock.error?.message ?? lock.stderr}`);
    }
  }
  if (nodeModules) symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
  return root;
}

const cell = (path, name) => `\`${path} › ${name}\``;
const row = (Behavior, Test, Removal = 'none: zed closed zed-industries/zed#66114 unmerged on 2026-10-28') => ({ Behavior, Issue: '#9001', Files: '`vendor/gpui-pre/src/lib.rs`', Test, Budget: '—', Removal });
const CONTROL = [
  row('The planted gradient', cell(NODE, 'gradient keeps its stops')),
  row('The planted surface', cell(NODE, 'surface › keeps its alpha'), 'upstream gpui composites BGRA surfaces premultiplied'),
  row('The planted reports', cell(NODE, 'reports › each frame'), 'none: upstream has no per-frame surface report'),
  row('The planted switch', cell(TS, 'switch › denies the engine'), 'longbridge/quickjs-jit adds a switch that denies native code'),
  row('The planted runtime', cell(RS, 'tests::switch_denies_the_engine')),
];

function table(root, rows, columns = COLUMNS) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  mkdirSync(dirname(join(root, README)), { recursive: true });
  writeFileSync(join(root, README), ['# The GPUI patches we carry', '', 'Prose above.', '', TABLE_HEADING, '', line(columns), `|${columns.map(() => '---').join('|')}|`,
    ...rows.map((r) => line(columns.map((column) => r[column] ?? ''))), '', 'Prose below.', ''].join('\n'));
}

let withModules;
let without;
before(() => {
  withModules = plant({ nodeModules: true });
  without = plant({ nodeModules: false });
});
after(() => {
  for (const root of [withModules, without]) if (root) remove(root);
});

const shown = ({ state, lines }) => `${state}\n${lines.join('\n') || '(no lines)'}`;
/** The verdict on `rows` in the plant, after checking that nothing built gpui. */
function judge(rows, { root = withModules, env, columns } = {}) {
  rmSync(join(root, 'BUILT_GPUI'), { force: true });
  if (rows) table(root, rows, columns);
  const verdict = judgeTable(root, { env });
  assert.ok(!existsSync(join(root, 'BUILT_GPUI')), `a judge run built the stub gpui-pre:\n${shown(verdict)}`);
  return verdict;
}
const failing = (verdict, ...words) => verdict.lines.filter((line) => line.startsWith('FAIL') && words.every((word) => line.includes(word)));

test('the control table passes: removal conditions given, and each test in node --test, vitest or cargo test\'s own list', () => {
  rmSync(join(withModules, 'CARGO_STATUS'), { force: true });
  const verdict = judge(CONTROL);
  assert.equal(verdict.state, 'PASS', shown(verdict));
  assert.equal(verdict.lines.filter((line) => line.startsWith('PASS row ')).length, CONTROL.length, shown(verdict));
  assert.equal(readFileSync(join(withModules, 'CARGO_STATUS'), 'utf8'), '97', 'a node test the judge ran reached a working cargo');
});

for (const [why, removal] of [['empty', ''], ['an em dash', '—'], ['a hyphen', '-'], ['none alone', 'none'], ['none and a colon', 'none:'], ['None and a stop', 'None.']]) {
  test(`a row whose removal condition is ${why} fails, naming the row`, () => {
    const verdict = judge([row('The planted gradient', cell(NODE, 'gradient keeps its stops'), removal)]);
    assert.equal(verdict.state, 'FAIL', shown(verdict));
    assert.ok(failing(verdict, 'The planted gradient', 'Removal').length, shown(verdict));
  });
}

for (const [why, path, name] of [
  ['a node test held only in a comment', NODE, 'gradient keeps every stop'],
  ['a node test name held only in a string', NODE, 'gradient keeps its colors'],
  ['the start of a node test\'s name', NODE, 'gradient keeps'],
  ['a node suite, not a test', NODE, 'surface'],
  ['a nested node test without its suite', NODE, 'keeps its alpha'],
  ['a test file that is gone', 'tests/planted/gone.test.mjs', 'gradient keeps its stops'],
  ['a bare file name', 'carried.test.mjs', 'gradient keeps its stops'],
  ['an absolute path', null, 'gradient keeps its stops'],
  ['a script no runner lists', 'tests/planted/helper.mjs', 'x'],
  ['a vitest test held only in a comment', TS, 'denies native code'],
  ['a nested vitest test without its suite', TS, 'denies the engine'],
  ['a Rust test held only in a comment', RS, 'tests::switch_in_a_comment'],
  ['a Rust fn with no #[test]', RS, 'tests::helper_not_a_test'],
  ['a Rust test without its module path', RS, 'switch_denies_the_engine'],
  ['a Rust test the file doesn\'t define', RS, 'tests::gone'],
  ['a gpui test the file doesn\'t define', GPUI, 'tests::gone'],
]) {
  test(`a row naming ${why} fails, naming the row and the test`, () => {
    const named = path ?? join(withModules, NODE);
    const verdict = judge([row('The planted gradient', cell(named, name))]);
    assert.equal(verdict.state, 'FAIL', shown(verdict));
    assert.ok(failing(verdict, 'The planted gradient', named, name).length, shown(verdict));
  });
}

for (const [why, test_] of [['empty', ''], ['a dash', '—'], ['a path with no name', `\`${NODE}\``], ['a name with no path', '`gradient keeps its stops`']]) {
  test(`a row whose Test cell is ${why} fails, naming the row`, () => {
    const verdict = judge([row('The planted gradient', test_)]);
    assert.equal(verdict.state, 'FAIL', shown(verdict));
    assert.ok(failing(verdict, 'The planted gradient', 'Test').length, shown(verdict));
  });
}

test('one wrong row among good ones fails the table, naming it alone', () => {
  const verdict = judge([...CONTROL, row('The planted stray', cell(NODE, 'gradient keeps every stop'))]);
  assert.equal(verdict.state, 'FAIL', shown(verdict));
  assert.deepEqual(verdict.lines.filter((line) => line.startsWith('FAIL')).map((line) => line.split(':')[0]), ['FAIL row The planted stray'], shown(verdict));
});

test('no README, a table without the Removal column, and a table with no rows each fail', () => {
  const dir = tempRoot('bare');
  try {
    const none = judgeTable(dir);
    assert.equal(none.state, 'FAIL', shown(none));
    assert.ok(failing(none, 'table', TABLE_HEADING).length, shown(none));
  } finally {
    remove(dir);
  }
  const five = judge(CONTROL, { columns: COLUMNS.filter((column) => column !== 'Removal') });
  assert.equal(five.state, 'FAIL', shown(five));
  assert.ok(failing(five, 'table', 'Removal').length, shown(five));
  const empty = judge([]);
  assert.equal(empty.state, 'FAIL', shown(empty));
  assert.ok(failing(empty, 'table', 'no rows').length, shown(empty));
});

for (const [why, rows, options, words] of [
  ['a test in gpui itself', [row('The planted gpui', cell(GPUI, 'tests::draws'))], {}, ['gpui build']],
  ['a test in a crate that needs gpui', [row('The planted gpui', cell(VIA_GPUI, 'tests::draws_through_gpui'))], {}, ['gpui build', 'gpui-pre']],
  ['a vitest test with no vitest installed', [row('The planted gpui', cell(TS, 'switch › denies the engine'))], { root: 'without' }, ['vitest']],
  ['a Rust test with no cargo on PATH', [row('The planted gpui', cell(RS, 'tests::switch_denies_the_engine'))], { env: { PATH: '/usr/bin:/bin' } }, ['cargo']],
  ['a Rust test in a crate with no Cargo.lock', [row('The planted gpui', cell('crates/nolock/src/lib.rs', 'tests::listed'))], {}, ['Cargo.lock']],
  ['a node test in a file that fails to load', [row('The planted gpui', cell('tests/planted/broken.test.mjs', 'loads'))], {}, ['load']],
]) {
  test(`a row naming ${why} is INCONCLUSIVE, naming the row and what is missing, and never passes`, () => {
    const verdict = judge(rows, { ...options, root: options.root === 'without' ? without : withModules });
    assert.equal(verdict.state, 'INCONCLUSIVE', shown(verdict));
    assert.ok(verdict.lines.some((line) => line.startsWith('INCONCLUSIVE row The planted gpui') && words.every((word) => line.includes(word))), shown(verdict));
  });
}

test('a FAIL stands over an INCONCLUSIVE', () => {
  const verdict = judge([row('The planted gpui', cell(GPUI, 'tests::draws')), row('The planted gradient', cell(NODE, 'gradient keeps its stops'), '')]);
  assert.equal(verdict.state, 'FAIL', shown(verdict));
});
