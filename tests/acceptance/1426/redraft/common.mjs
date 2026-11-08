// #1426's redrafted tests (AC2 and two Scope lines): what the judges and their self-tests share. The surface is the
// first draft's (../README.md, The surface): the carried-patch table under `## Carried patches` in
// vendor/gpui-pre-apple/upstream/README.md, its columns, and a Test cell naming `<repo path> › <test name>`.
// Nothing here writes to the repo or reaches the network.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
/** The merge base these tests were written against; nothing of #1426 is implemented there. */
export const BASE = 'c12a65bb';
export const AC = { 1: '#1426.4ef6dcfa', 2: '#1426.eb2029f7' };

export const README = 'vendor/gpui-pre-apple/upstream/README.md';
export const DESIGN = 'docs/technical-design.md';
export const TABLE_HEADING = '## Carried patches';
export const COLUMNS = ['Behavior', 'Issue', 'Files', 'Test', 'Budget', 'Removal'];

/** The carried-patch table in `text`, as rows; null when the file has none with the pinned heading and columns. */
export function carriedRows(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === TABLE_HEADING);
  if (start < 0) return null;
  const table = [];
  for (let index = start + 1; index < lines.length && !lines[index].startsWith('#'); index += 1) {
    if (lines[index].trim().startsWith('|')) table.push(lines[index].trim());
    else if (table.length) break;
  }
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  if (table.length < 2 || cells(table[0]).join('|') !== COLUMNS.join('|')) return null;
  return table.slice(2).map(cells).map(([behavior = '', issue = '', files = '', test = '', budget = '']) => ({
    behavior, issue, test, budget, files: [...files.matchAll(/`([^`]+)`/g)].map(([, file]) => file),
  }));
}

/** A row's Test cell as `{ path, name }`, or null when it names no test. */
export function rowTest(cell) {
  const [, path, name] = /^`(.+?) › (.+)`$/.exec((cell ?? '').trim()) ?? [];
  return path && name ? { path, name } : null;
}

/** A fresh folder under the system's temporary folder, by its real path (macOS's /tmp is /private/tmp). */
export const tempRoot = (what) => realpathSync(mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da1426r-${what}-`)));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/** A file as the base commit holds it, read from git, never from the working tree. Throws INCONCLUSIVE without it. */
export function atBase(path) {
  const run = spawnSync('git', ['show', `${BASE}:${path}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`INCONCLUSIVE: this clone can't show ${BASE}:${path}, the base commit these tests read: ${(run.stderr ?? '').trim()}`);
  return run.stdout;
}

/** The judge's lines as a test's outcome: any FAIL fails; otherwise any INCONCLUSIVE fails as INCONCLUSIVE; none passes. */
export function verdict(lines) {
  const fails = lines.filter((line) => !/^INCONCLUSIVE\b/.test(line));
  if (fails.length) throw new Error(`FAIL:\n${fails.join('\n')}${lines.length > fails.length ? `\n${lines.filter((line) => !fails.includes(line)).join('\n')}` : ''}`);
  if (lines.length) throw new Error(`INCONCLUSIVE:\n${lines.join('\n')}`);
}
