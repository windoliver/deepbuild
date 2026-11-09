// Size and scope (#324; design: An agent says it's done, Size and scope): a change measured with no model. Its lines
// and files against its base, the dependencies and top-level folders it adds and where each came from, and, for a
// document, the items its revisions changed by stable ID. The usual size is the median of the changes you accepted.
// What is outside the plan and what a person is asked are the hub's; this module only measures.
import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gitEnv } from './env.js';

/** A change past this many times the usual size is over it. */
export const OVER = 2;
/** The accepted changes the usual size is the median of. */
export const LAST = 20;
/** An untracked file larger than this counts as a file with no lines, never read whole at a stop. */
const READ_MAX = 4 * 1024 * 1024;
/** A duplicated block is at least this many lines, blank lines aside, that the change adds and that appear elsewhere in it or in a file it changes. */
const BLOCK = 6;

interface ChangedFile { path: string; added: number; removed: number }
/** Something a change brought in, and the file it came from. */
interface Brought { name: string; from: string }
interface Measured {
  files: ChangedFile[];
  added: number;
  removed: number;
  /** Dependencies a package manifest gained, by name, with the manifest. */
  dependencies: Brought[];
  /** Top-level folders the base didn't have, each with the first changed file in it. */
  folders: Brought[];
  /** Services and cloud resources added: a compose file's services and Terraform's resources (`type.name`), with the file. */
  resources: Brought[];
  /** The lines the change adds that sit in a duplicated block. */
  duplicated: number;
}
export interface Usual { lines: number; files: number; n: number }

const MANIFEST_DEPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { env: gitEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 10_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
/** A file's bytes at a commit, or undefined where it has none. */
const showAt = (cwd: string, commit: string, path: string): Promise<string | undefined> => git(cwd, ['show', `${commit}:${path}`]).catch(() => undefined);
const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** The lines of an untracked file: none for a link, anything not a regular file, a binary file or one past READ_MAX. */
async function untrackedLines(path: string): Promise<number> {
  const st = await lstat(path).catch(() => undefined);
  if (!st?.isFile() || st.size > READ_MAX) return 0;
  const bytes = await readFile(path).catch(() => undefined);
  return bytes && !bytes.includes(0) ? lineCount(bytes.toString('utf8')) : 0;
}

/**
 * The change from `base` to `head`, or to the working tree with its untracked files when `head` is undefined (what a
 * claim's snapshot holds): lines added and removed per file (a binary file counts none), the dependencies a
 * `package.json` gained and the top-level folders the base lacked. Paths are from the repository's root, wherever in
 * it `folder` is.
 */
export async function measure(folder: string, base: string, head?: string): Promise<Measured> {
  const cwd = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
  const numstat = await git(cwd, ['diff', '--numstat', '--no-renames', '-z', base, ...(head ? [head] : [])]);
  const files: ChangedFile[] = [];
  for (const entry of numstat.split('\0').filter(Boolean)) {
    const [added, removed, path] = entry.split('\t');
    if (path) files.push({ path, added: Number(added) || 0, removed: Number(removed) || 0 });
  }
  if (!head) {
    for (const path of (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)) {
      files.push({ path, added: await untrackedLines(join(cwd, path)), removed: 0 });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const atHead = (path: string) => (head ? showAt(cwd, head, path) : readFile(join(cwd, path), 'utf8').catch(() => undefined));
  // What a changed file names that its base version didn't: a manifest's dependencies, a compose file's services, Terraform's resources.
  const brought = async (test: (path: string) => boolean, names: (text: string | undefined) => string[]): Promise<Brought[]> => {
    const out: Brought[] = [];
    for (const f of files.filter((x) => test(x.path))) {
      const before = names(await showAt(cwd, base, f.path));
      for (const name of names(await atHead(f.path))) if (!before.includes(name) && !out.some((b) => b.name === name)) out.push({ name, from: f.path });
    }
    return out;
  };
  const dependencies = await brought((p) => basename(p) === 'package.json', depsOf);
  const resources = [...await brought((p) => COMPOSE.test(basename(p)), servicesOf), ...await brought((p) => p.endsWith('.tf'), terraformOf)];
  const top = new Set((await git(cwd, ['ls-tree', '--name-only', '-z', base])).split('\0').filter(Boolean));
  const folders: Brought[] = [];
  for (const f of files) {
    const name = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : undefined;
    if (name && !top.has(name) && !folders.some((x) => x.name === name)) folders.push({ name, from: f.path });
  }
  const duplicated = await duplicatedLines(cwd, base, head, files);
  return { files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), dependencies, folders, resources, duplicated };
}
const COMPOSE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
function servicesOf(text: string | undefined): string[] {
  try {
    const doc = parseYaml(text ?? '') as { services?: unknown } | null;
    return doc?.services && typeof doc.services === 'object' ? Object.keys(doc.services).map((s) => `service ${s}`) : [];
  } catch {
    return [];
  }
}
const terraformOf = (text: string | undefined): string[] => [...(text ?? '').matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gm)].map((m) => `${m[1]}.${m[2]}`);
/**
 * The lines the change adds that sit in a duplicated block: a run of BLOCK added lines (blank ones aside, each trimmed)
 * found more than once across the files it changes as they stand, so a block that only moved is not one.
 */
async function duplicatedLines(cwd: string, base: string, head: string | undefined, files: ChangedFile[]): Promise<number> {
  // A file as the change leaves it: a regular file within READ_MAX, never a link followed or a binary read.
  const now = async (path: string): Promise<string[]> => {
    let text: string | undefined;
    if (head) text = await showAt(cwd, head, path);
    else {
      const st = await lstat(join(cwd, path)).catch(() => undefined);
      if (st?.isFile() && st.size <= READ_MAX) text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    }
    return text === undefined || text.includes('\0') ? [] : text.split('\n').map((l) => l.trim()).filter(Boolean);
  };
  const windows = (lines: string[]) => (lines.length < BLOCK ? [] : Array.from({ length: lines.length - BLOCK + 1 }, (_, i) => lines.slice(i, i + BLOCK).join('\n')));
  const seen = new Map<string, number>();
  const changed = files.filter((f) => f.added > 0).slice(0, 200);
  const contents = new Map<string, string[]>();
  for (const f of changed) { const lines = await now(f.path); contents.set(f.path, lines); for (const w of windows(lines)) seen.set(w, (seen.get(w) ?? 0) + 1); }
  // The runs of lines the change adds: each hunk's added lines, and an untracked file whole.
  const runs: string[][] = [];
  const diff = await git(cwd, ['diff', '-U0', '--no-renames', '--no-color', base, ...(head ? [head] : [])]).catch(() => '');
  const inDiff = new Set<string>();
  let run: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) inDiff.add(line.slice(6));
    if (line.startsWith('+') && !line.startsWith('+++')) { const t = line.slice(1).trim(); if (t) run.push(t); } else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  for (const f of changed) if (!inDiff.has(f.path)) runs.push(contents.get(f.path) ?? []);
  let lines = 0;
  for (const r of runs) {
    const dup = new Set<number>();
    windows(r).forEach((w, i) => { if ((seen.get(w) ?? 0) > 1) for (let k = i; k < i + BLOCK; k++) dup.add(k); });
    lines += dup.size;
  }
  return lines;
}
function depsOf(manifest: string | undefined): string[] {
  try {
    const m = JSON.parse(manifest ?? '') as Record<string, unknown>;
    return MANIFEST_DEPS.flatMap((k) => (m[k] && typeof m[k] === 'object' ? Object.keys(m[k] as object) : []));
  } catch {
    return [];
  }
}

/** The unified diff of some of a change's files against `base`, the working tree's for untracked ones too; for a card. */
export async function diffOf(folder: string, base: string, paths: string[]): Promise<string> {
  if (!paths.length) return '';
  const cwd = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
  const tracked = await git(cwd, ['diff', '--no-renames', base, '--', ...paths]).catch(() => '');
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths]).catch(() => '')).split('\0').filter(Boolean);
  const added = await Promise.all(untracked.map(async (p) => {
    const text = (await untrackedLines(join(cwd, p))) ? await readFile(join(cwd, p), 'utf8').catch(() => '') : '';
    return `--- /dev/null\n+++ b/${p}\n${text.split('\n').filter((l, i, all) => i < all.length - 1 || l !== '').map((l) => `+${l}`).join('\n')}\n`;
  }));
  return [tracked, ...added].filter(Boolean).join('');
}

/** The median of the sizes given, the newest `LAST`; null with none. Lines are added and removed together. */
export function usualOf(sizes: readonly { lines: number; files: number }[]): Usual | null {
  const last = sizes.slice(-LAST);
  if (!last.length) return null;
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
  return { lines: median(last.map((s) => s.lines)), files: median(last.map((s) => s.files)), n: last.length };
}
/** Whether a size is over the usual: past `OVER` times its lines or its files. */
export const over = (size: { lines: number; files: number }, usual: Usual | null): boolean => usual !== null && (size.lines > OVER * usual.lines || size.files > OVER * usual.files);

/** One item a document's revisions added, changed or removed, by its stable ID. */
export interface ItemChange { id: string; change: 'added' | 'changed' | 'removed' }
/** The items of a canonical document, by ID: its `items`, a map by ID or a list of items carrying one. */
function itemsOf(doc: unknown): Map<string, string> {
  const items = doc && typeof doc === 'object' ? (doc as { items?: unknown }).items : undefined;
  const out = new Map<string, string>();
  const entries = Array.isArray(items) ? items.map((i) => [String((i as { id?: unknown })?.id ?? ''), i] as const) : items && typeof items === 'object' ? Object.entries(items) : [];
  for (const [id, item] of entries) if (id) out.set(id, canon(item));
  return out;
}
/** A value as JSON with every object's keys sorted, so key order never reads as a change. */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
/** What a document's revisions added, changed or removed between `before` (none for a new document) and `after`. */
export function itemChanges(before: unknown, after: unknown): ItemChange[] {
  const was = itemsOf(before);
  const now = itemsOf(after);
  const out: ItemChange[] = [];
  for (const [id, item] of now) if (!was.has(id)) out.push({ id, change: 'added' }); else if (was.get(id) !== item) out.push({ id, change: 'changed' });
  for (const id of was.keys()) if (!now.has(id)) out.push({ id, change: 'removed' });
  return out;
}
