// Helpers for #2665's acceptance tests: a sandboxed HOME, stand-ins at the boundaries the repo doesn't own (gh, the
// machine's fingerprint tools, the load, the warm-up builds), the fixture repository (a bare origin, a clone the tests
// commit in, and the checkout a window runs in, which holds this checkout's scripts/), approval tags, and readers for
// the window's records. Nothing here imports the code under test: a window is reached by running
// `node scripts/throttle.mjs window` in the fixture's checkout (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const MAC = process.platform === 'darwin';
/** A scene runs real windows, which take minutes on a loaded Mac: the test's own limit, and the window's. */
export const SLOW = { timeout: 2_700_000, skip: MAC ? false : 'INCONCLUSIVE (platform): the issue is judged on macOS, whose /usr/bin/time -l counts instructions retired' };
const WINDOW_MS = 2_400_000;

/** What `fingerprint()` in benchmark.mjs reads, as the stand-ins report it: a reference Mac, and a Mac that isn't one. */
const REFERENCE = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 };
export const ELSEWHERE = { model: 'Mac14,2', chip: 'Apple M2', memoryBytes: 8 * 2 ** 30 };
/** A load below any Mac's cores, which a window's grant waits for. */
const QUIET = 2;
/** A load above the cores of any reference Mac and of this one. */
export const LOADED = 999;

/**
 * A fixture command: `/bin/sh` counting to `rounds` in shell builtins, after `before`. With nothing before, its own
 * process does all its work, so its instructions retired and its peak memory hold steady from run to run. It names no
 * file of the tree.
 */
export const loop = (rounds, before = '') => ['/bin/sh', '-c', `${before}i=0; while [ $i -lt ${rounds} ]; do i=$((i+1)); done`];
/** A task of the fixture's benchmarks/budgets.json, in the manifest's own shape. */
export const task = (id, command, limits, more = {}) => ({ id, command, margin: 0.5, limits, initialReason: 'Fixture for #2665.', ...more });
export const manifest = (tasks) => `${JSON.stringify({ tasks }, null, 2)}\n`;

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

// The stand-in for gh: every call goes to calls.jsonl. The fixture's commits name no issue, so the only call a window
// makes is the follow-up a miss files; anything else exits 1 and is in the calls too.
const GH = (folder) => `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(folder, 'calls.jsonl'))}, JSON.stringify(args) + '\\n');
if (args[0] === 'issue' && args[1] === 'create') console.log('https://example.invalid/fixture/issues/9999');
else { console.error('stand-in gh: no ' + args.join(' ')); process.exit(1); }
`;

// The load is the OS's and shared with every session on this Mac, so each node process reads a pinned one. A window's
// grant waits for a load below the cores, so throttle.mjs reads $T2665_GRANT_LOAD; the window it starts, and everything
// else, reads $T2665_LOAD. The cores stay the machine's.
const LOAD = `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const granting = /[\\\\/]scripts[\\\\/]throttle\\.mjs$/.test(process.argv[1] ?? '');
const pinned = Number(granting ? process.env.T2665_GRANT_LOAD : process.env.T2665_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
`;

/** The machine's fingerprint tools and the warm-up builds, first on PATH: benchmark.mjs reads them by name. */
function standIns(bin, machine) {
  script(join(bin, 'sysctl'), `#!/bin/sh
case "$*" in
  "-n hw.model") echo ${machine.model} ;;
  "-n machdep.cpu.brand_string") echo "${machine.chip}" ;;
  "-n hw.memsize") echo ${machine.memoryBytes} ;;
  "-n vm.loadavg") echo "{ $T2665_LOAD $T2665_LOAD $T2665_LOAD }" ;;
  *) exec /usr/sbin/sysctl "$@" ;;
esac
`);
  script(join(bin, 'pmset'), `#!/bin/sh
if [ "$*" = "-g ps" ]; then echo "Now drawing from 'AC Power'"; else echo " lowpowermode         0"; fi
`);
  script(join(bin, 'osascript'), '#!/bin/sh\necho 0\n');
  script(join(bin, 'sw_vers'), '#!/bin/sh\necho 25A2665\n');
  // A fixture has nothing to build: the warm-up's npm and cargo, and cargo metadata, which then places no task.
  for (const tool of ['npm', 'cargo']) script(join(bin, tool), '#!/bin/sh\nexit 0\n');
}

/**
 * A sandbox removed after the test, with its own HOME, stand-ins, and this checkout's node_modules linked above every
 * tree a window reads (scripts/proof-change.mjs and affected.mjs import typescript). `machine` is what the fingerprint
 * tools report, `load` what the window reads. Every process it started is stopped by its process group's PID.
 */
export function sandbox(t, { machine = REFERENCE, load = QUIET } = {}) {
  assert.ok(existsSync(join(CHECKOUT, 'node_modules', 'typescript')), `no node_modules/typescript in ${CHECKOUT}: run npm ci there first`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2665-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'load.mjs'), LOAD);
  standIns(bin, machine);
  writeFileSync(join(gh, 'gh.mjs'), GH(gh));
  script(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gh, 'gh.mjs'))} "$@"\n`);
  const env = {
    ...process.env,
    HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: temp, PATH: `${bin}${delimiter}${process.env.PATH}`,
    RUSTUP_HOME: join(home, '.rustup'), CARGO_HOME: join(home, '.cargo'),
    NODE_OPTIONS: `--import=${join(dir, 'load.mjs')}`, T2665_LOAD: String(load), T2665_GRANT_LOAD: String(QUIET),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_GATES', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT', 'GIT_DIR', 'GIT_WORK_TREE']) delete env[name];
  const box = { dir, home, env, gh, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** What the sandbox's processes read as the load: the window's, and the throttle's at its grant. */
export function loads(box) {
  const read = (script) => Number(execFileSync(process.execPath, ['-e', 'console.log(require("node:os").loadavg()[0])', script], { env: box.env, encoding: 'utf8' }).trim());
  return { window: read('scripts/budget-window.mjs'), grant: read('/fixture/scripts/throttle.mjs') };
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status and output. */
function launch(box, argv, cwd) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return child;
}

/**
 * /usr/bin/time -l's report of `command`, run `times` times in the sandbox: each run's peak bytes and instructions
 * retired. The test's own reading of the fixture's commands, to set their ceilings, never the window's.
 */
export function timed(box, command, times = 5) {
  return Array.from({ length: times }, () => {
    const result = spawnSync('/usr/bin/time', ['-l', ...command], { cwd: box.dir, env: box.env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command.join(' ')} failed under /usr/bin/time -l: ${result.stderr}`);
    const read = (label) => Number(result.stderr.match(new RegExp(`^\\s*(\\d+)\\s+${label}\\s*$`, 'm'))?.[1]);
    const run = { peakBytes: read('maximum resident set size'), instructions: read('instructions retired') };
    assert.ok(run.peakBytes > 0 && run.instructions > 0, `/usr/bin/time -l reported no peak or no instructions retired for ${command.join(' ')}: ${result.stderr}`);
    return run;
  });
}

const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: box.env, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

/**
 * The fixture repository: `origin`, a bare repository on disk; `work`, the clone the tests commit in; and `mac`, the
 * checkout a window runs in. Its first commit holds this checkout's scripts/, `files`, and `.deepbuild/approvers`
 * listing the maintainer's security key (`keys`), and is on main before the first window.
 */
function fixture(box, files) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  const keys = people();
  mkdirSync(origin);
  mkdirSync(work);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(work, 'scripts'), { recursive: true });
  write(work, { [APPROVERS]: keys.list, 'notes.txt': 'Notes no task reads.\n', ...files });
  git('add', '-A');
  git('commit', '-qm', 'The fixture before the first window');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  return {
    mac, keys, git, root: git('rev-parse', 'HEAD'),
    /** One commit straight on main with `files`, pushed, as a squash merge leaves it; its SHA. */
    commit(changes, message) {
      write(work, changes);
      git('add', '-A');
      git('commit', '-qm', message);
      git('push', '-q', 'origin', 'main');
      return git('rev-parse', 'HEAD');
    },
    /** A person's approval of `commit`: a tag under deep/approved/ with one `Approves:` line per item, signed by the maintainer's key, pushed. */
    approve(name, commit, items) {
      tag(work, `deep/approved/${name}`, commit, items, keys.maintainer);
      git('push', '-q', 'origin', `refs/tags/deep/approved/${name}`);
    },
  };
}

/** A complete window in the fixture's checkout, `node scripts/throttle.mjs window`, its group stopped by PID past its limit. */
export async function windowOver(box, repo) {
  const child = launch(box, [process.execPath, join(repo.mac, 'scripts/throttle.mjs'), 'window', '--wait', '5'], repo.mac);
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, WINDOW_MS);
  try {
    return await child.done;
  } finally {
    clearTimeout(stop);
  }
}

/** Every evidence record under ~/.deepbuild/lanes/: a JSON object with a list of tests. */
function records(box) {
  const folder = join(box.home, '.deepbuild', 'lanes');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const record = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      return Array.isArray(record?.tests) ? [record] : [];
    } catch {
      return [];
    }
  });
}
/** A task's row in a record's tests. */
export const row = (record, id) => record.tests.find((test) => test.id === id);

/** What a person reads at a failed assertion: the records, the gh calls and the window's output. */
function dump(box, run) {
  const calls = join(box.gh, 'calls.jsonl');
  return [
    `records:\n${records(box).map((record) => JSON.stringify(record)).join('\n')}`,
    `gh calls:\n${existsSync(calls) ? readFileSync(calls, 'utf8') : ''}`,
    ...run ? [`window exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.slice(-6000)}\nstderr:\n${run.stderr.slice(-3000)}`] : [],
  ].join('\n');
}

/** The record a window left for `commit`, failing at the assertion when it left none. */
export function recordOf(box, run, commit, what) {
  const record = records(box).find((one) => one.commit === commit);
  assert.ok(record, `the window left no record for ${what} ${commit}\n${dump(box, run)}`);
  return record;
}

/** A scene's start: the fixture with `files`, marked by a first window, which only marks main's tip. */
export async function marked(box, files) {
  const repo = fixture(box, files);
  const run = await windowOver(box, repo);
  assert.equal(records(box).length, 0, `the first window measured something\n${dump(box, run)}`);
  assert.equal(run.status, 0, `the first window didn't mark main\n${dump(box, run)}`);
  return repo;
}
