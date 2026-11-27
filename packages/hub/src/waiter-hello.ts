import type { Conn } from './connection.js';
import type { CoreRequest } from './core-worker.js';
import { refusal } from './wire.js';

type Bound = { session: string; parent?: { pid: number; start: string } } | { refused: string; retryable?: true };

const said = new Set<string>();

export async function waiterHello(conn: Conn, value: Record<string, unknown>, request: (request: CoreRequest) => Promise<unknown>): Promise<void> {
  if (value.hello !== 'waiter') {
    conn.write({ id: null, error: refusal('enum', '/hello', 'Say hello as app, cli, mcp or waiter.', value.hello) });
    return conn.end();
  }
  const session = typeof value.session === 'string' ? value.session : '';
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
    conn.write({ id: null, error: 'retryable' in bound ? refusal('unavailable', '/hello', bound.refused, session, true) : refusal('role', '/hello', bound.refused, session) });
    return conn.end();
  }
  conn.role = 'waiter';
  conn.session = bound.session;
  conn.parent = bound.parent;
  conn.name = `waiter:${bound.session}`;
  conn.write({ role: conn.name });
}
