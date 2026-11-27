// Helpers for #3533's acceptance tests: scratch copies of the checkout with their own git history, the public text
// lane's word rule (copied from scripts/studied-names.mjs at the base, never imported), the base's lists and pack
// folders, open issues that name no product, one run of the `public text` lane's commands, and a filter that withholds
// every listed word from what a test prints. The copy approach follows tests/acceptance/2405/helpers.mjs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The base commit this suite was written at: main as the issue was filed against it. */
export const BASE = 'd303e2b64';
export const LANE = 'public text';
export const LIST = 'scripts/studied-names.json';
/** #3445's spike folder, and where PR #3505 keeps it. */
export const SPIKE = 'docs/spikes/3445';
export const SPIKE_REFS = ['spike/3445-sandbox-uncounted-costs', 'pull/3505/head'];
/** An invented word, listed only by AC2's plant. */
export const INVENTED = 'zorvanthique';

// Git with none of the caller's repository, config, hooks or signing: a worktree's GIT_DIR and the like never leak in.
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
function git(cwd, args, { input, encoding = 'utf8', allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv(IDENTITY), input, encoding, maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r;
}
// The checkout is read only: these commands never write to it.
const checkoutGit = (args, options) => git(CHECKOUT, args, options);

// The lane's word rule at the base: a word is letters and numbers, joined inside by . _ - or '; each word, each part of
// a joined word and each run of up to four words is read, lowercased, and listed when the SHA-256 of the salt followed
// by it is in the list's hashes.
const WORD = /[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu;
const JOINER = /['’._-]/;
const hashOf = (salt, form) => createHash('sha256').update(salt + form.toLowerCase()).digest('hex');
const listedIn = (list, form) => list.set.has(hashOf(list.salt, form));
export const asList = ({ salt, hashes }) => ({ salt, hashes, set: new Set(hashes) });
export const readList = (root) => asList(JSON.parse(readFileSync(join(root, LIST), 'utf8')));
export const baseList = () => asList(JSON.parse(checkoutGit(['show', `${BASE}:${LIST}`]).stdout));
/** Whether the lane reads a name, as written in one line, as listed. */
export function readsAsListed(list, name) {
  const words = name.match(WORD) ?? [];
  return words.some((word, i) => word.split(JOINER).some((part) => part !== word && listedIn(list, part))
    || [1, 2, 3, 4].some((n) => i + n <= words.length && listedIn(list, words.slice(i, i + n).join(' '))));
}

/**
 * Text with every word the lists read as listed replaced by <withheld>: each word, a joined word with a listed part,
 * and each word of a listed run. Everything a test prints passes through it, so no run record holds a listed word.
 */
export function withhold(text, lists) {
  return String(text).split('\n').map((line) => {
    const tokens = [...line.matchAll(WORD)];
    const hidden = new Set();
    const listed = (form) => lists.some((list) => listedIn(list, form));
    for (const [i, { 0: word }] of tokens.entries()) {
      if (word.split(JOINER).some((part) => listed(part))) hidden.add(i);
      for (let n = 1; n <= 4 && i + n <= tokens.length; n++) {
        if (listed(tokens.slice(i, i + n).map((t) => t[0]).join(' '))) for (let k = i; k < i + n; k++) hidden.add(k);
      }
    }
    let out = '', at = 0;
    for (const [i, t] of tokens.entries()) {
      if (!hidden.has(i)) continue;
      out += `${line.slice(at, t.index)}<withheld>`;
      at = t.index + t[0].length;
    }
    return out + line.slice(at);
  }).join('\n');
}

/** The folders directly under packs/ at the base. */
export const basePackFolders = () => checkoutGit(['ls-tree', '-d', '--name-only', `${BASE}:packs`]).stdout.split('\n').filter(Boolean);

/**
 * A sandbox under the OS temp folder, removed after the test: `repo/` holds this checkout's working tree (tracked
 * files and untracked ones git doesn't ignore; never .git), with a fresh `git init` whose origin is the checkout's
 * origin URL. `skip` leaves out paths under a prefix.
 */
export function makeCopy(t, { skip = [] } = {}) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3533-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = checkoutGit(['ls-files', '-z', '-co', '--exclude-standard']).stdout.split('\0').filter(Boolean);
  for (const file of files) {
    if (skip.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))) continue;
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  const origin = checkoutGit(['remote', 'get-url', 'origin'], { allowFail: true }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

/** Puts the base's packs/ and list in a copy in place of its own, as they are on main at the base. */
export function restoreBase(repo) {
  rmSync(join(repo, 'packs'), { recursive: true, force: true });
  const tar = checkoutGit(['archive', '--format=tar', BASE, 'packs', LIST], { encoding: 'buffer' }).stdout;
  const r = spawnSync('tar', ['-x', '-f', '-', '-C', repo], { input: tar });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
}

/** Commits everything in a copy. `base` also points origin/main at it, so later commits are the change. */
export function commit(repo, message, { base = false } = {}) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
  if (base) git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

/** A change that names no product: one new file and its commit. */
export function cleanChange(repo) {
  mkdirSync(join(repo, 'notes'), { recursive: true });
  writeFileSync(join(repo, 'notes', 'fixture.md'), 'A fixture note: the review panel keeps its toolbar on the left.\n');
  commit(repo, 'Add a fixture note');
}

/**
 * Fetches #3445's spike folder from origin into a copy's own git (never the checkout's), from the first of SPIKE_REFS
 * origin serves, and checks it out into the copy's tree. Returns the files, or `missing` saying why it couldn't.
 */
export function fetchSpike(repo) {
  const tried = [];
  for (const ref of SPIKE_REFS) {
    const r = git(repo, ['fetch', '-q', '--depth=1', '--no-tags', 'origin', ref], { allowFail: true });
    if (r.status !== 0) {
      tried.push(`${ref}: ${String(r.stderr).trim().split('\n').at(-1)}`);
      continue;
    }
    const files = git(repo, ['ls-tree', '-r', '--name-only', 'FETCH_HEAD', '--', SPIKE]).stdout.split('\n').filter(Boolean);
    if (!files.length) {
      tried.push(`${ref}: holds no ${SPIKE}/`);
      continue;
    }
    git(repo, ['checkout', 'FETCH_HEAD', '--', SPIKE]);
    git(repo, ['reset', '-q']);
    return { ref, files };
  }
  return { missing: `origin served no ${SPIKE}/ (${tried.join('; ')})` };
}

/** Open issues that name no product, fed through DEEP_OPEN_ISSUES and a fake `gh` alike. */
const ISSUES = [9703, 9702, 9701].map((number) => ({ number, title: `Fixture issue ${number}`, body: `A fixture issue (${number}) for the acceptance tests of #3533. It is not a real issue.\n\n### Scope\n- The history folds into one row.` }));

/** The sandboxed environment of a lane run: HOME, TMPDIR and XDG in the sandbox, no GitHub token, the issues fed. */
export function laneEnv(sandbox) {
  const issues = join(sandbox, 'open-issues.json');
  writeFileSync(issues, JSON.stringify(ISSUES));
  const gh = join(sandbox, 'bin', 'gh');
  writeFileSync(gh, `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] === 'issue' && a[1] === 'list') { const f = (a[a.indexOf('--json') + 1] ?? 'number,body').split(','); console.log(JSON.stringify(${JSON.stringify(ISSUES)}.map((i) => Object.fromEntries(f.filter((k) => k in i).map((k) => [k, i[k]]))))); process.exit(0); }\nif (a[0] === 'auth') process.exit(0);\nconsole.error('fake gh: unsupported: ' + a.join(' '));\nprocess.exit(1);\n`);
  chmodSync(gh, 0o755);
  const env = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT']) delete env[key];
  return {
    ...env,
    DEEP_OPEN_ISSUES: issues,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

/**
 * Runs the `public text` lane's commands, as the copy's own scripts/lanes.mjs lists them, in the copy, one after another
 * until one fails. `states` holds the verdict words its output's lines start with; `PASS` when every command exits 0.
 */
export function runLane(repo, env) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lane = checks.find((l) => l.name === ${JSON.stringify(LANE)});
console.log(JSON.stringify(lane ? lane.commands : null));`;
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
  let commands = null;
  try { commands = JSON.parse(listed.stdout.trim().split('\n').at(-1)); } catch {}
  if (!Array.isArray(commands) || !commands.length) {
    const output = `NO LANE: scripts/lanes.mjs lists no "${LANE}" lane with commands\n${listed.stdout}${listed.stderr}`;
    return { status: 3, output, lines: output.split('\n'), states: [] };
  }
  let output = '', status = 0;
  for (const [command, ...args] of commands) {
    const r = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.signal ? `\nSTOPPED after 300 s (${r.signal})\n` : ''}`;
    status = r.status ?? 1;
    if (status !== 0) break;
  }
  const lines = output.split('\n');
  const states = [...new Set(lines.map((l) => l.match(/^(FAIL|INCONCLUSIVE|BLOCKED|INVALID)\b/)?.[1]).filter(Boolean))];
  if (status === 0) states.unshift('PASS');
  return { status, output, lines, states };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a line names a folder: its name whole, not inside a longer name. */
export const namesFolder = (line, folder) => new RegExp(`(?<![\\p{L}\\p{N}_.-])${escape(folder)}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, 'u').test(line);

/** Writes a file into a copy. */
export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}
/** Adds the salted hash of a form to a copy's list, keeping its shape (sorted, two-space JSON). */
export function plantHash(repo, form) {
  const raw = JSON.parse(readFileSync(join(repo, LIST), 'utf8'));
  raw.hashes = [...new Set([...raw.hashes, hashOf(raw.salt, form)])].sort();
  writeFileSync(join(repo, LIST), `${JSON.stringify(raw, null, 2)}\n`);
}
