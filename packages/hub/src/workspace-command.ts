// `deep workspace` (#67): a CLI over the running hub, one line of JSON a command, and no command asks a question. A
// task enters a workspace's record with `task` (#1347), and `revert` with no commit goes back one step.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = `Usage: deep workspace new <topic> [--folder <path>]
       deep workspace task <id> <title> --criterion <text> [--criterion <text>]... [--blocked-by <n>]...
       deep workspace move <id> <folder | repo checkout>
       deep workspace revert <id> [<commit>]
       deep workspace diff <id>
       deep workspace drift <id>`;

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

export async function workspaceCommand(args: readonly string[]): Promise<number> {
  const asked = parsed(args);
  if (!asked) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), asked.method, asked.params);
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(reply.result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
}
