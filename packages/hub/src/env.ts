// `deep env up` and `deep env down` (#331): the worktree's stack, asked of the hub over its socket as the cli
// role, since only the hub's supervisor may start, signal and stop a stack's processes.
import { readFileSync, realpathSync } from 'node:fs';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

const USAGE = 'Usage: deep env up|down [--root <folder>] [--json]';

type Obj = Record<string, unknown>;

/** `deep env <up|down>` in the current folder, the worktree; exit 0 ready or clean, 1 when something is left, 3 when BLOCKED. */
export async function envCommand(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  let root: string | undefined;
  let json = false;
  let usage = command !== 'up' && command !== 'down';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') json = true;
    // A flag where the folder goes is a usage error, not a folder named for it.
    else if (rest[i] === '--root' && rest[i + 1] && !rest[i + 1]!.startsWith('--')) root = rest[++i];
    else usage = true;
  }
  if (usage) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const at = rootOf(root ?? installedRoot());
  const socket = root ? at.socket : hubAddress().path;
  const worktree = realpathSync(process.cwd());
  const say = (out: Obj, text: string) => process.stdout.write(json ? `${JSON.stringify(out)}\n` : `${text}\n`);
  let result: Obj;
  try {
    // Named as this process, so the hub's peer check finds the agent session above it: its leases are that session's (#332).
    const reply = await call(socket, readFileSync(at.token, 'utf8').trim(), `env.${command}`, { worktree }, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
    if ('error' in reply) throw Error(reply.error.remediation);
    result = reply.result;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    say({ status: 'BLOCKED', worktree, cause }, `BLOCKED: ${cause}`);
    return 3;
  }
  if (command === 'up') {
    const ports = Object.entries((result.ports ?? {}) as Obj).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    say(result, result.status === 'ready' ? `ready: ${ports} (${String(result.run)})` : `BLOCKED: ${String(result.cause)}`);
    return result.status === 'ready' ? 0 : 3;
  }
  const left = (result.left ?? []) as { pid?: number; port?: number; cause?: string }[];
  const named = (l: (typeof left)[number]) => l.pid === undefined ? `unchecked: ${l.cause}` : `pid ${l.pid}${l.port ? ` on port ${l.port}` : ''}`;
  say(result, `down: stopped ${(result.stopped as number[]).length}${left.length ? `; left, unproven and not stopped: ${left.map(named).join(', ')}` : ''}`);
  return left.length ? 1 : 0;
}
