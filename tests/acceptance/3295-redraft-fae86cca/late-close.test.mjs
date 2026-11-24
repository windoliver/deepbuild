// Blind redraft of #3295.fae86cca (README: The dispute): deep-hook's late-close cli test
// (`a_call_whose_agent_closes_stdin_late_is_decided_and_spooled_without_waiting_for_it` in crates/deep-hook/tests/cli.rs)
// run through `cargo test -p deep-hook --test cli --locked` on the first draft's starved stand-in, and read as the lanes
// read cargo's output (scripts/lanes.mjs, cargoResults, #3100).
//
// The test, its stand-in and its assertions are the first draft's (../3295/late-close.test.mjs), unchanged. That file
// exports nothing, and importing it would register its three tests here, so the few helpers the test needs are carried
// over as they are there. What this folder adds is the planted wrong program in twins.json, a twin of product source.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The test the issue names. */
const LATE = 'a_call_whose_agent_closes_stdin_late_is_decided_and_spooled_without_waiting_for_it';
/** The issue's command, narrowed to that one test. */
const COMMAND = ['cargo', 'test', '-p', 'deep-hook', '--test', 'cli', '--locked', '--', '--exact', LATE];
/** What cargo needs of the workspace to build deep-hook: its manifests, sources, patches and the files they include. */
const WORKSPACE = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'crates', 'vendor', 'tests', 'adapters'];
const MAIN = 'crates/deep-hook/src/main.rs';
/** A cold build of deep-hook takes minutes on a loaded machine; the file runs under the lanes' 20-minute cap. */
const LONG = { timeout: 19 * 60_000 };
/** deep-hook's RULING_LIMIT, and the issue's number of tries. */
const RULING_LIMIT_S = 0.5;
const TRIES = 20;

// The lines the stand-in adds to, each matched at exactly one place of the checkout's main.rs.
const FORWARD = 'fn forward(agent: &str, event: &str) -> ExitCode {';
const RULES_READ = '    READ_RULES.store(true, Ordering::SeqCst);';

let bench;
after(() => {
  // Only the processes this file started, by their process group's PID.
  for (const child of bench?.children ?? []) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  if (bench) rmSync(bench.dir, { recursive: true, force: true });
});

/** The copy: the workspace by copy-on-write where the disk can, its own target folder and HOME. */
function workbench() {
  if (bench) return bench;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3295-')));
  const src = join(dir, 'src'), home = join(dir, 'home');
  mkdirSync(src);
  mkdirSync(home);
  bench = { dir, src, children: [], queue: Promise.resolve() };
  for (const entry of WORKSPACE) {
    if (!existsSync(join(CHECKOUT, entry))) continue;
    const flags = process.platform === 'darwin' ? ['-cR'] : ['-R', '--reflink=auto'];
    const copied = spawnSync('cp', [...flags, join(CHECKOUT, entry), src], { encoding: 'utf8' });
    if (copied.status !== 0) throw Error(`copying ${entry} of the checkout failed: ${copied.stderr}`);
  }
  rmSync(join(src, 'target'), { recursive: true, force: true });
  bench.main = readFileSync(join(src, MAIN), 'utf8');
  bench.env = {
    ...process.env, HOME: home, CARGO_TARGET_DIR: join(dir, 'target'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
  };
  return bench;
}

/** Runs `argv` in the copy, in its own process group, to its end: its status and stdout with stderr as written. */
function run(argv) {
  const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'sh', ...argv], { cwd: bench.src, env: bench.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  bench.children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

/** `text` with `added` after the one line equal to `line`, which must be there once. */
function after1(text, line, added) {
  const lines = text.split('\n');
  const at = lines.flatMap((held, index) => (held === line ? [index] : []));
  if (at.length !== 1) throw Error(`${MAIN} holds ${at.length} lines ${line}, not one: the stand-in can't be built`);
  lines.splice(at[0] + 1, 0, ...added);
  return lines.join('\n');
}

/** A line that appends `start` to `log` each time the hook starts, so a run shows how many tries it made. */
const logStart = (log) => `    let _ = std::fs::OpenOptions::new().create(true).append(true).open(${JSON.stringify(log)}).and_then(|mut file| std::io::Write::write_all(&mut file, b"start\\n"));`;

/**
 * The late-close test run by the issue's command on a deep-hook built from the checkout's main.rs as `edit` makes it,
 * read as the lanes read it: its state (PASS, or the failure's state), its panic's first line, how long the test
 * binary ran, and how many times the hook started.
 */
function late(name, edit) {
  const ran = workbench().queue.then(async () => {
    const log = join(bench.dir, `${name}.starts`);
    writeFileSync(join(bench.src, MAIN), edit(bench.main, log));
    const { status, output } = await run(COMMAND);
    const lanes = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);
    bench.workspace ??= lanes.crates(bench.src);
    const results = lanes.cargoResults(output, status, bench.workspace);
    const id = (entry) => entry.endsWith(` › ${LATE}`);
    const failure = results.failures.find(({ id: failed }) => id(failed));
    const state = results.passed.some(id) ? 'PASS' : failure ? failure.state : 'NOT RUN';
    const seconds = Number(output.match(/^test result: .*; finished in ([\d.]+)s$/m)?.[1] ?? NaN);
    const starts = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
    const lines = output.split('\n');
    const at = lines.findIndex((line) => line.startsWith('failures:'));
    const why = (at >= 0 ? lines.slice(at, at + 30) : lines.slice(-30)).join('\n');
    return { state, message: failure?.message ?? '', seconds, starts, why: `${name}: ${state} in ${seconds}s, ${starts} hook starts\n${why}` };
  });
  bench.queue = ran.catch(() => {});
  return ran;
}

test('#3295.fae86cca the late-close test reads INCONCLUSIVE, never FAIL or PASS, on a deep-hook given no time to read its call', LONG, async () => {
  // The starved stand-in: its main thread reads rules.json (none here, so no fail_closed entry holds the call), then
  // waits past RULING_LIMIT before it reads the call, so the watchdog lets the call through unspooled with exit 0 at
  // 500 ms, as on the loaded Spark.
  const ran = await late('starved', (text, log) => after1(after1(text, FORWARD, [logStart(log)]), RULES_READ, [
    '    std::thread::sleep(RULING_LIMIT + std::time::Duration::from_millis(300));',
  ]));
  assert.ok(ran.starts >= 1, `the stand-in hook ran:\n${ran.why}`);
  assert.notEqual(ran.state, 'PASS', `the late-close test never passes on a hook that never read its call:\n${ran.why}`);
  assert.equal(ran.state, 'INCONCLUSIVE', `the lanes read the late-close test INCONCLUSIVE, not FAIL, on a hook given no time to read its call:\n${ran.why}`);
  assert.match(ran.message, /^INCONCLUSIVE: \S/, `its panic starts INCONCLUSIVE: and goes on:\n${ran.why}`);
  assert.match(ran.message, /no time|starv|500 ?ms|RULING_LIMIT|watchdog|CPU/i, `its panic names the reason, a hook given no time to read its call:\n${ran.why}`);
  assert.ok(ran.starts >= TRIES, `it panicked only after ${TRIES} tries, each starting the hook (it started ${ran.starts}):\n${ran.why}`);
  assert.ok(ran.seconds >= TRIES * RULING_LIMIT_S, `each try ended at or after 500 ms, so ${TRIES} take at least ${TRIES * RULING_LIMIT_S}s (the test ran ${ran.seconds}s):\n${ran.why}`);
});
