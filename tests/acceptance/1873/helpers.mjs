// Helpers for #1873's acceptance tests: a sandboxed HOME and TMPDIR, stand-ins for what the repo doesn't own (gh and
// GitHub, the agent CLIs, the hub's `deep lease`, any HTTP endpoint), fixture repositories holding this checkout's
// scripts/, the main watch's tick and status, and the lint lane's known-failures command run through this checkout's
// runLanes. Parts are copied from tests/acceptance/1333/helpers.mjs, never imported. Nothing here imports the code
// under test: every surface is reached by running it (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { availableParallelism, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const JOB = join(CHECKOUT, 'scripts', 'main-watch.mjs');
export const CHECK = 'scripts/known-failures-check.mjs';
export const LONG = { timeout: 1_800_000 };
/** The variable through which the main watch's tick takes the 1-minute load it judges by (README: The surface). */
export const LOAD_VAR = 'DEEP_MAIN_WATCH_LOAD';
/** The core count the tick compares the load with: this machine's, as affected.mjs's classify reads it. */
export const CORES = availableParallelism();
/** The opt-in variable the issue names for its fixture. */
export const OPT_IN = 'DEEP_FIXTURE_OPT_IN';

/** A date `ago` days before today, as an entry's `added`. */
export const day = (ago) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
/** An entry's text ending in its issue and the day it was added, the form `failures` takes since #1333. */
export const dated = (text, issue, ago) => `${text} (#${issue}, added ${day(ago)})`;

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

// The stand-in for gh and GitHub (copied from #1333's): issues are JSON files in its folder, and every call is
// recorded. A call it doesn't know exits 1 and is recorded too, so it can't read as done.
const GH = (folder) => `import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
function show(value) {
  const fields = flag('--json');
  const pick = (item) => (fields ? Object.fromEntries(fields.split(',').map((field) => [field, field === 'comments' ? (item.comments ?? []).map((body) => ({ body })) : field === 'labels' ? (item.labels ?? []).map((name) => ({ name })) : item[field] ?? null])) : item);
  let out = Array.isArray(value) ? value.map(pick) : pick(value);
  const query = flag('-q', '--jq');
  if (query) {
    let values = [out];
    for (const part of query.replace(/^\\./, '').split(/\\.(?![^[]*\\])/).filter(Boolean)) {
      const [, name, every] = part.match(/^([\\w]*)(\\[\\])?$/) ?? refuse('stand-in gh: --jq takes a plain path only: ' + query);
      values = values.flatMap((one) => { const got = name ? one?.[name] : one; return every ? (got ?? []) : [got]; });
    }
    for (const one of values) console.log(typeof one === 'object' && one !== null ? JSON.stringify(one) : String(one ?? ''));
    return;
  }
  console.log(JSON.stringify(out));
}
const [noun, verb] = args;
const ref = positional()[0];
if (noun === 'auth' && verb === 'status') { console.log('Logged in to github.com as fixture'); process.exit(0); }
if (noun === 'repo' && verb === 'view') { show({ nameWithOwner: 'fixture/watched', url: 'https://github.com/fixture/watched', defaultBranchRef: { name: 'main' }, name: 'watched', owner: { login: 'fixture' } }); process.exit(0); }
if (noun === 'issue') {
  if (verb === 'create') {
    const title = flag('--title', '-t');
    if (!title) refuse('stand-in gh: issue create needs --title');
    const issue = { number: next('issue', 9900), title, body: text('--body', '-b') ?? '', state: 'OPEN', comments: [], labels: [], created: Date.now() };
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
      issue.comments.push(text('--body', '-b') ?? '');
      save('issue', issue);
    } else if (verb === 'edit') save('issue', issue);
    else refuse('stand-in gh: no ' + args.join(' '));
  }
  process.exit(0);
}
if (noun === 'pr') {
  if (verb === 'list') { show(all('pr')); process.exit(0); }
  const pr = load('pr', number(ref));
  if (!pr) refuse('stand-in gh: no pull request ' + ref);
  if (verb === 'view') { show(pr); process.exit(0); }
}
refuse('stand-in gh: no ' + args.join(' '));
`;

// The agent CLIs' stand-in (copied from #1333's): it records its run, changes nothing and says so.
const AGENT = (log, bin) => `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bin: ${JSON.stringify(bin)}, args: process.argv.slice(2), cwd: process.cwd(), t: Date.now() }) + '\\n');
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'stand-in agent: I changed nothing' }));
`;

/**
 * A sandbox removed after the test: its own HOME, TMPDIR, git identity, the stand-ins first on PATH, every proxy and
 * model endpoint pointed at a recorder this process runs. Every process it started is stopped by its group's PID.
 */
export async function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1873-')));
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
  // The hub's `deep lease` (#1015), which scripts/lease calls first: it runs the command. Any other call exits 1.
  script(join(bin, 'deep'), '#!/bin/sh\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; exec "$@"; fi\necho "stand-in deep: no $*" >&2\nexit 1\n');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
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
  };
  for (const name of Object.keys(env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC_API|OPENAI_API|CODEX_|GH_|GITHUB_)/.test(name) || ['NODE_TEST_CONTEXT', 'NO_PROXY', 'no_proxy', 'NODE_OPTIONS', 'CARGO_TARGET_DIR', 'AI_AGENT'].includes(name)) delete env[name];
  }
  const box = { dir, home, env, gh, agents, requests, children: [] };
  t.after(async () => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status and output. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return child;
}

/** A child's end, or its group stopped by its PID after `ms`: a wrong program that never ends fails at an assertion. */
export function ended(child, ms) {
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));
export const show = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.slice(-8000)}\nstderr:\n${run.stderr.slice(-3000)}`;

/** An issue in the stand-in's state. */
export function fileIssue(box, number, state = 'OPEN') {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title: `Fixture issue ${number}`, body: 'A fixture issue.', state, comments: [], labels: [] }, null, 2));
}
export const agentRuns = (box) => lines(box.agents);

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};
export const gitIn = (box, cwd) => (...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A known-failures.json: every key the file has at the base, each defaulting to empty. */
export const known = ({ failures = {}, lint = {}, lintIssues = {}, timing = [], timingIssues = {}, skips = [] } = {}) =>
  `${JSON.stringify({ failures, lint, lintIssues, timing, timingIssues, skips }, null, 2)}\n`;

/** This checkout's scripts/ copied into `folder`/scripts, with `file` as its known-failures.json. */
function copyScripts(folder, file) {
  cpSync(join(CHECKOUT, 'scripts'), join(folder, 'scripts'), { recursive: true });
  writeFileSync(join(folder, 'scripts', 'known-failures.json'), file);
}

/**
 * A fixture repository for the lint lane: a git repository at `name` in the sandbox holding this checkout's scripts/,
 * `file` as its known-failures.json, and `files`. Each path in `deleted` is committed first and then removed by a
 * later commit, as a test deleted on main.
 */
export function lintRepo(box, name, file, files = {}, deleted = {}) {
  const repo = join(box.dir, name);
  mkdirSync(repo);
  copyScripts(repo, file);
  write(repo, { ...files, ...deleted, 'README.md': `A fixture repository for #1873's lint lane.\n` });
  const git = gitIn(box, repo);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  if (Object.keys(deleted).length) {
    git('rm', '-q', ...Object.keys(deleted));
    git('commit', '-qm', 'fixture: delete a test');
  }
  return repo;
}

/**
 * This checkout's lint lane cut to its known-failures command, run by this checkout's runLanes in `repo` (as #1333's
 * known-failures test runs it). Exit 9 says the lint lane holds no such command.
 */
export function lintLane(box, repo) {
  const lanes = pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href;
  const code = `const { checks, runLanes } = await import(${JSON.stringify(lanes)});
const lint = checks.find(({ name }) => name === 'lint');
const commands = lint.commands.filter((command) => command.includes(${JSON.stringify(CHECK)}));
if (!commands.length) { console.log('NO-COMMAND the lint lane runs no ${CHECK}'); process.exit(9); }
process.exitCode = runLanes([{ ...lint, commands }], { cwd: ${JSON.stringify(repo)} });`;
  return ended(launch(box, [process.execPath, '--input-type=module', '-e', code], { cwd: repo }), 600_000);
}
/** Whether a lint lane run read FAIL; and whether it read PASS. */
export const failed = (run) => run.status !== 0 && run.status !== 9 && /^FAIL lint\b/m.test(run.stdout);
export const passed = (run) => run.status === 0 && /^PASS lint\b/m.test(run.stdout);
/** The lines of `text` that read a verdict below PASS. */
export const verdicts = (text) => text.split('\n').filter((line) => /^\s*(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line));

/**
 * The known-failures check of this checkout run on this checkout's own file and tree, as on main (README: Main), with
 * every issue the file names open in the stand-in, so only what the file itself says can fail it.
 */
export async function checkOnMain(box) {
  const text = readFileSync(join(CHECKOUT, 'scripts', 'known-failures.json'), 'utf8');
  for (const [, n] of text.matchAll(/#(\d+)\b/g)) fileIssue(box, Number(n));
  const run = await ended(launch(box, [process.execPath, join(CHECKOUT, CHECK)], { cwd: CHECKOUT }), 300_000);
  return { run, file: JSON.parse(text) };
}

/**
 * The fixture's lanes for the main watch: this checkout's lanes.mjs whole, with its `checks` cut to the unit lane's
 * node --test command and the lint lane's known-failures command (as #1333's fixture does).
 */
const lanesShim = () => `// The fixture's lanes (tests/acceptance/1873/README.md, The fixtures).
export * from ${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href)};
export const checks = [
  { name: 'unit', commands: [[process.execPath, '--test', 'tests/*.test.mjs']], fix: 'Repair the behavior named by the failing test.' },
  { name: 'lint', commands: [[process.execPath, 'scripts/known-failures-check.mjs']], fix: 'Mend each entry named above.' },
];
`;

/**
 * The watched repository: `origin.git`, a bare repository standing for GitHub's; `work`, the clone landings are made
 * in; and `mac`, the clone the job runs in, left at the first commit. The first commit holds this checkout's scripts/
 * with the lanes shim, `file` as known-failures.json, and `files`. Each of `landings` is a set of files merged into
 * origin's main as a pull request's merge commit.
 */
export function watched(box, file, files, landings = []) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: box.env });
  mkdirSync(work);
  copyScripts(work, file);
  write(work, { 'scripts/lanes.mjs': lanesShim(), ...files, 'README.md': `The repository #1873's main watch scenes watch.\n` });
  const git = gitIn(box, work);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'r0: the watched repository');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  landings.forEach((changes, i) => {
    const k = i + 1, branch = `fixture/l${k}`;
    git('checkout', '-q', '-b', branch, 'main');
    write(work, changes);
    git('add', '-A');
    git('commit', '-qm', `Landing ${k} (Part of #${9100 + k})`);
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${9200 + k} from ${branch}\n\nLanding ${k} (Part of #${9100 + k})`);
    git('push', '-q', 'origin', 'main');
    fileIssue(box, 9100 + k);
  });
  return { origin, work, mac };
}

/** `node scripts/main-watch.mjs status` in the job's clone: open or paused, by its first line and exit. */
export async function status(box, fx) {
  const run = await ended(launch(box, [process.execPath, JOB, 'status'], { cwd: fx.mac }), 120_000);
  const first = run.stdout.split('\n').find(Boolean) ?? '';
  const state = run.status === 0 && /^landings open\b/.test(first) ? 'open' : run.status !== 0 && /^landings paused\b/.test(first) ? 'paused' : 'unreadable';
  return { state, line: first, run };
}

/** One scheduled tick in the job's clone with `env` added, `status` polled while it runs when `poll` is set. */
export async function tick(box, fx, { env = {}, poll = false } = {}) {
  const child = launch(box, [process.execPath, JOB, 'tick'], { cwd: fx.mac, env });
  const polls = [];
  let over = false;
  const done = ended(child, 1_200_000).then((run) => { over = true; return run; });
  while (poll && !over) {
    polls.push(await status(box, fx));
    await wait(500);
  }
  return { ...(await done), polls };
}

/** A line of `text` that starts with `word` and holds every one of `parts`. */
export const lineWith = (text, word, ...parts) => text.split('\n').find((line) => line.trimStart().startsWith(word) && parts.every((part) => line.includes(part)));

export { assert };
