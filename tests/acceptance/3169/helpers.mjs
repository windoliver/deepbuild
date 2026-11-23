// Helpers for #3169's acceptance tests: which machine this is, the named tests by their cargo targets, a run of those
// targets with the issue's Proof command, and that run read by scripts/lanes.mjs's own readers (cargoResults, crates,
// readRun, isPlatform), in a child process. Nothing here imports the code under test: a reader that can't load reads
// as an assertion failure, never as an import error (README: The surface).
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** This machine, as an evidence record names one. */
export const PLATFORM = `${process.platform}-${process.arch}`;
/** wgpu's GPU backend is Metal on macOS only (crates/deep-gpu/src/device.rs: "The platform's own GPU: Metal on macOS"). */
export const METAL = process.platform === 'darwin';
/**
 * The reference Mac a same-machine hash of #3016's criterion 5 was read on at the base: the model its fixture names
 * (`"model": "Mac17,10"`), read here as a constant so a test never reaches into #3016's files by path.
 */
export const REFERENCE_MAC = 'Mac17,10';
/** This machine's model (`hw.model`); '' where sysctl has no such key. */
export const model = () => {
  try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};
/** The note a test skips with on a machine that can't prove its criterion: unrun, never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs) => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;
export const HOURS = { timeout: 6 * 3600_000 };

const PKG = 'deep-scene3d-render';
/**
 * The issue's tests, by the cargo target that runs them and their libtest names (issue: What fails). `memory` reads the
 * device's held memory; `hash` compares a same-machine hash. The issue counts nine; it names these eight.
 */
export const NAMED = [
  { target: 'held_memory', name: 'a_scene_that_stopped_using_them_holds_none_of_their_memory', kind: 'memory' },
  { target: 'held_memory', name: 'a_frame_no_post_module_reads_the_key_lights_map_in_holds_no_map', kind: 'memory' },
  { target: 'held_memory', name: 'a_scene_with_no_label_holds_no_glyph_atlas', kind: 'memory' },
  { target: 'acceptance_3016_metal', name: 'ac3_the_third_scene_holds_the_scene_once_and_each_views_own_targets', kind: 'memory' },
  { target: 'acceptance_3016_metal', name: 'ac7_the_estimate_counts_what_each_view_holds', kind: 'memory' },
  { target: 'acceptance_3016_views', name: 'ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes', kind: 'memory' },
  { target: 'acceptance_3016_metal', name: 'ac5_a_view_insets_frame_hashes_as_on_the_merge_base', kind: 'hash' },
  { target: 'acceptance_3016_views', name: 'ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame', kind: 'hash' },
];
/** A named test's ID as cargoResults gives it: `cargo <the arguments that rerun its target> › <name>`. */
export const idOf = ({ target, name }) => `cargo -p ${PKG} --test ${target} › ${name}`;
/** The issue's Proof command, narrowed to the three targets that hold the named tests. */
export const COMMAND = ['cargo', 'test', '-p', PKG, '--locked', '--no-fail-fast', ...[...new Set(NAMED.map(({ target }) => target))].flatMap((target) => ['--test', target])];

/** Runs `argv` in its own process group, stderr merged into stdout in the order written (cargo names targets on stderr). */
function run(argv, t) {
  const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'sh', ...argv], { cwd: CHECKOUT, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Only the process this test started, by its process group's PID.
  t.after(() => { if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stdout += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout }));
  });
}

// The lane's own readers of a cargo test run: cargoResults over cargo metadata's targets, then readRun, as the unit lane
// reads a command, with isPlatform's verdict on each skip's note.
const READER = `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, log, status] = process.argv.slice(2);
const { cargoResults, crates, readRun, isPlatform, timed } = await import(pathToFileURL(join(checkout, 'scripts/lanes.mjs')).href);
const results = cargoResults(readFileSync(log, 'utf8'), Number(status), crates(checkout));
const read = readRun(results, Number(status), checkout, timed);
console.log(JSON.stringify({ results, tests: read.tests.map((row) => ({ ...row, platform: row.skipped ? isPlatform(row.note ?? '') : false })) }));
`;

/**
 * The Proof command's run here, read through lanes.mjs: the raw output, the exit status, cargoResults' results and
 * readRun's rows (each skipped row with `platform`, isPlatform's reading of its note). `error` when the reader failed.
 */
export async function proofRun(t) {
  const ran = await run(COMMAND, t);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3169-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'cargo-test.log'), reader = join(dir, 'reader.mjs');
  writeFileSync(log, ran.stdout);
  writeFileSync(reader, READER);
  const read = await run([process.execPath, reader, CHECKOUT, log, String(ran.status ?? 1)], t);
  let parsed;
  try { parsed = JSON.parse(read.stdout.trim().split('\n').at(-1)); } catch { return { ...ran, error: `lanes.mjs didn't read the run (exit ${read.status}): ${read.stdout.slice(-2000)}` }; }
  return { ...ran, ...parsed };
}

/** What libtest printed for a failed test: its `---- <name> stdout ----` section of the run's output, '' without one. */
export function section(output, name) {
  const at = output.indexOf(`---- ${name} stdout ----`);
  if (at < 0) return '';
  const rest = output.slice(at + 1);
  const end = rest.search(/\n---- |\nfailures:\n|\ntest result: /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** A failed test's panic: its location line and the message after it, for a message. */
export function panicOf(output, name) {
  const lines = section(output, name).split('\n');
  const at = lines.findIndex((line) => /panicked/.test(line));
  return at < 0 ? '' : lines.slice(at, at + 2).map((line) => line.trim()).join(' ');
}
