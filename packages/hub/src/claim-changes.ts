// What a claim's worktree changed against its merge base, and the test runners' configs it held (#33): read beside its
// snapshot, from the same worktree.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runnerConfig } from '@deepbuild/gate';

/**
 * What a claim's worktree changed against its merge base when its snapshot was taken, and the test runners' configs it held, each with its text (#33);
 * and, where a read of them failed or ran past its deadline, which one and why (#1869): then nothing is known of what it changed.
 */
export interface Changes { changed: string[]; configs: Map<string, string>; scripts: boolean; unread?: string }
/** Read as the snapshot's git reads are bounded (#1869): fsmonitor off, up to 1 GB of output (its untracked listing's), and all of them ended within `ms`, by SIGKILL. */
export async function changesOf(cwd: string, base: string, ms: number): Promise<Changes> {
  const deadline = Date.now() + ms;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const unread: string[] = [];
  // A read that fails is recorded unless `missing` allows it (a file the base never had); either way it lists nothing.
  const git = (args: string[], missing = false): Promise<string[]> => new Promise((done) => {
    const left = Math.max(1, Math.ceil(deadline - Date.now()));
    execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env, maxBuffer: 1 << 30, timeout: left, killSignal: 'SIGKILL' }, (error, out, err) => {
      if (error && !(missing && !error.killed)) {
        const why = (error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'gave more than 1 GB' : error.killed ? `timed out, past the read's ${Math.ceil(ms)} ms deadline` : `failed: ${String(err).trim().split('\n')[0] || error.message}`;
        unread.push(`git ${args.join(' ')} ${why}`);
      }
      done(error ? [] : out.split('\n').filter(Boolean));
    });
  });
  const [diff, others, tracked] = await Promise.all([git(['diff', '--name-only', '--no-renames', base]), git(['ls-files', '--others', '--exclude-standard']), git(['ls-files'])]);
  const configs = new Map<string, string>();
  for (const path of new Set([...tracked, ...others].filter(runnerConfig))) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    if (text !== undefined) configs.set(path, text);
  }
  // Whether package.json's scripts changed: the script a check runs is its own.
  const scriptsOf = (text: string | undefined): string => { try { return JSON.stringify((JSON.parse(text ?? '{}') as { scripts?: unknown }).scripts ?? null); } catch { return 'unreadable'; } };
  const scripts = diff.includes('package.json') && scriptsOf((await git(['show', `${base}:package.json`], true)).join('\n')) !== scriptsOf(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined));
  return { changed: [...new Set([...diff, ...others])].sort(), configs, scripts, ...(unread.length ? { unread: unread.join('; ') } : {}) };
}
