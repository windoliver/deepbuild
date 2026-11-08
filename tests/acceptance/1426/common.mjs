// #1426's acceptance tests: what every judge shares. The surface's names (README.md, The surface), a planted vendor
// tree with stub pinned releases, the carried-patch table's writer and reader, and how a script is run on a plant.
// Nothing here writes to the repo's own files, and nothing here reaches the network.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** The merge base this suite was written against. */
export const BASE = 'c12a65bb';

export const SCRIPT = 'scripts/vendor-rebase.mjs';
export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const TABLE_HEADING = '## Carried patches';
export const RECORD_HEADING = '## Rebase trial';
export const COLUMNS = ['Behavior', 'Issue', 'Files', 'Test', 'Budget'];
/** The variable naming the folder of stub releases, each `<crate>-<version>/` as an unpacked .crate holds it. */
export const RELEASES = 'DEEP_VENDOR_RELEASES';

/** The mark #711 uses, as a Rust or Metal comment. */
export const mark = (issue, why = 'planted') => `// DeepBuild patch (windoliver/deepbuild#${issue}): ${why}`;

export const tempRoot = (what) => mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da1426-${what}-`));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/** A child's environment: this one, less what a parent test run or a proof lane set. */
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'CARGO_TARGET_DIR', RELEASES]) delete env[name];
  return { ...env, ...extra };
}

const upstream = (tag, count) => Array.from({ length: count }, (_, index) => `// upstream ${tag} line ${index + 1}`);
const text = (lines) => `${lines.join('\n')}\n`;
const manifest = (name, version) => `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n`;

/** The stub pinned releases, as `<crate>-<version>/<path>`. */
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
    'quickjs-jit-runtime-0.12.11/src/lib.rs': text(upstream('quickjs', 30)),
    'quickjs-jit-runtime-0.12.11/src/engine.rs': text(upstream('engine', 30)),
  };
}

const TEST_FILE = 'tests/planted/carried.test.mjs';
export const testCell = (name, file = TEST_FILE) => `\`${file} › ${name}\``;
export const TABLE_ROWS = [
  { behavior: 'The planted gradient', issue: '#9001', files: ['vendor/gpui-pre/src/color.rs'], test: testCell('gradient keeps its stops'), budget: '—' },
  { behavior: 'The planted surface', issue: '#9002', files: ['vendor/gpui-pre-apple/src/metal_renderer.rs'], test: testCell('surface keeps its alpha'), budget: '1 over: the draw path is one branch' },
  { behavior: 'The planted switch', issue: '#9003', files: ['vendor/quickjs-jit-runtime/src/lib.rs'], test: testCell('switch denies the engine'), budget: '—' },
];
const TESTS = `import test from 'node:test';
test('gradient keeps its stops', () => {});
test('surface keeps its alpha', () => {});
test('switch denies the engine', () => {});
`;

export const rowLine = ({ behavior, issue, files, test, budget }) => `| ${behavior} | ${issue} | ${files.map((file) => `\`${file}\``).join(', ')} | ${test} | ${budget} |`;
export const carriedText = (rows, { extra = '' } = {}) => [
  '# The GPUI patches we carry', '', 'Planted prose above the table.', '', TABLE_HEADING, '',
  `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`, ...rows.map(rowLine), '', 'Planted prose below the table.', '', extra,
].join('\n');

/** The carried-patch table in `text`, as rows; null when the file has none in the pinned shape. */
export function carriedRows(text) {
  const lines = text.split('\n');
  const start = lines.indexOf(TABLE_HEADING);
  if (start < 0) return null;
  const table = [];
  for (let index = start + 1; index < lines.length && !lines[index].startsWith('#'); index += 1) {
    if (lines[index].startsWith('|')) table.push(lines[index]);
    else if (table.length) break;
  }
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  if (table.length < 2 || cells(table[0]).join('|') !== COLUMNS.join('|')) return null;
  return table.slice(2).map(cells).map(([behavior, issue, files, test, budget]) => ({
    behavior, issue, test, budget, files: [...(files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file),
  }));
}

/** A row's Test cell as `{ path, name }`, or null when it names no test. */
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

function git(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
}

/**
 * A planted checkout and its stub releases: three vendored crates with their carried hunks, each marked and each with
 * its row, so `check` passes it as it stands. `root` is a git repository with all of that committed; a test's plants
 * stay uncommitted. Each helper edits the plant, never the repo.
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
  put(root, {
    [README]: carriedText(TABLE_ROWS),
    'vendor/gpui-pre-apple/upstream/PR-DESCRIPTION.md': 'Ours, and no part of the release.\n',
    'vendor/unicode-17.0.0/README.md': 'Test data, no crate.\n',
    [TEST_FILE]: TESTS,
  });
  box.insert('vendor/gpui-pre/src/color.rs', 10, [mark(9001, 'the first stop'), 'pub const PLANTED_STOP: u8 = 1;']);
  box.insert('vendor/gpui-pre/src/color.rs', 30, [mark(9001, 'the second stop'), 'pub const PLANTED_END: u8 = 2;', 'pub const PLANTED_MID: u8 = 3;']);
  box.insert('vendor/gpui-pre-apple/src/metal_renderer.rs', 10, [mark(9002, 'the draw branch'), ...Array.from({ length: 8 }, (_, index) => `pub const PLANTED_DRAW_${index}: u8 = ${index};`)]);
  box.insert('vendor/gpui-pre-apple/src/metal_renderer.rs', 40, [mark(9002, 'the report'), 'pub const PLANTED_REPORT: u8 = 1;']);
  box.insert('vendor/quickjs-jit-runtime/src/lib.rs', 10, [mark(9003, 'the switch'), 'pub const PLANTED_SWITCH: u8 = 1;']);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'The planted checkout');
  return box;
}

/** Adds a stub new release of `crate`: the old release's files with `change(path, text)` over each, plus `added`. */
export function newRelease(box, crate, from, to, change, added = {}) {
  const files = Object.fromEntries(Object.entries(releaseFiles(from)).filter(([path]) => path.startsWith(`${crate}-${from}/`)).map(([path, content]) => {
    const inner = path.slice(`${crate}-${from}/`.length);
    return [inner, change(inner, content.replaceAll(`version = "${from}"`, `version = "${to}"`))];
  }));
  box.release(`${crate}-${to}`, { ...files, ...added });
}

/** Runs `node <script> <args>` in the plant, with the stub releases and no other way to a release. */
export function runIn(script, box, args, env = {}) {
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: box.root, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
    env: cleanEnv({ [RELEASES]: box.releases, HOME: box.dir, ...env }),
  });
  return { status: run.status, stdout: run.stdout ?? '', output: `${run.stdout ?? ''}${run.stderr ?? ''}`, error: run.error };
}

/** The output's lines that start with `word`. */
export const linesOf = (output, word) => output.split('\n').filter((line) => line.startsWith(`${word} `));
/** Lines starting FAIL, BLOCKED, INVALID or INCONCLUSIVE. */
export const refusals = (output) => output.split('\n').filter((line) => /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(line));
const at = (path, line) => new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${line}(?!\\d)`);
/** The FAIL lines naming `path:line`. */
export const naming = (output, path, line) => linesOf(output, 'FAIL').filter((text) => at(path, line).test(text));
export const clip = (output) => output.trim().slice(0, 900) || '(no output)';
