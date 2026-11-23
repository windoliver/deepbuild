// Shared by the #2327 acceptance tests. The check is reached only by running
// `node scripts/repo-rules.mjs` as a process, in this checkout or in a scratch git repository that
// holds a copy of this checkout's files (README: Surfaces). Every failure is node:assert's own.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPOSITORY = 'windoliver/deepbuild';
/** The forge's private report form for this repository (README: reading 2). */
export const ROUTE = `https://github.com/${REPOSITORY}/security/advisories/new`;
export const SECURITY = 'SECURITY.md';
export const CONTRIBUTING = 'CONTRIBUTING.md';
export const CONFIG = '.github/ISSUE_TEMPLATE/config.yml';
export const TEMPLATES = '.github/ISSUE_TEMPLATE';

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** A file of this checkout as text, or null when it isn't there. */
export const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

/**
 * The files a scratch tree is built from, as this checkout has them: every Markdown file at the
 * root and every file in .github/ISSUE_TEMPLATE/. A plant edits this map before the tree is made.
 */
export function checkoutFiles() {
  const files = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.md')) files.set(entry.name, readFileSync(join(root, entry.name), 'utf8'));
  if (existsSync(join(root, TEMPLATES)))
    for (const entry of readdirSync(join(root, TEMPLATES), { withFileTypes: true })) if (entry.isFile()) files.set(`${TEMPLATES}/${entry.name}`, readFileSync(join(root, TEMPLATES, entry.name), 'utf8'));
  return files;
}

/**
 * A scratch git repository under the system temporary folder, removed after the test. It holds
 * `files`, committed, with origin/main at that commit and origin's URL this repository's, and a
 * copy of every flat file of this checkout's scripts/, which git's listing leaves out.
 */
export function tree(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-route-2327-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, 'scripts'));
  for (const entry of readdirSync(join(root, 'scripts'), { withFileTypes: true })) if (entry.isFile()) writeFileSync(join(cwd, 'scripts', entry.name), readFileSync(join(root, 'scripts', entry.name)));
  writeFileSync(join(cwd, '.git/info/exclude'), 'scripts/\n');
  for (const [path, content] of files) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'fixture');
  git(cwd, 'remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`);
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

/** Runs `node scripts/repo-rules.mjs` with cwd at `cwd`. */
export function rules(cwd) {
  const result = spawnSync(process.execPath, ['scripts/repo-rules.mjs'], { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  return { ...result, stdout, lines: stdout.split('\n') };
}

/** The run with local paths left out, and only the lines that could bear on this issue. */
export function show(result) {
  const kept = result.lines.filter((line) => /^(?:PASS|NOTE) /.test(line) || names(line, SECURITY) || names(line, CONFIG) || names(line, CONTRIBUTING) || /security/i.test(line));
  const other = result.lines.filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line)).length - kept.filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line)).length;
  const text = `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? `, ${result.error.code ?? result.error.message}` : ''}\nstdout (${other} failing lines of other checks left out):\n${kept.map((line) => line.slice(0, 300)).join('\n')}\nstderr:\n${(result.stderr ?? '').slice(0, 2000)}`;
  return text.split(root).join('<checkout>').split(realpathSync(tmpdir())).join('<tmp>');
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A line names a file by its path, or for config.yml by its name; a longer path that ends the same is another file. */
export function names(line, path) {
  const spellings = path === CONFIG ? [CONFIG, 'config.yml'] : [path];
  return spellings.some((spelling) => new RegExp(`(?<![\\w/-])${escape(spelling)}(?![\\w-])`).test(line));
}

const failing = (result) => result.lines.filter((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE) /.test(line));
/** The failing lines that name one of the three files this issue's check reads. */
export const ours = (result) => failing(result).filter((line) => [SECURITY, CONFIG, CONTRIBUTING].some((path) => names(line, path)));

/**
 * The check passes: a PASS line about security (its name or SECURITY.md, any case), and no failing
 * line that names one of the three files. A silent run is not a pass. The exit status isn't judged
 * here, because other checks fail on a scratch tree and on this checkout (README: reading 4).
 */
export function assertChecked(result, where) {
  assert.ok(result.error === undefined && result.status !== null, `BLOCKED: node scripts/repo-rules.mjs did not finish in ${where}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS ') && /security/i.test(line)), `node scripts/repo-rules.mjs prints no PASS line about the security route in ${where}\n${show(result)}`);
  assert.deepEqual(ours(result), [], `node scripts/repo-rules.mjs fails ${where} on a file of the security route\n${show(result)}`);
}

/** The plant fails: exit 1 and a FAIL line that names `path` (and matches `part`, when given). */
export function assertFails(result, path, what, part = null) {
  assert.ok(result.error === undefined && result.status !== null, `BLOCKED: node scripts/repo-rules.mjs did not finish on ${what}\n${show(result)}`);
  const named = result.lines.filter((line) => line.startsWith('FAIL ') && (Array.isArray(path) ? path : [path]).some((one) => names(line, one)));
  assert.ok(named.length > 0, `no FAIL line names ${Array.isArray(path) ? path.join(' or ') : path} for ${what}\n${show(result)}`);
  if (part) assert.ok(named.some((line) => part.test(line)), `no FAIL line that names ${path} names the missing part (${part}) for ${what}\n${show(result)}`);
  assert.equal(result.status, 1, show(result));
}

/** Markdown as its words: list, quote and heading marks, emphasis and code marks dropped, whitespace folded. */
export const words = (text) => text.split('\n').map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, '')).join(' ').replace(/\*\*|__|`/g, '').split(/\s+/).filter(Boolean);

/** The longest run of consecutive words two texts share, as one string. */
export function sharedRun(a, b) {
  const left = words(a), right = words(b);
  let best = 0, end = 0, previous = new Uint32Array(right.length + 1);
  for (let i = 1; i <= left.length; i++) {
    const row = new Uint32Array(right.length + 1);
    for (let j = 1; j <= right.length; j++) {
      if (left[i - 1] !== right[j - 1]) continue;
      row[j] = previous[j - 1] + 1;
      if (row[j] > best) [best, end] = [row[j], i];
    }
    previous = row;
  }
  return left.slice(end - best, end).join(' ');
}

/** What the rule says, in the issue's words (README: reading 9). */
export const RULE = [
  ['is handled in the private advisory', /private advisory/i],
  ['its public issue is filed when its fix has merged', /public issue/i],
  ['its public issue is filed when its fix has merged', /\bmerged\b/i],
  ['an agent that finds such a fault files nothing public', /\bagent\b/i],
  ['an agent that finds such a fault files nothing public', /nothing public/i],
  ['issues already open stay as they are', /already open/i],
];
