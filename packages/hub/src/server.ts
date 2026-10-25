// The hub on its socket (#16): one process per user, listening on <root>/hub.sock, mode 0600, and on no network
// port. The event loop only reads lines, acknowledges, routes and writes replies: parser workers parse and scrub
// each line, and the core, in a worker of its own, owns the record. Every connection takes one role from the
// credential it presents in its first line, and every event takes its writer from that role.
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { CoreMessage, CoreRequest } from './core-worker.js';
import { takeLock, type Lock } from './lock.js';
import { installedRoot, rootOf, type Root } from './paths.js';
import { shedStartup } from './settle.js';
import { EXTENSION_HOLD_MS, FEATURES, line, plantOf, refusal, Refused, ulid, type CoreOptions, type ExtensionReply, type HookMeta, type Parsed, type Plant, type Refusal, type VfsSettings } from './wire.js';

/** A line longer than this goes to the parser kept for large lines, so it never queues ahead of small ones. */
const BIG = 1 << 20;
const MAX_LINE = 64 << 20;

type Role = 'hook' | 'app' | 'cli' | 'mcp';
/** Which roles may call each method. A hook connection may only send its one request. */
const ALLOWED = new Map<string, readonly Role[]>([
  ['hub.health', ['app', 'cli']], ['events.read', ['app', 'cli']], ['stream.subscribe', ['app', 'cli']], ['ask.answer', ['app', 'cli']], ['inbox.read', ['app', 'cli']],
  ['gates.off', ['app', 'cli']], ['hub.stop', ['app', 'cli']], ['run.start', ['app', 'cli']], ['test.load', ['app', 'cli']],
  ['env.up', ['app', 'cli']], ['env.down', ['app', 'cli']],
  ['mcp.call', ['mcp']], ['evidence.paste', ['app']],
  ['job.submit', ['app', 'cli']], ['job.status', ['app', 'cli']], ['job.list', ['app', 'cli']], ['job.output', ['app', 'cli']],
  // A window reading comes from the app, the CLI, or deep-hook's status line forwarder, which connects as a hook does.
  ['windows.report', ['app', 'cli', 'hook']],
]);

/** How long before an acknowledged hold the extensions' reply must be on the socket, so it reaches deep-hook in time. */
const HOLD_MARGIN = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const EMPTY_REPLY = line({ exit: 0, stdout: '', stderr: '' });
/**
 * The extensions' joined reply as the agent's own hook output (#350): a deny ends the call, its reasons on stderr
 * as deep-hook's own denials are; context goes as Claude Code reads it, each block labelled with its extension. An
 * agent with no context channel gets only the denies.
 */
function agentReply(agent: string, reply: ExtensionReply): string {
  if (reply.denies.length) return line({ exit: 2, stdout: '', stderr: reply.denies.map((d) => `DeepBuild blocked this: [${d.extension}] ${d.reason}`).join('\n') + '\n' });
  if (!reply.context.length || (agent !== 'claude-code' && agent !== 'claude')) return EMPTY_REPLY;
  const additionalContext = reply.context.map((b) => `[${b.extension}] ${b.text}`).join('\n');
  return line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }), stderr: '' });
}
const versionRefusal = (value: Obj): Refusal =>
  refusal('v' in value ? 'const' : 'required', '/v', 'Send every line with "v": 1, the socket protocol version.', value.v);

interface CoreLink {
  post(message: CoreMessage & { op: 'hook' | 'unsubscribe' }): void;
  request(request: CoreRequest): Promise<unknown>;
  /** Resolves once the record is open, the spool replayed, in-flight runs recovered and the extensions started, with the hook kinds they handle. */
  started: Promise<{ hooks: string[] }>;
  close(): Promise<void>;
}
interface Parsers { parse(chunks: Buffer[], first: boolean): Promise<Parsed>; close(): Promise<void> }

function coreWorker(options: CoreOptions, onFrame: (sub: string, event: Obj) => void, onFatal: (why: string) => void): CoreLink {
  const worker = new Worker(new URL('./core-worker.js', import.meta.url), { workerData: { core: options } });
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  let n = 0;
  let started!: (v: { hooks: string[] }) => void;
  const ready = new Promise<{ hooks: string[] }>((resolve) => { started = resolve; });
  worker.on('message', (m: { op?: string; n?: number; sub?: string; event?: Obj; message?: string; result?: unknown; error?: Refusal; hooks?: string[] }) => {
    if (m.op === 'frame') return onFrame(m.sub!, m.event!);
    if (m.op === 'started') return started({ hooks: m.hooks ?? [] });
    if (m.op === 'fatal') return onFatal(m.message!);
    const waiting = pending.get(m.n!);
    pending.delete(m.n!);
    if (m.error) waiting?.reject(new Refused(m.error));
    else waiting?.resolve(m.result);
  });
  worker.on('error', (error) => onFatal(error.stack ?? error.message));
  return {
    post: (message) => worker.postMessage(message),
    request: (request) => new Promise((resolve, reject) => {
      pending.set(++n, { resolve, reject });
      worker.postMessage({ ...request, n });
    }),
    started: ready,
    close: async () => { await worker.terminate(); },
  };
}
/** The commit-on-event-loop plant: the core on the event loop, committing through the synchronous binding there. */
async function coreInline(options: CoreOptions, onFrame: (sub: string, event: Obj) => void, onFatal: (why: string) => void): Promise<CoreLink> {
  const { Core } = await import('./core.js');
  const { answer, asRefusal } = await import('./core-worker.js');
  const core = new Core(options, onFrame);
  const started = core.started().then(() => ({ hooks: core.hooks() }));
  started.catch((error: unknown) => onFatal(error instanceof Error ? error.stack ?? error.message : String(error)));
  return {
    started,
    post: (message) => (message.op === 'hook' ? void core.hook(message.drafts, message.meta, message.writer).catch(() => undefined) : core.unsubscribe(message.sub)),
    request: (request) => answer(core, request).catch((error: unknown) => { throw new Refused(asRefusal(error)); }),
    close: async () => undefined,
  };
}

function parserPool(held: string[], plant: Plant | undefined): Parsers {
  const pending = new Map<number, (parsed: Parsed) => void>();
  let n = 0;
  const make = () => {
    const worker = new Worker(new URL('./parser.js', import.meta.url), { workerData: { held, ...(plant ? { plant } : {}) } });
    worker.on('message', ({ n: id, parsed }: { n: number; parsed: Parsed }) => {
      pending.get(id)?.(parsed);
      pending.delete(id);
    });
    return worker;
  };
  // One parser for small lines and one kept for large ones.
  const small = make();
  const big = make();
  return {
    parse(chunks, first) {
      const size = chunks.reduce((sum, c) => sum + c.length, 0);
      const worker = size > BIG ? big : small;
      return new Promise((resolve) => {
        pending.set(++n, resolve);
        worker.postMessage({ n, chunks, first });
      });
    },
    close: async () => { await Promise.all([small, big].map((w) => w.terminate())); },
  };
}
/** The parse-on-event-loop plant: every line it reads scrubbed and parsed on the event loop. */
async function parserInline(held: string[], plant: Plant): Promise<Parsers> {
  const { parseLine } = await import('./hookmap.js');
  const { scrubText } = await import('@deepbuild/evidence');
  return {
    parse: async (chunks, first) => {
      const line = Buffer.concat(chunks);
      const parsed = parseLine(line, first, held, plant);
      // A hook line is scrubbed whole, as a hub that scrubs what it reads before keeping any field would.
      if (parsed.kind === 'hook') scrubText(line.toString('utf8'), { held });
      return parsed;
    },
    close: async () => undefined,
  };
}

class Conn {
  role: Role | undefined;
  name = '';
  session: string | null = null;
  parent: { pid: number; start: string } | undefined;
  /** For an app or cli connection, the process its hello names as its own: the peer check starts there. */
  peer: { pid: number; start: string } | undefined;
  first = true;
  done = false;
  queue: Promise<void> = Promise.resolve();
  pending: Buffer[] = [];
  size = 0;
  readonly subs = new Set<string>();
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

/** What the hub reads of a guard@1 entry in rules.json. */
interface Guard { mode?: unknown; reason?: unknown; next_step?: unknown }

class Hub {
  private readonly server = net.createServer({ allowHalfOpen: false });
  private readonly conns = new Set<Conn>();
  private readonly subs = new Map<string, { conn: Conn; id: unknown }>();
  private core!: CoreLink;
  private parsers!: Parsers;
  private ids = 0;
  private ino = 0;
  private stopping = false;
  /** The hook kinds some extension handles: only such a hook is held for the extensions' reply. */
  private hooks = new Set<string>();
  readonly start = ulid(Date.now());
  private readonly helloLine = line({ hello: 'deep-hub', start: this.start, features: FEATURES });

  constructor(private readonly root: Root, private readonly token: string, private readonly lock: Lock, private readonly plant: Plant | undefined, private readonly vfs: VfsSettings | undefined) {}

  async open(clock: CoreOptions['clock']): Promise<void> {
    const options: CoreOptions = { root: this.root.dir, clock, held: [this.token], ...(this.plant ? { plant: this.plant } : {}), ...(this.vfs ? { vfs: this.vfs } : {}),
      ...(process.env.DEEP_HUB_TEST_HOST ? { host: process.env.DEEP_HUB_TEST_HOST } : {}),
      ...(Number(process.env.DEEP_HUB_TEST_LEASE_MS) > 0 ? { leaseMs: Number(process.env.DEEP_HUB_TEST_LEASE_MS) } : {}),
      ...(process.env.DEEP_HUB_TEST_CRASH === 'start-recorded' || process.env.DEEP_HUB_TEST_CRASH === 'spawned' ? { crash: process.env.DEEP_HUB_TEST_CRASH } : {}),
      ...(process.env.DEEP_HUB_TEST_CONFIRM ? { confirm: process.env.DEEP_HUB_TEST_CONFIRM } : {}) };
    const frame = (sub: string, event: Obj) => { const s = this.subs.get(sub); s?.conn.write({ id: s.id, event }); };
    const fatal = (why: string) => {
      process.stderr.write(`deep hub: the core stopped: ${why}\n`);
      this.exit(1);
    };
    this.core = this.plant === 'commit-on-event-loop' ? await coreInline(options, frame, fatal) : coreWorker(options, frame, fatal);
    this.parsers = this.plant === 'parse-on-event-loop' ? await parserInline([this.token], this.plant) : parserPool([this.token], this.plant);
    this.server.on('connection', (sock) => this.accept(sock));
    // Out of descriptors, the accept loop keeps going: libuv sheds the connections it can't take, and the next one is served.
    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EMFILE' && error.code !== 'ENFILE') process.stderr.write(`deep hub: ${error.message}\n`);
    });
    // The lock is held, so whatever is at the socket's path is a dead hub's: removed, then made again only you can open.
    rmSync(this.root.socket, { force: true });
    const umask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.root.socket, () => { this.server.off('error', reject); resolve(); });
      });
    } finally {
      process.umask(umask);
    }
    chmodSync(this.root.socket, 0o600);
    this.ino = statSync(this.root.socket).ino;
    // Hooks are acknowledged from the moment the socket exists; the hub reports ready once its core has started.
    this.hooks = new Set((await this.core.started).hooks);
  }

  private accept(sock: net.Socket): void {
    if (this.plant === 'accept-stops-at-emfile') {
      // The plant stops accepting the first time it finds no descriptor left.
      try {
        closeSync(openSync('/dev/null', 'r'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EMFILE') this.server.close();
      }
    }
    const conn = new Conn(++this.ids, sock);
    this.conns.add(conn);
    sock.on('error', () => undefined);
    sock.on('close', () => {
      conn.done = true;
      this.conns.delete(conn);
      for (const sub of conn.subs) {
        this.subs.delete(sub);
        this.core.post({ op: 'unsubscribe', sub });
      }
    });
    sock.on('data', (chunk: Buffer) => this.read(conn, chunk));
    sock.write(this.helloLine);
  }

  /** Frames lines: each newline ends one, however the bytes arrived. */
  private read(conn: Conn, chunk: Buffer): void {
    let from = 0;
    for (let nl = chunk.indexOf(10); nl >= 0; nl = chunk.indexOf(10, from)) {
      const parts = [...conn.pending, chunk.subarray(from, nl)];
      conn.pending = [];
      conn.size = 0;
      conn.queue = conn.queue.then(() => this.line(conn, parts)).catch((error: unknown) => {
        process.stderr.write(`deep hub: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      });
      from = nl + 1;
    }
    if (from < chunk.length) {
      conn.pending.push(chunk.subarray(from));
      conn.size += chunk.length - from;
      if (conn.size > MAX_LINE) {
        conn.write({ id: null, error: refusal('too_large', '', `Send lines under ${MAX_LINE} bytes.`) });
        conn.end();
        conn.pending = [];
      }
    }
  }

  private async line(conn: Conn, parts: Buffer[]): Promise<void> {
    if (conn.done && !conn.first) return;
    const first = conn.first;
    conn.first = false;
    const size = parts.reduce((sum, p) => sum + p.length, 0);
    // A small line is copied out of the socket's buffer, so only its own bytes cross to the parser.
    const chunks = size > BIG ? parts : [parts.length === 1 ? Buffer.from(parts[0]!) : Buffer.concat(parts)];
    const parsed = await this.parsers.parse(chunks, first);
    if (parsed.kind === 'hook') return this.hook(conn, parsed);
    if (parsed.kind === 'refused') {
      conn.write({ id: parsed.id, error: parsed.error });
      if (first) conn.end();
      return;
    }
    if (conn.done) return;
    const value = parsed.value;
    if (first && 'hello' in value) return this.hello(conn, value);
    // A first line with no credential makes the connection a hook connection, which may call no method.
    if (first) {
      conn.role = 'hook';
      conn.name = 'hook';
    }
    return this.method(conn, value);
  }

  private hook(conn: Conn, parsed: Extract<Parsed, { kind: 'hook' }>): void {
    conn.role = 'hook';
    conn.name = 'hook';
    if (this.plant === 'git-in-hook-handler') {
      try { execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' }); } catch { /* the plant only needs the call */ }
    }
    // A deep-hook gone before its acknowledgement spooled the request marked late: that copy is the one recorded.
    if (conn.done || !conn.sock.writable) return;
    conn.done = true;
    // A tool.before some extension handles, and no guard entry blocks, is held for their joined reply (#350); every
    // other hook gets the acknowledgement and the reply in one write, which also ends the connection.
    const ruled = this.reply(parsed.meta);
    const before = ruled === EMPTY_REPLY && this.hooks.has('tool.before') ? parsed.drafts.find((d) => d.kind === 'tool.before') : undefined;
    const hold = before ? Date.now() + EXTENSION_HOLD_MS : null;
    if (hold === null) conn.sock.end(line({ ack: parsed.meta.id, hold_until_ms: null }) + ruled);
    else conn.sock.write(line({ ack: parsed.meta.id, hold_until_ms: hold }));
    // The writer is the connection's, whatever the payload says. Posted in the same step as the reply, before any
    // other line is read, so a deep_* call that follows this hook finds its stamp.
    const writer = this.plant === 'writer-from-payload' && parsed.meta.payloadWriter ? parsed.meta.payloadWriter : 'hook';
    this.core.post({ op: 'hook', drafts: parsed.drafts, meta: parsed.meta, writer });
    if (hold !== null) void this.extensionReply(conn, parsed.meta, before!.data, hold);
  }

  /**
   * The extensions' reply, written by the hold deep-hook was given: one that isn't in by then, a core that can't
   * answer, or watch-only gates give the reply a hub with no extension gives, the hook's fail-open policy.
   */
  private async extensionReply(conn: Conn, meta: HookMeta, data: unknown, hold: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, hold - Date.now() - HOLD_MARGIN)); });
    const asked = this.core.request({ op: 'extension-hook', data }).catch(() => null) as Promise<ExtensionReply | null>;
    const reply = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    if (conn.sock.writable) conn.sock.end(reply ? agentReply(meta.agent, reply) : EMPTY_REPLY);
  }

  /**
   * The reply to a hook: deep-hook matched the call against every entry in rules.json, and the hub decides what
   * each matched entry does. A matched entry in block mode denies a tool call before it runs, with its reason and
   * next step; watch and warn are #304's.
   */
  private reply(meta: HookMeta): string {
    if (meta.event !== 'PreToolUse' || !meta.matched.length) return EMPTY_REPLY;
    const entries = this.rules();
    const name = meta.matched.find((n) => entries[n]?.mode === 'block');
    if (name === undefined) return EMPTY_REPLY;
    const entry = entries[name]!;
    const note = meta.notes?.[name] ? ` ${meta.notes[name]}` : '';
    return line({ exit: 2, stdout: '', stderr: `DeepBuild blocked this: ${String(entry.reason)} ${String(entry.next_step)}${note} (guard ${name})\n` });
  }

  private rulesSeen = { key: '', entries: {} as Record<string, Guard | undefined> };
  /** The entries of rules.json, read again only when the file changes. */
  private rules(): Record<string, Guard | undefined> {
    const file = join(this.root.dir, 'rules.json');
    let key = 'none';
    try {
      const s = statSync(file);
      key = `${s.ino}:${s.size}:${s.mtimeMs}`;
    } catch { /* no rules.json: no entries */ }
    if (key !== this.rulesSeen.key) {
      let entries: Record<string, Guard | undefined> = {};
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown };
        if (typeof parsed.entries === 'object' && parsed.entries !== null) entries = parsed.entries as Record<string, Guard | undefined>;
      } catch { /* unreadable: deep-hook names it; the hub decides nothing from it */ }
      this.rulesSeen = { key, entries };
    }
    return this.rulesSeen.entries;
  }

  private tokenMatches(token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const given = Buffer.from(token);
    const held = Buffer.from(this.token);
    return given.length === held.length && timingSafeEqual(given, held);
  }

  private async hello(conn: Conn, value: Obj): Promise<void> {
    if (value.v !== 1) {
      conn.write({ id: null, error: versionRefusal(value) });
      return conn.end();
    }
    if (value.hello === 'app' || value.hello === 'cli') {
      if (!this.tokenMatches(value.token)) {
        conn.write({ id: null, error: refusal('credential', '/token', "Present the control token this hub wrote to control.token at its launch; an earlier launch's token no longer counts.") });
        return conn.end();
      }
      conn.role = value.hello;
      conn.name = value.hello;
      const peer = value.peer;
      if (isObj(peer) && Number.isSafeInteger(peer.pid) && typeof peer.start === 'string') conn.peer = { pid: peer.pid as number, start: peer.start };
      return conn.write({ role: conn.name });
    }
    if (value.hello === 'mcp') {
      const parent = value.parent;
      const proved = isObj(parent) && Number.isSafeInteger(parent.pid) && typeof parent.start === 'string' ? { pid: parent.pid as number, start: parent.start } : undefined;
      const session = proved ? ((await this.core.request({ op: 'mcp-hello', parent: proved }).catch(() => null)) as string | null) : null;
      conn.role = 'mcp';
      conn.session = session;
      conn.parent = proved;
      conn.name = session ? `mcp:${session}` : 'mcp';
      return conn.write({ role: conn.name });
    }
    conn.write({ id: null, error: refusal('enum', '/hello', 'Say hello as app, cli or mcp.', value.hello) });
    conn.end();
  }

  private method(conn: Conn, value: Obj): void {
    const id = value.id ?? null;
    if (value.v !== 1) return conn.write({ id, error: versionRefusal(value) });
    if (!('method' in value)) {
      return conn.write({ id, error: refusal('role', '', `A hook request is read only as a connection's first line; this ${conn.name} connection can't send one.`, conn.name) });
    }
    const method = value.method;
    if (typeof method !== 'string') return conn.write({ id, error: refusal('type', '/method', 'Name the method as a string.', method) });
    const allowed = ALLOWED.get(method);
    if (!allowed || (method === 'test.load' && !this.vfs)) return conn.write({ id, error: refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method) });
    if (!allowed.includes(conn.role!)) {
      return conn.write({ id, error: refusal('role', '/method', `A ${conn.name} connection can't call ${method}: its credential allows ${allowed.join(' or ')} connections only.`, method) });
    }
    const reply = (work: Promise<unknown>) => work.then(
      (result) => conn.write({ id, result: result ?? {} }),
      (error: unknown) => conn.write({ id, error: error instanceof Refused ? error.refusal : refusal('unavailable', '', error instanceof Error ? error.message : String(error), method, true) }),
    );
    const params = isObj(value.params) ? value.params : {};
    switch (method) {
      case 'hub.stop':
        conn.write({ id, result: { stopping: true } });
        return void this.stop('requested');
      case 'hub.health':
        return void reply(this.core.request({ op: 'health' }).then((health) => ({ pid: process.pid, start: this.start, ...(health as Obj) })));
      case 'stream.subscribe': {
        const sub = `${conn.id}:${JSON.stringify(id)}`;
        conn.subs.add(sub);
        this.subs.set(sub, { conn, id });
        const after = Number.isSafeInteger(params.after) && (params.after as number) >= 0 ? (params.after as number) : 0;
        return void reply(this.core.request({ op: 'subscribe', sub, after }).then(() => ({ subscribed: true, after })));
      }
      default:
        return void reply(this.core.request({ op: 'call', method, params, context: { role: conn.name, session: conn.session, ...(conn.parent ? { parent: conn.parent } : {}), ...(conn.peer ? { peer: conn.peer } : {}) } }));
    }
  }

  /** A stop with its reason recorded: no new connections, the core's clean stop, then only our own socket removed. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.server.close();
    for (const conn of this.conns) conn.sock.destroy();
    try {
      await Promise.race([this.core.request({ op: 'stop', reason }), new Promise((_, reject) => setTimeout(() => reject(Error('the core took over 20 s to stop')), 20_000))]);
    } catch (error) {
      process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    this.exit(0);
  }
  private exit(code: number): void {
    try {
      if (this.ino && statSync(this.root.socket).ino === this.ino) rmSync(this.root.socket, { force: true });
    } catch { /* already gone */ }
    try { this.lock.release(); } catch { /* the OS drops it at exit anyway */ }
    process.exit(code);
  }
}

/** Writes the control token: random, new each launch, readable only by you, never on a command line. */
function writeToken(root: Root): string {
  const token = randomBytes(32).toString('base64url');
  const tmp = `${root.token}.${process.pid}`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, root.token);
  return token;
}

/** `deep hub run [--root <folder>]`: the hub itself, in this process. Resolves only if it couldn't start. */
export async function runHub(options: { root?: string }): Promise<number> {
  const plant = plantOf(process.env.DEEP_HUB_PLANT);
  const vfs = process.env.DEEP_HUB_TEST_VFS ? (JSON.parse(process.env.DEEP_HUB_TEST_VFS) as VfsSettings) : undefined;
  // Both read at one moment, so with no test clock the hub's is the wall clock exactly.
  const real = Date.now();
  const clock = { start: process.env.DEEP_HUB_TEST_CLOCK ? Number(process.env.DEEP_HUB_TEST_CLOCK) : real, real };
  const root = rootOf(options.root ?? installedRoot());
  // Everything the hub writes, the record and the evidence included, is readable only by you.
  process.umask(0o077);
  mkdirSync(root.dir, { recursive: true, mode: 0o700 });
  if (plant === 'unlink-before-lock') rmSync(root.socket, { force: true });
  const lock = takeLock(root.lock);
  if (!lock) {
    process.stderr.write(`deep hub: a hub is already running on ${root.dir}: it holds the lock\n`);
    return 1;
  }
  // A hangup isn't a stop: closing the terminal or SSH session that started the hub leaves it running.
  process.on('SIGHUP', () => undefined);
  process.stdout.on('error', () => undefined);
  process.stderr.on('error', () => undefined);
  const hub = new Hub(root, writeToken(root), lock, plant, vfs);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void hub.stop(`signal:${signal}`));
  await hub.open(clock);
  process.stdout.write(`${JSON.stringify({ v: 1, ready: true, pid: process.pid, socket: root.socket, start: hub.start })}\n`);
  shedStartup();
  const headroom = process.env.DEEP_HUB_TEST_HEADROOM;
  if (headroom) {
    // Takes descriptors until the OS refuses one, then gives `headroom` back: the limit is the open count plus that.
    const held: number[] = [];
    try { for (;;) held.push(openSync('/dev/null', 'r')); } catch { /* the limit */ }
    for (let i = 0; i < Number(headroom); i++) closeSync(held.pop()!);
  }
  return new Promise<number>(() => undefined);
}
