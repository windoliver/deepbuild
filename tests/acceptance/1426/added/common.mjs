// #1426's added criteria: what every judge here shares. It keeps the first draft's surface (../README.md, The
// surface): the table under `## Carried patches`, the mark, `check`'s lines, `merge`'s CONFLICT lines, stub releases
// through DEEP_VENDOR_RELEASES and a planted tree. It adds what the new Scope needs and that draft doesn't define:
// a sixth column, Removal; real test files for three runners; a tree with no Cargo.toml (README.md, The added surface).
// The folder runs on its own, so it imports nothing from the first draft. Nothing here writes to the repo's own
// files or reaches the network.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
/** The merge base this folder was written against. */
export const BASE = 'db917989';
/** `#1426.` and the first 8 hex of SHA-256 of each added criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = {
  tests: '#1426.a17e5e56', // A planted row naming a test that doesn't exist fails the lint, ... A row with no removal condition fails, naming the row
  quickjs: '#1426.ed3ed529', // A planted changed file under `vendor/quickjs-jit-runtime` with no row fails the lint, naming the file
  pin: '#1426.fdfd6785', // A planted rebase that applies cleanly while one row's test fails leaves the pin where it was and names that test
};

export const SCRIPT = 'scripts/vendor-rebase.mjs';
export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const TABLE_HEADING = '## Carried patches';
/** The first draft's five columns, and the removal condition after them. */
export const COLUMNS = ['Behavior', 'Issue', 'Files', 'Test', 'Budget', 'Removal'];
export const RELEASES = 'DEEP_VENDOR_RELEASES';

export const COLOR = 'vendor/gpui-pre/src/color.rs';
export const RENDERER = 'vendor/gpui-pre-apple/src/metal_renderer.rs';
export const SWITCH = 'vendor/quickjs-jit-runtime/src/lib.rs';
export const NODE_TESTS = 'tests/planted/carried.test.mjs';
export const VITEST_TESTS = 'tests/planted/carried.test.ts';
export const CRATE = 'tests/planted-crate';
export const RUST_TESTS = `${CRATE}/src/lib.rs`;

/** The mark #711 uses, as a Rust comment. */
export const mark = (issue, why = 'planted') => `// DeepBuild patch (windoliver/deepbuild#${issue}): ${why}`;

export const tempRoot = (what) => mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da1426-${what}-`));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/**
 * A child's environment: this one, less what a parent test run or a proof lane set. A planted run gets its own HOME,
 * so cargo and rustup are pointed at the real ones; otherwise rustup would install a toolchain into the temporary HOME.
 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'CARGO_TARGET_DIR', 'VITEST', 'VITEST_MODE', RELEASES]) delete env[name];
  return { CARGO_HOME: join(homedir(), '.cargo'), RUSTUP_HOME: join(homedir(), '.rustup'), ...env, ...extra };
}

const upstream = (tag, count) => Array.from({ length: count }, (_, index) => `// upstream ${tag} line ${index + 1}`);
const text = (lines) => `${lines.join('\n')}\n`;
const manifest = (name, version) => `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n`;
const sha = (content) => createHash('sha256').update(content).digest('hex');

/** The stub Unicode files: a few lines each, in Unicode's own shape. */
export const UNICODE_FILES = {
  'LineBreakTest.txt': '# LineBreakTest-17.0.0.txt (planted)\n× 0023 × 0020 ÷ 0023 ÷\t#  × [0.3] NUMBER SIGN (AL) × [7.01] SPACE (SP) ÷ [18.0] NUMBER SIGN (AL) ÷ [0.3]\n',
  'GraphemeBreakTest.txt': '# GraphemeBreakTest-17.0.0.txt (planted)\n÷ 0020 ÷ 0020 ÷\t#  ÷ [0.2] SPACE (Other) ÷ [999.0] SPACE (Other) ÷ [0.3]\n',
  'BidiCharacterTest.txt': '# BidiCharacterTest-17.0.0.txt (planted)\n05D0 05D1 0028 05D2 05D3 005B 0026 0065 0066 005D 002E 0029 0067 0068;0;0;1 1 0 1 1 0 0 0 0 0 0 0 0 0;1 0 2 3 4 5 6 7 8 9 10 11 12 13\n',
};
/** The tree's own README, as the real one: each file with its source and SHA-256. Ours, not Unicode's. */
export const unicodeReadme = (files = UNICODE_FILES) => [
  '# Unicode 17.0.0 conformance files (planted)', '', '| File | Source | SHA-256 |', '|---|---|---|',
  ...Object.entries(files).map(([name, content]) => `| \`${name}\` | <https://www.unicode.org/Public/17.0.0/ucd/auxiliary/${name}> | \`${sha(content)}\` |`), '',
].join('\n');

/** The stub pinned releases, as `<release>/<path>`. */
function releaseFiles(version = '0.3.9') {
  return {
    [`gpui-pre-${version}/Cargo.toml`]: manifest('gpui-pre', version),
    [`gpui-pre-${version}/src/gpui.rs`]: text(upstream('gpui', 60)),
    [`gpui-pre-${version}/src/color.rs`]: text(upstream('color', 60)),
    [`gpui-pre-${version}/src/app/context.rs`]: text(upstream('context', 30)),
    [`gpui-pre-apple-${version}/Cargo.toml`]: manifest('gpui-pre-apple', version),
    [`gpui-pre-apple-${version}/src/metal_renderer.rs`]: text(upstream('renderer', 80)),
    [`gpui-pre-apple-${version}/vendor/gpui/src/color.rs`]: text(upstream('nested color', 30)),
    'quickjs-jit-runtime-0.12.11/Cargo.toml': manifest('quickjs-jit-runtime', '0.12.11'),
    'quickjs-jit-runtime-0.12.11/build.rs': text(upstream('build', 20)),
    'quickjs-jit-runtime-0.12.11/src/lib.rs': text(upstream('quickjs', 30)),
    'quickjs-jit-runtime-0.12.11/src/engine.rs': text(upstream('engine', 30)),
    'quickjs-jit-runtime-0.12.11/src/runtime/osr.rs': text(upstream('osr', 30)),
    ...Object.fromEntries(Object.entries(UNICODE_FILES).map(([name, content]) => [`unicode-17.0.0/${name}`, content])),
    // The tree's README rides along, so a script that exempts it and one that compares it both pass the plant.
    'unicode-17.0.0/README.md': unicodeReadme(),
  };
}

export const testCell = (name, file = NODE_TESTS) => `\`${file} › ${name}\``;
export const TABLE_ROWS = [
  { behavior: 'The planted gradient', issue: '#9001', files: [COLOR], test: testCell('gradient keeps its stops'), budget: '—', removal: 'gpui-pre takes the planted stops upstream' },
  { behavior: 'The planted surface', issue: '#9002', files: [RENDERER], test: testCell('surface keeps its alpha'), budget: '1 over: the draw path is one branch', removal: 'none: zed closed zed-industries/zed#66114 unmerged' },
  { behavior: 'The planted switch', issue: '#9003', files: [SWITCH], test: testCell('switch denies the engine'), budget: '—', removal: 'longbridge/quickjs-jit adds deny_native_code' },
];

/** Each row's test, run for real: each reads the vendored file its row carries. */
export const NODE_TEST_TEXT = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const vendored = (path) => readFileSync(new URL(\`../../vendor/\${path}\`, import.meta.url), 'utf8');
// test('gradient keeps every stop', ...) was folded into the first test below; the name is only text now.
const retired = 'gradient keeps no stops';

test('gradient keeps its stops', () => {
  assert.match(vendored('gpui-pre/src/color.rs'), /^\\/\\/ upstream color line 5$/m, retired);
  assert.match(vendored('gpui-pre/src/color.rs'), /PLANTED_STOP/);
});
test('surface keeps its alpha', () => {
  assert.match(vendored('gpui-pre-apple/src/metal_renderer.rs'), /PLANTED_DRAW_0/);
});
test('switch denies the engine', () => {
  assert.match(vendored('quickjs-jit-runtime/src/lib.rs'), /PLANTED_SWITCH/);
});
`;
const VITEST_TEXT = `import { expect, test } from 'vitest';

// test('gradient keeps every stop', ...) was folded into the test below; the name is only text now.
test('gradient keeps its stops', () => {
  expect(1 + 1).toBe(2);
});
`;
const RUST_TEXT = `//! A planted crate whose one test a row may name.

#[cfg(test)]
mod tests {
    #[test]
    fn switch_denies_the_engine() {
        assert_eq!(1 + 1, 2);
    }

    // Not a test: the name is in the source, and in no list cargo gives.
    #[allow(dead_code)]
    fn not_a_test() {}
}
`;
const CRATE_FILES = {
  [`${CRATE}/Cargo.toml`]: '[package]\nname = "planted-crate"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n',
  [`${CRATE}/Cargo.lock`]: '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "planted-crate"\nversion = "0.1.0"\n',
  [RUST_TESTS]: RUST_TEXT,
};

export const rowLine = ({ behavior, issue, files, test, budget, removal }) => `| ${behavior} | ${issue} | ${files.map((file) => `\`${file}\``).join(', ')} | ${test} | ${budget} | ${removal} |`;
export const carriedText = (rows) => [
  '# The GPUI patches we carry', '', 'Planted prose above the table.', '', TABLE_HEADING, '',
  `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`, ...rows.map(rowLine), '', 'Planted prose below the table.', '',
].join('\n');

const cellsOf = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
/** The table under `## Carried patches` in `text`: its header's cells and its rows by column; null when there is none. */
export function readTable(text) {
  const lines = text.split('\n');
  const start = lines.indexOf(TABLE_HEADING);
  if (start < 0) return null;
  const table = [];
  for (let index = start + 1; index < lines.length && !lines[index].startsWith('#'); index += 1) {
    if (lines[index].startsWith('|')) table.push(lines[index]);
    else if (table.length) break;
  }
  if (table.length < 2) return null;
  const header = cellsOf(table[0]);
  const rows = table.slice(2).map(cellsOf).map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
  return { header, rows: rows.map((row) => ({ ...row, files: [...(row.Files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file) })) };
}

/** The plant's rows, as `TABLE_ROWS` holds them. */
export function carriedRows(text) {
  const table = readTable(text);
  if (!table || table.header.join('|') !== COLUMNS.join('|')) return null;
  return table.rows.map((row) => ({ behavior: row.Behavior, issue: row.Issue, files: row.files, test: row.Test, budget: row.Budget, removal: row.Removal }));
}

/** A Test cell as `{ path, name }`, or null when it names no test. */
export function rowTest(cell) {
  const [, path, name] = /^`(.+?) › (.+)`$/.exec(cell ?? '') ?? [];
  return path ? { path, name } : null;
}

const put = (root, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

export function git(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
}

/**
 * A planted checkout and its stub releases: four trees under vendor/ (three crates with carried hunks, each marked
 * and each with its row, and unicode-17.0.0 as released), the rows' tests for node --test, vitest and cargo, and the
 * repo's node_modules linked in, so `check` passes it as it stands. `root` is a git repository with all of that
 * committed; a test's plants stay uncommitted. Each helper edits the plant, never the repo.
 */
export function plantTree() {
  const dir = tempRoot('tree');
  const root = join(dir, 'checkout');
  const releases = join(dir, 'releases');
  const box = {
    dir, root, releases,
    read: (path) => readFileSync(join(root, path), 'utf8'),
    write(path, content) { put(root, { [path]: content }); },
    /** Puts `lines` after line `after` of the file; answers the first new line's number. */
    insert(path, after, lines) {
      const all = box.read(path).split('\n');
      all.splice(after, 0, ...lines);
      box.write(path, all.join('\n'));
      return after + 1;
    },
    rows(change) {
      const rows = carriedRows(box.read(README));
      box.write(README, carriedText(change(rows) ?? rows));
    },
    release(name, files) { put(join(releases, name), files); },
    remove: () => remove(dir),
  };
  mkdirSync(root);
  put(releases, releaseFiles());
  cpSync(join(releases, 'gpui-pre-0.3.9'), join(root, 'vendor/gpui-pre'), { recursive: true });
  cpSync(join(releases, 'gpui-pre-apple-0.3.9'), join(root, 'vendor/gpui-pre-apple'), { recursive: true });
  cpSync(join(releases, 'quickjs-jit-runtime-0.12.11'), join(root, 'vendor/quickjs-jit-runtime'), { recursive: true });
  cpSync(join(releases, 'unicode-17.0.0'), join(root, 'vendor/unicode-17.0.0'), { recursive: true });
  put(root, {
    [README]: carriedText(TABLE_ROWS),
    'vendor/gpui-pre-apple/upstream/PR-DESCRIPTION.md': 'Ours, and no part of the release.\n',
    [NODE_TESTS]: NODE_TEST_TEXT,
    [VITEST_TESTS]: VITEST_TEXT,
    ...CRATE_FILES,
    '.gitignore': 'node_modules\ntarget/\n',
    'package.json': '{ "name": "planted-checkout", "private": true, "type": "module" }\n',
  });
  if (existsSync(join(repoRoot, 'node_modules'))) symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
  box.insert(COLOR, 10, [mark(9001, 'the first stop'), 'pub const PLANTED_STOP: u8 = 1;']);
  box.insert(COLOR, 30, [mark(9001, 'the second stop'), 'pub const PLANTED_END: u8 = 2;', 'pub const PLANTED_MID: u8 = 3;']);
  box.insert(RENDERER, 10, [mark(9002, 'the draw branch'), ...Array.from({ length: 8 }, (_, index) => `pub const PLANTED_DRAW_${index}: u8 = ${index};`)]);
  box.insert(RENDERER, 40, [mark(9002, 'the report'), 'pub const PLANTED_REPORT: u8 = 1;']);
  box.insert(SWITCH, 10, [mark(9003, 'the switch'), 'pub const PLANTED_SWITCH: u8 = 1;']);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'The planted checkout');
  return box;
}

/** Adds a stub new release of gpui-pre: the old release's files with `change(path, text)` over each. */
export function newRelease(box, crate, from, to, change) {
  const prefix = `${crate}-${from}/`;
  const files = Object.fromEntries(Object.entries(releaseFiles(from)).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => {
    const inner = path.slice(prefix.length);
    return [inner, change(inner, content.replaceAll(`version = "${from}"`, `version = "${to}"`))];
  }));
  box.release(`${crate}-${to}`, files);
}

/** Runs `node <script> <args>` in the plant, with the stub releases and no other way to a release. */
export function runIn(script, box, args, env = {}) {
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: box.root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
    env: cleanEnv({ [RELEASES]: box.releases, HOME: box.dir, ...env }),
  });
  return { status: run.status, stdout: run.stdout ?? '', output: `${run.stdout ?? ''}${run.stderr ?? ''}`, error: run.error };
}

/** The output's lines that start with `word`. */
export const linesOf = (output, word) => output.split('\n').filter((line) => line.startsWith(`${word} `));
/** Lines starting FAIL, BLOCKED, INVALID or INCONCLUSIVE. */
export const refusals = (output) => output.split('\n').filter((line) => /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(line));
/** The script ran and passed the plant. */
export const passes = (run) => run.status === 0 && !refusals(run.output).length;
export const clip = (output) => output.trim().slice(0, 900) || '(no output)';

/** Runs `check` in a fresh plant after `plant(box)`, and answers what `judge(run, planted, box)` says. */
export function planted(script, plant, judge) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    const at = plant(box);
    return judge(runIn(script, box, ['check']), at, box);
  } finally {
    box.remove();
  }
}
