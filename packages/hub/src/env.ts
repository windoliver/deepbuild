// `deep env up` and `deep env down` (#331): the worktree's stack, asked of the hub over its socket as the cli
// role, since only the hub's supervisor may start, signal and stop a stack's processes.
import { readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const USAGE = 'Usage: deep env up|down [--root <folder>] [--json]';

type Obj = Record<string, unknown>;
/** One call on the hub's socket with the cli role: the result, or the hub's refusal as an Error. */
function call(socket: string, token: string, method: string, params: Obj): Promise<Obj> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let hello = false;
    sock.setEncoding('utf8');
    sock.on('error', (error) => reject(Error(`can't reach the hub at ${socket}: ${error.message}`)));
    sock.on('close', () => reject(Error('the hub closed the connection before it answered')));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        let reply: Obj;
        try {
          reply = JSON.parse(buffer.slice(0, i)) as Obj;
        } catch {
          sock.destroy();
          return reject(Error(`the hub answered a line that isn't JSON: ${buffer.slice(0, i).slice(0, 200)}`));
        }
        buffer = buffer.slice(i + 1);
        if (!hello) {
          hello = true;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (reply.role !== undefined) {
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (reply.id === 1) {
          sock.destroy();
          if (reply.error) reject(Error((reply.error as { remediation?: string }).remediation ?? JSON.stringify(reply.error)));
          else resolve(reply.result as Obj);
        }
      }
    });
  });
}

/** `deep env <up|down>` in the current folder, the worktree; exit 0 ready or clean, 1 when something is left, 3 when BLOCKED. */
export async function envCommand(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  let root: string | undefined;
  let json = false;
  let usage = command !== 'up' && command !== 'down';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') json = true;
    else if (rest[i] === '--root' && rest[i + 1]) root = rest[++i];
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
    result = await call(socket, readFileSync(at.token, 'utf8').trim(), `env.${command}`, { worktree });
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
  const left = (result.left ?? []) as { pid: number; port?: number }[];
  say(result, `down: stopped ${(result.stopped as number[]).length}${left.length ? `; left, unproven and not stopped: ${left.map((l) => `pid ${l.pid}${l.port ? ` on port ${l.port}` : ''}`).join(', ')}` : ''}`);
  return left.length ? 1 : 0;
}
