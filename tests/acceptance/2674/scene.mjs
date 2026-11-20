// The window scene for #2674's acceptance tests: a sandboxed HOME and throttle table, stand-ins at the boundaries the
// repo doesn't own (gh, the machine's fingerprint tools, the load, the warm-up builds), and a fixture repository whose
// main a real window measures through `node scripts/throttle.mjs window`, with every process reading a load at the
// cores. Nothing here imports the code under test: the window is reached by running it (README: The scene).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const MAC = process.platform === 'darwin';
/** A scene runs two real windows, which take minutes on a loaded Mac: the test's own limit, and each window's. */
export const SLOW = { timeout: 3_600_000, skip: MAC ? false : 'INCONCLUSIVE (platform): the windows run on a reference Mac, whose /usr/bin/time -l counts instructions retired' };
const WINDOW_MS = 3_000_000;

/** What `fingerprint()` in benchmark.mjs reads, as the stand-ins report it: a reference Mac on mains. */
export const MACHINE = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, macosBuild: '25A2674' };
/** The load every process of the scene reads but the throttle: this machine's core count, so "at or above the cores". */
export const LOAD = availableParallelism();
/** The load the throttle reads, below any Mac's cores, so a window's grant starts. */
const QUIET = 2;

/** A fixture command: `/bin/sh` counting in shell builtins. It names no file of the tree, so it runs on every commit. */
const loop = (rounds) => ['/bin/sh', '-c', `i=0; while [ $i -lt ${rounds} ]; do i=$((i+1)); done`];
const task = (id, command, limits) => ({ id, command, margin: 0.5, limits, initialReason: 'Fixture for #2674.' });
/**
 * The fixture's three tasks. `limited` carries a time limit and `plain` none; both run on every commit. `apart` runs
 * benchmarks/apart.mjs, which no measured commit changes, so it is never reached.
 */
export const TASKS = [
  task('limited', loop(20_000), { p50Ms: 60_000 }),
  task('plain', loop(15_000), {}),
  task('apart', ['node', 'benchmarks/apart.mjs'], { p50Ms: 60_000 }),
];
export const REACHED = ['limited', 'plain'];
export const UNREACHED = ['apart'];

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

// The stand-in for gh: every call goes to calls.jsonl. The fixture's commits name no issue, so a window has nothing to
// ask it; a call is answered only for a follow-up issue, and anything else exits 1 and is in the calls too.
const GH = (folder) => `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(folder, 'calls.jsonl'))}, JSON.stringify(args) + '\\n');
if (args[0] === 'issue' && args[1] === 'create') console.log('https://example.invalid/fixture/issues/9999');
else { console.error('stand-in gh: no ' + args.join(' ')); process.exit(1); }
`;

// The load is the OS's and shared with every session on this Mac, so each node process reads a pinned one: the throttle
// $T2674_GRANT_LOAD, so a window's grant starts; the window it starts, and everything else, $T2674_LOAD.
const PIN = `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const granting = /[\\\\/]scripts[\\\\/]throttle\\.mjs$/.test(process.argv[1] ?? '');
const pinned = Number(granting ? process.env.T2674_GRANT_LOAD : process.env.T2674_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
`;

/** The fingerprint tools, the warm-up builds and cargo, first on PATH. */
function standIns(bin) {
  script(join(bin, 'sysctl'), `#!/bin/sh
case "$*" in
  "-n hw.model") echo ${MACHINE.model} ;;
  "-n machdep.cpu.brand_string") echo "${MACHINE.chip}" ;;
  "-n hw.memsize") echo ${MACHINE.memoryBytes} ;;
  "-n vm.loadavg") echo "{ $T2674_LOAD $T2674_LOAD $T2674_LOAD }" ;;
  *) exec /usr/sbin/sysctl "$@" ;;
esac
`);
  script(join(bin, 'pmset'), `#!/bin/sh
if [ "$*" = "-g ps" ]; then echo "Now drawing from 'AC Power'"; else echo " lowpowermode         0"; fi
`);
  script(join(bin, 'osascript'), '#!/bin/sh\necho 0\n');
  script(join(bin, 'sw_vers'), `#!/bin/sh\necho ${MACHINE.macosBuild}\n`);
  script(join(bin, 'npm'), '#!/bin/sh\nexit 0\n');
  // A fixture has no crate: cargo metadata answers an empty workspace, so affected.mjs's selection places each task by
  // the files its command names; a build, test or clippy has nothing to do.
  script(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[]}\'; fi\nexit 0\n');
}

/** Whether this process runs under `node --test`, whose sandboxed throttle table is the only one a scene may touch. */
const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');

/**
 * A sandbox removed when the file's tests end, with its own HOME, throttle table, stand-ins, and this checkout's
 * node_modules linked above every tree a window reads (affected.mjs imports typescript). Every process it started is
 * stopped by its process group's PID.
 */
export function sandbox({ after }) {
  assert.ok(underTest(), 'the scene runs only under node --test, whose throttle table is the sandbox\'s own');
  assert.ok(existsSync(join(CHECKOUT, 'node_modules', 'typescript')), `no node_modules/typescript in ${CHECKOUT}: run npm ci there first`);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2674-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'load.mjs'), PIN);
  standIns(bin);
  writeFileSync(join(gh, 'gh.mjs'), GH(gh));
  script(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gh, 'gh.mjs'))} "$@"\n`);
  const env = {
    ...process.env,
    HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: temp, PATH: `${bin}${delimiter}${process.env.PATH}`,
    RUSTUP_HOME: join(home, '.rustup'), CARGO_HOME: join(home, '.cargo'),
    // Named outright: outside a test run the throttle refuses it rather than use the machine's table.
    DEEP_THROTTLE_TABLE: join(home, '.deepbuild', 'throttle'),
    NODE_OPTIONS: `--import=${join(dir, 'load.mjs')}`, T2674_LOAD: String(LOAD), T2674_GRANT_LOAD: String(QUIET),
  };
  for (const name of Object.keys(env)) if (/^GIT_/.test(name)) delete env[name];
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_GATES', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const box = { dir, home, env, gh, children: [] };
  after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: box.env, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

/** A complete window in the fixture's checkout, its group stopped by its PID past its limit; with the times around it. */
async function windowOver(box, mac) {
  const launched = Date.now();
  const child = spawn(process.execPath, [join(mac, 'scripts/throttle.mjs'), 'window', '--wait', '10'], { cwd: mac, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, WINDOW_MS);
  const [status, signal] = await new Promise((resolve) => child.on('close', (...end) => resolve(end)));
  clearTimeout(stop);
  return { status, signal, stdout, stderr, launched, ended: Date.now() };
}

/** Every JSON object in ~/.deepbuild/lanes/, where every record lies (README: The surface). */
function lanesFiles(box) {
  const folder = join(box.home, '.deepbuild', 'lanes');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      return value && typeof value === 'object' ? [value] : [];
    } catch {
      return [];
    }
  });
}
/** Each commit's record: an object with `commit` and a list of `tests`. */
export const commitRecords = (box) => lanesFiles(box).filter((value) => typeof value.commit === 'string' && Array.isArray(value.tests));
/** Each window's own record: an object with `start`, `end` and a list of `commits`. */
export const windowRecords = (box) => lanesFiles(box).filter((value) => 'start' in value && 'end' in value && Array.isArray(value.commits));
/** The sandbox throttle log's lines. */
export function logLines(box) {
  const file = join(box.home, '.deepbuild', 'throttle', 'log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}

/** What a person reads at a failed assertion. */
export function dump(box, run) {
  const calls = join(box.gh, 'calls.jsonl');
  return [
    `records:\n${lanesFiles(box).map((value) => JSON.stringify(value).slice(0, 4000)).join('\n')}`,
    `throttle log:\n${logLines(box).map((line) => JSON.stringify(line)).join('\n')}`,
    `gh calls:\n${existsSync(calls) ? readFileSync(calls, 'utf8') : ''}`,
    ...run ? [`window exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.slice(-6000)}\nstderr:\n${run.stderr.slice(-3000)}`] : [],
  ].join('\n');
}

/**
 * The scene: the fixture's first commit holds this checkout's scripts/, the three tasks, benchmarks/apart.mjs and
 * notes.txt; a first window marks it. Then two commits straight on main, each changing only notes.txt, and one window
 * that measures both. Returns the commits, the measuring window's run and the times around it.
 */
export async function play(box) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  mkdirSync(origin);
  mkdirSync(work);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(work, 'scripts'), { recursive: true });
  write(work, {
    'benchmarks/budgets.json': `${JSON.stringify({ tasks: TASKS }, null, 2)}\n`,
    'benchmarks/apart.mjs': '// A benchmark no measured commit reaches.\nlet i = 0;\nwhile (i < 1e6) i++;\n',
    'notes.txt': 'Notes no task reads.\n',
  });
  git('add', '-A');
  git('commit', '-qm', 'The fixture before the first window');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  const mark = await windowOver(box, mac);
  assert.equal(mark.status, 0, `the first window didn't mark main\n${dump(box, mark)}`);
  assert.equal(commitRecords(box).length, 0, `the first window measured something\n${dump(box, mark)}`);
  const commits = ['once', 'twice'].map((word) => {
    write(work, { 'notes.txt': `Notes no task reads, changed ${word}.\n` });
    git('add', '-A');
    git('commit', '-qm', `Change the notes ${word}`);
    return git('rev-parse', 'HEAD');
  });
  git('push', '-q', 'origin', 'main');
  const run = await windowOver(box, mac);
  return { commits, run, windows: 2 };
}
