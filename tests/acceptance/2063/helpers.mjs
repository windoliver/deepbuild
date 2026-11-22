// Helpers for #2063's acceptance tests: a scratch copy of the checkout, a fake `gh` on PATH that holds a small tracker
// (open and closed issues), the not-event-kinds list, and one run of the catalogue drift lane through the copy's own
// scripts/lanes.mjs and `runLanes`, as scripts/checks.mjs runs its lanes. The approach follows
// tests/acceptance/605/helpers.mjs and tests/acceptance/1329/helpers.mjs (copied here, never imported).
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// The lane is the one entry of `checks` in scripts/lanes.mjs that #605's suite picks (README: The surface).
export const LANE = /catalogue|drift/i;
// The list the issue names, `<name> #<issue>` a line.
export const LIST = 'scripts/not-event-kinds.txt';
// The docs the lane reads beside the open issues.
export const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
// The recorded copy of the tracker (README: The recorded tracker copy).
export const RECORD = join(CHECKOUT, 'tests/acceptance/2063/fixtures/open-issues-2026-11-14.json');
// The list as recorded that day: the record's names that are no event kinds, each beside a recorded issue that names it.
export const RECORDED_LIST = join(CHECKOUT, 'tests/acceptance/2063/fixtures/not-event-kinds-2026-11-14.txt');

// What the copy holds of the checkout: the root's own files, the scripts, the contracts package (the catalogue's
// schemas and source) and, added below, that package's built dist/ and two design docs. docs/ as a whole is 256 MB of
// evidence the lane never reads, and no other package's dist/ is copied, so the lane runs unleased in the copy
// whether or not the checkout's CLI is built.
const CONTRACTS_DIST = 'packages/contracts/dist';
const COPIED = (file) => !file.includes('/') || file.startsWith('scripts/') || file.startsWith('packages/contracts/');

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` is a copy of the part of this checkout's working
 * tree the lane can read (COPIED: tracked files and untracked files git doesn't ignore, plus the contracts package's
 * built dist/), with node_modules linked to the checkout's, a fresh `git init` and the checkout's origin URL as its remote.
 * `docs: 'checkout'` copies the checkout's two design docs; `docs: 'planted'` writes two small docs that name only
 * catalogued kinds, so a test plants one thing and everything else is clean. Ignored files such as
 * target/open-issues.json are never copied.
 */
export function makeFixture(t, { docs }) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2063-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const listed = checkoutGit(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter((file) => file && COPIED(file));
  // Only the contracts package's build: with packages/cli/dist in the copy, scripts/lease would run the lane through
  // the built CLI, which a copy without the CLI's package can't start, so a fully built checkout would fail in setup.
  if (existsSync(join(CHECKOUT, CONTRACTS_DIST))) listed.push(...walk(CONTRACTS_DIST));
  if (docs === 'checkout') listed.push(...DOCS);
  for (const file of new Set(listed)) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  if (docs === 'planted') {
    writeRepoFile(repo, DOCS[0], [
      '# Technical design',
      '',
      'A planted design doc (#2063\'s acceptance tests). It is not the real one.',
      '',
      'The hub appends `verdict.made` once a check runs, and `claim.made` when the agent says it is done. Settings live in `rules.json`.',
      '',
    ].join('\n'));
    writeRepoFile(repo, DOCS[1], [
      '# Canvas primitives',
      '',
      'A planted design doc (#2063\'s acceptance tests). It is not the real one.',
      '',
      '### The event catalogue',
      '',
      'The canvas reads the event kinds `user.ask`, `tool.before` and `ask.created`.',
      '',
    ].join('\n'));
  }
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: CHECKOUT, encoding: 'utf8' }).stdout.trim();
  fixtureGit(repo, ['init', '-q', '-b', 'change']);
  fixtureGit(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

const walk = (dir) => readdirSync(join(CHECKOUT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const checkoutGit = (args) => {
  const r = spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

// Git in the fixture, with a fixed identity, no signing and no hooks from the caller's config.
const fixtureGit = (repo, args) => {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} in the fixture failed: ${r.stderr}`);
  return r.stdout;
};

/** Writes a file in the fixture, making its folders. */
export function writeRepoFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** Writes the fixture's not-event-kinds list as exactly these `[name, issue]` entries, one `<name> #<issue>` a line. */
export const writeList = (repo, entries) => writeRepoFile(repo, LIST, entries.map(([name, issue]) => `${name} #${issue}\n`).join(''));

/**
 * The entries of a not-event-kinds list's text, as scripts/planned-names.txt is read: blank lines and lines starting
 * with `#` are skipped, and every other line is `<name> #<issue>`. A line of another shape comes back as `{ line }`.
 */
export const listEntries = (text) => text.split(/\r?\n/).map((raw) => raw.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
  const entry = line.match(/^(.+?)\s+#(\d+)$/);
  return entry ? { name: entry[1], issue: Number(entry[2]), line } : { line };
});

// The planted tracker's five names that are no event kinds, as #2063 gives them, each with the issue that defines it.
// Every family (plan, process, archive, stack, move) is the family of a catalogued kind, so the base's lane reads each
// name as an event kind.
export const LISTED = [['plan.overlay', 9612], ['process.conserve', 9611], ['archive.scene', 9610], ['stack.slot', 9609], ['move.feel', 9608]];

const DEFINING = {
  9612: '- Add `plan.overlay`, a check that lays the built walls back over the drawing\'s ink and fails a build that doesn\'t land on it.',
  9611: '- Kind rules: `process.conserve`, which holds entities made equal to entities kept plus entities out at every step.',
  9610: '- A new fixture `archive.scene`, which archives with its 19 entries.',
  9609: '- The stack serves the base checkout\'s tree and takes a `stack.slot` as a base run\'s does.',
  9608: '- The kit\'s checks: `move.feel` (a fixture course\'s jump peak, coyote window and step up against the brief\'s values).',
  // An issue that uses two of the names another issue defines, as #1261 uses #1260's check and #983 uses #980's rule.
  9607: '- The terminal passes `plan.overlay` on the plan with a share of at least 0.9, and `process.conserve` passes at every step.',
};

/** A clean planted issue body: catalogued kinds and backticked names in no catalogued family. `extra` adds Scope lines. */
export function cleanBody(number, extra = []) {
  return [
    `A planted issue body for #2063's acceptance tests (${number}). It is not a real issue.`,
    '',
    '### Scope',
    '- The hub appends `verdict.made` once a check runs, and `claim.made` when the agent says it is done.',
    '- It reads the event kinds `user.ask`, `tool.before` and `ask.created`.',
    '- Settings live in `rules.json`, and `hold_until_ms` stays a number.',
    ...extra,
  ].join('\n');
}

/**
 * The planted tracker, newest first as gh lists issues: #9640 down to #9601, all open. #9612 to #9608 each define one
 * of LISTED's names, #9607 uses two of them, and the rest are clean. `bodies` replaces the bodies of the issues it
 * names, and `closed` closes the issues it names (their bodies stay). #9605 is the 36th, so a lane that keeps gh's
 * default limit of 30 never reads it.
 */
export function tracker({ bodies = {}, closed = [] } = {}) {
  return Array.from({ length: 40 }, (_, i) => {
    const number = 9640 - i;
    return {
      number,
      title: `Fixture issue ${number}`,
      state: closed.includes(number) ? 'CLOSED' : 'OPEN',
      body: bodies[number] ?? cleanBody(number, DEFINING[number] ? [DEFINING[number]] : []),
    };
  });
}

/**
 * Puts a fake `gh` first on PATH, over `issues` (each `{number, title, state: OPEN | CLOSED, body}`; a recorded
 * `{number, body}` is open). It answers `gh issue list … --json <fields>` for `--state open` (the default), `closed`
 * or `all`, cut to `--limit`/`-L` (30 when absent, as gh does); `gh issue view <number> --json <fields>`;
 * `gh auth status` and `gh --version`. Anything else fails, and `--jq` and `--template` are ignored, so the lane parses
 * the JSON itself. Each call is logged.
 */
export function fakeGh(sandbox, issues) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(issues.map((issue) => ({ title: `Issue ${issue.number}`, state: 'OPEN', ...issue }))));
  const script = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(sandbox, 'gh.log'))}, JSON.stringify(args) + '\\n');
const value = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
};
// The exit status is set, never forced: process.exit would cut a long list short on a pipe.
const fail = (message) => { console.error(message); process.exitCode = 1; };
function answer() {
  if (args[0] === '--version') return console.log('gh version 2.99.0 (fake, #2063 acceptance tests)');
  if (args[0] === 'auth' && args[1] === 'status') return console.log('github.com\\n  Logged in to github.com (fake)');
  if (args[0] !== 'issue' || (args[1] !== 'list' && args[1] !== 'view')) return fail('fake gh: unsupported command: gh ' + args.join(' '));
  const fields = value('--json');
  if (!fields) return fail('fake gh: this test answers gh issue ' + args[1] + ' only with --json');
  const issues = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8'));
  const shown = (issue) => Object.fromEntries(fields.split(',').map((f) => f.trim()).filter((k) => k in issue).map((k) => [k, issue[k]]));
  if (args[1] === 'list') {
    const state = (value('--state', '-s') ?? 'open').toLowerCase();
    const limit = Number(value('--limit', '-L') ?? 30);
    return console.log(JSON.stringify(issues.filter((i) => state === 'all' || i.state.toLowerCase() === state).slice(0, limit).map(shown)));
  }
  const issue = issues.find((i) => i.number === Number(String(args[2]).replace(/^#/, '').split('/').at(-1)));
  if (!issue) return fail('GraphQL: Could not resolve to an issue or pull request with the number of ' + args[2] + '. (repository.issue)');
  console.log(JSON.stringify(shown(issue)));
}
answer();
`;
  const gh = join(sandbox, 'bin', 'gh');
  writeFileSync(gh, script);
  chmodSync(gh, 0o755);
}

/**
 * The sandboxed environment: HOME, TMPDIR and the XDG folders in the sandbox, no GitHub token or host, no cached open
 * issues (DEEP_OPEN_ISSUES), the local preflight, and the fake gh first on PATH.
 */
export function sandboxEnv(sandbox) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT']) delete env[key];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

/**
 * Runs the catalogue drift lane alone in a fresh scratch copy, over `issues` and, when `list` is given, with the copy's
 * not-event-kinds list replaced by `list` (entries for writeList, or the file's text). The lane runs in a child process
 * with cwd at the copy: the copy's own scripts/lanes.mjs, the one entry of `checks` whose name matches LANE, and
 * `runLanes([lane])`, the call scripts/checks.mjs makes over every lane. Returns the lane's name, its verdict states,
 * the exit status (runLanes' return) and the output.
 */
export const TIMEOUT_MS = 900_000;
export function runLane(t, { docs, issues, list }) {
  const { sandbox, repo } = makeFixture(t, { docs });
  if (typeof list === 'string') writeRepoFile(repo, LIST, list);
  else if (list) writeList(repo, list);
  fakeGh(sandbox, issues);
  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lanes = checks.filter((lane) => ${LANE}.test(lane.name));
if (lanes.length !== 1) {
  console.log('NO LANE: scripts/lanes.mjs checks has ' + lanes.length + ' lanes matching ${LANE}, of ' + JSON.stringify(checks.map((l) => l.name)));
  process.exit(3);
}
console.log('LANE ' + lanes[0].name);
process.exitCode = runLanes(lanes);
`;
  // runLanes waits for the machine's throttle, so a loaded machine can hold a lane for minutes.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env: sandboxEnv(sandbox), encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED: the lane didn't finish in ${TIMEOUT_MS / 1000} s and was stopped (${r.signal})` : ''}`;
  const name = output.match(/^LANE (.+)$/m)?.[1];
  if (!name) throw new Error(`no catalogue drift lane ran:\n${output}`);
  const lines = output.split('\n');
  // runLanes prints `PASS <name> (…)` or `<STATE> <name>: <reason>`.
  const verdicts = lines.filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^[A-Z]+ ${escape(name)}:`).test(l)).map((l) => l.split(' ')[0]);
  return { status: r.status, signal: r.signal, output, name, lines, verdicts };
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An output line that holds a text; with `number`, one that also holds that issue's number as a whole number (`#9605`, `issue 9605`). */
export const naming = (run, text, number) => run.lines.find((l) => l.includes(text) && (number === undefined || new RegExp(`(?<!\\d)${number}(?!\\d)`).test(l)));
