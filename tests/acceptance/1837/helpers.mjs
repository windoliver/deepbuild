// Helpers for #1837's acceptance tests (#1837.78b8f3bb): the eight items' design lines as checks over a text, a scratch
// copy of the checkout, a fake `gh` on PATH over a fixed open-issue list, and one run of the catalogue drift lane
// through the copy's own scripts/lanes.mjs and `runLanes`, as scripts/checks.mjs runs its lanes. The scratch copy,
// fake gh and lane runner are copied from tests/acceptance/2063/helpers.mjs (itself after 605's and 1329's), never
// imported.
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
// The docs the lane reads beside the open issues.
export const DOCS = [DESIGN, 'docs/canvas-primitives.md'];
// The lane is the one entry of `checks` in scripts/lanes.mjs whose name matches this, as #605's and #2063's suites pick it.
export const LANE = /catalogue|drift/i;
export const LIST = 'scripts/not-event-kinds.txt';
export const SCHEMAS = 'packages/contracts/schemas';

// The event kinds the issue's Scope names (README: Which names are event kinds). The others it names are a schema
// (`access@1`), a done.yaml key (`resources`), an adapter facts field (`transcripts.archived`), a hub slot's interface
// (`asset.library@1`) and a method (`RecordReader.sessions()`).
export const KINDS = ['ask.superseded', 'ask.moot', 'task.completed', 'session.archived', 'resource.created', 'transcript.archived', 'archive.quiet', 'ci.archived'];

// The eight items of the Scope, each a list of facts. A fact holds when one line of the design holds every one of its
// markers (README: How "has its line" is checked). A marker is a regular expression over the line.
const tick = (name) => new RegExp('`' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`');
export const ITEMS = [
  { item: '#112', facts: [
    { what: 'the configuration eval, its gate lane and RecordReader.sessions()', markers: [/configuration evals?\b/i, /`gate`|\bgate\b/, /\blane\b/, tick('RecordReader.sessions()')] },
  ] },
  { item: '#724', facts: [
    { what: 'perf judges instructions retired against the merge base', markers: [/\bperf\b/i, /instructions retired/i, /merge base/i] },
  ] },
  { item: '#723', facts: [
    { what: 'learned changes that loosen safety are held for you', markers: [/\blearned\b/i, /loosen/i, /safety/i, /held for you/i] },
    { what: 'learned step specs are checked again when they load', markers: [/\blearned\b/i, /step specs?\b/i, /checked again/i, /\bloads?\b/i] },
  ] },
  { item: '#907', facts: [
    { what: "the check slot kept for a held stop's quick checks", markers: [/\bslot\b/i, /\bkeeps?\b|\bkept\b/i, /held stop/i, /fast-lane checks|quick checks/i] },
    { what: 'the 30-minute cap on slow checks held by background work', markers: [/30 minutes|30-minute/i, /background work/i, /slow checks/i] },
  ] },
  { item: '#606', facts: [
    { what: '`ask.superseded`', markers: [tick('ask.superseded')] },
    { what: '`ask.moot`', markers: [tick('ask.moot')] },
    { what: '`task.completed`', markers: [tick('task.completed')] },
    { what: '`access@1`', markers: [tick('access@1')] },
  ] },
  { item: '#342', facts: [
    { what: '`resources`, recorded as `resource.created`', markers: [tick('resources'), /`resource\.created(@1)?`/] },
    { what: '`session.archived`', markers: [/`session\.archived(@1)?`/] },
    { what: 'the facts field `transcripts.archived`', markers: [/\bfacts\b/i, /`transcripts\.archived`|`archived`[^|]*`transcripts`|`transcripts`[^|]*`archived`/] },
  ] },
  { item: '#20', facts: [
    { what: 'retention that keeps CI logs', markers: [/retention/i, /\bkept\b|\bkeeps?\b/i, /\bCI\b/, /\blogs?\b/i, tick('ci.archived')] },
    { what: "`transcript.archived@2`'s `source`", markers: [/`transcript\.archived(@2)?`/, tick('source'), /second version|@2\b|version 2/i] },
    { what: '`archive.quiet`', markers: [tick('archive.quiet')] },
    { what: '`ci.archived`', markers: [tick('ci.archived')] },
  ] },
  { item: '#1731', facts: [
    { what: 'the hub-slot table row for `asset.library@1`', markers: [/^\|/, tick('asset.library@1')], table: /^\|\s*Slot\s*\|/ },
  ] },
];

/** The lines of `text` (1-based) that hold a fact: every marker on one line, and, for a table row, under a table whose header matches. */
export function factLines(text, fact) {
  const lines = text.split('\n');
  const hits = [];
  let header = '';
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('|') && !(lines[i - 1] ?? '').startsWith('|')) header = line;
    if (fact.markers.every((m) => m.test(line)) && (!fact.table || fact.table.test(header))) hits.push(i + 1);
  }
  return hits;
}

/** Each item of ITEMS whose facts a design text lacks: `[{ item, missing: [what] }]`, empty when every item has its line. */
export function missingItems(text) {
  return ITEMS.flatMap(({ item, facts }) => {
    const missing = facts.filter((fact) => factLines(text, fact).length === 0).map((f) => f.what);
    return missing.length ? [{ item, missing }] : [];
  });
}

/** The design text with every line removed that holds one of an item's facts: a planted design missing that item's line. */
export function withoutItem(text, item) {
  const { facts } = ITEMS.find((i) => i.item === item);
  const drop = new Set(facts.flatMap((fact) => factLines(text, fact)));
  return text.split('\n').filter((_, i) => !drop.has(i + 1)).join('\n');
}

export const readDesign = () => readFileSync(join(CHECKOUT, DESIGN), 'utf8');

// What the copy holds of the checkout: the root's own files, the scripts, the contracts package (the catalogue's
// schemas and source) and, added below, that package's built dist/ and the two design docs.
const CONTRACTS_DIST = 'packages/contracts/dist';
const COPIED = (file) => !file.includes('/') || file.startsWith('scripts/') || file.startsWith('packages/contracts/');

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` is a copy of the part of this checkout's working
 * tree the lane can read (tracked files and untracked files git doesn't ignore, the contracts package's built dist/
 * and the checkout's two design docs), with node_modules linked to the checkout's, a fresh `git init` and the
 * checkout's origin URL as its remote.
 */
export function makeFixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1837-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const listed = checkoutGit(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter((file) => file && COPIED(file));
  // Only the contracts package's build: with packages/cli/dist in the copy, scripts/lease would run the lane through
  // the built CLI, which a copy without the CLI's package can't start.
  if (existsSync(join(CHECKOUT, CONTRACTS_DIST))) listed.push(...walk(CONTRACTS_DIST));
  listed.push(...DOCS);
  for (const file of new Set(listed)) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
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

/** Removes from the copy every version of an event kind's schema, `<kind>@<n>.json`: a planted catalogue missing that kind. */
export function dropKind(repo, kind) {
  const dir = join(repo, SCHEMAS);
  const gone = readdirSync(dir).filter((file) => new RegExp(`^${kind.replace(/\./g, '\\.')}@\\d+\\.json$`).test(file));
  for (const file of gone) rmSync(join(dir, file));
  return gone;
}

/**
 * The fixed open-issue list, newest first: 40 planted issues, #9640 down to #9601, whose bodies name only kinds no
 * Scope item names (`verdict.made`, `claim.made`, `user.ask`) and a backticked name in no catalogued family
 * (`rules.json`), and, so the copy's own not-event-kinds list stays valid, one open issue per entry of the checkout's
 * list, numbered as the entry and naming its name in backticks. No body names any of KINDS.
 */
export function openIssueList() {
  const planted = Array.from({ length: 40 }, (_, i) => ({
    number: 9640 - i,
    title: `Fixture issue ${9640 - i}`,
    state: 'OPEN',
    body: [`A planted issue body for #1837's acceptance tests (${9640 - i}). It is not a real issue.`, '', '### Scope',
      '- The hub appends `verdict.made` once a check runs, and `claim.made` when the agent says it is done.',
      '- It reads `user.ask`, and settings live in `rules.json`.'].join('\n'),
  }));
  const listPath = join(CHECKOUT, LIST);
  const entries = existsSync(listPath) ? readFileSync(listPath, 'utf8').split(/\r?\n/).map((l) => l.trim().match(/^(\S+)\s+#(\d+)$/)).filter(Boolean) : [];
  const byIssue = new Map();
  for (const [, name, issue] of entries) byIssue.set(Number(issue), [...(byIssue.get(Number(issue)) ?? []), name]);
  const listed = [...byIssue].map(([number, names]) => ({
    number, title: `Fixture issue ${number}`, state: 'OPEN',
    body: `A planted issue body for #1837's acceptance tests (${number}). It defines ${names.map((n) => `\`${n}\``).join(', ')}, which are no event kinds.`,
  }));
  return [...planted, ...listed.sort((a, b) => b.number - a.number)];
}

/**
 * Puts a fake `gh` first on PATH, over `issues`. It answers `gh issue list … --json <fields>` for `--state open` (the
 * default), `closed` or `all`, cut to `--limit`/`-L` (30 when absent, as gh does); `gh issue view <number> --json
 * <fields>`; `gh auth status` and `gh --version`. Anything else fails, and `--jq` and `--template` are ignored.
 */
export function fakeGh(sandbox, issues) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(issues));
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
const fail = (message) => { console.error(message); process.exitCode = 1; };
function answer() {
  if (args[0] === '--version') return console.log('gh version 2.99.0 (fake, #1837 acceptance tests)');
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

/** The sandboxed environment: HOME, TMPDIR and XDG folders in the sandbox, no GitHub token or host, no cached open issues, and the fake gh first on PATH. */
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
 * Runs the catalogue drift lane alone in a fresh scratch copy over the fixed open-issue list, after `plant(repo)` when
 * given. The lane runs in a child process with cwd at the copy: the copy's own scripts/lanes.mjs, the one entry of
 * `checks` whose name matches LANE, and `runLanes([lane])`. Returns the lane's name, its verdict states, the exit
 * status, the output and its lines.
 */
export const TIMEOUT_MS = 900_000;
export function runLane(t, { plant } = {}) {
  const { sandbox, repo } = makeFixture(t);
  const planted = plant ? plant(repo) : undefined;
  fakeGh(sandbox, openIssueList());
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
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env: sandboxEnv(sandbox), encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED: the lane didn't finish in ${TIMEOUT_MS / 1000} s and was stopped (${r.signal})` : ''}`;
  const name = output.match(/^LANE (.+)$/m)?.[1];
  if (!name) throw new Error(`no catalogue drift lane ran:\n${output}`);
  const lines = output.split('\n');
  const verdicts = lines.filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^[A-Z]+ ${escape(name)}:`).test(l)).map((l) => l.split(' ')[0]);
  return { status: r.status, output, name, lines, verdicts, planted, repo };
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The output lines that name an event kind as a whole name: not as part of a longer dotted name or a schema file. */
export const naming = (run, kind) => run.lines.filter((l) => new RegExp(`(?<![\\w.])${escape(kind)}(?![\\w.@])`).test(l));

/** The kinds the copy's own published catalogue holds, through the contracts package's public entry (its built dist/). */
export function catalogueKinds(repo) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const { catalogue } = await import(${JSON.stringify(pathToFileURL(join(repo, CONTRACTS_DIST, 'index.js')).href)}); console.log(JSON.stringify([...new Set(catalogue().map((e) => e.kind))]));`], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the contracts package's catalogue() didn't load (npm run build -w packages/contracts):\n${r.stderr}`);
  return new Set(JSON.parse(r.stdout));
}
