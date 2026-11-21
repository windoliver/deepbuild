// Test-side tools for the #2629 acceptance tests: package folders copied into temp folders with the file modes a
// checkout under a given umask gives them, set by chmod (never by this process's umask), and `packageDigest` reached
// through the extension host's public entry. Nothing here computes a digest: every digest comes from `packageDigest`.
//
// Safety: every folder is under /tmp/dh2629-* (real paths) and removed after the file; no network, no process stopped.
import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const GIT = '/usr/bin/git';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #2629.aee527ff',
  2: 'AC2 #2629.5fd60962',
  3: 'AC3 #2629.9f639da0',
} as const;

/** The surface, through the extension host's public entry. */
export const packageDigest = async (folder: string): Promise<string> => {
  const { packageDigest: digest } = await import('../../../packages/extension-host/src/index.ts');
  return digest(folder);
};
export const DIGEST = /^d1:[0-9a-f]{64}$/;

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2629-${tag}-`));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A file of a package: its path in the package and whether git records it executable (100755). */
export interface Entry { path: string; executable: boolean }
/** The modes a checkout gives git's 100644 and 100755 files. */
export interface Umask { plain: number; executable: number }
/** umask 022: what git's own modes come out as. */
export const UMASK_022: Umask = { plain: 0o644, executable: 0o755 };
/** umask 002: group-writable, the issue's case. */
export const UMASK_002: Umask = { plain: 0o664, executable: 0o775 };

/**
 * The committed files of `dirs` at HEAD, written under a new temp root with `git archive`, each file then chmod-ed as
 * a checkout under `umask` gives it. Returns the root (each dir at its repo path under it) and each dir's entries.
 */
export function checkout(dirs: readonly string[], umask: Umask): { root: string; entries: Map<string, Entry[]> } {
  const root = tempDir('checkout');
  execSync(`${GIT} archive --format=tar HEAD -- ${dirs.map((d) => `'${d}'`).join(' ')} | tar -x -C '${root}'`, { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
  const entries = new Map<string, Entry[]>();
  for (const dir of dirs) {
    const listed = execFileSync(GIT, ['ls-tree', '-r', '-z', 'HEAD', '--', dir], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files: Entry[] = [];
    for (const line of listed) {
      const [meta, path] = line.split('\t') as [string, string];
      const mode = meta.split(' ')[0]!;
      if (mode !== '100644' && mode !== '100755') throw Error(`${path}: git mode ${mode}, not a plain file`);
      const executable = mode === '100755';
      chmodSync(join(root, path), executable ? umask.executable : umask.plain);
      files.push({ path: path.slice(dir.length + 1), executable });
    }
    entries.set(dir, files);
  }
  return { root, entries };
}

/** Each file of a package folder chmod-ed as `umask` gives it. */
export function setModes(folder: string, entries: readonly Entry[], umask: Umask): void {
  for (const e of entries) chmodSync(join(folder, e.path), e.executable ? umask.executable : umask.plain);
}

/** The `digest` a package's deepbuild.json carries. */
export const stamped = (folder: string): unknown => (JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as { digest?: unknown }).digest;

/** A small package of our own: a manifest, a TypeScript file, a nested data file and an executable `main`. */
export function smallPackage(tag: string): { folder: string; entries: Entry[] } {
  const folder = tempDir(tag);
  const files: Record<string, string> = {
    'deepbuild.json': `${JSON.stringify({ id: 'test/umask', version: '1.0.0' }, null, 2)}\n`,
    'index.ts': 'export default function register(): void {}\n',
    'data/words.txt': 'alpha\nbeta\n',
    main: '#!/bin/sh\necho hello\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  const entries: Entry[] = Object.keys(files).map((path) => ({ path, executable: path === 'main' }));
  setModes(folder, entries, UMASK_022);
  return { folder, entries };
}
