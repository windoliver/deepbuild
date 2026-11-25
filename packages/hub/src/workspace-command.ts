// `deep workspace` (#67): a CLI over the running hub, and no command asks a question. Each prints what it did in words,
// or with `--json` last its result as one line of JSON (#1812). A task enters a workspace's record with `task` (#1347),
// and `revert` with no commit goes back one step.
import { resolve } from 'node:path';
import { call, notAnswered } from './client.js';
import { hubControl } from './paths.js';
import { visible } from './visible.js';

const USAGE = `Usage: deep workspace new <topic> [--folder <path>] [--json]
       deep workspace task <id> <title> --criterion <text> [--criterion <text>]... [--blocked-by <n>]... [--json]
       deep workspace move <id> <folder | repo checkout> [--json]
       deep workspace revert <id> [<commit>] [--json]
       deep workspace diff <id> [--json]
       deep workspace drift <id> [--json]`;

/** The call a command line makes, or undefined when it isn't one. */
function parsed(args: readonly string[]): { method: string; params: Record<string, unknown> } | undefined {
  const [command, first, second, third] = args;
  if (!first || first.startsWith('-')) return undefined;
  if (command === 'new' && args.length === 2) return { method: 'workspace.new', params: { topic: first } };
  if (command === 'new' && args.length === 4 && second === '--folder' && third) return { method: 'workspace.new', params: { topic: first, folder: resolve(third) } };
  if (command === 'move' && args.length === 3 && second) return { method: 'workspace.move', params: { id: first, folder: resolve(second) } };
  if (command === 'revert' && args.length === 3 && second) return { method: 'workspace.revert', params: { id: first, commit: second } };
  if (command === 'revert' && args.length === 2) return { method: 'workspace.revert', params: { id: first } };
  if (command === 'task' && second && !second.startsWith('-')) return taskOf(first, second, args.slice(3));
  if ((command === 'diff' || command === 'drift') && args.length === 2) return { method: `workspace.${command}`, params: { id: first } };
  return undefined;
}

/** `task`'s flags: one or more criteria, and the earlier tasks it is blocked by, by number. */
function taskOf(id: string, title: string, rest: readonly string[]): { method: string; params: Record<string, unknown> } | undefined {
  const criteria: string[] = [];
  const blocked_by: number[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (value === undefined) return undefined;
    if (rest[i] === '--criterion' && value.trim()) criteria.push(value);
    else if (rest[i] === '--blocked-by' && /^#?[1-9][0-9]*$/.test(value)) blocked_by.push(Number(value.replace('#', '')));
    else return undefined;
  }
  return criteria.length ? { method: 'workspace.task', params: { id, title, criteria, blocked_by } } : undefined;
}

/** What a call did, in words, from its result: one line, or a diff's line per changed item. */
function said(method: string, params: Record<string, unknown>, r: Record<string, unknown>): string[] {
  const listed = (values: unknown) => (Array.isArray(values) && values.length ? values.join(', ') : 'none');
  switch (method) {
    case 'workspace.new': return [`Made the workspace ${String(r.name)} as ${String(r.id)}, in ${String(r.folder)}.`];
    case 'workspace.task': return [`Entered task #${String(r.task)} in ${String(params.id)}.`];
    case 'workspace.move': return [Array.isArray(r.filed)
      ? `Moved ${String(r.id)} to ${String(r.repo)}, its open tasks filed as ${listed((r.filed as { task: number; issue: number }[]).map((f) => `#${f.task} as issue #${f.issue}`))}.`
      : `Moved ${String(r.id)} to ${String(r.folder)}.`];
    case 'workspace.revert': return [r.task === undefined
      ? `Reverted ${String(params.commit)} in ${String(params.id)}; it is at ${String(r.commit)}.`
      : `Went back one step in ${String(params.id)}: task #${String(r.task)} undone, at ${String(r.commit)}${Array.isArray(r.undo) && r.undo.length ? `; undone outside git: ${r.undo.join('; ')}` : ''}.`];
    case 'workspace.diff': {
      const diffs = (r.diffs ?? []) as { touch: string; item: string; was: unknown; now: unknown }[];
      return diffs.length ? diffs.map((d) => `${d.touch} ${d.item}: ${JSON.stringify(d.was)} is now ${JSON.stringify(d.now)}`) : [`No item of ${String(params.id)} changed.`];
    }
    default: return [`Drifted: ${listed(r.drifted)}. Stale: ${listed(r.stale)}. Ran again: ${listed(r.reran)}.`];
  }
}

export async function workspaceCommand(args: readonly string[]): Promise<number> {
  const json = args.at(-1) === '--json';
  const asked = parsed(json ? args.slice(0, -1) : args);
  if (!asked) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const { path: socket, token } = hubControl();
    const reply = await call(socket, token, asked.method, asked.params);
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    process.stdout.write(`${json ? JSON.stringify(reply.result) : said(asked.method, asked.params, reply.result).map(visible).join('\n')}\n`);
    return 0;
  } catch (error) {
    return notAnswered(error);
  }
}
