// The plain TypeScript hub for #56: holds, leases and process cleanup over a Unix socket, on Node's
// built-ins only. See tests/acceptance/56/README.md for the surface.
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { realClock, virtualClock } from './clock.ts';
import type { Clock } from './clock.ts';
import { childOf, HOLD_MS, runHold } from './hold.ts';
import type { Hold } from './hold.ts';
import { Ledger, waitGroupGone } from './ledger.ts';
import { Pool } from './pool.ts';

interface Extension {
  name: string;
  onHold(hold: { id: string; session: string }, signal: AbortSignal): Promise<void> | void;
}

interface Session {
  node: AbortController;
  // Each open hold's node, with the promise that its lease is back.
  open: Map<AbortController, Promise<void>>;
}

type Request =
  | { op: 'hold'; id: string; session: string; check?: { argv?: unknown } }
  | { op: 'cancel'; session: string }
  | { op: 'leases' }
  | { op: 'stats' }
  | { op: 'tick'; ms: number };

const USAGE = 'usage: hub.mjs --variant plain --state <dir> --ports <first>-<last> [--extension <module>]... [--clock virtual]';

export async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { state: { type: 'string' }, ports: { type: 'string' }, extension: { type: 'string', multiple: true }, clock: { type: 'string' } },
  });
  const range = values.ports?.match(/^(\d+)-(\d+)$/);
  if (!values.state || !range) throw new Error(USAGE);
  const first = Number(range[1]);
  const ports = Array.from({ length: Number(range[2]) - first + 1 }, (_, index) => first + index);
  const state = resolve(values.state);
  mkdirSync(state, { recursive: true });

  const ledger = await Ledger.open(state);
  const extensions = await Promise.all(
    (values.extension ?? []).map(async (path) => ((await import(pathToFileURL(resolve(path)).href)) as { default: Extension }).default),
  );
  const virtual = values.clock === 'virtual' ? virtualClock() : undefined;
  const clock: Clock = virtual ?? realClock();
  const pool = new Pool(ports);
  const hub = new AbortController();
  const sessions = new Map<string, Session>();

  async function hold(request: Hold, socket: Socket): Promise<void> {
    const until = clock.now() + HOLD_MS;
    send(socket, { ack: request.id, hold_until_ms: until });
    let session = sessions.get(request.session);
    if (!session) {
      session = { node: childOf(hub.signal), open: new Map() };
      sessions.set(request.session, session);
    }
    const node = childOf(session.node.signal);
    for (const extension of extensions) notify(extension, { id: request.id, session: request.session }, node.signal);
    const cancelTimeout = clock.at(until, () => node.abort('timeout'));
    const { result: decided, released } = runHold(request, node.signal, pool, ledger);
    session.open.set(node, released);
    const result = await decided;
    // Only microtasks run between the hold's decision and here, so a cancel counts exactly the holds
    // that end `cancelled`.
    session.open.delete(node);
    cancelTimeout();
    node.abort('ended');
    if (!session.open.size && sessions.get(request.session) === session) {
      sessions.delete(request.session);
      session.node.abort('ended');
    }
    send(socket, { id: request.id, ...result });
    socket.end();
  }

  // Answers once the holds it cancelled have stopped their processes and given their leases back.
  async function cancel(name: string): Promise<number> {
    const session = sessions.get(name);
    if (!session) return 0;
    sessions.delete(name);
    const cancelled = [...session.open].filter(([node]) => !node.signal.aborted).map(([, released]) => released);
    session.node.abort('cancelled');
    await Promise.all(cancelled);
    return cancelled.length;
  }

  function serve(line: string, socket: Socket): void {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      return reply(socket, { error: 'a request is one JSON object on one line' });
    }
    switch (request.op) {
      case 'hold': {
        const { id, session } = request;
        const argv = request.check?.argv;
        if (!isArgv(argv)) return reply(socket, { error: 'check.argv must be a non-empty array of strings' });
        void hold({ id, session, argv }, socket).catch((error: unknown) => {
          process.stderr.write(`hold ${id} failed: ${error instanceof Error ? error.stack : String(error)}\n`);
        });
        return;
      }
      case 'cancel':
        void cancel(request.session).then((cancelled) => reply(socket, { ok: true, cancelled }));
        return;
      case 'leases':
        return reply(socket, { pool: pool.ports, held: pool.held() });
      case 'stats':
        return reply(socket, {
          rssBytes: process.memoryUsage().rss,
          maxRssBytes: process.resourceUsage().maxRSS * 1024,
          handles: process.getActiveResourcesInfo().length,
        });
      case 'tick':
        if (!virtual) return reply(socket, { error: 'tick needs --clock virtual' });
        return reply(socket, { now: virtual.tick(request.ms) });
      default:
        return reply(socket, { error: 'unknown op' });
    }
  }

  const socketPath = join(state, 'hub.sock');
  rmSync(socketPath, { force: true }); // a killed hub leaves its socket file behind
  const server = createServer((socket) => {
    socket.on('error', () => {}); // a client that hangs up early only loses its reply
    createInterface({ input: socket }).once('line', (line) => serve(line, socket));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(socketPath, done);
  });
  process.stdout.write(`${JSON.stringify({ ready: true, variant: 'plain', socket: socketPath, pid: process.pid })}\n`);

  await new Promise<void>((done) => {
    process.once('SIGTERM', () => done());
    process.once('SIGINT', () => done());
  });
  hub.abort('cancelled');
  server.close();
  // Aborting the hub sent SIGKILL to every running group; wait up to 3 s to see them gone.
  await Promise.race([Promise.all([...ledger.live].map(waitGroupGone)), new Promise((done) => setTimeout(done, 3000))]);
  // An extension's pending promise or timer would keep Node running, so exit outright.
  process.exit(0);
}

// Never awaited: an extension that ignores its signal must not keep a reply, a lease or exit waiting.
function notify(extension: Extension, hold: { id: string; session: string }, signal: AbortSignal): void {
  const report = (error: unknown) => process.stderr.write(`extension ${extension.name} failed: ${String(error)}\n`);
  try {
    Promise.resolve(extension.onHold(hold, signal)).catch(report);
  } catch (error) {
    report(error);
  }
}

function isArgv(value: unknown): value is Hold['argv'] {
  return Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string');
}

function send(socket: Socket, body: object): void {
  if (socket.writable) socket.write(`${JSON.stringify(body)}\n`);
}

function reply(socket: Socket, body: object): void {
  send(socket, body);
  socket.end();
}
