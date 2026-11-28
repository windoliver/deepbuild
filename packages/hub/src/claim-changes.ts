// What a claim's worktree changed against its merge base, and the test runners' configs it held (#33): read beside its
// snapshot, from the same worktree.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runnerConfig } from '@deepbuild/gate';

/** What a claim's worktree changed against its merge base when its snapshot was taken, and the test runners' configs it held, each with its text (#33). */
export interface Changes { changed: string[]; configs: Map<string, string>; scripts: boolean; unread?: string }
export async function changesOf(cwd: string, base: string, ms: number): Promise<Changes> {
  const deadline = Date.now() + ms;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), LC_ALL: 'C' };
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
  const [diff, others, tracked] = await Promise.all([paths(['diff', '-z', '--name-only', '--no-renames', base]), paths(['ls-files', '-z', '--others', '--exclude-standard']), paths(['ls-files', '-z'])]);
  const configs = new Map<string, string>();
  for (const path of new Set([...tracked, ...others].filter(runnerConfig))) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    if (text !== undefined) configs.set(path, text);
  }
  // Whether package.json's scripts changed: the script a check runs is its own.
  const scriptsOf = (text: string | undefined): string => { try { return JSON.stringify((JSON.parse(text ?? '{}') as { scripts?: unknown }).scripts ?? null); } catch { return 'unreadable'; } };
  const scripts = diff.includes('package.json') && scriptsOf((await git(['show', `${base}:package.json`], true)).toString('utf8')) !== scriptsOf(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined));
  return { changed: [...new Set([...diff, ...others])].sort(), configs, scripts, ...(unread.length ? { unread: unread.join('; ') } : {}) };
}
