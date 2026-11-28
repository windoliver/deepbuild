// What a claim's worktree changed against its merge base, and the test runners' configs it held (#33): read beside its
// snapshot, from the same worktree.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { OWN_BY_NAME, runnerConfig } from '@deepbuild/gate';

/** What a claim's worktree changed against its merge base when its snapshot was taken, and the test runners' configs it held, each with its text (#33). */
export interface Changes { changed: string[]; configs: Map<string, string>; scripts: boolean; unread?: string; untracked?: Map<string, string>; stamps?: Map<string, string> }
export const scriptsOf = (text: string | undefined): string => { try { return JSON.stringify((JSON.parse(text ?? '{}') as { scripts?: unknown }).scripts ?? null); } catch { return 'unreadable'; } };
export async function changesOf(cwd: string, base: string, ms: number): Promise<Changes> {
  const deadline = Date.now() + ms;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1' };
  const unread: string[] = [];
  const git = (args: string[], missing = false): Promise<Buffer> => new Promise((done) => {
    const left = Math.max(1, Math.ceil(deadline - Date.now()));
    execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env, encoding: 'buffer', maxBuffer: 1 << 30, timeout: left, killSignal: 'SIGKILL' }, (error, out, err) => {
      if (error && !(missing && !error.killed && /does not exist in|exists on disk, but not in/.test(String(err)))) {
        const why = (error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'gave more than 1 GB' : error.killed ? `timed out, past the read's ${Math.ceil(ms)} ms deadline` : `failed: ${String(err).trim().split('\n')[0] || error.message}`;
        unread.push(`git ${args.join(' ')} ${why}`);
      }
      done(error ? Buffer.alloc(0) : out);
    });
  });
  // Paths as git stores them (#3114): with -z, never quoted and escaped by core.quotePath, so they match a run's reads.
  const paths = async (args: string[]): Promise<string[]> => {
    const out = await git(args);
    const listed: string[] = [];
    for (let at = 0; at < out.length;) {
      const end = out.indexOf(0, at);
      const path = out.toString('utf8', at, end < 0 ? out.length : end);
      if (path) listed.push(path);
      at = end < 0 ? out.length : end + 1;
    }
    return listed;
  };
  const [diff, others, tracked, ignored, entries, format, top] = await Promise.all([paths(['diff', '-z', '--name-only', '--no-renames', base]), paths(['ls-files', '-z', '--others', '--exclude-standard']), paths(['ls-files', '-z']),
    paths(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']), paths(['ls-tree', '-r', '-z', '--full-tree', base]), git(['rev-parse', '--show-object-format']), git(['rev-parse', '--show-toplevel'])]);
  const workTree = top.toString('utf8').trim();
  const here = ((): string => { try { return realpathSync(cwd); } catch { return cwd; } })();
  const nested = (): boolean => { for (let d = here; d !== workTree && d !== dirname(d); d = dirname(d)) if (existsSync(join(d, '.git'))) return true; return false; };
  if (workTree && (relative(workTree, here).startsWith('..') || !existsSync(join(workTree, '.git')) || nested())) unread.push(`git takes ${workTree} for the work tree of ${here}`);
  const own = new RegExp(OWN_BY_NAME);
  const cache = (p: string): boolean => /(^|\/)__pycache__\//.test(p);
  const hidden = [...await Promise.all(ignored.filter((p) => own.test(p)).map(async (p) => (p.endsWith('/') ? paths(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', p]) : [p])))].flat().filter((p) => !cache(p));
  const algorithm = format.toString('utf8').trim() === 'sha256' ? 'sha256' : 'sha1';
  const blob = (bytes: Buffer): string => createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const differs = await Promise.all(entries.map(async (entry): Promise<string | undefined> => {
    const [meta, path] = [entry.slice(0, entry.indexOf('\t')), entry.slice(entry.indexOf('\t') + 1)];
    return own.test(path) ? compared(meta, path).catch(() => path) : undefined;
  }));
  async function compared(meta: string, path: string): Promise<string | undefined> {
    const [mode, kind, oid] = meta.split(' ');
    if (kind !== 'blob') return undefined;
    const at = join(workTree || cwd, path);
    const stat = await lstat(at).catch(() => undefined);
    if (!stat) return path;
    if (mode === '120000') return stat.isSymbolicLink() && blob(Buffer.from(await readlink(at))) === oid ? undefined : path;
    if (!stat.isFile() || (mode === '100755') !== ((stat.mode & 0o100) !== 0)) return path;
    return blob(await readFile(at)) === oid ? undefined : path;
  }
  const configs = new Map<string, string>();
  for (const path of new Set([...tracked, ...others].filter(runnerConfig))) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    if (text !== undefined) configs.set(path, text);
  }
  // Whether package.json's scripts changed: the script a check runs is its own.
  const scripts = diff.includes('package.json') && scriptsOf((await git(['show', `${base}:package.json`], true)).toString('utf8')) !== scriptsOf(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined));
  return { changed: [...new Set([...diff, ...others, ...hidden, ...differs.filter((p): p is string => p !== undefined)])].sort(), configs, scripts, ...(unread.length ? { unread: unread.join('; ') } : {}) };
}
