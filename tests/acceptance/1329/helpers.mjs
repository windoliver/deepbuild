// Helpers for #1329's acceptance tests: a scratch copy of the checkout with a git history (origin/main and a change on
// top), a fake `gh` on PATH, the planted planned-names and studied-names entries, and runs of the drift, design links and
// public-text lanes through the copy's own scripts/lanes.mjs and `runLanes`, as scripts/checks.mjs runs its lanes. The
// approach follows tests/acceptance/910/helpers.mjs and tests/acceptance/605/helpers.mjs (copied here, never imported).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';

// The lanes (README: The surface). Each key picks exactly one entry of `checks` in scripts/lanes.mjs.
export const LANES = {
  // The drift lane. Its name can't match #605's /catalogue|drift/i (its suite needs exactly one such lane).
  drift: { match: /\bnames?\b/i },
  // #910's design links lane, as its suite picks it.
  links: { match: /\blinks?\b/i, not: /catalogue|drift/i },
  // The public-text lane.
  public: { match: /\bpublic\b/i },
};

// The repo files the tests plant entries into (README: The surface).
export const PLANNED = 'scripts/planned-names.txt';
export const STUDIED = 'scripts/studied-names.json';

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` is a copy of this checkout's working tree (tracked
 * files and untracked files git doesn't ignore, plus each package's built dist/ when there is one), with node_modules
 * linked to the checkout's when it has one, a fresh `git init`, the checkout's origin URL as its remote, and no commit
 * yet: `commit` makes them. Ignored files such as target/open-issues.json are never copied.
 */
export function makeFixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1329-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const listed = checkoutGit(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  for (const pkg of readdirSync(join(CHECKOUT, 'packages'))) {
    const dist = join('packages', pkg, 'dist');
    if (existsSync(join(CHECKOUT, dist))) listed.push(...walk(dist));
  }
  for (const file of listed) {
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

/** Commits everything in the fixture. `base` also points origin/main at it, so later commits are the change. */
export function commit(repo, message, { base = false } = {}) {
  fixtureGit(repo, ['add', '-A']);
  fixtureGit(repo, ['commit', '-q', '--allow-empty', '-m', message]);
  if (base) fixtureGit(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

/** Writes a file in the fixture, making its folders. */
export function writeRepoFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** Appends text after a fixture file's last line, so no existing line moves. */
export const appendRepoFile = (repo, path, text) => appendFileSync(join(repo, path), `\n${text}\n`);

/** Adds `<name> #<issue>` lines to the fixture's planned-names list, making the file if it's missing. */
export function plantPlanned(repo, entries) {
  const path = join(repo, PLANNED);
  const had = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeRepoFile(repo, PLANNED, `${had}${had && !had.endsWith('\n') ? '\n' : ''}${entries.map(([name, issue]) => `${name} #${issue}`).join('\n')}\n`);
}

/** The hex SHA-256 of `salt` followed by the name lowercased, the studied-names file's hash. */
export const saltedHash = (salt, name) => createHash('sha256').update(salt + name.toLowerCase()).digest('hex');
/** The same without the salt: what a salt-free list would hold. */
export const plainHash = (name) => createHash('sha256').update(name.toLowerCase()).digest('hex');

/**
 * Adds a salted hash for each invented name to the fixture's studied-names file, under its salt (a fresh one when the
 * file is missing). Returns the salt and every hash the file then holds.
 */
export function plantStudied(repo, names) {
  const path = join(repo, STUDIED);
  const list = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { salt: randomBytes(16).toString('hex'), hashes: [] };
  list.hashes.push(...names.map((name) => saltedHash(list.salt, name)));
  writeRepoFile(repo, STUDIED, `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

// Real headings of the two docs at the base, by their GitHub slugs.
const TARGETS = [
  'docs/technical-design.md#how-runs-become-one-of-five-verdicts',
  'docs/technical-design.md#decided',
  'docs/canvas-primitives.md#the-event-catalogue',
];

/**
 * A clean issue body: a design link to a real heading, `deep` commands and agent tools the design holds, and links
 * outside docs/. `extra` adds lines to its Scope.
 */
export function cleanBody(number, { link = `${BLOB}${TARGETS[number % TARGETS.length]}`, extra = [] } = {}) {
  return [
    `A clean issue body for #1329's acceptance tests (${number}). It is not a real issue.`,
    '',
    `**Epic:** #5 · **Design:** [The section this follows](${link})`,
    '',
    '### Scope',
    '- `deep doctor` reports it, and `deep env up` leases what it needs.',
    '- The agent reads it with `deep_show` and finds it with `deep_search`.',
    `- A change in [scripts/checks.mjs](${BLOB}scripts/checks.mjs), under [the proof rules](${BLOB}AGENTS.md#proof).`,
    ...extra,
    '',
    '### Depends on',
    '- #910',
  ].join('\n');
}

/**
 * Open issues for the fake `gh`, newest first as gh lists them: 40 clean bodies numbered 9640 down to 9601. `bodies`
 * replaces the bodies of the issues it names. #9605 is the 36th, so a lane that keeps gh's default limit of 30 misses it.
 */
export function openIssues(bodies = {}) {
  return Array.from({ length: 40 }, (_, i) => {
    const number = 9640 - i;
    return { number, title: `Fixture issue ${number}`, body: bodies[number] ?? cleanBody(number) };
  });
}

/**
 * Puts a fake `gh` first on PATH. It answers `gh issue list … --json <fields>` with `issues`, cut to `--limit`/`-L` (30
 * when absent, as gh does), `gh auth status` and `gh --version`, and fails anything else. Each call is logged.
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
if (args[0] === '--version') { console.log('gh version 2.99.0 (fake, #1329 acceptance tests)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log('github.com\\n  Logged in to github.com (fake)'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') {
  const fields = value('--json');
  if (!fields) { console.error('fake gh: this test answers gh issue list only with --json'); process.exit(1); }
  const limit = Number(value('--limit', '-L') ?? 30);
  const issues = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8')).slice(0, limit);
  const keep = fields.split(',').map((f) => f.trim());
  console.log(JSON.stringify(issues.map((i) => Object.fromEntries(keep.filter((k) => k in i).map((k) => [k, i[k]])))));
  process.exit(0);
}
console.error('fake gh: unsupported command: gh ' + args.join(' '));
process.exit(1);
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
 * Runs the lanes `keys` names (keys of LANES) in a child process with cwd at `repo`, through the fixture's own
 * scripts/lanes.mjs and one `runLanes` call over them in their order in `checks`, as scripts/checks.mjs runs every lane.
 * Returns each key's lane name, the exit status (runLanes' return) and the output.
 */
export const TIMEOUT_MS = 900_000;
export function runLanes(repo, env, keys) {
  const picks = keys.map((key) => ({ key, match: LANES[key].match.source, not: LANES[key].not?.source ?? null }));
  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const names = JSON.stringify(checks.map((l) => l.name));
const chosen = [];
for (const { key, match, not } of ${JSON.stringify(picks)}) {
  const found = checks.filter((l) => new RegExp(match, 'i').test(l.name) && !(not && new RegExp(not, 'i').test(l.name)));
  if (found.length !== 1) {
    console.log('NO LANE: scripts/lanes.mjs checks has ' + found.length + ' lanes for the ' + key + ' lane (/' + match + '/i' + (not ? ' and not /' + not + '/i' : '') + '), of ' + names);
    process.exit(3);
  }
  console.log('LANE ' + key + ' ' + found[0].name);
  chosen.push(found[0]);
}
process.exitCode = runLanes(checks.filter((l) => chosen.includes(l)));
`;
  // runLanes waits for the machine's throttle, so a loaded Mac can hold a lane for minutes.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED: the lanes didn't finish in ${TIMEOUT_MS / 1000} s and were stopped (${r.signal})` : ''}`;
  const names = Object.fromEntries([...output.matchAll(/^LANE (\w+) (.+)$/gm)].map((m) => [m[1], m[2]]));
  return { status: r.status, signal: r.signal, output, names, lines: output.split('\n') };
}

/** The lane name a run chose for `key`; fails with the run's output when none ran. */
export function laneName(run, key) {
  if (!run.names[key]) throw new Error(`no ${key} lane ran:\n${run.output}`);
  return run.names[key];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A lane's verdict states: runLanes prints `PASS <name> (…)` or `<STATE> <name>: <reason>` (SKIP among them). */
export const verdicts = (run, name) => run.lines
  .filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^[A-Z]+ ${escape(name)}:`).test(l))
  .map((l) => l.split(' ')[0]);

/** An output line naming an issue and a text: the issue's number as a whole number (`#9605`, `issue 9605`) and the text. */
export const namesIssue = (run, number, text) => run.lines.find((l) => l.includes(text) && new RegExp(`(?<!\\d)${number}(?!\\d)`).test(l));
