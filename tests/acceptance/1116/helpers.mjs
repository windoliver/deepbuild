// Helpers for #1116's acceptance tests: a sandboxed HOME, stand-ins for what the repo doesn't own (gh, the machine's
// fingerprint tools, the load), stub holders, and the fixture repository: a bare origin, a clone the tests merge in,
// and a clone the window runs in. Nothing here imports the code under test: every surface is reached by running it
// (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const MAC = process.platform === 'darwin';
// Section 6's table: the Mac's limits on macOS, the Spark's elsewhere.
export const LIMIT = { build: MAC ? 1 : 2, 'bay-pair': MAC ? 1 : 3, test: MAC ? 2 : 4 };
export const LONG = { timeout: 600_000, skip: MAC ? false : 'INCONCLUSIVE (platform): the issue runs on the Mac, whose /usr/bin/time counts instructions' };
export const TASK = 'fixture-bench';
const REFERENCE = 'Mac15,7';
const QUIET_LOAD = '2';

// What makes a build of `work.sh` measurable: the loop in the child takes most of the run, so doubling it is a 2×
// regression that lands in a child process (#1404), not in the node parent.
const ROUNDS = 40_000;
export const workload = (rounds = ROUNDS) => `i=0\nwhile [ "$i" -lt ${rounds} ]; do i=$((i+1)); done\n`;
export const REGRESSED = workload(2 * ROUNDS);
export const budgets = (margin = 0.5) => `${JSON.stringify({ tasks: [{ id: TASK, command: ['node', 'bench.mjs'], margin, limits: { p50Ms: 60_000 }, initialReason: 'Fixture for #1116.' }] }, null, 2)}\n`;

// The fixture's benchmark. One line per sample in the test's events file, at an absolute path baked in when the
// fixture is written, so it holds whatever environment the window gives its samples. `tags` is the sample's own
// evidence of the tree it ran on, read from the tree: each commit adds one file under tags/.
const bench = (events) => `import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
const start = Date.now();
const tags = readdirSync(new URL('./tags/', import.meta.url)).sort();
const work = spawnSync('/bin/sh', [new URL('./work.sh', import.meta.url).pathname], { stdio: 'ignore' });
appendFileSync(${JSON.stringify(events)}, JSON.stringify({ kind: 'sample', start, end: Date.now(), tags }) + '\\n');
process.exit(work.status ?? 1);
`;

// A holder: `throttle.mjs <class> -- node stub.mjs '<json>'` notes when it starts and ends.
const STUB = `import { appendFileSync } from 'node:fs';
const spec = JSON.parse(process.argv[2]);
const note = (event) => appendFileSync(process.env.T1116_EVENTS, JSON.stringify({ kind: 'holder', name: spec.name, event, t: Date.now() }) + '\\n');
note('start');
await new Promise((done) => setTimeout(done, spec.hold ?? 0));
note('end');
`;

// The stand-in for gh: every call goes to calls.jsonl, and issues are JSON files it reads and changes. A call it
// doesn't know exits 1, and is in the calls too, so it can't read as done.
const GH = (folder) => `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const folder = ${JSON.stringify(folder)};
const args = process.argv.slice(2);
appendFileSync(folder + '/calls.jsonl', JSON.stringify(args) + '\\n');
const value = (...names) => {
  const at = args.findIndex((arg) => names.includes(arg));
  const inline = args.map((arg) => names.map((name) => (arg.startsWith(name + '=') ? arg.slice(name.length + 1) : null)).find((found) => found !== null)).find((found) => found != null);
  return at >= 0 ? args[at + 1] : inline;
};
const text = (...names) => {
  const file = value('--body-file', '-F');
  return value(...names) ?? (file ? readFileSync(file === '-' ? 0 : file, 'utf8') : '');
};
const path = folder + '/issue-' + args[2] + '.json';
const read = () => JSON.parse(readFileSync(path, 'utf8'));
const write = (issue) => writeFileSync(path, JSON.stringify(issue));
const refuse = (message) => { console.error(message); process.exit(1); };
const [noun, verb] = args;
if (noun !== 'issue') refuse('stand-in gh: no ' + args.join(' '));
if (verb === 'create') {
  appendFileSync(folder + '/created.jsonl', JSON.stringify({ title: value('--title', '-t') ?? '', body: text('--body', '-b') }) + '\\n');
  console.log('https://example.invalid/fixture/issues/9999');
} else if (verb === 'view') {
  let issue;
  try { issue = read(); } catch { refuse('stand-in gh: no issue ' + args[2]); }
  const fields = (value('--json') ?? 'state,body').split(',');
  const shown = Object.fromEntries(fields.map((field) => [field, issue[field]]));
  const query = value('-q', '--jq');
  if (query) console.log(String(shown[query.replace(/^\\./, '')] ?? ''));
  else console.log(JSON.stringify(shown));
} else if (verb === 'close') {
  const issue = read();
  issue.state = 'CLOSED';
  const comment = value('--comment', '-c');
  if (comment) issue.comments.push(comment);
  write(issue);
} else if (verb === 'comment') {
  const issue = read();
  issue.comments.push(text('--body', '-b'));
  write(issue);
} else if (verb === 'edit') {
  const issue = read();
  const body = text('--body', '-b');
  if (body) issue.body = body;
  write(issue);
} else refuse('stand-in gh: no ' + args.join(' '));
`;

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

/**
 * The machine's fingerprint tools, first on PATH: benchmark.mjs's fingerprint() reads them by name. They report a
 * reference Mac, on mains, unless `model` says otherwise.
 */
function standIns(bin, model) {
  script(join(bin, 'sysctl'), `#!/bin/sh
case "$*" in
  "-n hw.model") echo ${model} ;;
  "-n machdep.cpu.brand_string") echo "Apple M3 Pro" ;;
  "-n hw.memsize") echo ${36 * 2 ** 30} ;;
  "-n vm.loadavg") echo "{ \${T1116_LOAD:-${QUIET_LOAD}} \${T1116_LOAD:-${QUIET_LOAD}} \${T1116_LOAD:-${QUIET_LOAD}} }" ;;
  *) exec /usr/sbin/sysctl "$@" ;;
esac
`);
  script(join(bin, 'pmset'), `#!/bin/sh
if [ "$*" = "-g ps" ]; then echo "Now drawing from 'AC Power'"; else echo " lowpowermode         0"; fi
`);
  script(join(bin, 'osascript'), '#!/bin/sh\necho 0\n');
  script(join(bin, 'sw_vers'), '#!/bin/sh\necho 25A1116\n');
  // The warm-up builds, which a fixture has nothing for.
  for (const tool of ['npm', 'cargo']) script(join(bin, tool), '#!/bin/sh\nexit 0\n');
}

// The load is the OS's and shared with every session here, so each node process reads a pinned one: os.loadavg()
// answers $T1116_LOAD, which a test sets per process. Every other number stays the machine's.
const LOAD = `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const pinned = Number(process.env.T1116_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
`;

/** A sandbox removed after the test, with its own HOME, stand-ins and events file; every process it started is stopped. */
export function sandbox(t, { model = REFERENCE } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1116-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'load.mjs'), LOAD);
  standIns(bin, model);
  writeFileSync(join(gh, 'gh.mjs'), GH(gh));
  script(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gh, 'gh.mjs'))} "$@"\n`);
  const env = {
    ...process.env,
    HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: temp, PATH: `${bin}${delimiter}${process.env.PATH}`,
    RUSTUP_HOME: join(home, '.rustup'), CARGO_HOME: join(home, '.cargo'),
    NODE_OPTIONS: `--import=${join(dir, 'load.mjs')}`, T1116_LOAD: QUIET_LOAD, T1116_EVENTS: join(dir, 'events.jsonl'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const box = { dir, home, env, gh, events: env.T1116_EVENTS, stub: join(dir, 'stub.mjs'), children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status, output and end time. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.exited = false;
  child.done = new Promise((resolve) => child.on('close', (status, signal) => {
    child.exited = true;
    resolve({ status, signal, stdout, stderr, ended: Date.now() });
  }));
  return child;
}

/** A child's end, or its group stopped by its PID after `ms`: a wrong program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}

/** Polls until `predicate` holds or `ms` pass; returns whether it held. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const events = (box) => lines(box.events);
export const samples = (box) => events(box).filter(({ kind }) => kind === 'sample');
export const holder = (box, name, event) => events(box).find((one) => one.kind === 'holder' && one.name === name && one.event === event);

/** The throttle log's lines, as JSON objects (section 6's log; README: The surface). */
export const logLines = (box) => lines(join(box.home, '.deepbuild', 'throttle', 'log'));

/** Every evidence record under ~/.deepbuild/lanes/: a JSON object with a list of tests. Other files are the window's own. */
export function records(box) {
  const found = [];
  const walk = (folder) => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(readFileSync(path, 'utf8'));
          if (Array.isArray(record?.tests)) found.push(record);
        } catch {}
      }
    }
  };
  walk(join(box.home, '.deepbuild', 'lanes'));
  return found;
}
export const recordOf = (box, commit) => records(box).find((record) => record.commit === commit);

// The stand-in gh's state. A budget criterion is left unticked, as a `Part of #n` merge leaves it.
const body = (proven) => `A fixture issue for #1116.

### Acceptance criteria
- [${proven ? 'x' : ' '}] The fixture's other behaviour holds
- [ ] \`${TASK}\` stays within its budget on a reference Mac, in the local preflight
`;
export function fileIssue(box, number, { proven = true } = {}) {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title: `Fixture ${number}`, state: 'OPEN', body: body(proven), comments: [] }));
}
export const issue = (box, number) => JSON.parse(readFileSync(join(box.gh, `issue-${number}.json`), 'utf8'));
export const followUps = (box) => lines(join(box.gh, 'created.jsonl'));
const ghCalls = (box) => lines(join(box.gh, 'calls.jsonl'));

/** What a person reads at a failed assertion. */
export const dump = (box, ...runs) => [
  `records:\n${records(box).map((record) => JSON.stringify(record)).join('\n')}`,
  `gh calls:\n${ghCalls(box).map((call) => JSON.stringify(call)).join('\n')}`,
  `throttle log:\n${logLines(box).map((line) => JSON.stringify(line)).join('\n')}`,
  `samples: ${samples(box).length}`,
  ...runs.map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`),
].join('\n');

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};
const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: box.env, encoding: 'utf8', stdio: 'pipe' }).trim();

/**
 * The fixture repository: origin, a bare repository on disk; `work`, the clone the tests merge in; and `mac`, the
 * checkout the window runs in, which holds this checkout's scripts/. Two commits are on main: r0 and r1.
 */
export function fixture(box) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  mkdirSync(origin);
  mkdirSync(work);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(work, 'scripts'), { recursive: true });
  write(work, { 'bench.mjs': bench(box.events), 'work.sh': workload(), 'benchmarks/budgets.json': budgets(), 'tags/r0': '' });
  git('add', '-A');
  git('commit', '-qm', 'Root of the fixture');
  const r0 = git('rev-parse', 'HEAD');
  write(work, { 'tags/r1': '' });
  git('add', '-A');
  git('commit', '-qm', 'The fixture before the first window');
  const r1 = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  const commit = (name, number, files) => {
    write(work, { ...files, [`tags/${name}`]: '' });
    git('add', '-A');
    git('commit', '-qm', `Change ${name}\n\nPart of #${number}`);
    return git('rev-parse', 'HEAD');
  };
  return {
    mac, r0, r1, git,
    throttle: join(mac, 'scripts/throttle.mjs'), window: join(mac, 'scripts/budget-window.mjs'),
    /** A pull request's branch from `from`, adding tags/<name> and `files`; its tip. */
    branch(name, from, number, files = {}) {
      git('checkout', '-q', '-b', name, from);
      const tip = commit(name, number, files);
      git('checkout', '-q', 'main');
      return tip;
    },
    /** Merges a branch into main with a merge commit, as GitHub's merge button does, and pushes it. */
    merge(name, number) {
      git('merge', '-q', '--no-ff', '-m', `Merge pull request from fixture/${name}\n\nPart of #${number}`, name);
      git('push', '-q', 'origin', 'main');
      return git('rev-parse', 'HEAD');
    },
    /** One commit straight on main, as a squash merge leaves it, pushed. */
    push(name, number, files = {}) {
      const sha = commit(name, number, files);
      git('push', '-q', 'origin', 'main');
      return sha;
    },
    tree: (sha) => git('rev-parse', `${sha}^{tree}`),
  };
}

/** `throttle.mjs window` in the fixture's checkout. */
export const openWindow = (box, repo, { wait = 5, env = {} } = {}) => launch(box, [process.execPath, repo.throttle, 'window', '--wait', String(wait)], { cwd: repo.mac, env });
/** A complete window, ended by its PID's group if it runs past `ms`. */
export const fullWindow = (box, repo, { ms = 240_000, ...options } = {}) => ended(openWindow(box, repo, options), ms);
/** `throttle.mjs <class> -- node stub.mjs <spec>`, a top-level request from outside the window. */
export const hold = (box, repo, kind, wait, spec) => launch(box, [process.execPath, repo.throttle, kind, '--wait', String(wait), '--', process.execPath, box.stub, JSON.stringify(spec)]);

/** Waits for a stub holder to start, failing at the assertion when it doesn't within `ms`. */
export async function started(box, name, ms = 20_000) {
  assert.ok(await until(() => holder(box, name, 'start'), ms), `${name} never started under the throttle\n${dump(box)}`);
}

/** A window from which every later commit counts: the first on a repository has no last window, so it only marks main. */
export async function marked(box, repo) {
  return fullWindow(box, repo, { ms: 60_000 });
}

/** One commit merged since the last window, on issue `number`, fixture marked; what the single-commit tests start from. */
export async function oneMerged(box, number, { files = {}, proven = true } = {}) {
  const repo = fixture(box);
  fileIssue(box, number, { proven });
  await marked(box, repo);
  repo.branch('x', repo.r1, number, files);
  return { repo, commit: repo.merge('x', number) };
}
