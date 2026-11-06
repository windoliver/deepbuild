// `deep workspace` (#67): a CLI over the running hub, one line of JSON a command, and no command asks a question.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = `Usage: deep workspace new <topic> [--folder <path>]
       deep workspace move <id> <folder>
       deep workspace revert <id> <commit>
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
  if ((command === 'diff' || command === 'drift') && args.length === 2) return { method: `workspace.${command}`, params: { id: first } };
  return undefined;
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
