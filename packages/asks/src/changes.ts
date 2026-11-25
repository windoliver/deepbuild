// What changed in a session's worktree since the commit its ask showed, as git reads it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Card, Obj } from './model.js';

const git = promisify(execFile);
/** What git said to each command in a worktree, by the command: shared by the cards of one Needs you load. */
export type GitSaid = Map<string, Promise<string>>;

/**
 * What changed since the commit an ask showed, when its session's worktree has moved on from it. `said` holds what
 * git said to each command in a worktree, for one read of several cards; by default, this card's own.
 */
export async function changedSince(pin: Obj, worktree: string | undefined, said: GitSaid = new Map()): Promise<Card['changed']> {
  if (pin.kind !== 'commit' || worktree === undefined) return null;
  const from = pin.ref as string;
  try {
    const run = (...args: string[]): Promise<string> => {
      const key = JSON.stringify([worktree, ...args]);
      const known = said.get(key);
      if (known) return known;
      const out = git('git', ['-C', worktree, ...args], { maxBuffer: 1 << 24 }).then((r) => r.stdout);
      said.set(key, out);
      return out;
    };
    const to = (await run('rev-parse', 'HEAD')).trim();
    if (to === from) return null;
    const files = (await run('diff', '--name-only', from, to)).split('\n').filter(Boolean);
    return { from, to, files, diff: await run('diff', from, to) };
  } catch {
    return null;
  }
}
