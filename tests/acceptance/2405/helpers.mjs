// Helpers for #2405's acceptance tests: scratch copies of the checkout (with a git history when a lane runs in one), the
// public text lane's word rule and the salted hashes a test plants in a copy's list, the maintainers' private list read
// in the format the README sets, the direct dependencies and adapter names, a fake `gh`, and runs of the doc lanes
// through the copy's own scripts/lanes.mjs and `runLanes`, as scripts/checks.mjs runs them. The approach follows
// tests/acceptance/1329/helpers.mjs, copied here in part, never imported.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPO = process.env.GH_REPO ?? 'windoliver/deepbuild';

// The surfaces (README: my choice where the issue leaves it open).
/** The list the public text lane reads. */
export const LIST = 'scripts/studied-names.json';
/** AC1's script: `node scripts/studied-names.mjs <private list>`, run from the repo's root. */
export const SCRIPT = 'scripts/studied-names.mjs';
/** Where the live AC1 test finds the maintainers' private list. */
export const PRIVATE_LIST = 'DEEP_STUDIED_NAMES_LIST';
/** The doc lanes, as CONTRIBUTING.md names them. */
export const DOC_LANES = ['design links and names', 'catalogue drift', 'public text'];

// The public text lane's word rule (scripts/public-text.mjs, #1329), copied: a word is letters and numbers, joined
// inside by . _ - or '; the lane matches each word, each part of a joined word and each run of up to four words,
// lowercased, by the SHA-256 of the list's salt followed by it.
const WORD = /[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu;
const JOINER = /['’._-]/;
export const words = (text) => text.match(WORD) ?? [];
/** Every form the lane matches in one line of text: its words, the parts of its joined words, its runs of up to four words. */
export function laneForms(line) {
  const all = words(line);
  const forms = new Set();
  for (const [i, word] of all.entries()) {
    for (const part of word.split(JOINER)) if (part !== word) forms.add(part.toLowerCase());
    for (let n = 1; n <= 4 && i + n <= all.length; n++) forms.add(all.slice(i, i + n).join(' ').toLowerCase());
  }
  return [...forms];
}
/** A name whole, in the form the lane matches it: its words joined by one space, lowercased. */
export const nameForm = (name) => words(name).join(' ').toLowerCase();
/** The list's hash of a form: the hex SHA-256 of the salt followed by the form, lowercased. */
export const saltedHash = (salt, form) => createHash('sha256').update(salt + form.toLowerCase()).digest('hex');
export const readList = (root) => JSON.parse(readFileSync(join(root, LIST), 'utf8'));

/** Adds the salted hash of each form to a copy's list, under its salt, keeping the file's shape (sorted, two-space JSON). */
export function plantHashes(repo, forms) {
  const list = readList(repo);
  list.hashes = [...new Set([...list.hashes, ...forms.map((form) => saltedHash(list.salt, form))])].sort();
  writeFileSync(join(repo, LIST), `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

/**
 * The maintainers' private list, in the format the README sets: one name a line, spelled as public text spells it; a
 * name that is also a plain word written after `plain:`; blank lines and lines starting with # skipped. Each entry keeps
 * its line number, counted from 1 over every line of the file.
 */
export function readPrivateList(text) {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return [];
    const plain = line.startsWith('plain:');
    return [{ line: i + 1, name: plain ? line.slice('plain:'.length).trim() : line, plain }];
  });
}

/** Every direct dependency scripts/repo-rules.json names (`deps`: manifest → section → name), with where it is named. */
export function dependencies(root) {
  const { deps } = JSON.parse(readFileSync(join(root, 'scripts', 'repo-rules.json'), 'utf8'));
  const named = new Map();
  for (const [manifest, sections] of Object.entries(deps)) {
    for (const [section, names] of Object.entries(sections)) {
      for (const name of Object.keys(names)) named.set(name, [...(named.get(name) ?? []), `${manifest} ${section}`]);
    }
  }
  return named;
}

/** Each adapter's names: for each adapters/*.facts.json that names an agent, the file's name before .facts.json and that agent. */
export function adapterNames(root) {
  const names = new Set();
  for (const file of readdirSync(join(root, 'adapters')).filter((f) => f.endsWith('.facts.json'))) {
    const { agent } = JSON.parse(readFileSync(join(root, 'adapters', file), 'utf8'));
    if (typeof agent !== 'string') continue;
    names.add(basename(file, '.facts.json'));
    names.add(agent);
  }
  return [...names];
}

/**
 * The dependency AC3's plant names: the first, in scripts/repo-rules.json's order, that is one word with no joiner and
 * that the file names only under a Cargo manifest's target-specific section (objc2 at the base), so a program reading
 * only the plain dependency sections misses it; the first one-word dependency when there is none such.
 */
export function plantedDependency(root) {
  const single = [...dependencies(root)].filter(([name]) => /^[\p{L}\p{N}]+$/u.test(name));
  return (single.find(([, where]) => where.every((w) => /Cargo\.toml target\./.test(w))) ?? single[0])?.[0];
}

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` holds this checkout's working tree (tracked files
 * and untracked files git doesn't ignore, and with `dist` each package's built dist/), node_modules linked to the
 * checkout's when it has one and kept out of the copy's commits, and a fresh `git init` with the checkout's origin URL
 * as its remote. No commit yet: `commit` makes them. `private/` is a folder outside the copy's repo.
 */
export function makeCopy(t, { dist = false } = {}) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2405-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = checkoutGit(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  if (dist) {
    for (const pkg of readdirSync(join(CHECKOUT, 'packages'))) {
      const folder = join('packages', pkg, 'dist');
      if (existsSync(join(CHECKOUT, folder))) files.push(...walk(folder));
    }
  }
  for (const file of files) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: CHECKOUT, encoding: 'utf8' }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', origin || `https://github.com/${REPO}.git`]);
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  appendFileSync(join(repo, '.git', 'info', 'exclude'), '\nnode_modules\n');
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin', 'private']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

const walk = (dir) => readdirSync(join(CHECKOUT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const checkoutGit = (args) => {
  const r = spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

// Git in a copy, with a fixed identity, no signing and no hooks from the caller's config.
const git = (repo, args) => {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} in the copy failed: ${r.stderr}`);
  return r.stdout;
};

/** Commits everything in a copy. `base` also points origin/main at it, so later commits are the change. */
export function commit(repo, message, { base = false } = {}) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '-m', message]);
  if (base) git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

/** Open issues for the fake `gh`: plain text that names no product. */
export const cleanIssues = () => [9703, 9702, 9701].map((number) => ({
  number,
  title: `Fixture issue ${number}`,
  body: [
    `A fixture issue for the acceptance tests of #2405 (${number}). It is not a real issue.`,
    '',
    '### Scope',
    '- The review panel keeps its toolbar on the left and folds the history into one row.',
  ].join('\n'),
}));

/**
 * Puts a fake `gh` first on PATH. It answers `gh issue list … --json <fields>` with `issues`, cut to `--limit`/`-L`
 * (30 when absent, as gh does), `gh auth status` and `gh --version`, and fails anything else.
 */
export function fakeGh(sandbox, issues) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(issues));
  const script = `#!${process.execPath}
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const value = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
};
if (args[0] === '--version') { console.log('gh version 2.99.0 (fake, #2405 acceptance tests)'); process.exit(0); }
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
 * The sandboxed environment of an offline run: HOME, TMPDIR and the XDG folders in the sandbox (so the machine's
 * throttle table and lane records stay out of it), no GitHub token or host, no cached open issues, no private list, and
 * the fake gh first on PATH.
 */
export function sandboxEnv(sandbox) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT', PRIVATE_LIST]) delete env[key];
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

/** The caller's environment for a live run: its own gh and HOME, the repo named, and no cached open issues. */
export function liveEnv() {
  const env = { ...process.env, GH_REPO: REPO };
  delete env.DEEP_OPEN_ISSUES;
  return env;
}

/** Why gh can't read the open issues with `env`, or null when `gh auth status` passes. */
export function ghProblem(env) {
  const auth = spawnSync('gh', ['auth', 'status'], { env, encoding: 'utf8', timeout: 120_000 });
  if (auth.status === 0) return null;
  return `${auth.error?.message ?? ''}${auth.stderr ?? ''}`.trim() || `gh auth status exited ${auth.status ?? auth.signal}`;
}

/**
 * Runs the lanes `names` names in a child process with cwd at `repo`, through the copy's own scripts/lanes.mjs and one
 * `runLanes` call over them in their order in `checks`, as scripts/checks.mjs runs every lane. A live run waits on the
 * machine's throttle, which gives up after 30 minutes with INCONCLUSIVE, so its limit is 45 minutes.
 */
export function runLanes(repo, env, names, { timeout = 900_000 } = {}) {
  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const wanted = ${JSON.stringify(names)};
const missing = wanted.filter((name) => !checks.some((lane) => lane.name === name));
if (missing.length) {
  console.log('NO LANE: scripts/lanes.mjs checks has no lane named ' + missing.join(', ') + ', of ' + JSON.stringify(checks.map((l) => l.name)));
  process.exit(3);
}
process.exitCode = runLanes(checks.filter((lane) => wanted.includes(lane.name)));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED: the lanes didn't finish in ${timeout / 1000} s and were stopped (${r.signal})` : ''}`;
  return { status: r.status, signal: r.signal, output, lines: output.split('\n') };
}
export const LIVE_TIMEOUT = 2_700_000;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A lane's verdict states: runLanes prints `PASS <name> (…)` or `<STATE> <name>: <reason>` (SKIP among them). */
export const verdicts = (run, name) => run.lines
  .filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^(FAIL|INVALID|BLOCKED|INCONCLUSIVE|SKIP) ${escape(name)}( \\(platform\\))?:`).test(l))
  .map((l) => l.split(' ')[0]);
