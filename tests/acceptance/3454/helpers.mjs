// Shared by the #3454 acceptance tests. The comment ratchet is reached only through the lint lane's command for it,
// taken from `scripts/lanes.mjs`'s exported `checks` and run as a process with cwd at the checkout it checks, and
// `scripts/comment-only.mjs <path>` is run as a process the same way (README: Surfaces). Scratch repositories live under
// the realpathed system temporary folder and are removed in t.after. The planted comments, timers and URLs below are
// text these tests write into scratch files.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SCRIPT = 'scripts/comment-ratchet.mjs';
export const CEILINGS = 'scripts/comment-ceilings.json';
export const ONLY = 'scripts/comment-only.mjs';
export const lint = checks.find(({ name }) => name === 'lint');

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** A lint command that runs `script` with node, as the lane lists it. */
export const runsScript = (command, script) => [process.execPath, 'node'].includes(command[0]) && command[1] === script;

/** The lint lane's command for the comment ratchet; the test fails here when the lane has none. */
export function guardCommand() {
  const command = lint?.commands.find((candidate) => runsScript(candidate, SCRIPT));
  // The node path is left out of the message, so no local path lands in the evidence.
  assert.ok(command, `the lint lane runs no ${SCRIPT}; its node commands are ${JSON.stringify(lint?.commands.filter((c) => c[0] === process.execPath).map((c) => c.slice(1).join(' ')))}`);
  return command;
}

/** `scripts/comment-only.mjs` in this checkout; the test fails here when there is none. */
export function onlyScript() {
  assert.ok(existsSync(join(root, ONLY)), `this checkout has no ${ONLY}`);
  return ONLY;
}

const run = (cwd, program, args) => {
  const started = performance.now();
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }); // deadline: turns a hung script into a failure of this test; nothing waits on it to pass
  const seconds = (performance.now() - started) / 1000;
  const stdout = result.stdout ?? '';
  return { ...result, stdout, seconds, lines: stdout.split('\n') };
};

/** Runs the lane's comment-ratchet command with cwd at `cwd`, with `extra` arguments after the lane's own. */
export function guard(cwd, ...extra) {
  const [program, ...args] = guardCommand();
  return run(cwd, program === 'node' ? process.execPath : program, [...args, ...extra]);
}

/** Runs `node scripts/comment-only.mjs <path>` with cwd at `cwd`. */
export const commentOnly = (cwd, path) => run(cwd, process.execPath, [onlyScript(), path]);

export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ''}${result.error ? `\nerror: ${result.error.message}` : ''}`;

/** A whole number as the line may print it, with or without a thousands comma: 1601 or 1,601. */
export const number = (n) => new RegExp(`(?<![\\d,])${String(n).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`);
const fails = (result) => result.lines.filter((line) => line.startsWith('FAIL '));

/** A pass: exit 0, a PASS line, and no line in another state (a silent exit 0 is not a pass). */
export function assertPasses(result, why = '') {
  assert.equal(result.status, 0, `${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS ')), `no PASS line ${why}\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), `${why}\n${show(result)}`);
}

/** A FAIL: exit 1 and one FAIL line naming the file, its count of comment lines and its ceiling. */
export function assertFails(result, path, count, ceiling, why = '') {
  assert.equal(result.status, 1, `${why}\n${show(result)}`);
  const named = fails(result).some((line) => line.includes(path) && number(count).test(line) && number(ceiling).test(line));
  assert.ok(named, `no FAIL line naming ${path}, its count ${count} and its ceiling ${ceiling} ${why}\n${show(result)}`);
}

/** A FAIL: exit 1 and a FAIL line holding `path`. */
export function assertFailsNaming(result, path, why = '') {
  assert.equal(result.status, 1, `${why}\n${show(result)}`);
  assert.ok(fails(result).some((line) => line.includes(path)), `no FAIL line naming ${path} ${why}\n${show(result)}`);
}

/** No FAIL line names `path`: a finding elsewhere doesn't spill onto a file that holds its ceiling or is out of scope. */
export function assertNotNamed(result, path) {
  assert.ok(!fails(result).some((line) => line.includes(path)), `a FAIL line names ${path}, which holds its ceiling or is out of scope\n${show(result)}`);
}

export const ceilings = (entries) => `${JSON.stringify(entries, null, 2)}\n`;
/** The scratch repository's ceilings as its file holds them now. */
export const listedIn = (cwd) => JSON.parse(readFileSync(join(cwd, CEILINGS), 'utf8'));

/**
 * A scratch git repository holding a copy of every flat file in this checkout's scripts/ and a link to its
 * node_modules (the guard may load the `typescript` package), both hidden from git's listing by .git/info/exclude, and
 * `files`, committed with origin/main at that commit. The ceilings file is force-added, since it sits in the hidden
 * folder.
 */
export function repo(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-comments-3454-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  appendFileSync(join(cwd, '.git', 'info', 'exclude'), '\n/scripts/\n/node_modules\n');
  mkdirSync(join(cwd, 'scripts'));
  for (const name of readdirSync(join(root, 'scripts')))
    if (statSync(join(root, 'scripts', name)).isFile()) copyFileSync(join(root, 'scripts', name), join(cwd, 'scripts', name));
  symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
  for (const [path, content] of Object.entries(files)) put(cwd, path, content);
  git(cwd, 'add', '-A');
  if (Object.hasOwn(files, CEILINGS)) git(cwd, 'add', '-f', CEILINGS);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

/** Writes `content` at `path` in the scratch repository, as an uncommitted edit or an untracked file. */
export function put(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

/** Removes `path` from the scratch repository's work tree, so the next plant runs without it. */
export const drop = (cwd, path) => rmSync(join(cwd, path), { force: true });

/** Commits the scratch repository's work tree on top of its base; origin/main stays at the base. */
export function commit(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

const PLANT = 'a planted comment';
const text = (lines) => `${lines.filter((line) => line !== null).join('\n')}\n`;
const padded = (count, line) => Array.from({ length: count }, (_, i) => line(String(i + 1).padStart(2, '0'), i + 1));

/**
 * A listed TypeScript file. Its comment lines: a three-line block, a comment after code, a line comment, a block on its
 * own line, a block inside a line of code, and `tail` constants each with a comment after it. 7 + `tail` in all, so 23.
 */
export const LISTED = 'packages/fixture/src/totals.ts';
export const LISTED_COUNT = 23;
export const listed = ({ tail = 16, plant = false } = {}) => text([
  '/**',
  ' * Totals for one run.',
  ' */',
  'export interface Totals {',
  '  passed: number; // tests that passed',
  '  failed: number;',
  '}',
  '',
  '// The empty totals.',
  'export const EMPTY: Totals = { passed: 0, failed: 0 };',
  '',
  'export function add(a: Totals, b: Totals): Totals {',
  '  /* field by field */',
  plant ? `  // ${PLANT}` : null,
  '  return { passed: a.passed + b.passed, failed: a.failed /* both */ + b.failed };',
  '}',
  '',
  ...padded(tail, (id, n) => `export const K${id} = ${n}; // unit ${n}`),
]);

/**
 * A listed Rust file. Its comment lines: a line comment, a three-line block, a comment after code, and nine constants
 * each with a comment after it: 14 in all. The `//` in its string is on a line with no comment.
 */
export const RUST = 'crates/fixture/src/lib.rs';
export const RUST_COUNT = 14;
export const rust = ({ plant = false } = {}) => text([
  '// Sums the counts a run reports.',
  'pub const HOME: &str = "https://example.invalid//x";',
  '',
  'pub fn total(counts: &[u32]) -> u32 {',
  '    /* every count,',
  '       in order,',
  '       saturating */',
  plant ? `    // ${PLANT}` : null,
  '    counts.iter().fold(0, |sum, count| sum.saturating_add(*count)) // never wraps',
  '}',
  '',
  ...padded(9, (id, n) => `pub const R${id}: u32 = ${n}; // unit ${n}`),
]);

/**
 * A listed WGSL file. Its comment lines: a line comment, a comment after code, a two-line block, and thirteen constants
 * each with a comment after it: 17 in all. With `comments` false it holds the same code and no comment.
 */
export const WGSL = 'crates/fixture/src/fill.wgsl';
export const WGSL_COUNT = 17;
export const wgsl = ({ plant = false, comments = true } = {}) => text([
  comments ? '// The fill of one quad.' : null,
  'struct Fill {',
  `  color: vec4<f32>,${comments ? ' // straight alpha' : ''}`,
  '}',
  '',
  comments ? '/* Halves the alpha' : null,
  comments ? '   of a fill. */' : null,
  'fn half(fill: Fill) -> vec4<f32> {',
  plant ? `  // ${PLANT}` : null,
  '  let alpha = fill.color.a / 2.0;',
  '  return vec4<f32>(fill.color.rgb, alpha);',
  '}',
  '',
  ...padded(13, (id, n) => `const W${id}: f32 = ${n}.0;${comments ? ` // unit ${n}` : ''}`),
]);

export const BASE_CEILINGS = { [LISTED]: LISTED_COUNT, [RUST]: RUST_COUNT, [WGSL]: WGSL_COUNT };

/** The scratch repository every plant starts from: the three listed files, each at its ceiling, and `more`. */
export const base = (t, more = {}) => repo(t, { [LISTED]: listed(), [RUST]: rust(), [WGSL]: wgsl(), [CEILINGS]: ceilings(BASE_CEILINGS), ...more });

/** The reference Macs (technical design: Speed). */
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];

/**
 * Why a wall-clock budget read here doesn't count, or null on a reference Mac on mains power with Low Power Mode off and
 * the thermal state nominal, as tests/acceptance/159/helpers.ts's environmentProblem reads it.
 */
export function environmentProblem() {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const read = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).trim(); // deadline: turns a hung system tool into "cannot read the machine"
  let model, chip, gib, battery, power, thermal;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    battery = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    thermal = read('pmset', '-g', 'therm');
  } catch (error) {
    return `cannot read the machine: ${error.message.split('\n')[0]}`;
  }
  if (!REFERENCE_MACS.some((mac) => mac.model === model && mac.chip === chip && mac.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(battery)) return `not on mains power: ${battery.split('\n')[0]}`;
  const low = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!low) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (low[1] !== '0') return 'Low Power Mode is on';
  const limited = [...thermal.matchAll(/_Limit\s*=\s*(\d+)/g)].some((match) => Number(match[1]) < 100);
  if (limited || !/No thermal warning level/.test(thermal)) return `thermal state not nominal: ${thermal.replace(/\s+/g, ' ')}`;
  return null;
}
