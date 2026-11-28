import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const LINT = 'scripts/unread-exports.mjs';
export const LINT_NAME = 'unread-exports';
export const REPORT_DIR = 'contracts/api-report';
export const REPORT = 'contracts/api-report/extension-api.api.md';
export const EXTENSION_API = 'packages/contracts/extension-api.json';
const TIMEOUT = 600_000;

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
export function git(cwd, args, { allowFail = false, extra = {} } = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv({ ...IDENTITY, ...extra }), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r;
}

let mergeBase;
export function base() {
  mergeBase ??= git(CHECKOUT, ['merge-base', 'HEAD', 'origin/main']).stdout.trim();
  return mergeBase;
}
export function atBase(path) {
  const r = git(CHECKOUT, ['show', `${base()}:${path}`], { allowFail: true });
  return r.status === 0 ? r.stdout : undefined;
}
export function changedFiles() {
  return [...new Set([
    ...git(CHECKOUT, ['diff', '-z', '--name-only', '--no-renames', base()]).stdout.split('\0'),
    ...git(CHECKOUT, ['ls-files', '-z', '-o', '--exclude-standard']).stdout.split('\0'),
  ].filter(Boolean))].sort();
}
export const checkoutFiles = () => git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).stdout.split('\0').filter(Boolean).sort();
export function readNow(path) {
  const file = join(CHECKOUT, path);
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
}

export function makeCopy(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1688-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const copyIn = (file) => {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) return rmSync(join(repo, file), { force: true });
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  };
  for (const file of checkoutFiles()) copyIn(file);
  const changed = changedFiles();
  for (const file of changed) {
    const text = git(CHECKOUT, ['show', `${base()}:${file}`], { allowFail: true });
    if (text.status === 0) plantFile(repo, file, text.stdout);
    else rmSync(join(repo, file), { force: true });
  }
  const origin = git(CHECKOUT, ['remote', 'get-url', 'origin'], { allowFail: true }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  appendFileSync(join(repo, '.git', 'info', 'exclude'), '\n/node_modules\n');
  git(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  commit(repo, 'merge base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (const file of changed) copyIn(file);
  commit(repo, 'change');
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  for (const dir of ['home', 'tmp', 'cache', 'config']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

export function widenBase(repo, sandbox) {
  const index = join(sandbox, 'tmp', 'widened-index');
  const extra = { GIT_INDEX_FILE: index };
  const mainTree = git(repo, ['rev-parse', 'refs/remotes/origin/main^{tree}']).stdout.trim();
  const headTree = git(repo, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
  git(repo, ['read-tree', mainTree], { extra });
  const sources = git(repo, ['ls-files', '-z'], { extra }).stdout.split('\0').filter((p) => /^packages\/[^/]+\/src\//.test(p));
  for (let i = 0; i < sources.length; i += 500) git(repo, ['rm', '-q', '--cached', '--', ...sources.slice(i, i + 500)], { extra });
  const bare = git(repo, ['write-tree'], { extra }).stdout.trim();
  rmSync(index, { force: true });
  const below = git(repo, ['commit-tree', bare, '-m', 'merge base without packages/*/src']).stdout.trim();
  const main = git(repo, ['commit-tree', mainTree, '-p', below, '-m', 'merge base']).stdout.trim();
  const head = git(repo, ['commit-tree', headTree, '-p', main, '-m', 'change']).stdout.trim();
  git(repo, ['update-ref', 'refs/heads/change', head]);
  git(repo, ['update-ref', 'refs/remotes/origin/main', below]);
  return sources;
}

export function env(sandbox, extra = {}) {
  const e = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES']) delete e[key];
  return {
    ...e,
    PATH: [dirname(process.execPath), e.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
    ...extra,
  };
}

export function run(cwd, sandbox, args, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: env(sandbox, extra), timeout: TIMEOUT, killSignal: 'SIGKILL' });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => { output += `\n${e.message}\n`; });
    child.on('close', (code, signal) => {
      if (signal) output += `\nSTOPPED after ${TIMEOUT / 1000} s or by ${signal}\n`;
      const text = output.replaceAll(cwd, '<copy>');
      resolve({ command: `node ${args.join(' ')}`, status: code ?? 1, output: text, lines: text.split('\n').filter((l) => l.trim()) });
    });
  });
}

export const shown = (r, last = 30) => `${r.command} exited ${r.status}\n  ${r.lines.slice(-last).join('\n  ')}`;

export function sandboxOnly(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1688-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  for (const dir of ['home', 'tmp', 'cache', 'config']) mkdirSync(join(sandbox, dir));
  return sandbox;
}

export const CODE = /\.(?:d\.)?[mc]?[jt]sx?$/;
const IDENT = '[A-Za-z_$][\\w$]*';
const DECLARED = new RegExp(`^[ \\t]*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\s*\\*?|class|const\\s+enum|const|let|var|interface|type|enum|namespace)\\s+(${IDENT})`, 'gm');
const LISTED = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}/gm;
const listNames = (list, pick) => list.split(',').map((part) => part.trim().replace(/^type\s+/, '')).filter(Boolean).map(pick).filter((name) => new RegExp(`^${IDENT}$`).test(name));

export function exportsOf(text) {
  const names = new Set();
  for (const [, name] of (text ?? '').matchAll(DECLARED)) names.add(name);
  for (const [, list] of (text ?? '').matchAll(LISTED)) for (const name of listNames(list, (p) => p.split(/\s+as\s+/).at(-1).trim())) names.add(name);
  names.delete('default');
  return names;
}

const imported = (list) => listNames(list, (p) => p.split(/\s+as\s+|\s*:\s*/)[0].trim());

export function importsOf(text) {
  const found = [];
  for (const [, clause, spec] of text.matchAll(/\bimport\s+(?:type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) for (const name of imported(braces[1])) found.push({ name, spec });
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) for (const [, name] of text.matchAll(new RegExp(`\\b${ns[1].replace(/\$/g, '\\$')}\\.(${IDENT})`, 'g'))) found.push({ name, spec });
  }
  for (const [, list, spec] of text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g)) for (const name of imported(list)) found.push({ name, spec });
  for (const [, list, spec] of text.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) for (const name of imported(list)) found.push({ name, spec });
  for (const [, spec, name] of text.matchAll(/\(\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) found.push({ name, spec });
  return found;
}

export const moduleKey = (path) => path.replace(/^(packages\/[^/]+)\/dist\//, '$1/src/').replace(CODE, '');

export function packageDirs() {
  const map = new Map();
  for (const path of checkoutFiles().filter((p) => /^packages\/[^/]+\/package\.json$/.test(p))) {
    try {
      const { name } = JSON.parse(readFileSync(join(CHECKOUT, path), 'utf8'));
      if (typeof name === 'string') map.set(name, path.split('/')[1]);
    } catch {}
  }
  return map;
}

export function target(spec, from, packages) {
  if (spec.startsWith('.')) return { key: moduleKey(posix.normalize(posix.join(posix.dirname(from), spec))) };
  const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
  return packages.has(name) ? { pkg: packages.get(name) } : undefined;
}

export function testSources(path) {
  const text = readNow(path);
  if (text === undefined) return [];
  if (/\/twins\/[^/]+\/lines\.json$/.test(path)) {
    try {
      return Object.entries(JSON.parse(text)).map(([from, edits]) => ({ from, text: (Array.isArray(edits) ? edits : []).flatMap((edit) => edit?.wrong ?? []).join('\n') }));
    } catch {
      return [{ from: path, text }];
    }
  }
  return [{ from: path.match(/^tests\/acceptance\/[^/]+\/twins\/[^/]+\/(.+)$/)?.[1] ?? path, text }];
}
