// Real past tasks, read from the transcript archive (#20): each archived Claude Code session's first prompt you
// typed, in the folder it was typed in, at the commit that folder's branch was at when you typed it.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { RecordReader } from '@deepbuild/record';
import type { ReplayTask } from './index.js';

const run = promisify(execFile);
const git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  try { return (await run('git', args, { cwd })).stdout.trim() || undefined; } catch { return undefined; }
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The text of an entry you typed, or undefined for a tool result, a command, a caveat or what Claude Code wrote for you. */
function typed(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'user' || !isObj(entry.message) || entry.message.role !== 'user') return undefined;
  if (entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) return undefined;
  const content = entry.message.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.filter(isObj) : [];
  if (blocks.some((b) => b.type !== 'text')) return undefined;
  const text = blocks.map((b) => String(b.text ?? '')).join('\n').trim();
  // Claude Code wraps slash commands, their output and its own caveats in tags.
  return text && !text.startsWith('<') ? text : undefined;
}

/**
 * The tasks the archive holds, one per archived Claude Code session (by its lines), and why each other session gave none: a
 * session from another agent, one with no prompt you typed, or one whose folder or commit is gone from this machine.
 * A worktree is often removed once its work merges; with `checkout`, a session whose folder is gone and whose path
 * names that checkout's folder (`…/claude-worktrees/shop/x` for `~/shop`) is read in it, where its commits still are.
 */
export async function archivedTasks(reader: RecordReader, read: (sha256: string) => Promise<Uint8Array>, checkout?: string): Promise<{ tasks: ReplayTask[]; skipped: { session: string; why: string }[] }> {
  const named = checkout ? basename(checkout) : undefined;
  const tasks: ReplayTask[] = [];
  const skipped: { session: string; why: string }[] = [];
  for (const session of await reader.sessions()) {
    const skip = (why: string) => skipped.push({ session: `session:${session.id}`, why });
    // The archive links transcripts of sessions whose start the hub never saw, so their agent is unknown: their
    // lines say whether they are Claude Code's.
    if (session.agent !== null && session.agent !== 'claude-code') { skip(`its agent's transcripts (${session.agent}) aren't read for tasks yet`); continue; }
    let first: { entry: Record<string, unknown>; text: string } | undefined;
    for (const line of Buffer.from(await read(session.transcript)).toString('utf8').split('\n')) {
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      const text = isObj(entry) ? typed(entry) : undefined;
      if (text && typeof (entry as Record<string, unknown>).uuid === 'string') { first = { entry: entry as Record<string, unknown>, text }; break; }
    }
    if (!first) { skip('it holds no prompt you typed'); continue; }
    const at = Date.parse(String(first.entry.timestamp ?? ''));
    const cwd = typeof first.entry.cwd === 'string' ? first.entry.cwd : (session.worktree ?? '').replace(/^~(?=\/|$)/, homedir());
    const gone = !cwd || !existsSync(cwd);
    const repo = !Number.isFinite(at) ? undefined
      : !gone ? await git(cwd, ['rev-parse', '--show-toplevel'])
      : named && cwd.split('/').includes(named) ? checkout : undefined;
    if (!repo) { skip(`its folder ${cwd || '(none)'} is no git checkout on this machine`); continue; }
    const before = `--before=${new Date(at).toISOString()}`;
    const branch = typeof first.entry.gitBranch === 'string' && first.entry.gitBranch !== 'HEAD' ? first.entry.gitBranch : session.branch;
    const commit = (branch ? await git(repo, ['rev-list', '-1', before, branch, '--']) : undefined) ?? await git(repo, ['rev-list', '-1', before, 'HEAD', '--']);
    if (!commit) { skip(`${repo} has no commit from before ${new Date(at).toISOString()}`); continue; }
    tasks.push({ id: `session:${session.id}#${String(first.entry.uuid)}`, at, repo, commit, prompt: first.text });
  }
  // A replay's own agents run with your hooks, so the archive holds their sessions too, each opening with the words of
  // the task it replayed: only the first session to ask in those words is a task.
  const first = new Map<string, ReplayTask>();
  for (const t of tasks.sort((a, b) => a.at - b.at)) if (!first.has(t.prompt)) first.set(t.prompt, t);
  for (const t of tasks) if (first.get(t.prompt) !== t) skipped.push({ session: t.id.slice(0, t.id.indexOf('#')), why: `it asks in the words of ${first.get(t.prompt)!.id}, which came first` });
  return { tasks: tasks.filter((t) => first.get(t.prompt) === t), skipped };
}
