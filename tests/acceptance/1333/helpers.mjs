// Helpers for #1333's acceptance tests: a sandboxed HOME and TMPDIR, stand-ins for what the repo doesn't own (gh and
// GitHub, the agent CLIs, the hub's `deep lease`, any HTTP endpoint), and the watched repository: a bare origin, a clone
// the tests land in, and a clone the job runs in. Nothing here imports the code under test: every surface is reached by
// running it (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const JOB = join(CHECKOUT, 'scripts', 'main-watch.mjs');
export const LONG = { timeout: 1_800_000 };
/** The schedule's set number of landings (README: The surface). */
export const LANDINGS = 5;
/** The fixture's tests, by the name node --test gives each. */
export const SUM = 'adds two numbers', OTHER = 'doubles a number', FLAKY = 'settles on a repeat';
export const SUM_ID = `tests/sum.test.mjs › ${SUM}`;

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

// The stand-in for gh and GitHub. Issues and pull requests are JSON files in its folder; every call is recorded with
// its time. A pull request's head is a branch on the fixture's origin, and `pr merge` merges it into origin's main,
// as GitHub would. A call it doesn't know exits 1 and is recorded too, so it can't read as done.
const GH = (folder) => `import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const folder = ${JSON.stringify(folder)};
const args = process.argv.slice(2);
appendFileSync(join(folder, 'calls.jsonl'), JSON.stringify({ t: Date.now(), args, cwd: process.cwd() }) + '\\n');
const refuse = (message) => { console.error(message); process.exit(1); };
const flag = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const name of names) {
      if (args[i] === name) return args[i + 1];
      if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
    }
  }
  return undefined;
};
const has = (...names) => args.some((arg) => names.includes(arg));
const text = (...names) => {
  const file = flag('--body-file', '-F');
  return flag(...names) ?? (file ? readFileSync(file === '-' ? 0 : file, 'utf8') : undefined);
};
const VALUED = new Set(['--json', '-q', '--jq', '--title', '-t', '--body', '-b', '--body-file', '-F', '--comment', '-c', '--state', '-s', '--limit', '-L', '--head', '-H', '--base', '-B', '--label', '-l', '--repo', '-R', '--search', '-S', '--add-label', '--remove-label', '--assignee', '-a', '--reason', '-r']);
const positional = () => {
  const out = [];
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('-')) { if (VALUED.has(args[i])) i++; continue; }
    out.push(args[i]);
  }
  return out;
};
const file = (kind, n) => join(folder, kind + '-' + n + '.json');
const load = (kind, n) => (existsSync(file(kind, n)) ? JSON.parse(readFileSync(file(kind, n), 'utf8')) : null);
const save = (kind, item) => writeFileSync(file(kind, item.number), JSON.stringify(item, null, 2));
const all = (kind) => readdirSync(folder).filter((name) => name.startsWith(kind + '-') && name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
const next = (key, start) => {
  const path = join(folder, 'counters.json');
  const counters = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const n = counters[key] ?? start;
  counters[key] = n + 1;
  writeFileSync(path, JSON.stringify(counters));
  return n;
};
const number = (ref) => Number(String(ref ?? '').match(/(\\d+)\\/?$/)?.[1]);
// --json fields, then -q/--jq with a plain path such as .state, .[].number or .comments[].body.
function show(value) {
  const fields = flag('--json');
  const pick = (item) => (fields ? Object.fromEntries(fields.split(',').map((field) => [field, field === 'comments' ? (item.comments ?? []).map((body) => ({ body })) : field === 'labels' ? (item.labels ?? []).map((name) => ({ name })) : item[field] ?? null])) : item);
  let out = Array.isArray(value) ? value.map(pick) : pick(value);
  const query = flag('-q', '--jq');
  if (query) {
    let values = [out];
    for (const part of query.replace(/^\\./, '').split(/\\.(?![^[]*\\])/).filter(Boolean)) {
      const [, name, all] = part.match(/^([\\w]*)(\\[\\])?$/) ?? refuse('stand-in gh: --jq takes a plain path only: ' + query);
      values = values.flatMap((one) => { const got = name ? one?.[name] : one; return all ? (got ?? []) : [got]; });
    }
    for (const one of values) console.log(typeof one === 'object' && one !== null ? JSON.stringify(one) : String(one ?? ''));
    return;
  }
  console.log(JSON.stringify(out));
}
const origin = () => readFileSync(join(folder, 'origin.txt'), 'utf8').trim();
const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const [noun, verb] = args;
const ref = positional()[0];
if (noun === 'auth' && verb === 'status') { console.log('Logged in to github.com as fixture'); process.exit(0); }
if (noun === 'repo' && verb === 'view') { show({ nameWithOwner: 'fixture/watched', url: 'https://github.com/fixture/watched', defaultBranchRef: { name: 'main' }, name: 'watched', owner: { login: 'fixture' } }); process.exit(0); }
if (noun === 'issue') {
  if (verb === 'create') {
    const title = flag('--title', '-t');
    if (!title) refuse('stand-in gh: issue create needs --title');
    const labels = args.flatMap((arg, i) => (['--label', '-l'].includes(args[i - 1]) ? arg.split(',') : []));
    const issue = { number: next('issue', 9900), title, body: text('--body', '-b') ?? '', state: 'OPEN', comments: [], labels, created: Date.now() };
    save('issue', issue);
    console.log('https://github.com/fixture/watched/issues/' + issue.number);
  } else if (verb === 'list') {
    const state = (flag('--state', '-s') ?? 'open').toUpperCase();
    show(all('issue').filter((issue) => state === 'ALL' || issue.state === state).sort((a, b) => b.number - a.number));
  } else {
    const issue = load('issue', number(ref));
    if (!issue) refuse('stand-in gh: no issue ' + ref);
    if (verb === 'view') show(issue);
    else if (verb === 'reopen' || verb === 'close') {
      issue.state = verb === 'reopen' ? 'OPEN' : 'CLOSED';
      const comment = text('--comment', '-c');
      if (comment) issue.comments.push(comment);
      save('issue', issue);
    } else if (verb === 'comment') {
      const body = text('--body', '-b');
      if (!body) refuse('stand-in gh: issue comment needs --body');
      issue.comments.push(body);
      save('issue', issue);
    } else if (verb === 'edit') {
      const body = text('--body', '-b');
      if (body) issue.body = body;
      const add = flag('--add-label');
      if (add) issue.labels = [...(issue.labels ?? []), ...add.split(',')];
      save('issue', issue);
    } else refuse('stand-in gh: no ' + args.join(' '));
  }
  process.exit(0);
}
if (noun === 'pr') {
  if (verb === 'create') {
    const head = flag('--head', '-H') ?? git(process.cwd(), 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    const base = flag('--base', '-B') ?? 'main';
    const title = flag('--title', '-t');
    if (!title) refuse('stand-in gh: pr create needs --title');
    if (!git(origin(), 'branch', '--list', head).trim()) refuse('stand-in gh: you must first push ' + head + ' to origin');
    const pr = { number: next('pr', 9300), title, body: text('--body', '-b') ?? '', state: 'OPEN', headRefName: head, baseRefName: base, created: Date.now(), url: '' };
    pr.url = 'https://github.com/fixture/watched/pull/' + pr.number;
    save('pr', pr);
    console.log(pr.url);
  } else if (verb === 'list') {
    const state = (flag('--state', '-s') ?? 'open').toUpperCase();
    const head = flag('--head', '-H');
    show(all('pr').filter((pr) => (state === 'ALL' || pr.state === state) && (!head || pr.headRefName === head)).sort((a, b) => b.number - a.number));
  } else {
    const pr = load('pr', number(ref)) ?? all('pr').find((one) => one.headRefName === ref);
    if (!pr) refuse('stand-in gh: no pull request ' + ref);
    if (verb === 'view') show(pr);
    else if (verb === 'comment') { pr.comments = [...(pr.comments ?? []), text('--body', '-b') ?? '']; save('pr', pr); }
    else if (verb === 'close') { pr.state = 'CLOSED'; save('pr', pr); }
    else if (verb === 'merge') {
      if (pr.state !== 'OPEN') refuse('stand-in gh: pull request #' + pr.number + ' is ' + pr.state.toLowerCase());
      const work = mkdtempSync(join(folder, 'merge-'));
      try {
        git(work, 'clone', '-q', origin(), '.');
        git(work, 'checkout', '-q', pr.baseRefName);
        try {
          git(work, 'merge', '--no-ff', '-q', 'origin/' + pr.headRefName, '-m', 'Merge pull request #' + pr.number + ' from ' + pr.headRefName + '\\n\\n' + pr.title);
        } catch {
          refuse('stand-in gh: Pull request #' + pr.number + ' is not mergeable: the merge commit cannot be cleanly created.');
        }
        git(work, 'push', '-q', 'origin', pr.baseRefName);
        pr.state = 'MERGED';
        pr.mergeCommit = { oid: git(work, 'rev-parse', 'HEAD').trim() };
        save('pr', pr);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    } else refuse('stand-in gh: no ' + args.join(' '));
  }
  process.exit(0);
}
refuse('stand-in gh: no ' + args.join(' '));
`;

// The agent CLIs' stand-in: it records how it was started (its arguments, folder and stdin) and when it ended, changes
// nothing, and says so. An attempt that starts it ends with main as red as it found it.
const AGENT = (log, bin) => `import { appendFileSync } from 'node:fs';
const start = Date.now();
let stdin = '';
if (!process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { stdin += chunk; });
  await new Promise((done) => { process.stdin.on('end', done); process.stdin.on('error', done); setTimeout(done, 3000).unref(); });
}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bin: ${JSON.stringify(bin)}, args: process.argv.slice(2), cwd: process.cwd(), stdin, start, end: Date.now() }) + '\\n');
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'stand-in agent: I changed nothing' }));
process.stdin.destroy();
`;

/**
 * A sandbox removed after the test: its own HOME, TMPDIR, git identity, the stand-ins first on PATH, every proxy and
 * model endpoint pointed at a recorder this process runs, and the fixture tests' events file. Every process it
 * started is stopped by its process group's PID.
 */
export async function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1333-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  writeFileSync(join(gh, 'gh.mjs'), GH(gh));
  script(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gh, 'gh.mjs'))} "$@"\n`);
  const agents = join(dir, 'agents.jsonl');
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(dir, `${name}.mjs`), AGENT(agents, name));
    script(join(bin, name), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(dir, `${name}.mjs`))} "$@"\n`);
  }
  // The hub's `deep lease` (#1015), which scripts/lease calls first: it records the command and runs it, marked leased.
  const deepLog = join(dir, 'deep.log');
  script(join(bin, 'deep'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(deepLog)}\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; T1333_LEASED=1 exec "$@"; fi\necho "stand-in deep: no $*" >&2\nexit 1\n`);
  // Any HTTP or HTTPS request a process makes through the environment's proxy or a model SDK's base URL lands here.
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, host: request.headers.host });
    response.writeHead(502).end();
  });
  server.on('connect', (request, socket) => {
    requests.push({ method: 'CONNECT', url: request.url });
    socket.destroy();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const recorder = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...process.env,
    HOME: home, TMPDIR: temp, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'),
    PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC',
    HTTP_PROXY: recorder, HTTPS_PROXY: recorder, ALL_PROXY: recorder, http_proxy: recorder, https_proxy: recorder, all_proxy: recorder,
    NODE_USE_ENV_PROXY: '1', ANTHROPIC_BASE_URL: recorder, OPENAI_BASE_URL: recorder,
    T1333_EVENTS: join(dir, 'events.jsonl'), T1333_HOLD: join(dir, 'hold'), T1333_FLAKY: join(dir, 'flaky'),
  };
  for (const name of Object.keys(env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC_API|OPENAI_API|CODEX_|GH_|GITHUB_)/.test(name) || ['NODE_TEST_CONTEXT', 'NO_PROXY', 'no_proxy', 'NODE_OPTIONS', 'CARGO_TARGET_DIR', 'AI_AGENT'].includes(name)) delete env[name];
  }
  const box = { dir, home, env, gh, agents, deepLog, requests, children: [] };
  t.after(async () => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await new Promise((done) => server.close(done));
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
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, started: child.started, ended: Date.now() })));
  child.started = Date.now();
  return child;
}

/** A child's end, or its group stopped by its PID after `ms`: a wrong program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** `node scripts/main-watch.mjs status` in the job's clone: whether landings are open, by its first line and exit. */
export async function status(box, fx) {
  const run = await ended(launch(box, [process.execPath, JOB, 'status'], { cwd: fx.mac }), 120_000);
  const first = run.stdout.split('\n').find(Boolean) ?? '';
  const state = run.status === 0 && /^landings open\b/.test(first) ? 'open' : run.status !== 0 && /^landings paused\b/.test(first) ? 'paused' : 'unreadable';
  return { state, line: first, t: run.ended, run };
}

/**
 * One scheduled tick: `node scripts/main-watch.mjs tick` in the job's clone, with `status` asked again and again while
 * it runs. With `release`, the hold file (README: The fixture) is removed once landings read paused, or once the tick
 * ends.
 */
export async function tick(box, fx, { poll = false, release = false } = {}) {
  const child = launch(box, [process.execPath, JOB, 'tick'], { cwd: fx.mac });
  const polls = [];
  let over = false;
  const done = ended(child, 900_000).then((run) => { over = true; return run; });
  if (poll) {
    while (!over) {
      const seen = await status(box, fx);
      polls.push(seen);
      if (release && seen.state === 'paused') rmSync(box.env.T1333_HOLD, { force: true });
      await wait(100);
    }
  }
  const run = await done;
  if (release) rmSync(box.env.T1333_HOLD, { force: true });
  return { ...run, polls };
}

// The fixture's suite. Each test notes its run in the events file: which test, whether it passed, the tree it ran on
// (the tags each landing adds), and whether it ran under the throttle's grant and the hub's lease.
const NOTE = `import { appendFileSync, readdirSync } from 'node:fs';
export const tags = readdirSync(new URL('../tags/', import.meta.url)).sort();
export function note(test, ok) {
  if (!process.env.T1333_EVENTS) return;
  appendFileSync(process.env.T1333_EVENTS, JSON.stringify({ test, ok, tags, t: Date.now(), pid: process.pid, leased: process.env.T1333_LEASED === '1', throttle: Boolean(process.env.DEEP_THROTTLE) }) + '\\n');
}
`;
const SUM_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { sum } from '../lib/sum.mjs';
import { note } from './note.mjs';

test(${JSON.stringify(SUM)}, () => {
  const value = sum(2, 3);
  note('sum', value === 5);
  assert.equal(value, 5);
});
`;
// The hold: on the tree a revert of the fifth landing's break leaves (l5 there, l2 gone), the test waits while the hold
// file exists, for at most 60 s, so the tests can see landings paused before the revert lands.
const OTHER_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { double } from '../lib/double.mjs';
import { note, tags } from './note.mjs';

test(${JSON.stringify(OTHER)}, async () => {
  const hold = process.env.T1333_HOLD;
  if (hold && tags.includes('l5') && !tags.includes('l2')) {
    const end = Date.now() + 60_000;
    while (existsSync(hold) && Date.now() < end) await new Promise((done) => setTimeout(done, 50));
  }
  const value = double(2);
  note('other', value === 4);
  assert.equal(value, 4);
});
`;
// Fails once when armed: the armed file is rewritten as fired, so every later run passes.
const FLAKY_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { note } from './note.mjs';

test(${JSON.stringify(FLAKY)}, () => {
  const file = process.env.T1333_FLAKY;
  const armed = Boolean(file) && existsSync(file) && readFileSync(file, 'utf8') === 'armed';
  if (armed) writeFileSync(file, 'fired');
  note('flaky', !armed);
  assert.ok(!armed, 'failed once, as armed');
});
`;
export const GOOD_SUM = 'export const sum = (a, b) => a + b;\n';
export const BROKEN_SUM = 'export const sum = (a, b) => a - b;\n';
// A later landing's tidy-up of the same line: the break stays, and a revert of the break no longer applies.
export const TIDIED_SUM = 'export const sum = (a, b) => (a) - (b); // tidied\n';

/**
 * The fixture's scripts/lanes.mjs: this checkout's lanes.mjs whole, with its `checks` cut to the fixture's suite. The
 * unit lane is the real unit lane's node --test command, the lint lane the real lint lane's known-failures command,
 * and `typecheck` stands for every other lane, which the job never runs: it notes itself and fails.
 */
const lanesShim = () => `// The fixture's lanes (tests/acceptance/1333/README.md, The fixture).
export * from ${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href)};
export const checks = [
  { name: 'typecheck', commands: [[process.execPath, '-e', "require('node:fs').appendFileSync(process.env.T1333_EVENTS, JSON.stringify({ test: 'typecheck', tags: [] }) + '\\\\n'); process.exit(1)"]], fix: 'Not a lane the job runs.' },
  { name: 'unit', commands: [[process.execPath, '--test', 'tests/*.test.mjs']], fix: 'Repair the behavior named by the failing test.' },
  { name: 'lint', commands: [[process.execPath, 'scripts/known-failures-check.mjs']], fix: 'Give each entry named above an open issue and a date within 14 days.' },
];
`;
export const emptyKnown = () => `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [] }, null, 2)}\n`;

export const gitIn = (cwd) => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

/** This checkout's scripts/ copied into `folder`/scripts, with `known` as its known-failures.json. */
export function copyScripts(folder, known = emptyKnown()) {
  cpSync(join(CHECKOUT, 'scripts'), join(folder, 'scripts'), { recursive: true });
  writeFileSync(join(folder, 'scripts', 'known-failures.json'), known);
}

/**
 * The watched repository: `origin.git`, a bare repository standing for GitHub's; `work`, the clone the tests land
 * in; and `mac`, the clone the job runs in, left at the first commit. Main's first commit `r0` holds this checkout's
 * scripts/ with the lanes shim, the fixture's suite and `tags/base`.
 */
export function watched(box) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: box.env });
  writeFileSync(join(box.gh, 'origin.txt'), origin);
  mkdirSync(work);
  copyScripts(work);
  write(work, {
    'scripts/lanes.mjs': lanesShim(),
    'lib/sum.mjs': GOOD_SUM,
    'lib/double.mjs': 'export const double = (n) => n * 2;\n',
    'tests/note.mjs': NOTE,
    'tests/sum.test.mjs': SUM_TEST,
    'tests/other.test.mjs': OTHER_TEST,
    'tests/flaky.test.mjs': FLAKY_TEST,
    'tags/base': 'base\n',
    'README.md': 'The repository #1333\'s job watches in its acceptance tests.\n',
  });
  const git = (cwd) => (...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(work)('init', '-q', '-b', 'main');
  git(work)('add', '-A');
  git(work)('commit', '-qm', 'r0: the watched repository');
  git(work)('remote', 'add', 'origin', origin);
  git(work)('push', '-q', 'origin', 'main');
  git(box.dir)('clone', '-q', origin, mac);
  const fx = { origin, work, mac, git: git(work), r0: git(work)('rev-parse', 'HEAD'), landings: [] };
  return fx;
}

/** An issue in the stand-in's state. */
export function fileIssue(box, number, { state = 'OPEN', title = `Fixture issue ${number}`, body = 'A fixture issue.' } = {}) {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title, body, state, comments: [], labels: [] }, null, 2));
}

/**
 * A landing: branch `fixture/l<k>` from main adds `tags/l<k>` and `files`, and merges into origin's main as GitHub
 * merges pull request #92<k>, whose body says `Closes #91<k>` (its issue then closed) or `Part of #91<k>`. The merge
 * commit's message carries the same line.
 */
export function land(box, fx, { files = {}, closes = false } = {}) {
  const k = fx.landings.length + 1;
  const pr = 9200 + k, issue = 9100 + k, branch = `fixture/l${k}`, keyword = closes ? 'Closes' : 'Part of';
  const title = `Landing ${k}`;
  fx.git('checkout', '-q', '-b', branch, 'main');
  write(fx.work, { ...files, [`tags/l${k}`]: `l${k}\n` });
  fx.git('add', '-A');
  fx.git('commit', '-qm', `${title} (${keyword} #${issue})`);
  fx.git('checkout', '-q', 'main');
  fx.git('merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${pr} from ${branch}\n\n${title} (${keyword} #${issue})`);
  fx.git('push', '-q', 'origin', 'main');
  const sha = fx.git('rev-parse', 'HEAD');
  fileIssue(box, issue, { state: closes ? 'CLOSED' : 'OPEN', title: `Fixture issue ${issue}` });
  writeFileSync(join(box.gh, `pr-${pr}.json`), JSON.stringify({ number: pr, title, body: `${keyword} #${issue}`, state: 'MERGED', headRefName: branch, baseRefName: 'main', mergeCommit: { oid: sha }, url: `https://github.com/fixture/watched/pull/${pr}` }, null, 2));
  const landing = { k, sha, pr, issue, branch, tags: ['base', ...fx.landings.map((one) => `l${one.k}`), `l${k}`].sort() };
  fx.landings.push(landing);
  return landing;
}

/** origin's main, now. */
export const originMain = (fx) => gitIn(fx.origin)('rev-parse', 'main');

export const events = (box) => lines(box.env.T1333_EVENTS);
export const ghCalls = (box) => lines(join(box.gh, 'calls.jsonl'));
export const agentRuns = (box) => lines(box.agents);
export const deepCalls = (box) => (existsSync(box.deepLog) ? readFileSync(box.deepLog, 'utf8').split('\n').filter(Boolean) : []);
export const issue = (box, number) => JSON.parse(readFileSync(join(box.gh, `issue-${number}.json`), 'utf8'));
const items = (box, kind) => readdirSync(box.gh).filter((name) => name.startsWith(`${kind}-`) && name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(box.gh, name), 'utf8')));
/** Issues the job created, each with `t`, the time it was created. */
export const created = (box) => items(box, 'issue').filter((one) => one.created).sort((a, b) => a.number - b.number).map((one) => ({ ...one, t: one.created }));
/** An ask (README: The surface): an issue the job created whose title starts `Ask:`. */
export const asks = (box) => created(box).filter(({ title }) => /^Ask:/.test(title));
export const pulls = (box) => items(box, 'pr').filter((one) => one.created);

/** Whether a run's tags are a landing's tree. */
export const onTree = (tags, landing) => JSON.stringify([...tags].sort()) === JSON.stringify(landing.tags);
export const sha7 = (sha) => sha.slice(0, 7);
/** A line of `text` that names the commit by at least its first 7 characters and also holds `also`. */
export const namesCommit = (text, sha, also = '') => text.split('\n').some((line) => line.includes(sha7(sha)) && line.includes(also));

/** What a person reads at a failed assertion. */
export const dump = (box, ...runs) => [
  `gh calls:\n${ghCalls(box).map(({ args }) => JSON.stringify(args)).join('\n')}`,
  `agent runs:\n${agentRuns(box).map((run) => JSON.stringify(run)).join('\n')}`,
  `fixture test runs:\n${events(box).map(({ test, ok, tags }) => `${test} ${ok ? 'ok' : 'FAILED'} on ${tags.join(',')}`).join('\n')}`,
  ...runs.filter(Boolean).map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.slice(-6000)}\nstderr:\n${run.stderr.slice(-3000)}`),
].join('\n');

export { assert };
