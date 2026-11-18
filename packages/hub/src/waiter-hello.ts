// deep-hook's waiter says hello (#1851): bound to its session by the agent process it runs under, checked by that
// process's start time, as a deep mcp is bound, and with no token.
import type { Conn } from './connection.js';
import type { CoreRequest } from './core-worker.js';
import { refusal } from './wire.js';

type Bound = { session: string; parent?: { pid: number; start: string } } | { refused: string; retryable?: true };

/**
 * Binds `conn` as the waiter of the session its hello names, or refuses it. A refusal is said once in the hub's output
 * too (`said` keeps those said, at most a thousand): the waiter asks again quietly, and its stderr becomes a wake's prompt.
 */
export async function waiterHello(conn: Conn, value: Record<string, unknown>, request: (request: CoreRequest) => Promise<unknown>, said: Set<string>): Promise<void> {
  const session = typeof value.session === 'string' ? value.session : '';
  // A session's ID as its hooks carry it, and short: nothing else costs the hub a look at processes.
  if (!/^[\w.:-]{1,128}$/.test(session)) {
    conn.write({ id: null, error: refusal('type', '/session', "Name the waiter's session by its ID, as its hooks carry it.") });
    return conn.end();
  }
  const fd = (conn.sock as unknown as { _handle?: { fd?: number } })._handle?.fd;
  const bound = (await request({ op: 'waiter-hello', fd, session, at: conn.at }).catch((error: unknown) => ({ refused: error instanceof Error ? error.message : String(error), retryable: true }))) as Bound;
  if ('refused' in bound) {
    if (!said.has(bound.refused)) {
      if (said.size >= 1000) said.clear();
      said.add(bound.refused);
      process.stderr.write(`deep hub: refused a waiter: ${bound.refused}\n`);
    }
    // One the core couldn't look into, as when it is stopping, is asked again soon.
    conn.write({ id: null, error: 'retryable' in bound ? refusal('unavailable', '/hello', bound.refused, session, true) : refusal('role', '/hello', bound.refused, session) });
    return conn.end();
  }
  conn.role = 'waiter';
  conn.session = bound.session;
  conn.parent = bound.parent;
  conn.name = `waiter:${bound.session}`;
  conn.write({ role: conn.name });
}
