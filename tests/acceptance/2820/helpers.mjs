// Helpers for #2820's acceptance tests. Written blind from issue #2820, AGENTS.md (Proof), docs/parallel-proof.md
// sections 5 ("Binaries for tests"), 6 and 7a, at base f17fa347c. Nothing here imports the code under test: this
// checkout's real scripts/ run in a scratch git repository made by #1115's tree(), with a small Cargo workspace of
// bin crates, a HOME of the test's own (so ~/deepbuild-shards is the sandbox's) and a throttle table of its own
// (DEEP_THROTTLE_TABLE), whose `log` the tests read. cargo and rustc are real (README).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, dump, sandbox as sandbox1115, tree, write } from '../1115/helpers.mjs';
import { start } from '../2574/helpers.mjs';

export { dump, start };
export { hold, started, until } from '../1115/helpers.mjs';

/** How long one affected.mjs run is given: its builds are seconds, but the machine may be loaded. */
export const RUN_MS = 10 * 60_000;
export const TEST = { timeout: RUN_MS + 3 * 60_000 };
// docs/parallel-proof.md, section 6: the build class has 1 slot on the Mac, 2 on the Spark (Linux).
export const BUILD_SLOTS = process.platform === 'darwin' ? 1 : 2;

// Where rustup's proxies live when cargo isn't on PATH.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];
const RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');

/**
 * #1115's sandbox (its own HOME, removed after the test, every process it started stopped by its group's PID), with
 * a throttle table of its own under DEEP_THROTTLE_TABLE, and cargo as a developer runs it: no target folder, wrapper,
 * jobserver or profile setting from this process (CARGO_BUILD_JOBS, a job count only, is kept), the real toolchains,
 * and a CARGO_HOME of the sandbox's, so no user cargo config applies.
 */
export function sandbox(t) {
  const box = sandbox1115(t);
  for (const name of Object.keys(box.env)) {
    if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$)/.test(name) && name !== 'CARGO_BUILD_JOBS') delete box.env[name];
    if (/^DEEP_(?:SHARDS|TEST_GRANT_WAIT|TEST_SHARD_FLOOR|BIN_DIR|AFFECTED_HELD)$/.test(name)) delete box.env[name];
  }
  box.table = join(box.dir, 'throttle');
  box.env.DEEP_THROTTLE_TABLE = box.table;
  box.env.PATH = [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter);
  box.env.RUSTUP_HOME = RUSTUP_HOME;
  box.env.CARGO_HOME = join(box.dir, 'cargo');
  return box;
}

const pkg = (name) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n`;

/**
 * A Cargo workspace of one bin crate per entry of `bins` (name -> main.rs), with no dependencies, and its Cargo.lock,
 * made by cargo itself (offline) in a folder of the sandbox's, so the fixture can commit it and build --locked.
 */
export function workspace(box, bins) {
  const files = { 'Cargo.toml': `[workspace]\nresolver = "2"\nmembers = [${Object.keys(bins).map((name) => `"crates/${name}"`).join(', ')}]\n` };
  for (const [name, main] of Object.entries(bins)) {
    files[`crates/${name}/Cargo.toml`] = pkg(name);
    files[`crates/${name}/src/main.rs`] = main;
  }
  const scratch = join(box.dir, `lock-${Object.keys(bins).join('-')}`);
  mkdirSync(scratch, { recursive: true });
  write(scratch, files);
  const result = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: scratch, env: box.env, encoding: 'utf8' });
  assert.equal(result.status, 0, `cargo can't run in the sandbox, so nothing can build: ${result.error?.message ?? result.stderr}`);
  return { ...files, 'Cargo.lock': readFileSync(join(scratch, 'Cargo.lock'), 'utf8') };
}

/** A main.rs that prints `line`. */
export const prints = (line) => `fn main() {\n    println!("${line}");\n}\n`;
/** A main.rs that doesn't compile. */
export const BROKEN = 'fn main() {\n    let planted: u32 = "a type error planted by tests/acceptance/2820";\n    println!("{planted}");\n}\n';

/**
 * The scratch repository: #1115's tree (this checkout's scripts/, the lint lane's own scripts stubbed, node_modules
 * linked) with `files` committed, and the env the run gets: the sandbox's TMPDIR, the planted tests' record file and
 * a shard disk floor of 0 (so the machine's free space doesn't refuse a sandbox shard). #1115's cargo stub is not put
 * on PATH: cargo is real.
 */
export function fixture(box, files, extra = {}) {
  const { cwd } = tree(box, { '.gitignore': 'node_modules\n/target\n', ...files });
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const record = join(box.dir, 'record.jsonl');
  return { cwd, record, env: { TMPDIR: tmp, T2820_RECORD: record, DEEP_TEST_SHARD_FLOOR: '0', ...extra } };
}

// What every planted test starts with: its checkout (the folder up from it that holds Cargo.toml) and a note().
const head = (file) => `import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'Cargo.toml')) && dirname(root) !== root) root = dirname(root);
const note = (fields) => appendFileSync(process.env.T2820_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, root, pid: process.pid, at: Date.now(), ...fields }) + '\\n');
`;

// The build an acceptance helper starts itself (as tests/acceptance/935/helpers.ts does), with the helpers' profile:
// CARGO_INCREMENTAL=0 and CARGO_PROFILE_DEV_DEBUG=0 unless the environment says otherwise.
const build = (bin) => `spawnSync('cargo', ['build', '--locked', '--bin', '${bin}'], {
    cwd: root,
    env: { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' },
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })`;
const built = `const compiling = (result.stderr ?? '').split('\\n').filter((line) => /^\\s*Compiling /.test(line));
  note({ event: 'built', status: result.status, compiling, error: result.error?.message ?? null, stderr: (result.stderr ?? '').trim().split('\\n').slice(-6).join('\\n') });
  assert.equal(result.status, 0, result.stderr);`;

/** A node --test file that runs `cargo build --locked --bin <bin>` itself in its checkout, noting cargo's output. */
export const selfBuilding = (file, bin) => `${head(file)}
test('the planted binary builds in this checkout', () => {
  note({ event: 'start' });
  const result = ${build(bin)};
  ${built}
});
`;

/** A helper module a test imports, whose exported function runs `cargo build --locked --bin <bin>` in `root`. */
export const buildingHelper = (bin) => `import { spawnSync } from 'node:child_process';

/** Builds the planted binary in the checkout \`root\`, as an acceptance helper does. */
export function buildPlanted(root) {
  return ${build(bin)};
}
`;
/** A node --test file whose build is started by the helper it imports from `specifier`. */
export const helperBuilding = (file, specifier) => `${head(file)}import { buildPlanted } from '${specifier}';

test('the planted binary builds in this checkout, through its helper', () => {
  note({ event: 'start' });
  const result = buildPlanted(root);
  ${built}
});
`;

/** A node --test file that runs <bin> from DEEP_BIN_DIR, noting what it found and what the binary printed. */
export const binDirReading = (file, bin) => `${head(file)}
test('the planted binary runs from DEEP_BIN_DIR', () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const path = dir ? join(dir, '${bin}') : null;
  const exists = Boolean(path && existsSync(path));
  note({ event: 'start', dir, exists });
  const result = exists ? spawnSync(path, [], { encoding: 'utf8' }) : null;
  note({ event: 'ran', status: result?.status ?? null, stdout: result?.stdout?.trim() ?? null });
  assert.ok(exists, 'no ${bin} in DEEP_BIN_DIR');
  assert.equal(result.status, 0);
});
`;

/** A node --test file that touches no Rust binary. */
export const plain = (file) => `${head(file)}
test('a planted test that needs no binary passes', () => {
  note({ event: 'start' });
  assert.equal(1, 1);
});
`;

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
/** The planted tests' notes. */
export const record = (fixture) => lines(fixture.record);
/** The sandbox table's `log`, in order. */
export const throttleLog = (box) => lines(join(box.table, 'log'));
export const show = (log) => log.map((event) => JSON.stringify(event)).join('\n');

/** affected.mjs on `paths` in the fixture, in its own process group; resolves with its result, or fails at RUN_MS. */
export async function affected(box, fx, paths, extra = {}) {
  const child = start(box, { cwd: fx.cwd, env: { ...fx.env, ...extra } }, paths);
  let timer;
  const result = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), RUN_MS); })]);
  clearTimeout(timer);
  assert.ok(result, `affected.mjs did not end within ${RUN_MS / 60_000} min\nstdout so far:\n${child.out().slice(-3_000)}`);
  return result;
}

/** Everything a failure message shows: the run, the table's log and the planted tests' notes. */
// The TIMED line lists the real timed files, so it is left out to keep the run's own lines in the message.
export const evidence = (run, box, fx) => `${dump({ ...run, stdout: run.stdout.split('\n').filter((line) => !line.startsWith('TIMED ')).join('\n') })}\nthrottle log (${join(box.table, 'log')}):\n${show(throttleLog(box))}\nplanted tests' notes:\n${record(fx).map((e) => JSON.stringify(e)).join('\n')}`;

/**
 * The criterion's order in the log: the run's one build grant granted, then released, then its test grant granted.
 * Returns the test grant's event.
 */
export function buildBeforeTest(log, all) {
  const tests = log.filter((e) => e.event === 'granted' && e.class === 'test' && e.grant === 'top-level');
  assert.ok(tests.length >= 1, `the run took no top-level test grant\n${all}`);
  const testAt = log.indexOf(tests[0]);
  const builds = log.filter((e) => e.event === 'granted' && e.class === 'build');
  assert.equal(builds.length, 1, `the run's log shows ${builds.length} build grants granted, not the one the run builds its binaries under\n${all}`);
  const grantedAt = log.indexOf(builds[0]);
  const releasedAt = log.findIndex((e) => e.event === 'released' && e.id === builds[0].id);
  assert.ok(grantedAt < testAt, `the run's build grant was granted after its test grant\n${all}`);
  assert.ok(releasedAt >= 0, `the run's build grant ${builds[0].id} was never released\n${all}`);
  assert.ok(releasedAt < testAt, `the run's build grant ${builds[0].id} was released after its test grant was granted\n${all}`);
  return tests[0];
}

/** The planted test's own build in `root`: it ran, succeeded and cargo printed no Compiling line. */
export function compiledNothing(fx, root, all) {
  const builds = record(fx).filter((e) => e.event === 'built' && e.root === root);
  assert.ok(builds.length >= 1, `no planted test built in ${root}, so the run proves nothing\n${all}`);
  for (const b of builds) {
    assert.equal(b.status, 0, `the planted test's own cargo build in ${root} failed\n${all}`);
    assert.deepEqual(b.compiling, [], `the planted test's own cargo build in ${root} compiled crates: ${b.compiling.join(' | ')}\n${all}`);
  }
}

/** The last line of the output that starts with a state, as the run ends on. */
export const finalState = (stdout) => stdout.split('\n').map((line) => line.match(/^(PASS|NO NEW FAILURES|FAIL|BLOCKED|INCONCLUSIVE|INVALID)\b/)?.[1]).filter(Boolean).at(-1) ?? null;

const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * `count` folders of lanes.mjs's alone list where a planted `<name>.mjs` is its own alone group: neither exclusive,
 * timed, slow, left to a person nor in a lane of its own. The lists are read by a child, so a missing one fails here.
 */
export function aloneFolders(count, name) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
    console.log(JSON.stringify(Object.fromEntries(['alone', 'exclusive', 'timed', 'slow', 'byHand', 'ownLane'].map((list) => [list, lanes[list] ?? []]))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  const lists = JSON.parse(result.stdout.trim().split('\n').at(-1));
  const folders = lists.alone.filter((entry) => {
    const file = `${entry}${name}.mjs`;
    return /^tests\/.+\/$/.test(entry) && [...lists.exclusive, ...lists.alone].find((other) => covers([other], file)) === entry
      && ![lists.timed, lists.slow, lists.byHand, lists.ownLane].some((list) => covers(list, file));
  });
  assert.ok(folders.length >= count, `scripts/lanes.mjs's alone list has ${folders.length} folders a planted file runs alone in, not ${count}`);
  return folders.slice(0, count);
}
