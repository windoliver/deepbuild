import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'c13122f6ae02c140cfb1a3387153af1a878e746a';
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const DOCS = [DESIGN, CANVAS];
export const CHECK = 'scripts/glossary-lint.mjs';
export const LINKS = 'scripts/design-links.mjs';
export const PHRASES = ['ask-task', 'unblock task', 'standing grant', 'session run', 'lease grant'];
export const LIMIT = { timeout: 1_200_000 };

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key.startsWith('DEEP_')) delete env[key];
  return { ...env, PATH: [dirname(process.execPath), env.PATH].join(delimiter), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

function git(cwd, args) {
  const r = spawnSync('/usr/bin/git', args, { cwd, env: cleanEnv(), encoding: 'utf8', maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, `BLOCKED: git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

export const checkoutFile = (path) => readFileSync(join(CHECKOUT, path), 'utf8');
export const baseFile = (path) => git(CHECKOUT, ['show', `${BASE}:${path}`]);

export function makeCopy(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3415-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  for (const file of files) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git']);
  for (const dir of ['home', 'tmp']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

export const read = (repo, path) => readFileSync(join(repo, path), 'utf8');
export const write = (repo, path, text) => writeFileSync(join(repo, path), text);

function fenced(lines) {
  const inside = new Array(lines.length).fill(false);
  let fence = null;
  lines.forEach((line, i) => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      inside[i] = true;
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
    } else if (mark) {
      inside[i] = true;
      fence = mark[1];
    }
  });
  return inside;
}

export function plant(text, block) {
  const lines = text.split('\n');
  const inside = fenced(lines);
  const headings = lines.flatMap((line, i) => (!inside[i] && /^## /.test(line) ? [i] : []));
  assert.ok(headings.length >= 2, 'BLOCKED: the doc has fewer than two ## headings to plant between');
  const at = headings[1];
  lines.splice(at, 0, ...block, '');
  return { text: lines.join('\n'), first: at + 1 };
}

export function lineOf(text, test) {
  const found = text.split('\n').flatMap((line, i) => (test(line) ? [i + 1] : []));
  return found;
}

export function runCheck(repo, sandbox) {
  const r = spawnSync(process.execPath, [CHECK], { cwd: repo, env: cleanEnv({ HOME: join(sandbox, 'home'), TMPDIR: join(sandbox, 'tmp') }), encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status ?? 1, out, lines: out.split('\n').filter((l) => l.trim()) };
}

export function runLinks(repo) {
  const r = spawnSync(process.execPath, [LINKS], { cwd: repo, env: cleanEnv(), encoding: 'utf8', timeout: 900_000, maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status ?? 1, out, lines: out.split('\n').filter((l) => l.trim()) };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const at = (file, number) => new RegExp(`${escape(file)}(?::${number}(?!\\d)|\\D{1,12}line ${number}(?!\\d))`);
export const holds = (line, phrase) => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(phrase)}(?![\\p{L}\\p{N}_])`, 'iu').test(line);

export function named(run, file, number, phrase) {
  if (run.status === 0) return [];
  return run.lines.filter((line) => at(file, number).test(line) && (!phrase || holds(line, phrase)));
}

export const shown = (run) => run.out.replaceAll(CHECKOUT, '<checkout>').split('\n').slice(0, 120).join('\n');
