// Shared by the #246 acceptance tests. The rules are reached only by running
// `node scripts/repo-rules.mjs` in a scratch git repository that holds a copy of this checkout's
// script, and the lanes only through `scripts/lanes.mjs`'s exported `checks` and `runLanes`.
//
// No secret-shaped literal appears in these files: every planted value is built at runtime, so
// the finished check can scan this repo without an allowedFindings entry.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'dcfd7b86f55373c14181f5da827fb2aee6f663b0'; // #12 landed; no repo rules yet
export const lanesUrl = pathToFileURL(join(root, 'scripts/lanes.mjs')).href;

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export const FIX = {
  workflows: '  Fix: Remove it; checks run locally through scripts/preflight, never on push or pull request.',
  hooks: "  Fix: Install hooks and plugins at user level only, never in a repo's settings.",
  secrets: '  Fix: Remove or redact it (use ~/ or <name>); for a deliberate fixture, add an allowedFindings entry to scripts/repo-rules.json.',
  deps: '  Fix: Remove it, or add it to scripts/repo-rules.json with why the task needs it.',
};

export const KINDS = ['home path', 'private key', 'GitHub token', 'API key', 'AWS access key'];

// #12's three devDependencies, as scripts/repo-rules.json lists them at landing.
export const NPM12 = { '@types/node': '22.20.5', typescript: '5.9.3', vitest: '5.0.5' };

// The scripts/repo-rules.json layout these tests use (README: "The rules file"):
// { "deps": { "<manifest path>": { "<section>": { "<name>": { "spec", "why" } } } },
//   "allowedFindings": [{ "path", "kind", "sha256", "why" }] }
export function rulesFile({ deps = {}, allowedFindings = [] } = {}) {
  const listed = {};
  for (const [manifest, sections] of Object.entries(deps)) {
    listed[manifest] = {};
    for (const [section, entries] of Object.entries(sections)) {
      listed[manifest][section] = {};
      for (const [name, spec] of Object.entries(entries)) listed[manifest][section][name] = { spec, why: `Fixture: the task needs ${name}.` };
    }
  }
  return `${JSON.stringify({ deps: listed, allowedFindings }, null, 2)}\n`;
}

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function scratch(t, prefix = 'deep-rules-246-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

// A scratch repository with a copy of scripts/repo-rules.mjs, a package.json without
// dependencies and a rules file that lists nothing, unless `files` replaces them. `tracked`
// files are committed; `files` are left as new untracked files. `origin` points origin/main at
// the first commit.
export function repo(t, { tracked = {}, files = {}, origin = false, defaults = true } = {}) {
  const cwd = scratch(t);
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, 'scripts'));
  const script = join(root, 'scripts/repo-rules.mjs');
  if (existsSync(script)) copyFileSync(script, join(cwd, 'scripts/repo-rules.mjs'));
  const base = defaults ? { 'package.json': '{ "name": "fixture", "private": true }\n', 'scripts/repo-rules.json': rulesFile() } : {};
  write(cwd, { ...base, ...tracked });
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'base');
  if (origin) git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(cwd, files);
  return cwd;
}

export function rules(cwd, { env = process.env } = {}) {
  const result = spawnSync(process.execPath, ['scripts/repo-rules.mjs'], { cwd, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  return { ...result, stdout, out: stdout + (result.stderr ?? ''), lines: stdout.split('\n').filter((line) => line.trim()) };
}

export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The exact line, followed on the next line by its exact Fix line.
export function assertLine(result, line, fix) {
  const pattern = fix ? `^${escape(line)}\\n${escape(fix)}$` : `^${escape(line)}$`;
  assert.match(result.stdout, new RegExp(pattern, 'm'), show(result));
}

export function assertNoState(result, state, check) {
  assert.doesNotMatch(result.stdout, new RegExp(`^${state} ${escape(check)}:`, 'm'), show(result));
}

// Every `path:line:column: kind` the output reports, unique and sorted, whatever the layout.
export function findings(text) {
  const found = new Set();
  for (const match of text.matchAll(/([^\s,;:()]+):(\d+):(\d+): (home path|private key|GitHub token|API key|AWS access key)(?![A-Za-z])/g))
    found.add(`${match[1]}:${match[2]}:${match[3]}: ${match[4]}`);
  return [...found].sort();
}

export function assertNotLeaked(result, values) {
  for (const [index, value] of values.entries())
    assert.ok(!result.out.includes(value), `the output contains planted value #${index} (${value.length} characters); it must print only path, line, column and kind`);
}

// Planted values, built from parts at runtime.
const slash = (...parts) => parts.join('/');
const back = (...parts) => parts.join('\\');
export const plant = {
  macHome: (name = 'alice') => slash('', 'Users', name, ''),
  linuxHome: (name = 'bob') => slash('', 'home', name, ''),
  winHome: (name = 'carol') => back('C:', 'Users', name, ''),
  winHomeDoubled: (name = 'dave') => ['C:', 'Users', name, ''].join('\\\\'),
  privateKey: (type = 'RSA ') => `${'-'.repeat(5)}BEGIN ${type}PRIVATE KEY${'-'.repeat(5)}`,
  pgpKey: () => `${'-'.repeat(5)}BEGIN PGP PRIVATE KEY BLOCK${'-'.repeat(5)}`,
  github: (prefix = 'p', fill = 'a') => `gh${prefix}_${fill.repeat(36)}`,
  githubPat: (fill = 'A', length = 22) => `github${'_pat_'}${fill.repeat(length)}`,
  apiKey: (fill = 'x', length = 24) => `s${'k-'}${fill.repeat(length)}`,
  aws: (prefix = 'KIA', fill = 'ABCDEFGHIJKLMNOP') => `A${prefix}${fill}`,
};

// One value per variant, with its kind.
export const PLANTS = [
  [plant.macHome(), 'home path'],
  [plant.linuxHome(), 'home path'],
  [plant.winHome(), 'home path'],
  [plant.winHomeDoubled(), 'home path'],
  [plant.privateKey(), 'private key'],
  [plant.pgpKey(), 'private key'],
  ...['p', 'o', 'u', 's', 'r'].map((prefix) => [plant.github(prefix, 'b'), 'GitHub token']),
  [plant.githubPat(), 'GitHub token'],
  [plant.apiKey(), 'API key'],
  [plant.aws(), 'AWS access key'],
  [plant.aws('SIA', 'Q1W2E3R4T5Y6U7I8'), 'AWS access key'],
];

// A text whose `line` (1-based) holds `value` starting at `column` (1-based).
export function placed(value, line, column, filler = 'plain words') {
  const rows = Array.from({ length: line - 1 }, (_, index) => `${filler} ${index + 1}`);
  rows.push(`${' '.repeat(column - 1)}${value} end`);
  rows.push(`${filler} after`);
  return `${rows.join('\n')}\n`;
}

// A fixture crate the lint lane's cargo fmt and clippy accept.
export const CRATE = {
  'Cargo.toml': '[package]\nname = "fixture"\nversion = "0.0.0"\nedition = "2021"\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "fixture"\nversion = "0.0.0"\n',
  'src/main.rs': 'fn main() {}\n',
  '.gitignore': 'target/\n',
};

// Runs only the lint lane through runLanes, with cwd at the scratch repository. The script is
// passed with -e so no file holding this checkout's path lands in the scanned repository.
export function lintLane(cwd) {
  const code = `
    import { checks, runLanes } from ${JSON.stringify(lanesUrl)};
    process.exitCode = runLanes(checks.filter(({ name }) => name === 'lint'), { cwd: process.cwd() });
  `;
  const env = { ...process.env };
  delete env.CARGO_TARGET_DIR;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  return { ...result, out: result.stdout + result.stderr };
}
