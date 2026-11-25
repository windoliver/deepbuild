// Test-side tools for #3336's acceptance tests (README). Two kinds of run, each on a copy, never on this checkout:
//
// - The taste run (#3336.f7adc8c8, #3336.7d4ab4ab): a clean copy of this checkout, a fresh git repository whose one
//   commit is its working tree, runs #1941's taste test files as the unit lane runs them (vitest, from the copy's
//   root), with TMPDIR set to a folder of the run outside the copy. After the run the copy's `git status`, every file
//   the run wrote under the copy, and the screenshots it wrote outside it are read.
// - The lane run (#3336.f0336513): a small fixture git repository, the copy's scripts/ and root files with one planted
//   vitest file, runs `runLanes` from the fixture's own scripts/lanes.mjs on the `unit` entry of its `checks`, holding
//   that lane's parallel vitest command, as scripts/checks.mjs runs a lane. The printed lines, the exit status, the
//   evidence record it wrote under the sandbox HOME and the fixture's `git status` are read.
//
// Nothing here imports the code under test: lanes.mjs is loaded in a child process from the copy, so a lanes.mjs that
// can't load reads as an assertion failure, never as an import error.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The checkout root (tests/acceptance/3336 is three levels down). */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const PLATFORM = `${process.platform}-${process.arch}`;
/** #1941's taste test draws on macOS's Metal device and reads INCONCLUSIVE elsewhere (issue: Runs on). */
export const METAL = process.platform === 'darwin';
/** The note a test skips with where it can't prove its criterion: unrun, never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs: string): string => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;

/** #1941's first draft of the taste test, and the folder of its blind redraft (issue: Scope). */
export const FIRST_DRAFT = 'tests/acceptance/1941/taste.test.ts';
export const REDRAFT = 'tests/acceptance/1941-redraft-3336';
/** The folder the first draft writes its screenshots into, in the checkout (issue: The writer). */
export const EVIDENCE_1941 = 'docs/evidence/1941';
/** The bytes every committed #1941 screenshot holds in the taste copy (README: The placeholder screenshots). */
export const PLACEHOLDER = 'placeholder for #3336: no screenshot is drawn here\n';
/** The taste run's budget, the copy and its commit included, under the lanes' 20-minute cap of a file: the run is stopped
 * when it is spent, and a stopped run proves nothing. */
export const TASTE_LIMIT_MS = 18.5 * 60_000;

const git = (cwd: string, args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, env: gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${r.stderr}`);
  return r.stdout;
};
/** Git's environment without a caller's repository or index, and without a Terminal tab's safe.bareRepository. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  return env;
}
/** `git status --porcelain` with every untracked file listed, one line each. */
export const status = (repo: string): string[] => git(repo, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean);

/** A new git repository at `repo` whose one commit is its working tree; it is clean after. */
function commitAll(repo: string): void {
  git(repo, ['init', '-q', '-b', 'base']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--no-verify', '-m', 'the tree the run starts on']);
  const dirty = status(repo);
  if (dirty.length) throw new Error(`the copy isn't clean before the run:\n${dirty.join('\n')}`);
}

/** A sandbox under the OS temp folder: `repo/` and the run's own HOME, TMPDIR and bin folders. */
function sandbox(prefix: string): { root: string; repo: string; home: string; tmp: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const dirs = { root, repo: join(root, 'repo'), home: join(root, 'home'), tmp: join(root, 'tmp') };
  for (const dir of [dirs.repo, dirs.home, dirs.tmp]) mkdirSync(dir);
  return dirs;
}

// ---------------------------------------------------------------------------------------------------
// The taste run

export interface TasteRun {
  root: string;
  repo: string;
  tmp: string;
  /** The #1941 taste files the run ran, relative to the copy. */
  files: string[];
  /** Exit status, or null when the run was stopped once TASTE_LIMIT_MS was spent. */
  exit: number | null;
  stopped: boolean;
  output: string;
  /** `git status --porcelain` lines of the copy after the run. */
  after: string[];
  /** Files under the copy (outside .git, node_modules and target) the run created, changed or removed: `<what> <path>`. */
  written: string[];
  /** Every .png file outside the copy under the run's TMPDIR or under a folder the output names, by real path. */
  shots: string[];
  /** Those of `shots` that lie in a folder, or are a file, the output names by its path. */
  named: string[];
}

/** The folders of the copy a run's tools keep their caches and builds in: never a run's output (README: What is read). */
const TOOL_DIRS = new Set(['.git', 'node_modules', 'target']);

/** Every file under `dir` (relative to `base`), skipping the tool folders at the top: path → `size:mtime`. */
function stamps(base: string, dir = '', into = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(join(base, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (!dir && TOOL_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) stamps(base, path, into);
    else {
      const s = lstatSync(join(base, path));
      into.set(path, `${s.size}:${s.mtimeMs}`);
    }
  }
  return into;
}

/** The test files under `dir` of the copy, relative to it, sorted. */
function testFiles(repo: string, dir: string): string[] {
  if (!existsSync(join(repo, dir))) return [];
  return readdirSync(join(repo, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.test\.ts$/.test(e.name))
    .map((e) => relative(repo, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

/**
 * Of `files`, those the copy's unit lane runs: not a file its lane lists leave to a person or a lane of their own
 * (`byHand`, `ownLane` of the copy's scripts/lanes.mjs, read with its own `listed`).
 */
function unitLaneRuns(repo: string, files: string[]): string[] {
  const program = `const { byHand, ownLane, listed } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
console.log(JSON.stringify(${JSON.stringify(files)}.filter((file) => !listed(byHand, file) && !listed(ownLane, file))));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(r.stdout.trim().split('\n').at(-1) ?? ''); } catch { throw new Error(`the copy's scripts/lanes.mjs didn't load (exit ${r.status}):\n${r.stderr.slice(-3000)}`); }
}

/** Absolute paths the output names, as the words that start with `/`, trailing punctuation cut. */
function pathsNamed(output: string): string[] {
  const words = output.match(/\/[^\s'"`<>|]+/g) ?? [];
  return [...new Set(words.map((w) => w.replace(/[.,;:)\]}]+$/, '')))].filter((w) => w.length > 1 && isAbsolute(w));
}
const real = (path: string): string | undefined => { try { return realpathSync(path); } catch { return undefined; } };
const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + sep);
function pngsUnder(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return /\.png$/i.test(dir) ? [dir] : [];
    return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.png$/i.test(e.name)).map((e) => join(e.parentPath, e.name));
  } catch { return []; }
}

/** Runs `argv` in `cwd` in its own process group, stderr into stdout, stopped by its own PID's group at `limit`. */
function runChild(argv: string[], cwd: string, env: NodeJS.ProcessEnv, limit: number): Promise<{ exit: number | null; stopped: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stopped = false;
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    const timer = setTimeout(() => { stopped = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, limit);
    child.on('error', (e) => { clearTimeout(timer); resolve({ exit: null, stopped, output: `${output}\n${e.message}` }); });
    child.on('close', (exit) => { clearTimeout(timer); resolve({ exit, stopped, output }); });
  });
}

/**
 * The taste run: a clean copy of this checkout (its files, the build outputs and node_modules included, by an APFS
 * clone), each committed #1941 screenshot holding PLACEHOLDER, committed as one fresh repository; then #1941's taste
 * files the unit lane runs (the first draft if the copy still has it, and every test file of the redraft's folder),
 * by the copy's vitest, with TMPDIR the run's own folder outside the copy.
 */
export async function tasteRun(): Promise<TasteRun> {
  const started = Date.now();
  const { root, repo, tmp } = sandbox('deep-3336-taste-');
  for (const entry of readdirSync(CHECKOUT)) {
    if (entry === '.git') continue;
    const r = spawnSync('cp', ['-cpR', join(CHECKOUT, entry), `${repo}/`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cp -cpR ${entry} failed: ${r.stderr}`);
  }
  // The checkout's tracked #1941 screenshots: in the copy each holds the placeholder, so any drawn screenshot written
  // into the copy changes a tracked file's bytes on every machine.
  const tracked = git(CHECKOUT, ['ls-files', '-z', '--', EVIDENCE_1941]).split('\0').filter((f) => f.endsWith('.png'));
  for (const file of tracked) writeFileSync(join(repo, file), PLACEHOLDER);
  commitAll(repo);
  const candidates = [...(existsSync(join(repo, FIRST_DRAFT)) ? [FIRST_DRAFT] : []), ...testFiles(repo, REDRAFT)];
  const files = unitLaneRuns(repo, candidates);
  const before = stamps(repo);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp };
  // The copy builds into its own target/, never into a folder a caller named.
  delete env['CARGO_TARGET_DIR'];
  const ran = files.length
    ? await runChild([process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...files], repo, env, Math.max(60_000, TASTE_LIMIT_MS - (Date.now() - started)))
    : { exit: null, stopped: false, output: '(no #1941 taste file to run)' };
  const after = status(repo);
  const now = stamps(repo);
  const written = [
    ...[...now].filter(([path]) => !before.has(path)).map(([path]) => `created ${path}`),
    ...[...now].filter(([path, stamp]) => before.has(path) && before.get(path) !== stamp).map(([path]) => `rewrote ${path}`),
    ...[...before.keys()].filter((path) => !now.has(path)).map((path) => `removed ${path}`),
  ].sort();
  // Outside the copy: the run's TMPDIR, any folder the output names under a temp folder, and any .png file it names.
  const temps = [...new Set([tmp, tmpdir(), '/tmp', '/private/tmp'].map(real).filter((p): p is string => Boolean(p)))];
  const named = pathsNamed(ran.output).map(real).filter((p): p is string => Boolean(p) && !inside(p!, repo) && p !== root && !temps.includes(p!)
    && (/\.png$/i.test(p!) || temps.some((t) => inside(p!, t))));
  const shots = [...new Set([...pngsUnder(tmp), ...named.flatMap(pngsUnder)].map((p) => real(p) ?? p))].filter((p) => !inside(p, repo)).sort();
  const namedShots = shots.filter((shot) => named.some((p) => inside(shot, p)));
  return { root, repo, tmp, files, exit: ran.exit, stopped: ran.stopped, output: ran.output, after, written, shots, named: namedShots };
}

export const dispose = (run: { root: string } | undefined): void => { if (run) rmSync(run.root, { recursive: true, force: true }); };
/** The run's last lines, for a message. */
export const tail = (output: string, n = 60): string => output.split('\n').slice(-n).join('\n');

// ---------------------------------------------------------------------------------------------------
// The lane run

/** The planted tracked screenshot under docs/evidence/ (issue: criterion 3). */
export const PLANTED_SHOT = 'docs/evidence/3336-planted/scene-before.png';
const PLANTED_BYTES = 'the committed screenshot of #3336\'s planted writer\n';

/** The planted vitest file: it writes `target` (an expression over `HERE`, the repository root's URL) and passes. */
const writerTest = (what: string, target: string): string => `// #3336's planted ${what}: it writes a screenshot and passes.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const HERE = fileURLToPath(new URL('../', import.meta.url));
it('draws a screenshot and writes it', () => {
  const target = ${target};
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'bytes this run drew\\n');
  console.log('wrote ' + target);
  expect(target.length).toBeGreaterThan(0);
});
`;
/** A writer that targets the tracked screenshot under docs/evidence/, and its clean twin that writes to a temp folder. */
export const WRITERS = {
  evidence: writerTest('writer that targets docs/evidence', `join(HERE, ${JSON.stringify(PLANTED_SHOT)})`),
  temp: writerTest('clean writer, to a temp folder', `join(mkdtempSync(join(tmpdir(), 'deep-3336-shots-')), 'scene-before.png')`),
};
export const PLANTED_TEST = 'tests/planted-3336.test.ts';

export interface LaneRun {
  repo: string;
  exit: number | null;
  output: string;
  lines: string[];
  /** The lane's verdict lines: `PASS unit (…)` or `<STATE> unit…: …` with what follows up to its Fix line. */
  verdicts: string[];
  /** The evidence records of the `unit` lane the run wrote under the sandbox HOME. */
  records: Array<Record<string, unknown>>;
  after: string[];
}

/**
 * A fixture repository: this checkout's root files and scripts/ (tracked and untracked files git doesn't ignore),
 * tests/vitest-setup.ts, the tracked PLANTED_SHOT, and the planted vitest file `writer`, with node_modules linked to the
 * checkout's (ignored by an added .gitignore line); committed, clean. Then the fixture's own `runLanes` on its `unit`
 * lane with that lane's first command, the parallel vitest block, in a child process with cwd at the fixture and the
 * sandbox's HOME and TMPDIR.
 */
export function laneRun(writer: string): LaneRun & { root: string } {
  const { root, repo, home, tmp } = sandbox('deep-3336-lane-');
  const listed = git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).split('\0')
    .filter((f) => f && (!f.includes('/') || f.startsWith('scripts/') || f === 'tests/vitest-setup.ts'));
  for (const file of listed) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !lstatSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  writeFileSync(join(repo, '.gitignore'), `${existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : ''}\n# #3336's fixture links node_modules\n/node_modules\n`);
  mkdirSync(dirname(join(repo, PLANTED_SHOT)), { recursive: true });
  writeFileSync(join(repo, PLANTED_SHOT), PLANTED_BYTES);
  mkdirSync(dirname(join(repo, PLANTED_TEST)), { recursive: true });
  writeFileSync(join(repo, PLANTED_TEST), writer);
  commitAll(repo);
  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const unit = checks.find((lane) => lane.name === 'unit');
if (!unit) { console.log('NO LANE: checks has no unit lane, of ' + JSON.stringify(checks.map((l) => l.name))); process.exit(3); }
console.log('LANE ' + unit.name);
process.exitCode = runLanes([{ ...unit, commands: [unit.commands[0]] }]);
`;
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TMPDIR: tmp, PATH: [dirname(process.execPath), process.env['PATH']].join(delimiter) };
  for (const key of ['DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 8 * 60_000, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED: the lane didn't finish in 480 s (${r.signal})` : ''}`;
  const lines = output.split('\n');
  const verdicts: string[] = [];
  lines.forEach((line, i) => {
    if (/^PASS unit \(/.test(line)) verdicts.push(line);
    else if (/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE) unit\b/.test(line)) {
      const end = lines.findIndex((l, j) => j > i && /^\s+Fix:/.test(l));
      verdicts.push(lines.slice(i, end < 0 ? lines.length : end + 1).join('\n'));
    }
  });
  const folder = join(home, '.deepbuild', 'lanes');
  const records = (existsSync(folder) ? readdirSync(folder) : []).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(folder, f), 'utf8')) as Record<string, unknown>).filter((rec) => rec['lane'] === 'unit');
  return { root, repo, exit: r.status, output, lines, verdicts, records, after: status(repo) };
}
