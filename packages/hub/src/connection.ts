// A socket's owned state, shared by the server's read, reply and shutdown paths (#2330).
import type net from 'node:net';
import { line } from './wire.js';

/** A person's connection (#1337) reads only what that person may see. */
export type Role = 'hook' | 'app' | 'cli' | 'mcp' | 'person';

export class Conn {
  role: Role | undefined;
  name = '';
  session: string | null = null;
  parent: { pid: number; start: string } | undefined;
  /** For a deep mcp, the folder it runs in: which known worktree's spec an unbound deep_search reads. */
  cwd: string | undefined;
  /** For an app or cli connection, the process its hello names as its own: the peer check starts there. */
  peer: { pid: number; start: string } | undefined;
  /** The person whose credential the connection presented (#1337); none for the owner. */
  person: string | undefined;
  /**
   * A connection over the network listener (#1338), with the ID of the key its TLS handshake proved, if any: it says
   * hello first, with a credential bound to that key, or it gets nothing.
   */
  remote: { key: string | undefined } | undefined;
  /** A network connection that carries hooks its machine spooled while the link was down (#1338), one per line. */
  spool = false;
  first = true;
  done = false;
  /** A waiter's connection: its close tells the core the waiter is gone. */
  waiter = false;
  queue: Promise<void> = Promise.resolve();
  pending: Buffer[] = [];
  size = 0;
  readonly subs = new Set<string>();
  /** Its deep mcp calls in flight, each `<connection>:<call ID>`: a cancel or the connection's close tells the core their caller is gone (#1923). */
  readonly calls = new Set<string>();
  constructor(readonly id: number, readonly sock: net.Socket) {}
  write(o: object): void {
    if (!this.done && this.sock.writable) this.sock.write(line(o));
  }
  end(): void {
    if (this.done) return;
    this.done = true;
    this.sock.end();
  }
}
