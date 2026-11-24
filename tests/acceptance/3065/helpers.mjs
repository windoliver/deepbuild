// Helpers for #3065's acceptance tests. Written blind from issue #3065, its checkpoint #2673, AGENTS.md (Proof), the
// design's "How we know version 0 works" and docs/parallel-proof.md sections 5 ("Binaries for tests") and 7a, at base
// c7dc0edc3. Nothing here imports the code under test: this checkout's real scripts/ run in a scratch git repository
// made by #1115's tree(), with a small Cargo workspace, a HOME of the test's own (so ~/.deepbuild/reach/ is the
// sandbox's, never the machine's) and #2820's sandbox: a throttle table of its own (DEEP_THROTTLE_TABLE) and real cargo.
// The surfaces are the issue's: the record file ~/.deepbuild/reach/<tree>.json, `node scripts/reach.mjs compare
// <path ...>` and `node scripts/affected.mjs --list <path ...>`; what the issue leaves open is in the README.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { dump, launch, stop, tree, write } from '../1115/helpers.mjs';
import { sandbox } from '../2820/helpers.mjs';

/** How long the recording run is given: one unit lane of a fixture is seconds idle, minutes on a loaded machine. */
export const RECORD_MS = 15 * 60_000;
/** How long one compare or --list is given. */
export const READ_MS = 5 * 60_000;
export const TEST = { timeout: RECORD_MS + 3 * READ_MS };

// The fixture's paths. The three changes are #2673's: one line in one hub source file, in one canvas crate and in
// one design doc.
export const HUB = 'packages/hub/src/core.mjs';
export const CANVAS = 'crates/deep-canvas/src/lib.rs';
export const DOC = 'docs/technical-design.md';
/** A hub source file only one planted test names, so a change to it selects that test alone. */
export const only = (which) => `packages/hub/src/only-${which}.mjs`;
/** The fixture workspace's binaries: deep-hook of the crate deep-hook, deep-show of the canvas crate deep-canvas. */
export const BINARIES = ['deep-hook', 'deep-show'];

export const T = {
  hookNamed: 'tests/fixture-3065-hook-named.test.mjs',
  hookStarted: 'tests/fixture-3065-hook-started.test.mjs',
  hookTarget: 'tests/fixture-3065-hook-target.test.mjs',
  hubLoaded: 'tests/fixture-3065-hub-loaded.test.mjs',
  hubChild: 'tests/fixture-3065-hub-child.test.mjs',
  hubNamed: 'tests/fixture-3065-hub-named.test.mjs',
  canvasStarted: 'tests/fixture-3065-canvas-started.test.mjs',
  canvasNamed: 'tests/fixture-3065-canvas-named.test.mjs',
  // The unit lane's node command reads tests/*.test.mjs, so a file a folder deeper never runs in it.
  unrun: 'tests/fixture-3065/unrun.test.mjs',
  skipped: 'tests/fixture-3065-skipped.test.mjs',
  killed: 'tests/fixture-3065-killed.test.mjs',
};
export const HOOK_HELPER = 'tests/fixture-3065/hook.mjs';
export const SHOW_HELPER = 'tests/fixture-3065/show.mjs';
export const HUB_HELPER = 'tests/fixture-3065/hub.mjs';
export const CLI = 'packages/hub/src/cli.mjs';

const pkg = (name) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n`;

/**
 * The fixture's Cargo workspace, with no dependencies, and its Cargo.lock, made by cargo itself (offline) in a folder
 * of the sandbox's, so `--locked` builds work offline in seconds: the bin crate `deep-hook`, and the canvas crate
 * `deep-canvas`, a library with its binary `deep-show`.
 */
function workspace(box) {
  const files = {
    'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["crates/deep-hook", "crates/deep-canvas"]\n',
    'crates/deep-hook/Cargo.toml': pkg('deep-hook'),
    'crates/deep-hook/src/main.rs': 'fn main() {\n    println!("deep-hook {}", std::env::args().count());\n}\n',
    'crates/deep-canvas/Cargo.toml': pkg('deep-canvas'),
    [CANVAS]: 'pub fn layers() -> u32 {\n    3\n}\n',
    'crates/deep-canvas/src/bin/deep-show.rs': 'fn main() {\n    println!("deep-show {}", deep_canvas::layers());\n}\n',
  };
  const scratch = join(box.dir, 'lock');
  mkdirSync(scratch, { recursive: true });
  write(scratch, files);
  const result = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: scratch, env: box.env, encoding: 'utf8' });
  assert.equal(result.status, 0, `cargo can't run in the sandbox, so nothing can build: ${result.error?.message ?? result.stderr}`);
  return { ...files, 'Cargo.lock': readFileSync(join(scratch, 'Cargo.lock'), 'utf8') };
}

// What every planted test starts with: its checkout (the folder up from it that holds Cargo.toml).
const HEAD = `import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'Cargo.toml')) && dirname(root) !== root) root = dirname(root);
`;

// A helper that names a workspace binary and starts it from DEEP_BIN_DIR, as a redrafted acceptance helper does.
const starter = (constant, binary, content) => `// ${content}
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const ${constant} = '${binary}';
/** Starts the binary the run built into DEEP_BIN_DIR. */
export function start(args = [], env = {}) {
  return spawnSync(join(process.env.DEEP_BIN_DIR ?? '', ${constant}), args, { encoding: 'utf8', env: { ...process.env, ...env } });
}
`;
const named = (helper, constant, binary) => `${HEAD}import { ${constant}, start } from '${helper}';

test('the helper names ${binary}, and this test never starts it', () => {
  assert.equal(${constant}, '${binary}');
  assert.equal(typeof start, 'function');
});
`;
const started = (helper, constant, binary, tokens) => `${HEAD}import { ${constant}, start } from '${helper}';

test('the helper starts ${binary} from DEEP_BIN_DIR', () => {
  const result = start(['--note', '${tokens.argument}'], { T3065_SPAWN: '${tokens.environment}' });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /^${binary} /);
  assert.equal(${constant}, '${binary}');
});
`;

/**
 * The fixture's files. `tokens` are values of this run alone, planted where a record could pick them up: `content` in
 * the sources a test's node processes load, `argument` in the arguments of the binaries and node processes the tests
 * start, `environment` in their environment (and the recording run's own, see recorded()).
 */
function files(box, tokens) {
  return {
    '.gitignore': 'node_modules\n/target\n',
    ...workspace(box),
    [DOC]: '# Technical design\n\nA design doc of the fixture.\n',
    [HUB]: `// ${tokens.content}\nexport const lanes = 3;\nexport const note = '${tokens.content}';\n`,
    [CLI]: `// ${tokens.content}\nimport { lanes } from './core.mjs';\n\nconsole.log(lanes);\n`,
    ...Object.fromEntries(['unrun', 'skipped', 'killed'].map((which) => [only(which), `export const which = '${which}';\n`])),
    [HOOK_HELPER]: starter('HOOK', 'deep-hook', tokens.content),
    [SHOW_HELPER]: starter('SHOW', 'deep-show', tokens.content),
    [HUB_HELPER]: `// ${tokens.content}\nexport { lanes } from '../../packages/hub/src/core.mjs';\n`,
    // #3065.AC1's pair: both import the helper that names deep-hook; only the twin starts it.
    [T.hookNamed]: named('./fixture-3065/hook.mjs', 'HOOK', 'deep-hook'),
    [T.hookStarted]: started('./fixture-3065/hook.mjs', 'HOOK', 'deep-hook', tokens),
    // The twin that starts it by its path under target/, after building it there, as ~70 acceptance files do.
    [T.hookTarget]: `${HEAD}
test('deep-hook starts from target/debug, built by this test', () => {
  const built = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-hook'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.error?.message ?? built.stderr);
  const result = spawnSync(join(root, 'target/debug/deep-hook'), ['--note', '${tokens.argument}'], { encoding: 'utf8', env: { ...process.env, T3065_SPAWN: '${tokens.environment}' } });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(result.stdout, /^deep-hook /);
});
`,
    // The hub change: one test loads the changed file through a helper, one through a node process it starts, and
    // one only names its path.
    [T.hubLoaded]: `${HEAD}import { lanes } from './fixture-3065/hub.mjs';

test('the hub source is loaded through the helper', () => {
  assert.equal(lanes, 3);
});
`,
    [T.hubChild]: `${HEAD}
test('the hub source is loaded by a node process this test starts', () => {
  const result = spawnSync(process.execPath, [join(root, 'packages/hub/src/cli.mjs'), '${tokens.argument}'], { encoding: 'utf8', env: { ...process.env, T3065_SPAWN: '${tokens.environment}' } });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.equal(result.stdout.trim(), '3');
});
`,
    [T.hubNamed]: `${HEAD}
const CORE = 'packages/hub/src/core.mjs';

test('the hub source is named, and never loaded', () => {
  assert.match(CORE, /core\\.mjs$/);
});
`,
    // The canvas change: both import the helper that names the crate's binary; only one starts it.
    [T.canvasStarted]: started('./fixture-3065/show.mjs', 'SHOW', 'deep-show', tokens),
    [T.canvasNamed]: named('./fixture-3065/show.mjs', 'SHOW', 'deep-show'),
    // The three files with no row. Each names the hub source, a hub file of its own, and none loads either.
    [T.unrun]: `${HEAD}
const NAMES = ['packages/hub/src/core.mjs', 'packages/hub/src/only-unrun.mjs', 'deep-show'];

test('a file the unit lane never runs', () => {
  assert.equal(NAMES.length, 3);
});
`,
    [T.skipped]: `${HEAD}
const NAMES = ['packages/hub/src/core.mjs', 'packages/hub/src/only-skipped.mjs'];

test('a file whose only test is skipped', { skip: 'planted by tests/acceptance/3065: this file is skipped' }, () => {
  assert.equal(NAMES.length, 2);
});
`,
    [T.killed]: `${HEAD}
const NAMES = ['packages/hub/src/core.mjs', 'packages/hub/src/only-killed.mjs'];

test('a file whose process is killed', () => {
  assert.equal(NAMES.length, 2);
  // Its own process only, by its PID.
  process.kill(process.pid, 'SIGKILL');
});
`,
  };
}

/** `argv` in the fixture, in its own process group; resolves with its result, or with null once `ms` have passed. */
async function run(box, fx, argv, ms, extra = {}) {
  const child = launch(box, argv, { cwd: fx.cwd, env: { ...fx.env, ...extra } });
  let timer;
  // A hang ends as a failure: the child is then stopped by its process group's PID.
  const result = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), ms); })]); // deadline: bounds the wait for the child
  clearTimeout(timer);
  if (!result) stop(child);
  return result;
}

const made = new Map();
/**
 * One fixture and one recording for a test file's process: the scratch repository, committed and clean, then
 * `node scripts/reach.mjs record` in it, once. Returns the sandbox, the fixture, the tokens and the recording run
 * (null when it did not end in RECORD_MS). `after(cleanup)` removes it and stops what it started.
 */
export function recorded() {
  if (!made.has('it')) made.set('it', (async () => {
    const box = sandbox({ after: (fn) => cleanups.push(fn) });
    const tokens = Object.fromEntries(['content', 'argument', 'environment'].map((kind) => [kind, `t3065-${kind}-${randomBytes(8).toString('hex')}`]));
    const { cwd } = tree(box, files(box, tokens));
    const tmp = join(box.dir, 'tmp');
    mkdirSync(tmp, { recursive: true });
    // #1115's cargo stub is not put on PATH: cargo is real (#2820's sandbox).
    const fx = { cwd, env: { TMPDIR: tmp } };
    const record = await run(box, fx, [process.execPath, 'scripts/reach.mjs', 'record'], RECORD_MS, { T3065_ENV: tokens.environment });
    return { box, fx, tokens, record };
  })());
  return made.get('it');
}
const cleanups = [];
export function cleanup() {
  for (const fn of cleanups.splice(0).reverse()) fn();
}

const shown = (run) => (run ? dump(run) : 'it did not end in its time and was stopped');

/** The sandbox's ~/.deepbuild/reach/: its .json files. */
export function recordFiles(box) {
  const folder = join(box.home, '.deepbuild', 'reach');
  return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('.json')).map((name) => join(folder, name)) : [];
}

/** The one record the recording run wrote: its path, its text and its JSON. Fails at an assertion when there is none. */
export function theRecord({ box, record }) {
  const found = recordFiles(box);
  assert.equal(found.length, 1, `the recording run left ${found.length} records under ~/.deepbuild/reach/ of its HOME, not the one <tree>.json the issue names\nnode scripts/reach.mjs record:\n${shown(record)}`);
  const text = readFileSync(found[0], 'utf8');
  let json;
  try { json = JSON.parse(text); } catch {}
  assert.ok(json && typeof json === 'object', `${found[0]} is not a JSON document:\n${text.slice(0, 600)}`);
  return { path: found[0], text, json };
}

/**
 * A test file's rows in the record, wherever they sit: each value under a key that is the file's path, and each
 * object one of whose own values is the file's path. The path is the repository's, as affected.mjs prints it, or the
 * same file's absolute path.
 */
export function rowsOf(fx, json, file) {
  const is = (text) => typeof text === 'string' && (text === file || text === join(fx.cwd, file));
  const rows = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node) && Object.values(node).some(is)) rows.push(Object.fromEntries(Object.entries(node).filter(([, value]) => !is(value))));
    for (const [key, value] of Object.entries(node)) {
      if (!Array.isArray(node) && is(key)) rows.push(value);
      walk(value);
    }
  };
  walk(json);
  return rows;
}

/** Every string a value holds, at any depth. */
export function strings(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(strings);
}

/** The workspace binary a string names: the name itself, or a path that ends in it, as target/debug/deep-hook. */
export const binaryIn = (text) => BINARIES.find((name) => text === name || text.endsWith(`/${name}`)) ?? null;
/** The workspace binaries a test file's rows list. */
export const binariesOf = (fx, json, file) => [...new Set(rowsOf(fx, json, file).flatMap(strings).map(binaryIn).filter(Boolean))].sort();
/** The repository files a test file's rows list, as repository paths. */
export const filesOf = (fx, json, file) => [...new Set(rowsOf(fx, json, file).flatMap(strings).filter((text) => !binaryIn(text))
  .map((text) => (isAbsolute(text) ? relative(fx.cwd, text) : text)))].sort();
/** Whether a string of a row is a path of the fixture's checkout: a file there, relative to it or absolute. */
export const isRepoPath = (fx, text) => {
  const at = resolve(fx.cwd, text);
  return !relative(fx.cwd, at).startsWith('..') && existsSync(at);
};

export const show = (value) => JSON.stringify(value, null, 1);

/** `node scripts/affected.mjs --list <paths>` in the fixture: the test files it selects, its crates and its WIDE line. */
export async function listed({ box, fx }, paths) {
  const result = await run(box, fx, [process.execPath, 'scripts/affected.mjs', '--list', ...paths], READ_MS);
  assert.ok(result, `node scripts/affected.mjs --list ${paths.join(' ')} did not end in ${READ_MS / 60_000} min`);
  assert.equal(result.status, 0, `node scripts/affected.mjs --list ${paths.join(' ')} failed\n${dump(result)}`);
  const lines = result.stdout.split('\n');
  const tests = lines.flatMap((line) => line.match(/^(?:parallel|alone|timed|slow) (?:vitest|node): (.*?)(?: \(--\w+ runs them\))?$/)?.[1].split(' ') ?? []);
  const byHand = lines.flatMap((line) => line.match(/^SKIP (\S+) \(/)?.[1] ?? []);
  const crates = lines.flatMap((line) => line.match(/^parallel cargo test: (.*)$/)?.[1].split(' ') ?? []);
  return { tests: [...tests, ...byHand].sort(), crates, wide: lines.filter((line) => line.startsWith('WIDE ')), stdout: result.stdout };
}

// A count is the whole number directly before its label, as "5 selected" or "4 recorded as reaching", or directly
// after it behind a colon or an equals sign, as "selected: 5" (README: Surfaces this suite assumes).
// Count and label share a line.
const WORDS = '(?:(?:tests?|files?|test files|of them|recorded|as|are|were|was|is)[ \\t]+)*';
const LABELS = { selected: 'selected', reaching: '(?<!\\bnot[ \\t]+)reaching', notReaching: 'not[ \\t]+reaching' };
function count(stdout, label) {
  const found = [...stdout.matchAll(RegExp(`(?<![\\w.,/-])(\\d+)[ \\t]+${WORDS}${LABELS[label]}\\b`, 'gi')), ...stdout.matchAll(RegExp(`\\b${LABELS[label]}[ \\t]*[:=][ \\t]*(\\d+)\\b`, 'gi'))].map(([, digits]) => Number(digits));
  return [...new Set(found)];
}

/**
 * `node scripts/reach.mjs compare <paths>` in the fixture, with the three counts it prints. Fails at an assertion when
 * a count is missing or printed with two values.
 */
export async function compare({ box, fx }, paths) {
  const result = await run(box, fx, [process.execPath, 'scripts/reach.mjs', 'compare', ...paths], READ_MS);
  const said = `node scripts/reach.mjs compare ${paths.join(' ')}:\n${shown(result)}`;
  assert.ok(result, said);
  const counts = {};
  for (const [label, words] of [['selected', 'selected'], ['reaching', 'recorded as reaching'], ['notReaching', 'recorded as not reaching']]) {
    const found = count(result.stdout, label);
    assert.equal(found.length, 1, `compare printed ${found.length ? `${found.length} different counts (${found.join(', ')})` : 'no count'} labelled "${words}"\n${said}`);
    [counts[label]] = found;
  }
  return { ...counts, said };
}
