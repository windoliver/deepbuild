// A reading of what the selected tests really run (#3065). affected.mjs selects a test by what its sources name, an
// upper bound; this records what one run started and loaded, and counts the gap for a change. It changes no selection.
//
//   node scripts/reach.mjs record [test file ...]   run the unit lane's test files, or those named, each in a job of
//                                                   its own, and write ~/.deepbuild/reach/<tree>.json
//   node scripts/reach.mjs compare <path ...>       the tests affected.mjs selects for the change, by that record
//
// A row is a test file's: the workspace binaries its processes started, whether one started cargo, which builds every
// crate it is asked for, and the repository source files its node processes loaded (NODE_V8_COVERAGE's file list):
// paths and names only. A file that didn't run whole and pass has no row: it failed, was skipped in part, was stopped,
// was never started, or one of its node processes left no coverage (killed, or still running at its end), and `compare`
// counts it as reaching the change. A record is one run's, of one tree; a recording of the same tree adds to it, so a
// part of the lane can be recorded at a time.
//
// What a row can't show, each of which reads as not reaching: a binary seen only when a node process names it in a
// command it starts (reach-preload.cjs) or it starts from DEEP_BIN_DIR, so not one another program starts by a path
// of its own, one started under another name, or a crate that is loaded, not started (a cdylib); a file a test reads
// without running it; code that runs outside node, as a page's script or a script built into a binary; and whatever
// a node process loads once a program between it and the test cleaned or replaced its environment (env -i), in a
// worker thread given an environment of its own, or in a sandbox that can't write the job's folder; and a script
// vitest.config.ts imports, which vite builds into the config it loads.
import { spawn } from 'node:child_process';
import { chmodSync, globSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, constants, homedir, loadavg, tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerOf, select } from './affected.mjs';
import { alone, checks, crates, exactTree, exclusive, listed, reportResults } from './lanes.mjs';
import { binaryNames, buildBinaries, commandFiles } from './proof-binaries.mjs';
import { listFiles } from './proof-change.mjs';
import { childEnv } from './proof-runs.mjs';
import { acquire, descendants, killTree, release } from './throttle.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const PRELOAD = join(root, 'scripts/reach-preload.cjs');
// A file's job is stopped after an hour: the lane's files run in minutes, and a hung one would hold the recording.
const FILE_MS = 60 * 60_000;
const recordPath = (tree) => join(homedir(), '.deepbuild', 'reach', `${tree}.json`);
const within = (folder, path) => path === folder || path.startsWith(`${folder}/`);

/**
 * The repository source file a loaded path stands for, or null: the file itself, the source a package's build file
 * was built from, or, for a path outside the checkout, the repository file it copies by its path, as a scratch tree's
 * scripts/lanes.mjs does.
 */
function sourceOf(path, tracked) {
  const at = relative(root, path).split(sep).join('/');
  const known = (file) => {
    if (tracked.has(file)) return file;
    const stem = file.replace(/^(packages\/[^/]+)\/dist\//, '$1/src/').replace(/\.[cm]?js$/, '');
    return ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'].map((extension) => stem + extension).find((candidate) => tracked.has(candidate)) ?? null;
  };
  if (at.split('/').includes('node_modules')) return null;
  if (!at.startsWith('..')) return known(at);
  const parts = path.split(sep);
  for (let from = 1; from < parts.length - 1; from++) {
    const found = known(parts.slice(from).join('/'));
    if (found) return found;
  }
  return null;
}

/**
 * A job's row from what it left: the names started, of `names`, and the tracked files its coverage lists. Each node
 * process noted itself as it started (reach-preload.cjs), so one that left no coverage, or coverage cut short, is
 * known: the job then has `why` and no row, since what that process loaded is unknown.
 */
function rowOf(dir, names, tracked) {
  let noted = [];
  try { noted = readFileSync(join(dir, 'started'), 'utf8').split('\n').filter(Boolean); } catch {}
  // Each thread by `<pid>-<thread>`, as its coverage-<pid>-<time>-<thread>.json names it.
  const pids = new Set(noted.filter((line) => line.startsWith('pid ')).map((line) => line.slice(4)));
  const started = noted.filter((line) => !line.startsWith('pid ')).map((path) => basename(path));
  const files = new Set();
  let coverage = [];
  try { coverage = readdirSync(join(dir, 'coverage')); } catch {}
  for (const name of coverage) {
    let result;
    try { ({ result } = JSON.parse(readFileSync(join(dir, 'coverage', name), 'utf8'))); } catch {}
    if (!Array.isArray(result)) return { why: `a node process of its job left coverage that can't be read (${name})` };
    pids.delete(`${name.split('-')[1]}-${name.split('-')[3]?.replace('.json', '')}`);
    for (const { url } of result) {
      let path = null;
      try { path = url.startsWith('file:') ? fileURLToPath(url) : url.startsWith('/') ? url.replace(/\?.*$/, '') : null; } catch {}
      const file = path && path !== PRELOAD && sourceOf(path, tracked);
      if (file) files.add(file);
    }
  }
  if (pids.size) return { why: `${pids.size} node ${pids.size === 1 ? 'thread' : 'threads'} of its job left no coverage: killed, or still running` };
  return { row: { binaries: [...new Set(started.filter((name) => names.has(name)))].sort(), ...(started.includes('cargo') && { cargo: true }), files: [...files].sort() } };
}

// A DEEP_BIN_DIR of the job's own: each binary's name there notes its start and becomes the binary, so a start by any
// program is seen.
const quoted = (text) => `'${text.replaceAll("'", "'\\''")}'`;
function shims(dir, bin, names) {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  for (const name of names) {
    writeFileSync(join(dir, 'bin', name), `#!/bin/sh\necho ${quoted(name)} >> ${quoted(join(dir, 'started'))}\nexec ${quoted(join(bin, name))} "$@"\n`);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  return join(dir, 'bin');
}

// The unit lane's test files (lanes.mjs): what its vitest commands list and what its node --test command names.
function laneFiles() {
  const unit = checks.find(({ name }) => name === 'unit').commands;
  const named = unit.flatMap((command) => commandFiles(root, command)).flatMap((file) => (file.includes('*') ? globSync(file, { cwd: root }) : [file]));
  return [...new Set(named.map((file) => relative(root, realpathSync(resolve(root, file))).split(sep).join('/')))].sort();
}

async function record(args) {
  const started = performance.now();
  const tree = exactTree(root);
  if (!tree) return console.log('BLOCKED reach: the checkout has no tree git can write, so a record has no name'), 3;
  let files, names, workspace;
  try {
    files = args.length ? args.map((file) => relative(root, realpathSync(resolve(file))).split(sep).join('/')) : laneFiles();
    workspace = crates(root);
    names = binaryNames(root, files);
  } catch (error) {
    return console.log(`${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED reach: '}${error.message}`), 3;
  }
  // One test grant for the whole recording, as an affected.mjs run takes (docs/parallel-proof.md, section 6); its
  // binaries' build passes through on it.
  const wait = Number(process.env.DEEP_TEST_GRANT_WAIT ?? '30');
  let grant;
  try { grant = acquire('test', { wait }); } catch (error) { return console.log(`BLOCKED throttle: ${error.message}`), 3; }
  if (!grant) return console.log(`INCONCLUSIVE no grant: no test grant came within ${wait} min; nothing was recorded`), 2;
  process.env.DEEP_THROTTLE = grant.token;
  const live = new Set();
  // Why the recording ends early, and its exit status: a signal, an error, or a tree that moved under it. Its jobs are
  // stopped and no more start.
  let stopped = null, run;
  const halt = (why, status) => {
    stopped ??= { why, status };
    for (const stop of live) stop();
  };
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => halt(`was stopped by ${signal}`, 128 + constants.signals[signal]));
  try {
    run = mkdtempSync(join(tmpdir(), 'deep-reach-'));
    const bin = buildBinaries(root, join(run, 'built'), names, undefined, { timeout: 0 });
    const tracked = new Set(listFiles(root));
    const known = new Set([...workspace.flatMap((crate) => crate.names), ...names]);
    const path = recordPath(tree);
    // This recording's rows, null for a file that ended with none; a save lays them over the record as it then is, so
    // two recordings of one tree keep each other's rows.
    const mine = new Map();
    let moved;
    let saved = performance.now(), held = null;
    // A row is the tree's it was recorded on, so a save writes only while the checkout's tree is the recording's. A
    // test's own passing file moves it for a while, so a save that finds another tree only waits for the next; the
    // last, with every job ended, decides.
    const save = () => {
      if ((moved = exactTree(root)) !== tree) return false;
      let rows = {};
      try { rows = JSON.parse(readFileSync(path, 'utf8')).tests ?? {}; } catch {}
      for (const [file, row] of mine) if (row) rows[file] = row; else delete rows[file];
      const next = `${path}.${process.pid}.next`;
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(next, `${JSON.stringify({ tree, tests: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 1)}\n`);
      renameSync(next, path);
      [saved, held] = [performance.now(), Object.keys(rows).length];
      return true;
    };
    let at = 0, kept = 0;
    const one = async (file) => {
      const dir = join(run, String(at++)), report = join(dir, 'report.jsonl');
      mkdirSync(join(dir, 'coverage'), { recursive: true });
      const vitest = runnerOf(file, readFileSync(join(root, file), 'utf8')) === 'vitest';
      const command = vitest ? ['node_modules/vitest/vitest.mjs', 'run', '--reporter=dot', '--reporter=./scripts/proof-vitest-reporter.mjs', file]
        : ['--test', '--test-reporter=./scripts/proof-reporter.mjs', `--test-reporter-destination=${report}`, '--test-reporter=dot', '--test-reporter-destination=stdout', file];
      // The recording is the test's alone: the lease that holds its cpu.slot runs outside it.
      const recording = { NODE_V8_COVERAGE: join(dir, 'coverage'), DEEP_REACH: join(dir, 'started'), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(PRELOAD)}`.trim() };
      const log = openSync(join(dir, 'log'), 'w');
      const result = await new Promise((done) => {
        const child = spawn(join(root, 'scripts/lease'), ['env', ...Object.entries(recording).map(([key, value]) => `${key}=${value}`), process.execPath, ...command], { cwd: root, stdio: ['ignore', log, log], env: childEnv({ DEEP_BIN_DIR: shims(dir, bin, names), DEEP_PROOF_VITEST_REPORT: report }) });
        let why = null;
        // Every process of the job, by PID and start, as affected.mjs stops a job that stands still.
        const stop = (reason = `the recording ${stopped.why}`) => {
          why ??= reason;
          let below = [];
          try { below = descendants(child.pid); } catch {}
          child.kill('SIGKILL');
          try { killTree(below); } catch {}
        };
        live.add(stop);
        const bound = setTimeout(() => stop(`it ran past ${FILE_MS / 60_000} min and was stopped`), FILE_MS); // deadline: bounds one file's job
        const end = (status, signal) => { clearTimeout(bound); live.delete(stop); done({ status, why: why ?? (signal ? `its job was stopped by ${signal}` : null) }); };
        child.on('error', (error) => { why ??= String(error); end(null, null); });
        child.on('close', end);
      });
      closeSync(log);
      let text = '';
      try { text = readFileSync(report, 'utf8'); } catch {}
      const { failures, passed, skips = [] } = reportResults(root, text, vitest ? 'vitest' : 'node');
      const left = rowOf(dir, known, tracked);
      const why = result.why ?? (failures.length ? `${failures[0].state} ${failures[0].id}: ${failures[0].message}` : result.status !== 0 ? `its job exited ${result.status}` : skips.length ? `${skips.length} of its tests ${skips.length === 1 ? 'was' : 'were'} skipped` : passed.length ? left.why ?? null : 'it reported no test');
      // A job the recording itself stopped says nothing of its file, whose earlier row stands.
      if (!stopped || !why) mine.set(file, why ? null : left.row);
      if (!why) kept++;
      console.log(why ? `NO ROW ${file}: ${why}` : `ROW ${file}: ${left.row.files.length} files${left.row.binaries.length ? `, ${left.row.binaries.join(' ')}` : ''}${left.row.cargo ? ', cargo' : ''}`);
      // A process the test leaked may still write there; the run's folder goes at the end.
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      if (!stopped && performance.now() - saved > 60_000) save();
    };
    // The files lanes.mjs runs alone build or time what a sibling would disturb, so they run after the rest, one at a time.
    const serial = files.filter((file) => listed(alone, file) || listed(exclusive, file)), queue = files.filter((file) => !serial.includes(file));
    const worker = async (from) => {
      while (from.length && !stopped) try { await one(from.shift()); } catch (error) { halt(`was ended by an error: ${error.message}`, 3); }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.floor(availableParallelism() / 2)) }, () => worker(queue)));
    await worker(serial);
    // A recording stopped by a signal keeps the rows it has; one whose tree moved keeps none past its last save.
    // git can fail once on a file a leaked process is removing, so the last look is taken up to three times.
    const written = stopped?.status !== 3 && (save() || save() || save());
    if (!stopped && !written) halt(`ended on ${moved ? `another tree, ${moved},` : 'a tree git could not write'} than the ${tree} it started on (git status names the files), so the rows since its last save are of no known tree and are dropped`, 3);
    console.log(`${stopped ? `BLOCKED reach: the recording ${stopped.why}; ` : ''}${kept} of ${files.length} test files ran whole and passed, ${files.length - kept} have no row, in ${((performance.now() - started) / 1000).toFixed(0)} s at load ${loadavg()[0].toFixed(0)}: ${held === null ? `nothing was saved to ${path}` : `${path} holds ${held} rows`}`);
    return stopped?.status ?? 0;
  } catch (error) {
    return console.log(`${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED reach: '}${error.message}`), error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  } finally {
    release(grant);
    if (run) try { rmSync(run, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Whether a row reaches a changed path, and whether a record could tell: a file its node processes loaded, or a file
 * of a crate whose binary, or a binary built on it, the test started, since a crate's change reaches its binary whole.
 * A test that started cargo built what it asked for, so it reaches every crate. Null for a path no row can show: one
 * that is neither code node runs nor a crate's.
 */
function reaches(row, path, workspace) {
  const owners = workspace.filter((crate) => (within(crate.dir, path) && !path.endsWith('.md')) || (path.endsWith('.rs') && crate.away.some((folder) => within(folder, path))));
  const code = /\.(?:[cm]?[jt]s|tsx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
  if (!owners.length && !code) return null;
  const built = new Set(owners.map((crate) => crate.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const crate of workspace) if (!built.has(crate.name) && crate.deps.some((dep) => built.has(dep))) {
      built.add(crate.name);
      grew = true;
    }
  }
  const binaries = workspace.filter((crate) => built.has(crate.name)).flatMap((crate) => crate.names);
  return (code && row.files.includes(path)) || (owners.length > 0 && (row.cargo === true || row.binaries.some((name) => binaries.includes(name))));
}

function compare(paths) {
  if (!paths.length) return console.log('usage: node scripts/reach.mjs compare <path ...>'), 3;
  const workspace = crates(root);
  const selection = select(root, paths, { workspace });
  const tree = exactTree(root);
  let rows = null;
  try { rows = JSON.parse(readFileSync(recordPath(tree), 'utf8')).tests; } catch {}
  console.log(rows ? `record: ${recordPath(tree)}` : `record: none for this tree (${tree}); every selected test counts as reaching`);
  const unseen = paths.filter((path) => selection.every.includes(path) || reaches({ binaries: [], files: [] }, path, workspace) === null);
  for (const path of unseen) console.log(`NOTE ${path} ${selection.every.includes(path) ? 'feeds every suite' : "is neither code node runs nor a crate's file"}, so no row can show a test reading it; every selected test counts as reaching`);
  const noRow = [], not = [];
  for (const test of selection.tests) {
    if (!rows?.[test]) noRow.push(test);
    else if (!unseen.length && !paths.some((path) => reaches(rows[test], path, workspace))) not.push(test);
  }
  const selected = selection.tests.length;
  console.log(`selected: ${selected}`);
  console.log(`recorded as reaching: ${selected - not.length}, of which ${noRow.length} have no row and count as reaching`);
  console.log(`recorded as not reaching: ${not.length}`);
  if (selected) console.log(`never reach the change, by the record: ${(100 * not.length / selected).toFixed(1)}% of the selected`);
  if (selection.crates.length) console.log(`crates, run by cargo test and not counted: ${selection.crates.join(' ')}`);
  if (selection.wide.length) console.log(`WIDE, left out as affected.mjs leaves them: ${selection.wide.length}`);
  for (const test of not) console.log(`NOT REACHED ${test}`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  process.exitCode = command === 'record' ? await record(args) : command === 'compare' ? compare(args) : (console.log('usage: node scripts/reach.mjs record [test file ...] | compare <path ...>'), 3);
}
