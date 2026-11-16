// Test-side tools for the redraft of #1493's AC1 (README: The surface under test): the census script
// (`node scripts/census.mjs`) run as a process on the checkout and on a copy of it laid out like the repo; the fetcher
// (`node scripts/fetch-lock.mjs fetch`) that confirms the reference files are cached at their pinned hashes; and an
// independent lister of a reference file's public names. Nothing here stands in for the census script or the
// fetcher: every verdict a test judges is the script's own. Copied from tests/acceptance/1493/helpers.ts (its listing
// rule redrafted), never imported across suites. Node built-ins and vitest only.

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1493-redraft-ac1 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** The census script under test. */
export const CENSUS = join(REPO, 'scripts', 'census.mjs');
/** The pinned reference commit the familiar@1 pack is held to (tests/acceptance/433/reference.ts, its pin). */
export const PIN = '65c4864bb3bd4309257d41c6e54f4403dc57f255';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export const show = (v: unknown, max = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, max);
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export function writeJson(path: string, value: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Whether `text` holds `word` as a whole word: not inside a longer name (`Light` in `PointLight`). */
export function namesWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
}

// ---------------------------------------------------------------------------------------------------
// A reference file's public names, listed here apart from the script. Comments are left out first. Then:
//   - each entry of any `export { … }` list, with or without `from`, one line or many: its `as` name, else its name;
//   - X of `export class X`, `export function X`, `export function* X`, `export const X`, `export let X`, `export var X`;
//   - X of `export * as X from '…'`.
// A bare `export * from '…'` names nothing itself: the file it leads to counts when it is among the census's
// reference files, and is listed on its own. `default` is left out.

export function publicNames(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/(?<![\w$.])export\s*\{([^}]*)\}/g)) {
    for (const entry of m[1]!.split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0] ?? '').trim();
      if (name && name !== 'default') out.push(name);
    }
  }
  for (const m of code.matchAll(/(?<![\w$.])export\s+(?:class|function\s*\*?|const|let|var)\s*([A-Za-z_$][\w$]*)/g)) out.push(m[1]!);
  for (const m of code.matchAll(/(?<![\w$.])export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from/g)) if (m[1] !== 'default') out.push(m[1]!);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Scripts: `node <script> <args>` in `cwd`, with HOME at `home`, never with the network allowed.

export interface Ran { status: number | null; output: string; lines: string[] }

function scriptEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(DEEP_|XDG_)/.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  return { ...env, HOME: home };
}

export function runScript(script: string, args: string[], cwd: string, home: string): Ran {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: scriptEnv(home), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { status: r.status, output, lines: output.split('\n') };
}
/** `node scripts/census.mjs <args> --root <tree>`, run in the tree. */
export const census = (args: string[], tree: string, home: string): Ran => runScript(CENSUS, [...args, '--root', tree], tree, home);

const STATE = /^(PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/;
const clip = (r: Ran): string => `exit ${r.status}; output:\n${r.output.trim().split('\n').slice(0, 40).join('\n').slice(0, 4000)}`;

/** The run passes: exit 0, a `PASS census:` line, and no line in another state. */
export function passFailures(r: Ran, what: string): string[] {
  const out: string[] = [];
  if (r.status !== 0) out.push(`${what}: exits ${r.status}, not 0`);
  if (!r.lines.some((l) => l.startsWith('PASS census:'))) out.push(`${what}: prints no "PASS census:" line`);
  const other = r.lines.filter((l) => STATE.test(l) && !l.startsWith('PASS'));
  if (other.length) out.push(`${what}: prints ${other.length} line(s) in another state: ${other.slice(0, 5).join(' | ')}`);
  return out.length ? [...out, clip(r)] : [];
}

/** The run fails naming `word`: exit not 0, no PASS line, and a `FAIL census:` line that holds `word` as a whole word. */
export function failNamingFailures(r: Ran, word: string, what: string): string[] {
  const out: string[] = [];
  if (r.status === 0) out.push(`${what}: exits 0`);
  if (r.lines.some((l) => l.startsWith('PASS'))) out.push(`${what}: prints a PASS line`);
  if (!r.lines.some((l) => l.startsWith('FAIL census:') && namesWord(l, word))) out.push(`${what}: no "FAIL census:" line names ${word}`);
  return out.length ? [...out, clip(r)] : [];
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders, git, and the copy of familiar@1.

export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1493r-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** `git <args>` in `cwd`, with no user hooks, signing or settings of this machine's. */
function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw Error(`git ${args.join(' ')} in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
/** Makes `tree` a git repository with one commit of everything in it: the census's before-state (no origin/main, so HEAD). */
export function commitAll(tree: string): void {
  git(tree, ['init', '-q', '-b', 'work']);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '-m', 'the before-state']);
}

/** A copy of the checkout's familiar@1 pack, lock and fetcher in `tree`, laid out like the repo; the pack's folder. */
export function copyFamiliar(tree: string): string {
  mkdirSync(join(tree, 'scripts'), { recursive: true });
  copyFileSync(join(REPO, 'scripts', 'fetch-lock.mjs'), join(tree, 'scripts', 'fetch-lock.mjs'));
  copyFileSync(join(REPO, 'scripts', 'fetch-lock.json'), join(tree, 'scripts', 'fetch-lock.json'));
  const folder = join(tree, 'packs', 'familiar-1.0.0');
  cpSync(join(REPO, 'packs', 'familiar-1.0.0'), folder, { recursive: true });
  return folder;
}
