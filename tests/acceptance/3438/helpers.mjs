// Helpers for #3438's acceptance tests (README.md): a sandbox whose HOME is under a temp folder, with stand-ins for the
// service managers first on PATH; the built `deep` run as a child; a reader for the login service's definition; the
// budget tasks that name a criterion, their runs and their judge; and the reports the judge tests plant. Nothing here
// imports the code under test: `deep`, a task's run and a task's judge are each reached by running them, and
// benchmarks/budgets.json by reading it. Every process a test starts is run to its end, in a process group of its
// own, and that group is stopped by its PID afterwards; nothing here waits on a timer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export { assert };
/** The checkout this folder is in, wherever it sits; messages write it `<checkout>`. */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const CLI = join(CHECKOUT, 'packages', 'cli', 'dist', 'main.js');
const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const MAC = process.platform === 'darwin';
/** The installed hub's label, the one every home shares (packages/hub/src/service.ts at the base). */
export const INSTALLED = 'com.deepbuild.hub';
export const C2 = '#3438.e9cc07fb', C3 = '#3438.65e37fd0', C4 = '#3438.ac71a3bd';
const STATES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED', 'INVALID'];

const real = (path) => { try { return realpathSync(path); } catch { return path; } };
/** Whether two paths name one file, links followed. */
export const samePath = (a, b) => real(a) === real(b);
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
const quoted = (path) => `'${path.replaceAll("'", "'\\''")}'`;
function script(file, text) {
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

/** A text as a message shows it: the test's HOME and your own as `~`, the sandbox and the checkout by name, never by path. */
export function plain(text, box) {
  let out = String(text);
  const swap = (path, name) => { for (const form of new Set([path, real(path)])) if (form.length > 1) out = out.split(form).join(name); };
  if (box) {
    swap(box.home, '~');
    if (box.outside) swap(box.outside, '<outside>');
    swap(box.dir, '<sandbox>');
  }
  swap(CHECKOUT, '<checkout>');
  swap(userInfo().homedir, '~');
  return out;
}

// ---- The sandbox.

/**
 * A sandbox removed when the test ends: `<dir>/h`, a HOME under a temp folder with nothing in it; TMPDIR and XDG_*
 * inside the sandbox; a `launchctl` stand-in (fixtures/launchctl.mjs, refusing every load until `accept`) and a
 * `systemctl` one first on PATH; a launcher stand-in at `<dir>/launcher` for a test that names one; and the OS
 * confirmation's stub answering cancelled. With `outside`, the `launchctl` stand-in sits in a folder outside every
 * temp folder, as the system's own does (#2203): /Users/Shared/dh3438-*, readable by this user alone. A child gets
 * this environment and nothing of the runner's.
 */
export function sandbox(t, { outside = false } = {}) {
  const dir = realpathSync(mkdtempSync('/tmp/dh3438-'));
  const made = [dir];
  t.after(() => { for (const folder of made) rmSync(folder, { recursive: true, force: true }); });
  const home = join(dir, 'h'), temp = join(dir, 't'), bin = join(dir, 'bin');
  for (const folder of [home, temp, bin]) mkdirSync(folder);
  symlinkSync(NODE, join(bin, 'node'));
  script(join(bin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${quoted(join(dir, 'systemctl.log'))}\necho 'the systemctl stand-in loads and starts nothing' >&2\nexit 1\n`);
  script(join(dir, 'launcher'), `#!/bin/sh\nprintf '%s\\n' "$1" >> ${quoted(join(dir, 'launcher.log'))}\necho 'the launcher stand-in starts nothing' >&2\nexit 1\n`);
  writeFileSync(join(dir, 'confirm'), 'cancelled\n');
  let manager = dir;
  if (outside) {
    try {
      manager = realpathSync(mkdtempSync('/Users/Shared/dh3438-'));
    } catch (error) {
      throw Error(`BLOCKED: no folder outside every temp folder could be made under /Users/Shared for the launchctl stand-in: ${error.message}`);
    }
    made.push(manager);
    mkdirSync(join(manager, 'bin'));
  }
  const state = join(manager, 'launchd'), managerBin = join(manager, 'bin');
  mkdirSync(state);
  script(join(managerBin, 'launchctl'), `#!/bin/sh\nexec ${quoted(NODE)} ${quoted(join(FIXTURES, 'launchctl.mjs'))} ${quoted(state)} "$@"\n`);
  const env = {
    HOME: home, TMPDIR: temp, SHELL: '/bin/sh', TZ: 'UTC', LC_ALL: 'C',
    PATH: [...new Set([managerBin, bin]), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_STATE_HOME: join(home, '.local', 'state'),
    DEEP_HUB_TEST_CONFIRM: join(dir, 'confirm'),
  };
  return { dir, home, state, env, outside: outside ? manager : undefined, launcher: join(dir, 'launcher'), plist: join(home, 'Library', 'LaunchAgents', `${INSTALLED}.plist`) };
}
/** From now on the `launchctl` stand-in loads a job it is handed (`accept`) or refuses every load (`refuse`). */
export const answering = (box, mode) => writeFileSync(join(box.state, 'mode'), `${mode}\n`);
/** Every call the `launchctl` stand-in got so far: `{ argv, exit, loads? }`, a load with the definition it was handed. */
export const calls = (box) => lines(join(box.state, 'calls.jsonl')).map((line) => JSON.parse(line));
/** Forgets the calls so far, so the next ones are one program's. */
export const forgetCalls = (box) => rmSync(join(box.state, 'calls.jsonl'), { force: true });
/** The labels the `launchctl` stand-in holds as loaded now. */
export const loaded = (box) => { try { return Object.keys(JSON.parse(readFileSync(join(box.state, 'jobs.json'), 'utf8'))); } catch { return []; } };
/** The definition a logged load was handed, as it was at that moment. */
export const handed = (box, load) => join(box.state, load.copy);
/** The stand-in's calls as a message shows them, one a line. */
export const shownCalls = (box) => plain(calls(box).map(({ argv, exit }) => `  | launchctl ${argv.join(' ')} (exit ${exit})`).join('\n') || '  | (no call)', box);

/**
 * `argv` run to its end in the sandbox's environment, in a process group of its own; whatever that group still holds
 * afterwards is stopped by its PID. `shown` is the command, its exit and its output, each output line quoted so none
 * reads as a frame of a test's stack, with every path written by name.
 */
function run(box, argv, { env = {}, cwd = box.dir, timeout = 120_000, said = argv.join(' ') } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, encoding: 'utf8', timeout, killSignal: 'SIGKILL', detached: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.pid > 0) try { process.kill(-r.pid, 'SIGKILL'); } catch { /* nothing of the group is left */ }
  const block = (label, text) => (String(text ?? '').trim() ? `${label}:\n${plain(String(text).trimEnd().slice(-3000), box).split('\n').map((line) => `  | ${line}`.trimEnd()).join('\n')}` : `${label}: nothing`);
  const shown = [`$ ${plain(said, box)}`, `exit ${r.status ?? r.signal ?? r.error?.message}`, block('stdout', r.stdout), block('stderr', r.stderr), '(end of the run)'].join('\n');
  return { status: r.status, pid: r.pid, stdout: r.stdout ?? '', stderr: r.stderr ?? '', shown };
}

/** A program's last stdout line as the JSON object it is, as scripts/benchmark.mjs's judgeTargets reads a report; undefined when it is none. */
function lastObject(stdout) {
  try {
    const value = JSON.parse(String(stdout).trim().split('\n').at(-1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---- `deep`, and the definition it writes.

/**
 * `deep <args>`, this checkout's built CLI under this Node, in the sandbox. On a machine that isn't macOS the child is
 * told it runs on macOS (fixtures/as-macos.mjs), since the base picks the definition by platform alone.
 */
export function deep(box, args, env = {}) {
  if (!existsSync(CLI)) throw Error('BLOCKED: this checkout has no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  const ran = run(box, [NODE, ...(MAC ? [] : ['--import', pathToFileURL(join(FIXTURES, 'as-macos.mjs')).href]), CLI, ...args], { env, said: `deep ${args.join(' ')}` });
  if (ran.status === null) throw Error(`BLOCKED: deep ${args.join(' ')} did not run to its end\n${ran.shown}`);
  if (ran.stderr.includes('ERR_MODULE_NOT_FOUND')) throw Error(`BLOCKED: this checkout is not fully built; run npm run build --workspaces first\n${ran.shown}`);
  return ran;
}

/**
 * The login service's definition as `deep hub start` writes it for the installed hub and hands it to the service
 * manager, here the launcher stand-in ($DEEP_HUB_LAUNCHER, the base's seam), which logs the file and starts nothing:
 * the file's path, whether it is there, the files the launcher was handed, and the run as a message shows it.
 */
export function definition(box) {
  const ran = deep(box, ['hub', 'start'], { DEEP_HUB_LAUNCHER: box.launcher });
  const given = lines(join(box.dir, 'launcher.log'));
  return { file: box.plist, written: existsSync(box.plist) && given.some((file) => real(file) === real(box.plist)), given, shown: ran.shown };
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unxml = (text) => text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (all, dec, hex, name) => (dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name] ?? all));
/** An XML property list as the value it holds: dicts, arrays, strings, numbers and booleans. Throws on anything else. */
export function parsePlist(text) {
  const tokens = [];
  for (const m of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z][\w.-]*)(?:\s[^>]*?)?(\/?)>|([^<]+)/g)) {
    if (m[2]) tokens.push({ tag: m[2], close: m[1] === '/', empty: m[3] === '/' });
    else if (m[4] !== undefined) tokens.push({ text: m[4] });
  }
  let at = 0;
  const next = () => {
    while (tokens[at] && tokens[at].text !== undefined && !tokens[at].text.trim()) at += 1;
    if (!tokens[at]) throw Error('the property list ends early');
    return tokens[at++];
  };
  const leaf = (tag) => {
    let out = '';
    for (; tokens[at] && tokens[at].text !== undefined; at += 1) out += tokens[at].text;
    const end = tokens[at++];
    if (!end || end.tag !== tag || !end.close) throw Error(`<${tag}> is not closed`);
    return unxml(out);
  };
  const value = (open) => {
    if (open.text !== undefined || open.close) throw Error(`a value was expected, not ${open.text ?? `</${open.tag}>`}`);
    if (open.tag === 'true' || open.tag === 'false') {
      if (!open.empty) next();
      return open.tag === 'true';
    }
    if (open.tag === 'dict') {
      const out = {};
      if (open.empty) return out;
      for (;;) {
        const key = next();
        if (key.tag === 'dict' && key.close) return out;
        if (key.tag !== 'key' || key.close) throw Error('a <key> was expected in a <dict>');
        out[key.empty ? '' : leaf('key')] = value(next());
      }
    }
    if (open.tag === 'array') {
      const out = [];
      if (open.empty) return out;
      for (;;) {
        const item = next();
        if (item.tag === 'array' && item.close) return out;
        out.push(value(item));
      }
    }
    if (open.tag === 'string') return open.empty ? '' : leaf('string');
    if (open.tag === 'integer' || open.tag === 'real') return Number(leaf(open.tag).trim());
    throw Error(`<${open.tag}> is no value this reader knows`);
  };
  const top = next();
  if (top.tag !== 'plist' || top.close) throw Error('no <plist> at the top');
  const out = value(next());
  const end = next();
  if (end.tag !== 'plist' || !end.close) throw Error('</plist> was expected after the one value');
  return out;
}
/**
 * A definition as launchd reads it. On macOS the reader is the OS's own, `plutil`, and this suite's reader must agree
 * with it or the test is BLOCKED; anywhere else, where there is no `plutil`, this suite's reader alone. `ok` false,
 * with what the reader said, when the file is no property list.
 */
export function readPlist(file) {
  let own, why;
  try { own = parsePlist(readFileSync(file, 'utf8')); } catch (error) { why = error.message; }
  if (!MAC) return own === undefined ? { ok: false, said: why } : { ok: true, value: own };
  const r = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  if (r.error || r.status === null) throw Error(`BLOCKED: /usr/bin/plutil could not be run to read the definition: ${r.error?.message ?? r.signal}`);
  if (r.status !== 0) return { ok: false, said: `${r.stdout}${r.stderr}`.trim() };
  const value = JSON.parse(r.stdout);
  if (own !== undefined && !isDeepStrictEqual(own, value)) throw Error(`BLOCKED: this suite's reader and plutil read the definition differently: ${JSON.stringify(own)} against ${JSON.stringify(value)}`);
  return { ok: true, value };
}

/**
 * The `ProcessType` the build's definition holds, which a report names for the hub it was loaded from. `{ skip }`
 * where this isn't macOS and the child wrote no macOS definition; a definition with no `ProcessType` fails here.
 */
export function chosenType(t) {
  const box = sandbox(t);
  const wrote = definition(box);
  if (!wrote.written && !MAC) return { skip: offMac("the definition deep writes on macOS, which names the type a report's hub was loaded with,") };
  assert.ok(wrote.written, `deep hub start wrote no definition for ${INSTALLED} and handed none to the launcher\n${wrote.shown}`);
  const read = readPlist(wrote.file);
  assert.ok(read.ok, `the definition deep hub start wrote is no property list: ${read.said}`);
  assert.equal(typeof read.value.ProcessType, 'string', `the definition deep hub start wrote holds no ProcessType, so no report can name the type its hub was loaded with: its keys are ${Object.keys(read.value).join(', ')}`);
  return { type: read.value.ProcessType };
}

// ---- The budget tasks that name a criterion (README: The tasks).

/** Each reading a criterion names: its target in a task of benchmarks/budgets.json, its value, and how its reading is shaped. */
export const TARGETS = {
  hook_overhead_p95_ms: { criterion: C2, value: 10, kind: 'limit' },
  idle_cpu_percent: { criterion: C2, value: 0.5, kind: 'limit' },
  round_trip_p50_ratio: { criterion: C2, value: 1.5, kind: 'sides' },
  record_append_p50_ratio: { criterion: C2, value: 1.5, kind: 'sides' },
  spin_ratio: { criterion: C3, value: 1.2, kind: 'pairs' },
  write_sync_ratio: { criterion: C3, value: 1.2, kind: 'pairs' },
};
export const manifest = () => JSON.parse(readFileSync(join(CHECKOUT, 'benchmarks', 'budgets.json'), 'utf8'));
const names = (task, criterion) => Array.isArray(task.criteria) && task.criteria.includes(criterion);

/**
 * The tasks of benchmarks/budgets.json that name `criterion`, C2 or C3: at least one; each a `node <script> …` command
 * whose script is in the checkout, with `targets`; every target one of this suite's, on a task that names its
 * criterion; and each of the criterion's targets on exactly one of them, with the criterion's value.
 */
export function launchdTasks(criterion) {
  const tasks = manifest().tasks.filter((task) => names(task, criterion));
  const wanted = Object.entries(TARGETS).filter(([, target]) => target.criterion === criterion);
  assert.ok(tasks.length > 0, `benchmarks/budgets.json holds no task whose criteria name ${criterion}, so the budget window has no task that reads a hub launchd started and this criterion stays unmeasured; its readings are ${wanted.map(([name, { value }]) => `${name} ${value}`).join(', ')}`);
  for (const task of tasks) {
    assert.ok(Array.isArray(task.command) && task.command[0] === 'node' && typeof task.command[1] === 'string' && existsSync(join(CHECKOUT, task.command[1])),
      `${task.id}: a task that names ${criterion} runs \`node <script in the checkout> …\`, so the window can run \`node <script> judge\` on its report: its command is ${JSON.stringify(task.command)}`);
    assert.ok(task.targets && typeof task.targets === 'object' && !Array.isArray(task.targets) && Object.keys(task.targets).length > 0, `${task.id}: a task that names ${criterion} holds targets, which its bench's judge holds its report to: ${JSON.stringify(task.targets)}`);
    for (const name of Object.keys(task.targets)) {
      assert.ok(Object.hasOwn(TARGETS, name) && names(task, TARGETS[name].criterion), `${task.id}: its target ${name} is none of the readings of the criteria it names (${Object.keys(TARGETS).join(', ')})`);
    }
  }
  for (const [name, { value }] of wanted) {
    const holders = tasks.filter((task) => Object.hasOwn(task.targets, name));
    assert.equal(holders.length, 1, `exactly one task that names ${criterion} holds the target ${name}: ${holders.map(({ id }) => id).join(', ') || 'none does'}`);
    assert.equal(holders[0].targets[name], value, `${holders[0].id}: the criterion's ${name} is ${value}`);
  }
  return tasks;
}
/** The task among `tasks` that holds the target `name`. */
export const holder = (tasks, name) => tasks.find((task) => Object.hasOwn(task.targets, name));

// ---- A task's judge, and the reports planted on it (README: The report, The judge).

/** A reference Mac's fingerprint on mains power, as scripts/benchmark.mjs's fingerprint() gives one. */
export const REFERENCE = Object.freeze({ model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '26B8119' });
/** The one ask of a run that could load no login service. */
export const ASK = Object.freeze({ kind: 'unblock', what: 'Run this where a login service can load: this home is under a temp folder, and a temp home gets no login service.' });
const quiet = (count) => Array.from({ length: count }, () => ({ start: 0.25, end: 0.25 }));
const turns = (count, a, b) => Array.from({ length: count }, (_, i) => (i % 2 ? b : a));
/** Five readings of a limit, each `value`, at a load far below any machine's cores. */
export const limitOf = (...runs) => ({ runs: runs.length === 1 ? Array(5).fill(runs[0]) : runs, loads: quiet(runs.length === 1 ? 5 : runs.length) });
/** A task read on both hubs in alternated rounds: one sample a side a round, in ms. */
export const sidesOf = (launchd, child) => ({ launchd, child, first: turns(launchd.length, 'launchd', 'child'), loads: quiet(launchd.length) });
/** A command's pairs, each `ratio` times the terminal's `ms` when the hub starts it. */
export const pairsOf = (ratio, ms, count = 10) => ({ hub: Array(count).fill(ms * ratio), terminal: Array(count).fill(ms), first: turns(count, 'hub', 'terminal'), loads: quiet(count) });
/** What a command takes from a terminal in the planted pairs: the 5 s spin a little over 5 s, the 256 MiB write under a second. */
export const TERMINAL_MS = { spin_ratio: 5200, write_sync_ratio: 800 };
/** A hub launchd started under a label of its own, from a definition whose type is `type`. */
export const hubOf = (type, label = 'com.deepbuild.hub.budget') => ({ label, process_type: type, pid: 4321, ppid: 1, parent: '/sbin/launchd' });
/** A reading within its target, by the target's name. */
function within(name) {
  const { kind, value } = TARGETS[name];
  if (kind === 'limit') return limitOf(value * 0.9);
  if (kind === 'sides') return sidesOf(Array(20).fill(120), Array(20).fill(100));
  return { chosen: pairsOf(1.1, TERMINAL_MS[name]), background: pairsOf(3, TERMINAL_MS[name]) };
}
/**
 * A report of `task` that every right judge passes: a reference Mac at rest, a hub launchd started from the build's
 * definition (type `type`) under a label of its own, and each of the task's targets read within its value; `over`
 * replaces readings by target name, and `change` fields of the report.
 */
export function report(task, type, over = {}, change = {}) {
  const readings = Object.fromEntries(Object.keys(task.targets).map((name) => [name, over[name] ?? within(name)]));
  const paired = Object.keys(task.targets).some((name) => TARGETS[name].kind === 'pairs');
  return { task: task.id, machine: { ...REFERENCE }, hub: hubOf(type), ...(paired ? { background_hub: hubOf('Background', 'com.deepbuild.hub.budget-background') } : {}), readings, asks: [], ...change };
}

/**
 * The verdict of the task's judge on `current`, as the budget window asks for it (scripts/benchmark.mjs's
 * judgeTargets): `node <the task's script> judge` with `{ current, base: null }` on stdin, its last stdout line.
 */
export function judge(task, current) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DEEP_|NODE_OPTIONS$|NODE_TEST_CONTEXT$)/.test(name)));
  const r = spawnSync(NODE, [task.command[1], 'judge'], { cwd: CHECKOUT, env, input: JSON.stringify({ current, base: null }), encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  const verdict = lastObject(r.stdout);
  assert.ok(r.status === 0 && verdict && STATES.includes(verdict.status), `node ${task.command[1]} judge gave no verdict for ${task.id}: it exits 0 and its last line is {"status": one of ${STATES.join(', ')}, …}; it exited ${r.status ?? r.signal ?? r.error?.message}\n${plain(`${r.stdout}\n${r.stderr}`.trim().slice(-2000))}`);
  return verdict;
}
/** The verdict as a message shows it. */
export const said = (verdict) => `${verdict.status}${verdict.reason ? `: ${plain(verdict.reason)}` : ''}`;

// ---- A task's run (README: The run).

/** The source files a run can be made of. */
function sources(folder) {
  if (!existsSync(join(CHECKOUT, folder))) return [];
  return readdirSync(join(CHECKOUT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return ['node_modules', 'dist', 'test', 'tests', 'target'].includes(entry.name) ? [] : sources(path);
    return entry.isFile() && /\.(?:[cm]?js|ts)$/.test(entry.name) ? [path] : [];
  });
}
/**
 * A task is run only where every program it can be made of reaches the service manager through PATH, where a
 * stand-in comes first: a source that names launchctl by its path could reach the real one, so nothing is run.
 */
function onlyThroughPath() {
  const named = ['benchmarks', 'scripts', 'packages'].flatMap((folder) => sources(folder)).filter((file) => /\/(?:usr\/)?s?bin\/launchctl\b/.test(readFileSync(join(CHECKOUT, file), 'utf8')));
  if (named.length) throw Error(`BLOCKED: ${named.join(', ')} names launchctl by its path, which a stand-in first on PATH can't stand in front of; these tests run a task only where the service manager is reached as \`launchctl\` on PATH`);
}
/**
 * Whether the hub a run named in its report still runs after the run ended and its process group was stopped: one
 * that left the group. It is then stopped by its PID, as a process this test's run started, and only while it is
 * still `deep hub run`.
 */
export function stopLeftHub(pid) {
  const r = spawnSync('/bin/ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (r.status !== 0 || !/\bhub\s+run\b/.test(r.stdout)) return false;
  try { process.kill(pid, 'SIGKILL'); } catch { /* it ended meanwhile */ }
  return true;
}
/** What a run of a task needs built: the CLI, and deep-hook for a run that starts a hub. */
export function needsBuilds({ hook = false } = {}) {
  const hookBuilt = ['debug', 'release'].some((build) => existsSync(join(CHECKOUT, 'target', build, 'deep-hook')));
  const missing = [...(existsSync(CLI) ? [] : ['packages/cli/dist/main.js']), ...(hook && !hookBuilt ? ['target/debug/deep-hook'] : [])];
  if (missing.length) throw Error(`BLOCKED: build first (npm run build --workspaces${hook ? ' and cargo build --locked -p deep-hook' : ''}); missing: ${missing.join(', ')}`);
}
/**
 * The task's own command, run from the checkout in the sandbox's environment as the window runs it, to its end:
 * its exit, its PID, its report (its last stdout line), and the run as a message shows it.
 */
export function runTask(box, task, { env = {}, timeout = 900_000 } = {}) {
  onlyThroughPath();
  const ran = run(box, [NODE, ...task.command.slice(1)], { env, cwd: CHECKOUT, timeout, said: task.command.join(' ') });
  assert.ok(ran.status !== null, `${task.id}: its run did not end within ${timeout / 1000} s and was stopped: a run ends by itself, whatever its hub does\n${ran.shown}`);
  return { ...ran, report: lastObject(ran.stdout) };
}

// ---- What a test says when it can't read the criterion itself.

/** Off macOS: nothing was read, and the lanes read the note as a platform they lack, never as a pass. */
export const offMac = (what) => `INCONCLUSIVE: ${what} needs macOS, whose service manager is launchd; this is ${process.platform}, so nothing was read here, and this is not a pass`;
/** A criterion the budget window reads: the test held what the reading rests on, and names the tasks that take it. */
export const windowReads = (criterion, tasks) => `INCONCLUSIVE: the budget window reads this criterion, never a test: ${criterion}'s readings are taken on a reference Mac by ${tasks.map(({ id }) => id).join(', ')} of benchmarks/budgets.json; every assertion of this test held`;
