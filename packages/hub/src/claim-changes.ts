// What a claim's worktree changed against its merge base, and the test runners' configs it held (#33): read beside its
// snapshot, from the same worktree.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runnerConfig } from '@deepbuild/gate';

/** What a claim's worktree changed against its merge base when its snapshot was taken, and the test runners' configs it held, each with its text (#33). */
export interface Changes { changed: string[]; configs: Map<string, string>; scripts: boolean }
export async function changesOf(cwd: string, base: string): Promise<Changes> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (args: string[]): Promise<string[]> => new Promise((done) => execFile('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, maxBuffer: 64 << 20 }, (error, out) => done(error ? [] : out.split('\n').filter(Boolean))));
  const [diff, others, tracked] = await Promise.all([git(['diff', '--name-only', '--no-renames', base]), git(['ls-files', '--others', '--exclude-standard']), git(['ls-files'])]);
  const configs = new Map<string, string>();
  for (const path of new Set([...tracked, ...others].filter(runnerConfig))) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    if (text !== undefined) configs.set(path, text);
  }
  // Whether package.json's scripts changed: the script a check runs is its own.
  const scriptsOf = (text: string | undefined): string => { try { return JSON.stringify((JSON.parse(text ?? '{}') as { scripts?: unknown }).scripts ?? null); } catch { return 'unreadable'; } };
  const scripts = diff.includes('package.json') && scriptsOf((await git(['show', `${base}:package.json`])).join('\n')) !== scriptsOf(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined));
  return { changed: [...new Set([...diff, ...others])].sort(), configs, scripts };
}
