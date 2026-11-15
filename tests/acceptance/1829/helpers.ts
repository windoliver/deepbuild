// Shared test-side tools for issue #1829 (README): the #120 wake-up fixture, reused by import (never edited), with
// homes of this suite's own under /tmp/dh1829-*; the ask-source check run as a process, against this checkout or
// another tree with `--root`; scratch trees for that: a copy of this checkout's packages/ (working tree, so the
// change under test is in it) to plant files into, and the merge base's packages/ from `git archive`.

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CODEX_COVERED, COVERED, CURRENT, FIXTURES, NODE, REPO, type Checkout, type Home } from '../120/helpers.ts';

/** The criteria these files prove, each named by its number in the issue's order and its ID (README: Criteria to tests). */
export const AC1 = 'AC1 #1829.4f01565f';
export const AC2 = 'AC2 #1829.a7d207ff';

/** The source the issue is about, and the table it must have a row in. */
export const SOURCE = 'promise.blocked';
export const SOURCES_FILE = 'packages/asks/sources.json';
/** The check this suite names (README: The check): a repo guard in the shape of scripts/blocking-call-guard.mjs. */
export const GUARD = join(REPO, 'scripts/ask-sources-guard.mjs');

// ---- Temp folders: short paths under /tmp (a socket path must fit in 104 bytes), removed by `removeTemps`.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1829-'));
  made.push(dir);
  return dir;
}
export function removeTemps(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A fresh home laid out exactly as #120's `makeHome` lays it out (its stand-ins for launchctl, systemctl, claude and
 * codex, a `deep` running the checkout's CLI, the stubbed OS confirmation), only under /tmp/dh1829-*. Every #120
 * helper that takes a Home works on it.
 */
export function makeHome(co: Checkout = CURRENT): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'codex.version'), `${CODEX_COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${co.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, hookLog: join(tmp, 'hooks.jsonl'), co };
}

// ---- The check as a process.
export interface Checked { code: number | null; stdout: string; stderr: string; fails: string[]; passes: string[] }
/** `node scripts/ask-sources-guard.mjs [--root <dir>]`, from this checkout, with HOME a temp dir. */
export function runGuard(root?: string): Checked {
  if (!existsSync(GUARD)) {
    return { code: null, stdout: '', stderr: `${GUARD} does not exist`, fails: [], passes: [] };
  }
  const home = tempDir();
  const r = spawnSync(NODE, [GUARD, ...(root ? ['--root', root] : [])], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LC_ALL: 'C' },
  });
  const lines = (r.stdout ?? '').split('\n');
  return {
    code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '',
    fails: lines.filter((l) => l.startsWith('FAIL ask source: ')),
    passes: lines.filter((l) => l.startsWith('PASS ask source')),
  };
}
export const guardShown = (c: Checked) => `exit ${c.code}, stdout ${JSON.stringify(c.stdout.slice(-3000))}, stderr ${JSON.stringify(c.stderr.slice(-1500))}`;
/** Whether a FAIL line names this call site, `<path>:<line>` (a column after it allowed). */
export const namesSite = (line: string, path: string, lineNo: number): boolean =>
  new RegExp(`(^|[\\s(\`'"])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${lineNo}(?![0-9])`).test(line);
/** Whether a FAIL line names this source as written (a whole token, not a prefix of a longer one). */
export const namesSource = (line: string, source: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_.$])${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(line);
/** The `<path>:<line>` a FAIL line names, read as `packages/...:<n>`. */
export const sitesIn = (line: string): { path: string; line: number }[] =>
  [...line.matchAll(/(packages\/[^\s:`'"]+):(\d+)/g)].map((m) => ({ path: m[1]!, line: Number(m[2]) }));

// ---- Scratch trees for `--root`.
/**
 * A copy of this checkout's packages/ as its working tree holds it (tracked and untracked files git doesn't ignore,
 * so the change under test is in it), at `<tmp>/packages`. Returns the tree's root.
 */
export function copyOfCheckout(): string {
  const root = tempDir();
  const listed = execFileSync('git', ['-C', REPO, 'ls-files', '-z', '-co', '--exclude-standard', '--', 'packages'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  for (const rel of new Set(listed)) {
    const from = join(REPO, rel);
    if (!existsSync(from) || lstatSync(from).isDirectory()) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(from, join(root, rel), { dereference: false });
  }
  return root;
}
/** The merge base of this checkout with origin/main. */
export function mergeBaseSha(): string {
  try {
    return execFileSync('git', ['-C', REPO, 'merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
  } catch (e) {
    throw Error(`BLOCKED: no merge base with origin/main to check: ${(e as Error).message.split('\n')[0]}`);
  }
}
/** The merge base's packages/, from `git archive`, at `<tmp>/packages`. Returns the tree's root. */
export function baseTree(sha: string): string {
  const root = tempDir();
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive '${sha}' packages | tar -x -C '${root}'`], { stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });
  return root;
}
/** Every `<line number>` (1-based) in a file whose text matches. */
export function linesMatching(file: string, re: RegExp): number[] {
  return readFileSync(file, 'utf8').split('\n').flatMap((text, i) => (re.test(text) ? [i + 1] : []));
}
/** The rows of a tree's sources file. */
export function sourceRows(root: string): { source: string }[] {
  return JSON.parse(readFileSync(join(root, SOURCES_FILE), 'utf8')) as { source: string }[];
}
