// The hub's side of deep_drive (#124): each launch starts one `deep-drive --out <dir>` process, the checkout's build
// of the replica, which hosts one headless copy of the app and answers each call as one JSON line. The hub forwards a
// session's calls to the process its launch started and its reply back, as the binary gave it; the core takes the
// replica lease before a launch, at most two per machine, and releases it once the process has exited.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { LeaseKind, LeaseTable } from '@deepbuild/leases';
import { refuse, ulid, type Plant } from './wire.js';
import { isRecord as isObj } from '@deepbuild/contracts';

type Obj = Record<string, unknown>;

/** The replica's lease kind: at most two replicas run on a machine at once (Replica, Cost). */
export const REPLICA_LEASE: LeaseKind = { name: 'replica', match: 'pool(2)', cap: 2, cooldown: 0, cost: 0 };

/** How long a replica has to exit once its stdin ends before it is sent SIGTERM. */
const END_MS = 2000;

/** The replica's binary: the checkout's debug build of `deep-drive`. */
function driveBinary(): string {
  const bin = join(fileURLToPath(new URL('../../../', import.meta.url)), 'target', 'debug', 'deep-drive');
  if (!existsSync(bin)) throw refuse('unavailable', '', `No replica is built at ${bin}; run cargo build -p deep-replica --bin deep-drive first.`, 'deep-drive', true);
  return bin;
}

/** One `deep-drive` process: its `{"ready": true}` first, then one reply line per call, one call at a time, in order. */
export class Replica {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting: ((line: Obj | undefined) => void)[] = [];
  private chain: Promise<unknown>;
  private stderr = '';
  /** Settles once the process has exited, or failed to start. */
  readonly exited: Promise<void>;

  constructor(out: string) {
    const child = this.child = spawn(driveBinary(), ['--out', out], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { this.stderr = (this.stderr + d).slice(-2000); });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let value: Obj;
      try { value = JSON.parse(line) as Obj; } catch { value = { unparsed: line.slice(0, 300) }; }
      this.waiting.shift()?.(value);
    });
    child.stdin.on('error', () => undefined);
    this.exited = new Promise((done) => {
      const gone = () => { for (const wake of this.waiting.splice(0)) wake(undefined); done(); };
      child.once('exit', gone);
      child.once('error', gone);
    });
    this.chain = this.next().then((first) => {
      if (first?.ready !== true) throw refuse('unavailable', '', `deep-drive didn't say it was ready: ${JSON.stringify(first ?? this.stderr).slice(0, 300)}`, 'deep-drive', true);
    });
  }

  private next(): Promise<Obj | undefined> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Sends one call once the process is ready and every call before it has its reply; its reply. */
  call(line: Obj): Promise<Obj> {
    const run = this.chain.then(async () => {
      const reply = this.next();
      this.child.stdin.write(`${JSON.stringify(line)}\n`);
      const value = await reply;
      if (!value) throw refuse('unavailable', '', `deep-drive exited before it answered ${String(line.call)}: ${this.stderr.slice(-300)}`, String(line.call), true);
      return value;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Ends its stdin, which ends the process; SIGTERM by its PID if it hasn't exited in END_MS. */
  async end(): Promise<void> {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), END_MS);
    await this.exited;
    clearTimeout(timer);
  }
}

/** A deep_drive call as the binary takes it: the fields left null dropped, at every depth, so its defaults hold. */
export function driveCall(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(driveCall);
  if (!isObj(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, driveCall(v)]));
}

interface ReplicasOptions { folder: string; now: () => number; leases: () => LeaseTable; plant: Plant | undefined }

/** Each session's replicas (#124): each its own deep-drive process under the replica lease, released once it exits. */
export class Replicas {
  /** Each replica process a launch started, by the handle the hub gave it: the binary's own handle, its session, and its end. */
  private readonly held = new Map<string, { replica: Replica; own: string; session: string; gone: Promise<void> }>();
  constructor(private readonly o: ReplicasOptions) {}

  /**
   * One deep_drive call. A launch takes the replica lease, refused naming it when the machine runs its two, then
   * starts a deep-drive process for the session; every other call goes to the process the session's launch started,
   * and close ends it. Its lease is released once the process has exited, however it ends.
   */
  async drive(session: string, args: Obj): Promise<Obj> {
    const call = driveCall(args) as Obj;
    if (call.call === 'launch') return this.launch(session, call);
    const handle = String(args.replica);
    const held = this.held.get(handle);
    if (!held?.own || held.session !== session) throw refuse('not_found', '/params/arguments/replica', 'Name a replica your session launched and hasn\'t closed; deep_drive\'s launch starts one.', args.replica);
    const reply = await held.replica.call({ ...call, replica: held.own });
    if (call.call === 'close') {
      await held.replica.end();
      await held.gone;
    }
    return reply.replica === undefined ? reply : { ...reply, replica: handle };
  }
  /** A session that ended takes its replicas with it, and their leases (#124). */
  endFor(session: string): void {
    for (const held of this.held.values()) if (held.session === session) void held.replica.end();
  }
  /** Every replica ends with the hub. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.held.values()].map(async (r) => { await r.replica.end(); await r.gone; }));
  }
  private async launch(session: string, call: Obj): Promise<Obj> {
    const id = ulid(this.o.now());
    const handle = `replica:${id}`;
    let lease: string | undefined;
    // The planted hub launches without the lease (#124's wrong program).
    if (this.o.plant !== 'deep-drive-no-lease') {
      const got = await this.o.leases().lease({ holder: `mcp:${session}` }, { host: 'local', kind: REPLICA_LEASE.name, key: handle }, 'exclusive');
      if (got.status !== 'granted') {
        return { ok: false, error: { code: 'blocked', lease: REPLICA_LEASE.name, message: `No replica was launched: the ${REPLICA_LEASE.name} lease allows ${REPLICA_LEASE.cap} per machine, and ${got.message}.` } };
      }
      lease = got.lease.id;
    }
    const out = join(this.o.folder, id);
    let replica: Replica;
    try {
      mkdirSync(out, { recursive: true });
      replica = new Replica(out);
    } catch (error) {
      if (lease) await this.o.leases().release(lease, []);
      throw error;
    }
    const gone = replica.exited.then(async () => {
      this.held.delete(handle);
      if (lease) await this.o.leases().release(lease, []);
    }).catch(() => undefined);
    const entry = { replica, own: '', session, gone };
    this.held.set(handle, entry);
    let reply: Obj;
    try {
      reply = await replica.call(call);
    } catch (error) {
      await replica.end();
      throw error;
    }
    if (reply.ok !== true || typeof reply.replica !== 'string') {
      await replica.end();
      return reply;
    }
    entry.own = reply.replica;
    return { ...reply, replica: handle };
  }
}
