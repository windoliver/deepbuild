// Fails before, and the mutation lane (#569): each tagged test runs on the change, on the merge base
// in a temporary checkout, on the planted wrong programs its criterion names, and against mutants of
// the lines the change adds. Results come from the runner's report, never from its output.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addedLines, git, isTestFile, listFiles, named, outsideTests, RUNNER_CONFIG, show, spans, tagsIn, tagsWithImports, TEST_DATA, testImports, testPattern, underTestPaths } from './proof-change.mjs';

const REPORTER = pathToFileURL(fileURLToPath(new URL('./proof-reporter.mjs', import.meta.url))).href;
const VITEST_REPORTER = fileURLToPath(new URL('./proof-vitest-reporter.mjs', import.meta.url));
const BEFORE_FIX = 'Make each tagged test fail on the merge base at its assertion, or name a planted wrong program its criterion fails in tests/acceptance/<issue>/twins.json; a merge base that cannot install is repaired on main.';
const MUTATION_FIX = 'Assert what the criterion names so a mutant of the added lines fails its tests, or name a planted wrong program in tests/acceptance/<issue>/twins.json; install the tool a BLOCKED line names.';

// Every temporary folder of a run lies in one folder of its own. A run stopped by a signal can't
// remove it, so a watcher outside the run's process group does once the run's process is gone.
let runFolder = null;
export function temporary(prefix) {
  if (!runFolder) {
    runFolder = realpathSync(mkdtempSync(join(tmpdir(), 'deep-proof-run-')));
    spawn('sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; rm -rf "$2"', 'sh', String(process.pid), runFolder], { detached: true, stdio: 'ignore' }).unref();
  }
  return mkdtempSync(join(runFolder, prefix));
}
export function removeTemporaries() {
  if (runFolder) rmSync(runFolder, { recursive: true, force: true });
  runFolder = null;
}

/** The environment for the runs: a lane's own `node --test` must not report to a parent runner. */
export function childEnv(extra = {}) {
  const environment = { ...process.env, ...extra };
  delete environment.NODE_TEST_CONTEXT;
  // A test under a mutant that runs the lanes itself mustn't hand that mutant to their own runs.
  delete environment.__STRYKER_ACTIVE_MUTANT__;
  return environment;
}

const firstLine = (text) => String(text).split('\n').map((line) => line.trim()).find(Boolean) ?? '';

/** A temporary checkout of `rev` from `git archive`, so the repository's worktrees and refs stay as they were. */
export function checkout(root, rev, prefix) {
  const directory = temporary(prefix);
  const result = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -xf - -C "$3"', 'sh', root, rev, directory], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(`git archive ${rev} failed: ${firstLine(result.stderr)}`);
  return directory;
}

const within = (directory, path) => path === directory || path.startsWith(`${directory}/`);

/** Makes room for the file `to` in the checkout at `directory`, never through a link out of it; returns its path. */
export function place(directory, to) {
  const target = join(directory, to);
  // A write through a link, such as into the repository's node_modules, would change files outside;
  // where the nearest existing folder really is shows it before anything is made.
  let existing = dirname(target);
  while (!existsSync(existing)) existing = dirname(existing);
  const parent = realpathSync(existing);
  if (!within(directory, parent)) throw Error(`${to} leads out of the checkout, to ${parent}`);
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  return target;
}

function copy(root, path, directory, to = path) {
  const source = join(root, path), target = place(directory, to);
  if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), target);
  else copyFileSync(source, target);
}

/**
 * A temporary copy of the change as the worktree holds it, laid out as the merge base's checkout is:
 * no .git, and a node_modules folder whose entries link to the repository's (StrykerJS's sandbox
 * reads no node_modules that is itself a link). A workspace package's relative link is made anew, so
 * it reaches the copy's own package.
 */
function copyChange(root, prefix) {
  const directory = temporary(prefix);
  for (const path of listFiles(root)) copy(root, path, directory);
  const link = (folder) => {
    mkdirSync(join(directory, folder), { recursive: true });
    for (const name of readdirSync(join(root, folder))) {
      const source = join(root, folder, name), target = join(directory, folder, name);
      if (existsSync(target)) continue;
      const stat = lstatSync(source);
      if (stat.isSymbolicLink() && !isAbsolute(readlinkSync(source))) symlinkSync(readlinkSync(source), target);
      else if (stat.isDirectory() && name.startsWith('@') && folder === 'node_modules') link(join(folder, name));
      // A tool's cache, such as vitest's in .vite, is the copy's own, so no run writes the repository's.
      else if (stat.isDirectory() && name.startsWith('.') && name !== '.bin') mkdirSync(target);
      else symlinkSync(source, target);
    }
  };
  if (existsSync(join(root, 'node_modules'))) link('node_modules');
  return directory;
}

/**
 * Makes a checkout one the tests can read as they read the repository: a .git of its own holding the
 * repository's refs at the change's HEAD (objects read from the repository, never written there), and
 * the workspaces' builds. Every side gets the same, so a test can't tell them apart by either.
 * Returns why the build failed, or null.
 */
function prepare(root, change, directory) {
  const common = resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim());
  git(directory, ['init', '-q', '--template=', directory]);
  writeFileSync(join(directory, '.git/objects/info/alternates'), `${join(common, 'objects')}\n`);
  const refs = git(root, ['for-each-ref', '--format=%(objectname) %(refname)']).split('\n').filter(Boolean).map((row) => `create ${row.split(' ')[1]} ${row.split(' ')[0]}`);
  git(directory, ['update-ref', '--stdin'], { input: `${refs.join('\n')}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  git(directory, ['update-ref', '--no-deref', 'HEAD', change.head]);
  git(directory, ['read-tree', 'HEAD']);
  return build(directory);
}

const workspaces = (directory) => existsSync(join(directory, 'package.json')) && Boolean(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).workspaces);

/** The change in a prepared copy: its directory, and why it can't run there, or null. */
export function changeCopy(root, change) {
  const directory = copyChange(root, 'deep-proof-checkout-');
  const blocked = prepare(root, change, directory);
  undoBuild(root, directory);
  return { directory, blocked };
}

/**
 * Undoes what the change's build wrote in a checkout it ran in, but its output: puts back every file
 * the change holds but those in `keep`, as the mutants StrykerJS writes, and removes any it added that
 * a test run reads as a test's own or as the run's setup: a test, a script under the test paths or a
 * file there a resolver tries first for want of an extension, a runner config, a package, as under a
 * node_modules the copy doesn't link to the repository's, or a link, which can lead a test's imports
 * anywhere. Data it generates, such as a table a test reads, stays.
 */
export function undoBuild(root, directory, keep = []) {
  const held = listFiles(root).filter((path) => !keep.includes(path));
  // Names compare in lower case, as a disk that ignores case resolves Support.json for support.json.
  const tracked = new Set(listFiles(root).map((path) => path.toLowerCase()));
  const heldName = (path) => tracked.has(path.toLowerCase());
  // A json file a resolver tries before a tracked module of its stem, or before a tracked folder's index.
  const stems = new Set([...tracked].flatMap((path) => [path.replace(/\.[cm]?[jt]sx?$/, ''), ...path.split('/').slice(1).map((_, at) => path.split('/').slice(0, at + 1).join('/'))]));
  const shadows = (path) => /\.json$/i.test(path) && stems.has(path.slice(0, -'.json'.length).toLowerCase());
  const walk = (folder) => {
    for (const entry of readdirSync(join(directory, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (path === '.git') continue;
      // The copy's node_modules links to the repository's packages, scope by scope, as copyChange laid it.
      if (folder === 'node_modules' || /^node_modules\/@[^/]+$/.test(folder)) {
        if (!existsSync(join(root, path))) rmSync(join(directory, path), { recursive: true, force: true });
        else if (entry.isDirectory() && entry.name.startsWith('@')) walk(path);
      } else if (entry.isSymbolicLink() && !heldName(path)) rmSync(join(directory, path), { force: true });
      else if (entry.isDirectory()) walk(path);
      else if (!heldName(path) && (path.split('/').includes('node_modules') || RUNNER_CONFIG.test(path) || (underTestPaths(path) && (/\.[cm]?[jt]sx?$|(?:^|\/)[^./]+$|(?:^|\/)package\.json$/i.test(path) || shadows(path))))) rmSync(join(directory, path), { force: true });
    }
  };
  walk('');
  for (const path of held) copy(root, path, directory);
}

/** The merge base installed and prepared in a temporary checkout: its directory, and why it can't run there, or null. */
export function baseCheckout(root, change) {
  const directory = checkout(root, change.base, 'deep-proof-checkout-');
  if (existsSync(join(directory, 'package.json'))) {
    const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: directory, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT });
    if (timedOut(install)) return { directory, blocked: `npm ci ${stopped(['npm ci']).get('npm ci')}` };
    if (install.status !== 0) return { directory, blocked: `npm ci failed there: ${firstLine([install.stderr, install.stdout].join('\n').split('\n').find((line) => /\bnpm (?:error|ERR!)/.test(line) && !/A complete log|^npm error\s*$/.test(line)) ?? install.stderr ?? install.error?.message).replace(/^npm (?:error|ERR!)\s*/, '')}` };
  }
  return { directory, blocked: prepare(root, change, directory) };
}

/** Builds the workspaces of the checkout in `directory`; returns why it failed, or null. */
function build(directory) {
  if (!workspaces(directory)) return null;
  const args = ['run', 'build', '--workspaces', '--if-present'];
  const result = spawnSync('npm', args, { cwd: directory, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT });
  return result.status === 0 ? null : `npm ${args.join(' ')} failed: ${firstLine(result.stderr || result.error?.message || result.stdout)}`;
}

/** The paths of a stack's frames outside the runtime and the installed packages, innermost first; a
 * path may hold spaces. */
function frames(stack, directory) {
  return [...String(stack).matchAll(/^\s*at (?:.*? \()?((?:file:\/\/)?\/.*?):\d+:\d+\)?\s*$/gm)]
    .map(([, location]) => relative(directory, location.startsWith('file:') ? fileURLToPath(location) : location))
    .filter((path) => !path.split('/').includes('node_modules'));
}

// The framework's own assertion failures: node:assert's, chai's under vitest's expect, a custom
// matcher's from expect.extend, one under .resolves or .rejects but not their TypeError for a value
// that isn't a promise, and a snapshot mismatch.
const asserted = (name = '', code = '', message = '', stack = '') => code === 'ERR_ASSERTION' || /AssertionError|JestExtendError/.test(name) || (name !== 'TypeError' && /__VITEST_(?:EXTEND_ASSERTION|RESOLVES|REJECTS)__/.test(stack)) || (name === 'Error' && /^Snapshot .* mismatched/.test(message));

// A failure is at its assertion when it is the framework's own assertion failure, thrown under the
// test paths, which a wrong program can't replace: not one the program under test raises itself.
// An assertion that caught an error, such as not.toThrow or doesNotReject, counts only when the
// caught error's stack runs through the code under test, a file of the checkout outside the test
// paths: a fix for a crash does, a call to a function the base lacks or an import of a module it
// lacks doesn't, and neither does a caught error the report gives only as text, as vitest's toThrow
// does (design: Failing on an assertion). The before lane and the mutation lane's judge both read this.
function atAssertion(directory, { name = 'Error', code, message = '', stack = '', thrown }) {
  const caught = thrown ?? (/ but got '.*'$| but '.*' was thrown$/.test(firstLine(message)) ? { stack: '' } : null);
  if (caught && !frames(caught.stack, directory).some((path) => !path.startsWith('..') && !underTestPaths(path))) return false;
  return asserted(name, code, message, stack) && underTestPaths(frames(stack, directory)[0] ?? '..');
}

function failure(directory, error) {
  const { name = 'Error', code, message = '' } = error;
  const cause = `${name}${code && !name.includes(code) ? ` [${code}]` : ''}: ${firstLine(message)}`.split(`${directory}/`).join('');
  return { atAssertion: atAssertion(directory, error), cause };
}

// A run that outlasts this is stopped, and its files count as not run, never as passed or failed.
const TIMEOUT = 20 * 60_000;
const timedOut = (result) => result.error?.code === 'ETIMEDOUT';
const stopped = (files) => new Map(files.map((file) => [file, `the run was stopped after ${TIMEOUT / 60_000} minutes`]));

// Two tests of one full name report under one key: a failure of either stands, so a passing twin of
// a failing test can't hide it, and the key counts the reports that ran and those skipped, so a twin
// can't stand for one never run.
const quiet = (status) => status === 'skip' || status === 'todo';
const keep = (results, key, result) => {
  const old = results.get(key);
  const counts = { ran: (old?.ran ?? 0) + (quiet(result.status) ? 0 : 1), skips: (old?.skips ?? 0) + (quiet(result.status) ? 1 : 0) };
  if (!old || (result.status === 'fail' && old.status !== 'fail') || (quiet(old.status) && !quiet(result.status))) results.set(key, { ...result, ...counts });
  else Object.assign(old, counts);
};

function runNode(directory, files, env) {
  const report = join(temporary('deep-proof-report-'), 'report.jsonl');
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, `--test-reporter-destination=${report}`, ...files],
    { cwd: directory, env: childEnv(env), encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT });
  const results = new Map(), fileErrors = new Map(), stacks = new Map(), stderr = new Map(), suites = new Map();
  if (timedOut(result)) return { results, fileErrors, unrunnable: stopped(files) };
  if (!existsSync(report)) return { results, fileErrors, unrunnable: new Map(files.map((file) => [file, `node --test did not run: ${firstLine(result.stderr ?? result.error?.message)}`])) };
  for (const event of readFileSync(report, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))) {
    const file = event.file && (isAbsolute(event.file) ? relative(directory, event.file) : event.file);
    if (event.type === 'stderr') stderr.set(file, (stderr.get(file) ?? '') + event.message);
    else if (event.type === 'start') stacks.set(file, [...(stacks.get(file) ?? []).slice(0, event.nesting), event.name]);
    else if (event.nesting === 0 && files.includes(event.name)) {
      // The runner's own entry for a file that failed outside every test, such as on its imports.
      if (event.type === 'fail') fileErrors.set(file, firstLine((stderr.get(file) ?? '').split('\n').find((line) => /^\w*Error\b.*:/.test(line)) ?? event.error?.message));
    } else if (event.suite) {
      if (event.type === 'fail') suites.set(file, suites.get(file) ?? `suite ${event.name}: ${firstLine(event.error?.cause?.message ?? event.error?.message)}`);
    } else {
      const name = [...(stacks.get(file) ?? []).slice(0, event.nesting), event.name].join(' › ');
      keep(results, named(file, name), { path: file, name, status: event.skip ? 'skip' : event.todo ? 'todo' : event.type, failure: event.type === 'fail' ? failure(directory, event.error ?? {}) : null });
    }
  }
  for (const [file, cause] of suites) if (!fileErrors.has(file) && ![...results.values()].some((test) => test.path === file && test.status === 'fail')) fileErrors.set(file, cause);
  for (const [file, text] of stderr) if (fileErrors.has(file)) fileErrors.set(file, (firstLine(text.split('\n').find((line) => /^\w*Error\b.*:/.test(line)) ?? fileErrors.get(file))).split(`${directory}/`).join(''));
  return { results, fileErrors, unrunnable: new Map() };
}

function runVitest(directory, files, env) {
  const results = new Map(), fileErrors = new Map();
  const vitest = join(directory, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(vitest)) return { results, fileErrors, unrunnable: new Map(files.map((file) => [file, 'vitest is not installed in the checkout'])) };
  const reports = temporary('deep-proof-report-'), report = join(reports, 'report.json'), errors = join(reports, 'errors.jsonl');
  // vitest's JSON report for what ran, and ours for how each failure failed.
  const result = spawnSync(process.execPath, [vitest, 'run', '--reporter=json', `--outputFile.json=${report}`, `--reporter=${VITEST_REPORTER}`, ...files], { cwd: directory, env: { ...childEnv(env), DEEP_PROOF_VITEST_REPORT: errors }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: TIMEOUT });
  if (timedOut(result)) return { results, fileErrors, unrunnable: stopped(files) };
  if (!existsSync(report)) return { results, fileErrors, unrunnable: new Map(files.map((file) => [file, `vitest wrote no report: ${firstLine(result.stderr)}`])) };
  const failures = new Map();
  let unhandled = null;
  for (const line of existsSync(errors) ? readFileSync(errors, 'utf8').split('\n').filter(Boolean) : []) {
    const event = JSON.parse(line);
    if (event.type === 'fail') failures.set(named(relative(directory, event.file), event.name), event.error);
    if (event.type === 'unhandled') unhandled ??= event.message;
  }
  for (const file of JSON.parse(readFileSync(report, 'utf8')).testResults ?? []) {
    const path = relative(directory, file.name);
    // A file failed with none of its tests failing failed outside them, as in a hook or on its imports.
    if (file.status === 'failed' && !file.assertionResults?.some(({ status }) => status === 'failed')) fileErrors.set(path, (firstLine(file.message) || 'failed in a hook').split(`${directory}/`).join(''));
    for (const test of file.assertionResults ?? []) {
      const name = [...test.ancestorTitles, test.title].join(' › ');
      const message = test.failureMessages?.[0] ?? '';
      const [, errorName = 'Error', text = message] = firstLine(message).match(/^(\w*Error)\b[^:]*: ?(.*)$/) ?? [];
      const status = { passed: 'pass', failed: 'fail', todo: 'todo' }[test.status] ?? 'skip';
      keep(results, named(path, name), { path, name, status, failure: status === 'fail' ? failure(directory, failures.get(named(path, name)) ?? { name: errorName, message: text, stack: message }) : null });
    }
  }
  // vitest can't say which file an uncaught error came from, so none of the run's files passes.
  if (unhandled) for (const file of files) if (!fileErrors.has(file)) fileErrors.set(file, `an error no test caught: ${firstLine(unhandled)}`);
  return { results, fileErrors, unrunnable: new Map() };
}

/**
 * Runs test files in `directory`: .mjs and .js with node --test, .ts with the checkout's vitest.
 * fileErrors holds files that failed outside every test, unrunnable those whose runner couldn't run.
 */
function runTests(directory, files, { env = {} } = {}) {
  // A runner given no file runs every test it finds, so each starts only with files of its own.
  const node = files.filter((file) => !file.endsWith('.ts')), vitest = files.filter((file) => file.endsWith('.ts'));
  const parts = [node.length && runNode(directory, node, env), vitest.length && runVitest(directory, vitest, env)].filter(Boolean);
  const merged = (key) => new Map(parts.flatMap((part) => [...part[key]]));
  return { results: merged('results'), fileErrors: merged('fileErrors'), unrunnable: merged('unrunnable') };
}

const failedAtAssertion = (result) => result?.status === 'fail' && result.failure.atAssertion;

// The twins file of a test's acceptance folder: criterion tags, each to the names of its twins.
function twinsOf(root, path) {
  const [folder] = path.match(/^tests\/acceptance\/[^/]+/) ?? [];
  const file = folder && join(root, folder, 'twins.json');
  if (!file || !existsSync(file)) return { folder, twins: {} };
  let twins;
  try {
    twins = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { folder, twins: {}, error: `${folder}/twins.json is not JSON: ${firstLine(error.message)}` };
  }
  const shaped = twins && typeof twins === 'object' && !Array.isArray(twins) && Object.values(twins).every((names) => Array.isArray(names) && names.every((name) => typeof name === 'string' && /^[\w.-]+$/.test(name) && name !== '..' && name !== '.'));
  return shaped ? { folder, twins } : { folder, twins: {}, error: `${folder}/twins.json must map each criterion tag to a list of twin folder names` };
}

/**
 * Every run the before, trace and mutation lanes read: the tagged tests (those of the change's issue,
 * and with no issue those in files the change touches), on the change, on the merge base, and on the
 * twins of each criterion a test didn't already prove on the merge base.
 */
export function prepareRuns({ root, change, issue }, { coverage = false } = {}) {
  const touched = new Set(change.whole.map(({ path }) => path));
  const counts = (tag, path) => (issue?.number ? tag.startsWith(`#${issue.number}.`) : touched.has(path));
  const files = listFiles(root).filter(isTestFile).filter((path) => tagsWithImports(root, null, path).some((tag) => counts(tag, path)));
  const empty = () => ({ results: new Map(), fileErrors: new Map(), unrunnable: new Map() });
  const runs = { files, tests: [], twins: new Map(), head: empty(), base: empty() };
  if (!files.length) return runs;
  runs.coverage = coverage ? temporary('deep-proof-coverage-') : null;
  // The merge base, with the change's test code: every file under the test paths (tests, helpers
  // wherever they are and however they're imported, fixtures, goldens, twins and setup files), never
  // code beside a colocated test, so a hollow helper the change brings in runs on both. The runner
  // config stays the merge base's, as the guard keeps it once main holds the lanes. It runs before
  // any of the change's code, as its build, can reach it.
  const { directory: base, blocked } = baseCheckout(root, change);
  // A fixture project's committed packages are its own too, as a test that runs it reads them.
  for (const path of listFiles(root)) if (underTestPaths(path) || underTestPaths(`${path.split('/node_modules/')[0]}/package.json`)) copy(root, path, base);
  if (blocked) runs.base.blocked = blocked;
  else runs.base = runTests(base, files);

  // The change runs in a copy prepared as the merge base's checkout is, so a test can't pass on the
  // change and fail on the base by telling the two places apart.
  const head = changeCopy(root, change);
  runs.directory = head.directory;
  runs.head = head.blocked ? { ...empty(), unrunnable: new Map(files.map((file) => [file, head.blocked])) } : runTests(runs.directory, files, { env: runs.coverage ? { NODE_V8_COVERAGE: runs.coverage } : {} });
  // A test the change adds or edits: its file is new, or a line the change adds or removes is in it.
  const edited = new Map(change.whole.map((file) => [file.path, file.status === 'A' ? true : [...addedLines(file), ...file.hunks.filter(({ added }) => !added.length).map(({ newStart }) => newStart)]]));
  const sourceSpans = new Map(files.map((path) => [path, spans(show(root, null, path) ?? '')]));
  const changed = ({ path, name }) => {
    const lines = edited.get(path);
    const span = sourceSpans.get(path).find((candidate) => candidate.name === name);
    return lines === true || Boolean(lines && (!span || lines.some((line) => span.start <= line && line <= span.end)));
  };
  // A test the change could have skipped as it runs, where its merge base run can't show it: one it
  // edits, or one whose file, or a file under the test paths that file imports, the change edits
  // outside every test, such as where a hook is added. Adding a test beside it is no such edit.
  const bare = (rev, file) => {
    const text = show(root, rev, file) ?? '';
    return outsideTests(text, spans(text).filter(({ leaf }) => leaf)).replace(/\s+/g, '');
  };
  const reached = new Map(files.map((path) => [path, [...testImports(root, null, path).keys()].some((file) => touched.has(file) && bare(change.base, file) !== bare(null, file))]));
  const declaredSkipped = ({ path, name }) => sourceSpans.get(path).some((span) => span.leaf && span.skipped && span.name === name);
  runs.tests = [...runs.head.results.entries()].map(([key, result]) => {
    const isChanged = changed(result);
    return { key, ...result, changed: isChanged, declaredSkipped: declaredSkipped(result), reached: isChanged || reached.get(result.path), tags: tagsIn(result.name).filter((tag) => counts(tag, result.path)) };
  }).filter(({ tags }) => tags.length);
  // A tagged test the source declares and doesn't skip must show in the runner's report: one the
  // runner never reached is no test that passed. A helper's test may run under a suite around its
  // call, so a reported name ending in the declared one counts; a test that skips itself as it runs
  // is reported, and the trace lane counts it as no test.
  // Each unskipped test the source declares of a name that registers whenever its file runs needs a
  // report that ran of its own, and the ones declared under a condition, such as the branches of an
  // if, need one between them. A skip or todo report stands for a test declared skipped first.
  // A report under suites around a helper's call stands for its test, never one under another test.
  const underTest = (path, key, name) => {
    const around = key.slice(path.length + 3, key.length - name.length - 3).split(' › ');
    return around.some((_, index) => runs.head.results.has(named(path, around.slice(0, index + 1).join(' › '))));
  };
  const reported = (path, name) => [...runs.head.results].filter(([key]) => key === named(path, name) || (key.startsWith(`${path} › `) && key.endsWith(` › ${name}`) && !underTest(path, key, name)))
    .reduce((sum, [, result]) => ({ ran: sum.ran + (result.ran ?? 1), skips: sum.skips + (result.skips ?? 0) }), { ran: 0, skips: 0 });
  const runnable = files.filter((path) => !runs.head.fileErrors.has(path) && !runs.head.unrunnable.has(path));
  runs.unrun = runnable.flatMap((path) => {
    const declared = sourceSpans.get(path).filter(({ name, kind, leaf }) => name !== null && kind !== 'describe' && leaf && tagsIn(name).some((tag) => counts(tag, path)));
    return [...new Set(declared.filter(({ skipped }) => !skipped).map(({ name }) => name))].filter((name) => {
      const of = declared.filter((test) => test.name === name), live = of.filter(({ skipped }) => !skipped);
      const needed = live.filter(({ runs: always }) => always).length + (live.some(({ runs: always }) => !always) ? 1 : 0);
      const { ran, skips } = reported(path, name);
      return ran + Math.max(0, skips - of.filter(({ skipped }) => skipped).length) < needed;
    }).map((name) => named(path, name));
  });
  // vitest runs only the .only tests of a file that has one, so the file's other tagged tests don't run.
  runs.only = runnable.filter((path) => path.endsWith('.ts') && sourceSpans.get(path).some(({ only }) => only)
    && sourceSpans.get(path).some(({ name, leaf, only, skipped }) => leaf && !only && !skipped && (name === null ? tagsWithImports(root, null, path) : tagsIn(name)).some((tag) => counts(tag, path))));

  // The twins each unproven test's criteria name, one checkout per twin.
  const needs = new Map();
  for (const test of runs.tests) {
    const { folder, twins, error } = twinsOf(root, test.path);
    test.twinsError = error;
    test.twins = test.tags.flatMap((tag) => (twins[tag] ?? []).map((twin) => ({ tag, twin, key: `${folder}/twins/${twin}` })));
    if (failedAtAssertion(runs.base.results.get(test.key))) continue;
    for (const { key } of test.twins) needs.set(key, [...new Set([...(needs.get(key) ?? []), test.path])]);
  }
  const all = listFiles(root);
  for (const [folder, twinFiles] of needs) {
    const own = all.filter((path) => path.startsWith(`${folder}/`));
    // A twin is a wrong program: it replaces code under test, never a test's own files, or a test
    // that asserts nothing could fail on a twin that rewrites what it compares.
    // Nor installed packages, whose frames a failure's origin passes over.
    const tests = own.map((path) => path.slice(folder.length + 1)).filter((path) => underTestPaths(path) || path.split('/').includes('node_modules'));
    if (!own.length || tests.length) {
      runs.twins.set(folder, { refused: own.length ? `replaces files under the test paths or node_modules (${tests.join(', ')})` : 'has no files', ...empty() });
      continue;
    }
    const directory = copyChange(root, 'deep-proof-checkout-');
    try {
      for (const path of own) copy(root, path, directory, path.slice(folder.length + 1));
    } catch (error) {
      runs.twins.set(folder, { refused: `cannot be laid over the change: ${firstLine(error.message)}`, ...empty() });
      continue;
    }
    const failed = prepare(root, change, directory);
    undoBuild(root, directory);
    for (const path of own) copy(root, path, directory, path.slice(folder.length + 1));
    runs.twins.set(folder, failed ? { ...empty(), unrunnable: new Map(twinFiles.map((file) => [file, failed])) } : runTests(directory, twinFiles));
  }
  return runs;
}

/** How a test failed on a wrong program without a mutant, or null. */
function wrongProgram(runs, test) {
  if (failedAtAssertion(runs.base.results.get(test.key))) return 'failed on the merge base at its assertion';
  const twin = (test.twins ?? []).find(({ key }) => failedAtAssertion(runs.twins.get(key)?.results.get(test.key)));
  return twin ? `failed on ${twin.twin} at its assertion` : null;
}

/** The before lane's lines; returns the tests that failed on a wrong program. */
export function before(runs, kills, say, print) {
  const proven = new Set();
  for (const [path, cause] of runs.head.fileErrors) say('FAIL', 'before', `${path}: fails on the change outside its tests (${cause})`, BEFORE_FIX);
  for (const [path, cause] of runs.head.unrunnable) say('BLOCKED', 'before', `${path}: cannot run on the change: ${cause}`, BEFORE_FIX);
  for (const key of runs.unrun ?? []) say('FAIL', 'before', `${key}: declared and not skipped, but the runner never reported it on the change`, BEFORE_FIX);
  for (const path of runs.only ?? []) say('FAIL', 'before', `${path}: a .only in the file keeps its other tagged tests from running`, BEFORE_FIX);
  for (const test of runs.tests) {
    if (quiet(test.status)) {
      // The trace lane counts it as no test. One the source declares unskipped that ran on the merge
      // base, where the test paths are the change's, was skipped by the change's code, such as a hook
      // in a module the test imports; one the change edits, or edits code around, may have been
      // skipped by that edit on the base too. Either proved nothing in this run.
      const base = runs.base.results.get(test.key);
      if (!test.declaredSkipped && base && !quiet(base.status)) say('INCONCLUSIVE', 'before', `${test.key}: declared unskipped, but skipped on the change, though it ran on the merge base, so it proved nothing in this run`, BEFORE_FIX);
      else if (!test.declaredSkipped && test.reached) say('INCONCLUSIVE', 'before', `${test.key}: declared unskipped, but skipped as it ran on the change, so it proved nothing in this run`, BEFORE_FIX);
      continue;
    }
    if (runs.head.fileErrors.has(test.path)) continue; // its file failed on the change, as listed above
    if (test.status !== 'pass') {
      say('FAIL', 'before', `${test.key}: fails on the change (${test.failure.cause})`, BEFORE_FIX);
      continue;
    }
    const how = wrongProgram(runs, test) ?? (kills.get(test.key) ? `killed ${kills.get(test.key)} mutant${kills.get(test.key) === 1 ? '' : 's'}` : null);
    if (how) {
      proven.add(test.key);
      say('PASS', 'before', `${test.key}: ${how}`);
      continue;
    }
    const base = runs.base.results.get(test.key);
    const refused = test.twins.filter(({ key }) => runs.twins.get(key)?.refused);
    const unrun = test.twins.filter(({ key }) => runs.twins.get(key)?.unrunnable.has(test.path));
    if (test.twinsError) say('BLOCKED', 'before', `${test.key}: ${test.twinsError}`, BEFORE_FIX);
    else if (refused.length) say('FAIL', 'before', `${test.key}: its planted wrong program ${refused.map(({ twin, key }) => `${twin} ${runs.twins.get(key).refused}`).join('; ')}`, BEFORE_FIX);
    else if (runs.base.blocked) say('BLOCKED', 'before', `${test.key}: cannot run on the merge base: ${runs.base.blocked}`, BEFORE_FIX);
    else if (runs.base.unrunnable.has(test.path)) say('BLOCKED', 'before', `${test.key}: cannot run on the merge base: ${runs.base.unrunnable.get(test.path)}`, BEFORE_FIX);
    else if (unrun.length) say('BLOCKED', 'before', `${test.key}: cannot run on its planted wrong program ${unrun.map(({ twin, key }) => `${twin}: ${runs.twins.get(key).unrunnable.get(test.path)}`).join('; ')}`, BEFORE_FIX);
    // A test that no longer fails on its planted wrong program checks nothing now, edited or not.
    else if (test.twins.length) say('FAIL', 'before', `${test.key}: ${[...new Set(test.twins.map(({ tag }) => tag))].join(', ')}: fails on neither the merge base nor its planted wrong program`, BEFORE_FIX);
    // A tagged test this change leaves alone, such as one an earlier change of the issue landed with
    // its fix, isn't this change's proof to fail; it proves its criterion only through a wrong program.
    else if (!test.changed) print(`before: ${test.key}: unchanged by this change and failed on no wrong program in this run, so it proves nothing here`);
    else if (base?.status === 'pass') say('FAIL', 'before', `${test.key}: passed on the merge base`, BEFORE_FIX);
    else say('FAIL', 'before', `${test.key}: failed on the base before its assertion (${base?.failure?.cause ?? runs.base.fileErrors.get(test.path) ?? (base ? `${base.status} there` : 'not collected there')})`, BEFORE_FIX);
  }
  if (!runs.tests.length && !runs.head.fileErrors.size && !runs.unrun?.length && !runs.only?.length) say('PASS', 'before', 'no tagged test to run on the merge base');
  return proven;
}

// Exits 1 when the report of a test run alone holds a failure at an assertion, else 0.
const ASSERTED = `import { readFileSync, rmSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const [report] = process.argv.slice(1);
let text = '';
try { text = readFileSync(report, 'utf8'); } catch {}
rmSync(report, { force: true });
const asserted = ${asserted};
const testPattern = ${testPattern};
const TEST_DATA = ${TEST_DATA};
const underTestPaths = ${underTestPaths};
const firstLine = ${firstLine};
${frames}
${atAssertion}
// Both runners' reports are ours: a JSON line per test. A suite's or a file's own failure, such as
// a describe's hook, is no test's, as the before lane reads it.
const own = (event) => !event.suite && !(event.nesting === 0 && event.file?.endsWith(event.name));
const failed = text.split('\\n').filter(Boolean).map((line) => JSON.parse(line)).some((event) => event.type === 'fail' && own(event) && atAssertion(process.cwd(), event.error ?? {}));
process.exit(failed ? 1 : 0);
`;
const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whether the tagged tests executed the code at a 1-based line and column on the change, from V8's
// block coverage of their run: the innermost range holding it ran at least once. Without coverage
// (vitest files take none) every position counts as executed.
function executed(runs, root, path) {
  if (runs.files.some((file) => file.endsWith('.ts')) || !runs.coverage) return () => true;
  const starts = [0];
  for (const line of show(root, null, path).split('\n')) starts.push(starts.at(-1) + line.length + 1);
  const url = pathToFileURL(join(runs.directory, path)).href;
  const ranges = readdirSync(runs.coverage).filter((name) => name.endsWith('.json'))
    .flatMap((name) => JSON.parse(readFileSync(join(runs.coverage, name), 'utf8')).result ?? [])
    .filter((script) => script.url === url).flatMap(({ functions }) => functions.flatMap(({ ranges: list }) => list));
  return ({ line, column }) => {
    const at = starts[line - 1] + column - 1;
    const inner = ranges.filter(({ startOffset, endOffset }) => startOffset <= at && at < endOffset).sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0];
    return inner?.count > 0;
  };
}

function strykerRun(root, copyDirectory, mutate, command) {
  const directory = temporary('deep-proof-stryker-');
  const report = join(directory, 'report.json');
  const config = join(copyDirectory, 'stryker.proof.config.json');
  writeFileSync(config, JSON.stringify({
    testRunner: 'command', commandRunner: { command }, mutate, coverageAnalysis: 'off', reporters: ['json'], jsonReporter: { fileName: report },
    inPlace: true, plugins: [], checkers: [], logLevel: 'error', fileLogLevel: 'off', allowConsoleColors: false,
    concurrency: Math.max(1, Math.floor(availableParallelism() / 2)), timeoutMS: 60_000,
  }));
  const result = spawnSync(process.execPath, [join(root, 'node_modules/.bin/stryker'), 'run', config], { cwd: copyDirectory, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 4 * TIMEOUT });
  if (!existsSync(report)) return { error: firstLine([result.stdout, result.stderr].join('\n').split('\n').find((line) => /error/i.test(line)) ?? result.stderr ?? `stryker exited ${result.status}`) };
  const mutants = [];
  for (const [file, { mutants: list }] of Object.entries(JSON.parse(readFileSync(report, 'utf8')).files ?? {}))
    for (const mutant of list) mutants.push({ ...mutant, path: relative(copyDirectory, isAbsolute(file) ? file : join(copyDirectory, file)) });
  return { mutants };
}

function mutantDiff(source, { location: { start, end }, replacement }) {
  const lines = source.split('\n').slice(start.line - 1, end.line);
  const mutated = `${lines[0].slice(0, start.column - 1)}${replacement}${lines.at(-1).slice(end.column - 1)}`.split('\n');
  return [...lines.map((line) => `    -${line}`), ...mutated.map((line) => `    +${line}`)];
}

/**
 * The mutation lane: StrykerJS mutates the TypeScript lines the change adds under packages/*\/src,
 * cargo-mutants the Rust lines under crates/*\/src. Each test no merge base or twin proved runs alone
 * against the mutants, the rest together; a mutant none kills, on a line a tagged test executes, is
 * listed with its diff. Returns the mutants each test killed, by test.
 */
export function mutation({ root, change }, runs, say, print) {
  const kills = new Map();
  const added = (pattern) => change.whole.filter(({ path, status }) => pattern.test(path) && status !== 'D').map((file) => ({ path: file.path, lines: addedLines(file) })).filter(({ lines }) => lines.length);
  const typescript = added(/^packages\/[^/]+\/src\/.+(?<!\.d|\.test)\.ts$/);
  const rust = added(/^crates\/[^/]+\/src\/.+\.rs$/);
  const tests = runs.tests.filter(({ status }) => status === 'pass');
  const unproven = tests.filter((test) => !wrongProgram(runs, test));
  let mutants = 0, survivors = 0, blocked = false;
  if (typescript.length && !existsSync(join(root, 'node_modules/.bin/stryker'))) {
    blocked = true;
    say('BLOCKED', 'mutation', `StrykerJS is not installed (no node_modules/.bin/stryker in the repository checked), so the lines added to ${typescript.map(({ path }) => path).join(', ')} were not mutated`, MUTATION_FIX);
  } else if (typescript.length && !tests.length) {
    blocked = true;
    say('INCONCLUSIVE', 'mutation', `no tagged test passes on the change, so the lines added to ${typescript.map(({ path }) => path).join(', ')} were not mutated`, MUTATION_FIX);
  } else if (typescript.length) {
    const mutate = typescript.flatMap(({ path, lines }) => lines.reduce((ranges, line) => {
      const last = ranges.at(-1);
      if (last && last[1] === line - 1) last[1] = line;
      else ranges.push([line, line]);
      return ranges;
    }, []).map(([from, to]) => `${path}:${from}-${to}`));
    const directory = copyChange(root, 'deep-proof-mutants-');
    build(directory); // a failed build shows as StrykerJS's failed initial run
    undoBuild(root, directory);
    // StrykerJS writes each mutated file in place, so a file that is a link out of the copy is refused.
    const outside = typescript.filter(({ path }) => {
      try {
        return !within(directory, realpathSync(join(directory, path)));
      } catch {
        return true; // a link to nothing
      }
    });
    if (outside.length) {
      say('BLOCKED', 'mutation', `${outside.map(({ path }) => path).join(', ')}: links out of the checkout or to nothing, so the lines added there were not mutated`, MUTATION_FIX);
      return kills;
    }
    // A test alone: each runner matches a pattern against its full name, its suites' names and its
    // own joined by a space for node --test and by " > " for vitest.
    // A test alone kills a mutant only by failing at an assertion, judged from its runner's report: a
    // mutant that makes the code throw shows the code ran, not that the test checks it.
    const command = (group, test) => {
      const node = group.filter((file) => !file.endsWith('.ts')), vitest = group.filter((file) => file.endsWith('.ts'));
      const pattern = (joint) => quote(`^${test.name.split(' › ').map(escape).join(joint)}$`);
      const judge = `; ${quote(process.execPath)} --input-type=module -e ${quote(ASSERTED)} "$R"`;
      const runs = [
        node.length && [quote(process.execPath), '--test', ...test ? [`--test-reporter=${quote(REPORTER)}`, '--test-reporter-destination="$R"', `--test-name-pattern=${pattern(' ')}`] : [], ...node.map(quote)].join(' ') + (test ? judge : ''),
        vitest.length && [...test ? ['DEEP_PROOF_VITEST_REPORT="$R"'] : [], quote(process.execPath), 'node_modules/vitest/vitest.mjs', 'run', ...test ? [`--reporter=${quote(VITEST_REPORTER)}`, '-t', pattern(' > ')] : [], ...vitest.map(quote)].join(' ') + (test ? judge : ''),
      ].filter(Boolean).map((run) => (test ? `R=$(mktemp ${quote(reports)}/report.XXXXXX) && { ${run}; }` : run));
      // Mutants reach a package that tests read through its build only once it is rebuilt, and the
      // rebuild is undone as the first build was, keeping the mutants.
      const undo = `import { undoBuild } from ${JSON.stringify(import.meta.url)}; undoBuild(${JSON.stringify(root)}, process.cwd(), ${JSON.stringify(typescript.map(({ path }) => path))});`;
      return [...workspaces(directory) ? ['npm run build --workspaces --if-present >/dev/null', `${quote(process.execPath)} --input-type=module -e ${quote(undo)}`] : [], ...runs].join(' && ');
    };
    const reports = temporary('deep-proof-report-');
    const groups = unproven.map((test) => [test, command([test.path], test)]);
    if (unproven.length < tests.length) groups.push([null, command([...new Set(tests.filter((test) => !unproven.includes(test)).map(({ path }) => path))])]);
    const killed = new Set(), seen = new Map();
    for (const [test, line] of groups) {
      const run = strykerRun(root, directory, mutate, line);
      if (run.error) {
        blocked = true;
        say('BLOCKED', 'mutation', `StrykerJS could not run ${test ? test.key : 'the tagged tests'}: ${run.error}`, MUTATION_FIX);
        break;
      }
      // A timeout shows the code ran, not that a test checks it: it neither kills nor survives.
      for (const mutant of run.mutants.filter(({ status }) => ['Killed', 'Survived', 'NoCoverage'].includes(status))) {
        const id = `${mutant.path}:${mutant.location.start.line}:${mutant.location.start.column}:${mutant.mutatorName}:${mutant.replacement}`;
        seen.set(id, mutant);
        if (mutant.status === 'Killed') {
          killed.add(id);
          if (test) kills.set(test.key, (kills.get(test.key) ?? 0) + 1);
        }
      }
    }
    if (!blocked) {
      mutants += seen.size;
      for (const [id, mutant] of seen) {
        if (killed.has(id)) continue;
        if (!executed(runs, root, mutant.path)(mutant.location.start)) continue;
        survivors += 1;
        print(`SURVIVED ${mutant.path}:${mutant.location.start.line} (${mutant.mutatorName})`);
        for (const line of mutantDiff(show(root, null, mutant.path), mutant)) print(line);
      }
    }
  }
  if (rust.length) {
    const result = cargoMutants(root, change, rust, say, print);
    blocked ||= result.blocked;
    mutants += result.mutants;
    survivors += result.survivors;
  }
  if (!blocked) {
    const criteria = new Map();
    for (const test of tests) for (const tag of test.tags) criteria.set(tag, [...(criteria.get(tag) ?? []), test]);
    let invalid = 0;
    for (const [id, list] of criteria) {
      if (list.some((test) => wrongProgram(runs, test) || test.twins.some(({ tag }) => tag === id) || kills.get(test.key))) continue;
      invalid += 1;
      say('INVALID', 'mutation', `${id}: its tests kill no mutant and name no planted wrong program (${list.map(({ key }) => key).join(', ')})`, MUTATION_FIX);
    }
    const summary = typescript.length || rust.length ? `${mutants} mutant${mutants === 1 ? '' : 's'} of the added lines, ${survivors} surviving on a line a tagged test executes` : 'the change adds no line under packages/*/src or crates/*/src to mutate';
    if (invalid) print(`mutation: ${summary}`);
    else say('PASS', 'mutation', summary);
  }
  return kills;
}

// cargo-mutants over the Rust lines the change adds. Its runs carry no test names, so its kills prove
// no criterion and its survivors are listed whether or not a tagged test executes their line.
function cargoMutants(root, change, files, say, print) {
  if (spawnSync('cargo', ['mutants', '--version'], { cwd: root, stdio: 'ignore' }).status !== 0) {
    say('BLOCKED', 'mutation', `cargo-mutants is not installed, so the lines added to ${files.map(({ path }) => path).join(', ')} were not mutated`, MUTATION_FIX);
    return { blocked: true, mutants: 0, survivors: 0 };
  }
  const directory = temporary('deep-proof-cargo-mutants-');
  const patch = join(directory, 'change.diff');
  const tracked = new Set(git(root, ['ls-files', '--', ...files.map(({ path }) => path)]).split('\n').filter(Boolean));
  writeFileSync(patch, [
    tracked.size ? git(root, ['diff', '--text', '--no-ext-diff', '--no-textconv', '--no-color', change.base, '--', ...tracked]) : '',
    ...files.filter(({ path }) => !tracked.has(path)).map(({ path }) => spawnSync('git', ['diff', '--text', '--no-index', '--no-color', '/dev/null', path], { cwd: root, encoding: 'utf8' }).stdout),
  ].join(''));
  const result = spawnSync('cargo', ['mutants', '--in-diff', patch, '--output', directory, '--no-shuffle'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 4 * TIMEOUT });
  const outcomes = join(directory, 'mutants.out', 'outcomes.json');
  if (!existsSync(outcomes)) {
    say('BLOCKED', 'mutation', `cargo-mutants could not run: ${firstLine(result.stderr)}`, MUTATION_FIX);
    return { blocked: true, mutants: 0, survivors: 0 };
  }
  let mutants = 0, survivors = 0;
  for (const { scenario, summary } of JSON.parse(readFileSync(outcomes, 'utf8')).outcomes ?? []) {
    const mutant = scenario?.Mutant;
    if (!mutant) continue;
    mutants += 1;
    if (summary !== 'MissedMutant') continue;
    survivors += 1;
    const { file, span: { start, end }, replacement } = mutant;
    print(`SURVIVED ${file}:${start.line} (${mutant.genre ?? 'mutant'})`);
    for (const line of mutantDiff(show(root, null, file), { location: { start, end }, replacement })) print(line);
  }
  return { blocked: false, mutants, survivors };
}
