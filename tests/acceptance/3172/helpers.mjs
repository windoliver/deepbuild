// Helpers for #3172's acceptance tests: which machine this is, a temporary folder per test, running a process, a small
// cargo workspace of `harness = false` targets run by the real cargo, and the reader: the checkout's own `cargoResults`
// and `crates` of scripts/lanes.mjs, the lane's reader of a cargo test run. The reader runs in a process of its own, so
// a missing export or a throw reads as an assertion failure here, never as an import error (README: The surface).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** This machine, as an evidence record names one (`<platform>-<arch>`). */
export const PLATFORM = `${process.platform}-${process.arch}`;
/** The note a test skips with where it can't prove its criterion: unrun, so never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs) => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;
/** A note that names a platform the machine lacks, as lanes.mjs reads one (its PLATFORM pattern). */
export const namesPlatform = (note) => typeof note === 'string' && !note.startsWith('BLOCKED') && /\b(?:macOS|Linux|darwin|Metal|GPU|platform)\b/i.test(note);
/** A cold build of the fixture takes seconds; a hang still ends. */
export const MINUTES = { timeout: 10 * 60_000 };

/** A folder removed after the test, and the environment its cargo runs in: the machine's cargo, a target of its own. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3172-')));
  const env = { ...process.env };
  for (const name of ['CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET', 'RUSTFLAGS', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const box = { dir, env, children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/**
 * Runs `argv` in its own process group to its end: its status, and its output with stderr and stdout in the one stream,
 * in the order written, as the lane's log holds a run (cargo names a target on stderr, the target prints on stdout).
 */
export function run(argv, { cwd = CHECKOUT, env = process.env, box } = {}) {
  const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'sh', ...argv], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box?.children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, output }));
  });
}

/** The fixture's one package, so each target's ID is `cargo -p fixture-3172 --test <target>`. */
export const PACKAGE = 'fixture-3172';
const BESIDE = 'fixture-3172-beside';
export const idOf = (target) => `cargo -p ${PACKAGE} --test ${target}`;

/** The reasons the fixture's targets give, as the Spark's 19 targets give theirs. */
export const REASON = {
  inconclusive: "the fixture's renderer runs on macOS only, so nothing ran",
  blocked: "the fixture's record is missing, so no row was read",
};

/**
 * The fixture's `harness = false` targets, each a `main` that prints its lines and exits 1, as the Spark's targets do.
 * `plain_failure` prints a line that isn't `<its name>: <state>; …`; `borrowed_line` prints another target's line.
 */
export const TARGETS = {
  inconclusive_target: [`inconclusive_target: INCONCLUSIVE; ${REASON.inconclusive}`],
  blocked_target: [`blocked_target: BLOCKED; ${REASON.blocked}`],
  plain_failure: ['plain_failure: the fixture could not open its window'],
  borrowed_line: [`inconclusive_target: INCONCLUSIVE; ${REASON.inconclusive}`],
};

const main = (lines) => `fn main() {\n${lines.map((line) => `    println!(${JSON.stringify(line)});\n`).join('')}    std::process::exit(1);\n}\n`;

/**
 * A workspace of two packages: the fixture, a library with one passing test, so the run reports a pass, and the named
 * targets of TARGETS; and a library beside it with no test. With two packages cargo names a failed target by `-p` and
 * its package, as it names the real workspace's; with one it leaves `-p` out. No dependency, so cargo runs offline and
 * `--locked` holds.
 */
export function workspace(box, targets) {
  const root = join(box.dir, 'workspace');
  const files = {
    'Cargo.toml': '[workspace]\nmembers = ["fixture", "beside"]\nresolver = "2"\n',
    'Cargo.lock': `# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "${PACKAGE}"\nversion = "0.0.0"\n\n[[package]]\nname = "${BESIDE}"\nversion = "0.0.0"\n`,
    'beside/Cargo.toml': `[package]\nname = "${BESIDE}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[lib]\ndoctest = false\n`,
    'beside/src/lib.rs': 'pub fn three() -> u32 {\n    3\n}\n',
    'fixture/Cargo.toml': `[package]\nname = "${PACKAGE}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[lib]\ndoctest = false\n${targets.map((name) => `\n[[test]]\nname = "${name}"\npath = "${name}.rs"\nharness = false\n`).join('')}`,
    'fixture/src/lib.rs': 'pub fn two() -> u32 {\n    2\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn two_is_two() {\n        assert_eq!(super::two(), 2);\n    }\n}\n',
    ...Object.fromEntries(targets.map((name) => [`fixture/${name}.rs`, main(TARGETS[name])])),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The lane's cargo test command at the base (`unit` in scripts/lanes.mjs), run whole on the fixture. */
export const CARGO_TEST = ['cargo', 'test', '--workspace', '--locked', '--no-fail-fast'];

// cargoResults and crates are what the lane itself reads a cargo test run with (testsOf in scripts/lanes.mjs).
const READER = `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, cwd, log, status] = process.argv.slice(2);
const { cargoResults, crates } = await import(pathToFileURL(join(checkout, 'scripts/lanes.mjs')).href);
console.log(JSON.stringify(cargoResults(readFileSync(log, 'utf8'), Number(status), crates(cwd))));
`;

/** What the checkout's lanes.mjs reads of a cargo test run's output and status, for the workspace at `cwd`. */
export async function read(box, cwd, output, status) {
  const log = join(box.dir, `run-${box.children.length}.log`), reader = join(box.dir, 'reader.mjs');
  // The lane reads its log trimmed (runLanes).
  writeFileSync(log, output.trim());
  writeFileSync(reader, READER);
  const ran = await run([process.execPath, reader, CHECKOUT, cwd, log, String(status)], { cwd, env: box.env, box });
  assert.equal(ran.status, 0, `scripts/lanes.mjs's cargoResults and crates read the run:\n${ran.output}`);
  return JSON.parse(ran.output.trim().split('\n').at(-1));
}

/** Builds and runs the lane's cargo test on a fixture of these targets, and reads it as the lane does. */
export async function fixtureRun(t, targets) {
  const box = sandbox(t);
  const root = workspace(box, targets);
  const ran = await run(CARGO_TEST, { cwd: root, env: box.env, box });
  const results = await read(box, root, ran.output, ran.status ?? 1);
  const all = `$ ${CARGO_TEST.join(' ')}  (exit ${ran.status})\n${ran.output.trim()}\n--- cargoResults\n${JSON.stringify(results, null, 1)}`;
  // The fixture's library test passed, so cargo built and ran the workspace; its targets failed, so the run exits 101.
  assert.ok(results.passed?.some((id) => id.endsWith(' › tests::two_is_two')), `the fixture's run reports its library's passing test\n${all}`);
  assert.notEqual(ran.status, 0, `the fixture's targets exit 1, so cargo test fails\n${all}`);
  for (const name of targets) assert.ok(ran.output.includes(`Running ${name}.rs`), `cargo ran ${name}\n${all}`);
  return { ...results, all };
}

/** The failures a run reads of one target: its own ID, or a test under it. */
export const ofTarget = (failures, id) => failures.filter((failure) => failure.id === id || failure.id.startsWith(`${id} › `));

/** The Spark's whole-workspace cargo test at 0c73a8a4 (#1121's evidence): its output and exit, as the lane got them. */
export function sparkRun() {
  const text = readFileSync(join(CHECKOUT, 'docs/evidence/1121/spark-test-0c73a8a4.txt'), 'utf8').trimEnd().split('\n');
  assert.match(text[0], /^\$ cargo test --workspace --locked --no-fail-fast\b/, 'the evidence starts with the command it ran');
  const exit = text.at(-1).match(/^exit (\d+)$/);
  assert.ok(exit, 'the evidence ends with the exit status');
  return { output: text.slice(1, -1).join('\n'), status: Number(exit[1]) };
}

/** The 19 targets the issue names, each by the arguments that rerun it, with the state and reason its line gives. */
export const SPARK_TARGETS = [
  ['-p deep-app --test spike_402', 'INCONCLUSIVE', "the app's headless renderer runs on macOS only"],
  ...[
    ['acceptance_1425', 'the replica draws on macOS only, so nothing ran'],
    ['acceptance_1425_ac3', 'the headless app needs macOS, so nothing ran'],
    ['acceptance_1454_panel_redraft', 'the headless app needs macOS, so nothing ran'],
    ['acceptance_1620_planted_loader', 'the window needs macOS, so nothing ran'],
    ['acceptance_326_panels', 'window captures need macOS, so nothing ran'],
    ['acceptance_326_panels_planted', 'window captures need macOS, so nothing ran'],
    ['acceptance_326_panels_planted_redraft', 'window captures need macOS, so nothing ran'],
    ['acceptance_326_panels_redraft', 'the headless app needs macOS, so nothing ran'],
    ['acceptance_326_surfaces', "the replica runs on macOS only, so none of #326's surface checks ran"],
    ['acceptance_327_card', "the replica runs on macOS only, so none of #327's card checks ran"],
    ['acceptance_327_planted', 'the replica runs on macOS only, so nothing ran'],
    ['acceptance_883', "the replica runs on macOS only, so none of #883's checks ran"],
    ['acceptance_883_ac3_redraft', "the replica runs on macOS only, so the case didn't run"],
    ['acceptance_994_sound', 'the replica runs on macOS only, so nothing ran'],
    ['acceptance_994_window', 'the replica runs on macOS only, so nothing ran'],
    ['card_size', 'the replica draws on macOS only, so nothing ran'],
    ['headless', 'the replica renders pixels on macOS only, so none of the #338 checks ran'],
  ].map(([name, reason]) => [`-p deep-replica --test ${name}`, 'INCONCLUSIVE', reason]),
  ['-p deep-replica --test acceptance_992_app', 'BLOCKED', 'the replica runs on macOS only, so no sidebar row was read'],
];
