// The hub's core: the one writer to the record and the evidence store. It checks each hook against the
// session it claims, binds deep mcp calls to sessions, supervises check runs, replays deep-hook's spool, runs
// retention, and answers the socket's methods. It runs in a worker thread of its own, so a disk sync, a run's
// output or a backfill never holds up the event loop that acknowledges hooks.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openAsks } from '@deepbuild/asks';
import { canonicalize, fixtures, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { openRecord, RecordError, toJson, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import { answers, downStack, newRun, portKind, upStack, type Stack, type Up } from '@deepbuild/env-local';
import { openSupervisor, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import { parseLine } from './hookmap.js';
import { rootOf, type Root } from './paths.js';
import { disk, testVfs, type Durable } from './vfs.js';
import { Refused, refusal, ulid, type CoreOptions, type Draft, type HookMeta } from './wire.js';

const DAY = 86_400_000;
const YOU = { actor: 'you', scope: 'you' };
const SECRETS_TTL = 10_000;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const running = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};
/** The PIDs that listen on the TCP port, as lsof shows them; a failed lsof rejects, since it proves nothing. */
const listening = (port: number): Promise<number[]> => new Promise((done, fail) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing listens.
    if (error && !((error as { code?: unknown }).code === 1 && stdout.trim() === '' && stderr.trim() === '')) return fail(Error(`lsof can't list port ${port}'s listeners: ${stderr.trim() || error.message}`));
    done([...new Set(String(stdout ?? '').split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))))]);
  });
});
const isUnder = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** What a connection brings to a call: its role, the session it is bound to, and for deep mcp the process it serves. */
export interface CallContext { role: string; session?: string | null; parent?: { pid: number; start: string } }

/** A session as its own hooks established it: the agent process, its working folder and its transcript. */
interface Session { id: string; agent: string; pid: number; start: string; cwd: string; transcript: string; ended: boolean }
/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
interface Stamp { session: string; tool: string; digest: string; spent: boolean }
/** A run the supervisor started, as the journal keeps it until its finish is durable; `environment`: it needs its folder's stack running. */
interface Run { run: string; check: string; claim: string; commit: string; argv: string[]; env: Record<string, string>; cwd: string; grant: Grant; environment?: boolean }
/** What a run gets when run.start names no grant: your files and programs, as you, in the sandbox all the same (Access: run-as-you). */
const RUN_AS_YOU: Grant = { run_as_you: true };
const GRANT_LISTS = ['read', 'write', 'hosts', 'sockets'] as const;

/** A ULID at `ms` whose random part is a hash of `key`, so the same source line always gets the same ID. */
function derivedId(ms: number, key: string): string {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  let time = BigInt(Math.max(0, Math.floor(ms)));
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let bits = BigInt(`0x${sha256Hex(new TextEncoder().encode(key)).slice(0, 20)}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(bits & 31n)] + tail; bits >>= 5n; }
  return out + tail;
}

export class Core {
  private readonly root: Root;
  private readonly now: () => number;
  private readonly durable: Durable;
  private record!: RecordStore;
  private store!: EvidenceStore;
  private supervisor!: Supervisor;
  /** host@1: where every check run starts, is signalled and waited for; the supervisor, unless a test put another in its place. */
  private host!: Host;
  private readonly ready: Promise<void>;
  private readonly sessions = new Map<string, Session>();
  private readonly counters = new Map<string, { msgs: number; turns: number; worked: boolean }>();
  private readonly stamps: Stamp[] = [];
  /** Each process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID. */
  private readonly starts = new Map<number, Promise<string | undefined>>();
  /** Hooks and calls run in arrival order: a deep_* call finds the stamp its PreToolUse left. */
  private chain: Promise<unknown> = Promise.resolve();
  private blocked: string | undefined;
  private readonly runs = new Map<string, { run: Run; done: Promise<void>; stop(): void }>();
  /** The stack `deep env up` started in each worktree, by the worktree's real path, and each one on its way up. */
  private readonly stacks = new Map<string, Stack>();
  /** Each worktree's env up and down, one after another. */
  private readonly turns = new Map<string, Promise<unknown>>();
  /** Every stack run started and not yet cleaned up, a run's or a worktree's, so the hub's stop takes each down. */
  private readonly stackRuns = new Set<string>();
  /** Each worktree's stack run while it waits for its health route, so a down can end it rather than wait. */
  private readonly rising = new Map<string, string>();
  private readonly subscribers = new Map<string, number>();
  /** Appends handed to the record and not yet settled: a read waits for them, so it sees every hook acknowledged before it. */
  private readonly inflight = new Set<Promise<unknown>>();
  private streaming = false;
  private secrets: { at: number; value: Promise<string> } | undefined;
  private readonly timers: NodeJS.Timeout[] = [];
  private stopping = false;

  constructor(private readonly options: CoreOptions, private readonly emit: (sub: string, event: Obj) => void) {
    this.root = rootOf(options.root);
    this.now = () => options.clock.start + (Date.now() - options.clock.real);
    this.durable = options.vfs ? testVfs(options.vfs) : disk;
    this.ready = this.init();
    // A start that fails stops nothing else; each call then reports why.
    this.ready.catch(() => undefined);
  }

  /** Resolves once the record is open, the spool replayed and runs recovered; rejects with why it couldn't start. */
  started(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    this.store = await openEvidenceStore({ root: this.root.evidence, now: this.now });
    const storage = this.durable.backend();
    // Each event its own commit: the durable write points a run makes depend only on the events it appends,
    // never on how many arrived together, so a cut at any one can be replayed.
    this.record = await openRecord({ path: this.root.ledger, now: this.now, evidence: this.store, commitEach: true, ...(storage ? { storage } : {}) });
    // A start that finds the last run still marked running records that run's stop as a crash.
    const crashed = existsSync(this.root.state) && readFileSync(this.root.state, 'utf8').trim() === 'running';
    this.writeState('running');
    if (crashed) await this.appendCore('hub.stopped', { reason: 'crashed' });
    // Opening the supervisor reaps what the record says a run left before this start.
    const asks = await openAsks({ record: this.record, now: this.now, deliver: () => undefined });
    this.supervisor = await openSupervisor({
      record: this.record, asks, now: this.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
      // env-local's port kind (#331): ports from 3000 up, each checked free before it is leased.
      resources: [portKind({ free: this.options.plant !== 'env-leases-port-again' })],
      ...(this.options.plant === 'env-holds-lease-for-helper' ? { plant: 'holds-lease-while-taken' as const } : {}),
      ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}),
      ...(this.options.crash ? { crash: this.options.crash } : {}),
      // No run, run-as-you included, writes the record, the agents' config folders or the Node the hub runs on;
      // the sandbox profile itself keeps every project's agent hook and MCP files.
      guarded: [
        this.root.dir, join(homedir(), '.claude'), join(homedir(), '.codex'), realpathSync(resolve(fileURLToPath(import.meta.url), '../../..')),
        join(homedir(), 'Library', 'LaunchAgents'),
        process.execPath, resolve(process.execPath, '../../lib/node_modules'),
        ...[process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((p): p is string => !!p && isAbsolute(p)),
      ],
    });
    this.host = this.options.host
      ? ((await import(pathToFileURL(this.options.host).href)) as { default: (local: Host) => Host }).default(this.supervisor)
      : this.supervisor;
    this.timers.push(setInterval(() => void this.supervisor.tick().catch(() => undefined), 1000));
    await this.replaySpool();
    await this.recoverRuns();
    await this.retain();
    this.timers.push(setInterval(() => void this.retain().catch(() => undefined), DAY));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && this.durable.probe(this.root.dir)) this.blocked = undefined; }, 250));
    for (const timer of this.timers) timer.unref();
  }

  private writeState(state: 'running' | 'stopped'): void {
    writeFileSync(`${this.root.state}.tmp`, `${state}\n`, { mode: 0o600 });
    renameSync(`${this.root.state}.tmp`, this.root.state);
  }

  private get held(): string[] {
    return this.options.held;
  }

  // ---- Appends.

  private connection(writer: string, extra: Partial<Connection> = {}): Connection {
    return { writer, ...YOU, ...extra };
  }
  /** Appends one event; a storage failure turns every gate watch-only, BLOCKED, until a write succeeds again. */
  private async append(connection: Connection, input: EventInput, backfill = false): Promise<void> {
    const appended = this.record.append(connection, input);
    // No read waits for a backfill: nobody was acknowledged for its events.
    if (!backfill) this.inflight.add(appended);
    try {
      await appended;
    } catch (error) {
      if (error instanceof RecordError && error.code === 'storage') this.blocked = `BLOCKED: appends fail: ${error.message}`;
      throw error;
    } finally {
      this.inflight.delete(appended);
    }
    this.stream();
  }
  private appendCore(kind: string, data: Obj, extra: { subject?: string; evidence?: string[] } = {}): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core'), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...extra });
  }

  // ---- Hooks.

  /**
   * One hook's events, checked and handed to the record in the order hooks arrived; the next hook waits only
   * for that, not for the commit. Resolves once each append settled.
   */
  hook(drafts: Draft[], meta: HookMeta, writer: string): Promise<void> {
    return this.queue(() => this.handleHook(drafts, meta, writer)).then(({ settled }) => settled);
  }
  /** Runs `work` after everything queued before it, and after the start, which the spool replay is part of. */
  private queue<T>(work: () => Promise<T>, starting = false): Promise<T> {
    const done = this.chain.then(() => (starting ? undefined : this.ready)).then(work);
    this.chain = done.catch(() => undefined);
    return done;
  }
  private async handleHook(drafts: Draft[], meta: HookMeta, writer: string): Promise<{ settled: Promise<void> }> {
    const verified = await this.verify(meta);
    const session = this.sessions.get(meta.session);
    if (session && (verified || this.options.plant === 'ends-binding')) {
      // Only an event checked against its session acts on it: an unverified SessionEnd ends nothing.
      if (meta.event === 'SessionEnd') {
        session.ended = true;
        for (const stamp of this.stamps) if (stamp.session === session.id) stamp.spent = true;
      }
      if (verified && meta.stamp) this.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest, spent: false });
    }
    const count = this.counters.get(meta.session) ?? { msgs: 0, turns: 0, worked: false };
    this.counters.set(meta.session, count);
    const appends = drafts.map((draft) => {
      const data = { ...draft.data };
      if (draft.fill === 'msg') data.msg = count.msgs++;
      if (draft.fill === 'turn') {
        data.turn = ++count.turns;
        data.did_work = count.worked;
        count.worked = false;
      }
      if (draft.kind === 'tool.after') count.worked = true;
      const connection = this.connection(writer, { ...(meta.session ? { session: meta.session } : {}), agent: meta.agent, verified });
      return this.append(connection, {
        v: draft.v, id: draft.id, kind: draft.kind, ts: draft.ts, ...(draft.seq !== undefined ? { seq: draft.seq } : {}), ...(draft.subject ? { subject: draft.subject } : {}), data: data as JsonValue,
      });
    });
    const settled = Promise.allSettled(appends).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected' && !(result.reason instanceof RecordError && result.reason.code === 'storage')) {
          process.stderr.write(`deep hub: hook ${meta.id} (${meta.event}) not recorded: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
        }
      }
      if (results.some((r) => r.status === 'rejected')) throw Error(`hook ${meta.id} was not recorded`);
    });
    settled.catch(() => undefined);
    return { settled };
  }

  /** A process's start time, or undefined when it can't be read. Read in this worker, never on the event loop. */
  private startOf(pid: number, fresh = false): Promise<string | undefined> {
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = new Promise<string | undefined>((done) => {
      try {
        execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => done(error ? undefined : stdout.trim() || undefined));
      } catch {
        done(undefined);
      }
    });
    this.starts.set(pid, read);
    return read;
  }

  /**
   * Whether an event can be checked against the session it claims: its transcript under its agent's home, its
   * working folder and its process tree (its hook's parent, by PID and start time) all as the session's own
   * hooks established them. The first checked event of a session establishes it.
   */
  private async verify(meta: HookMeta): Promise<boolean> {
    if (!meta.session || !meta.cwd || !isAbsolute(meta.transcript)) return false;
    const home = meta.agent === 'codex' ? join(homedir(), '.codex', 'sessions') : join(homedir(), '.claude', 'projects');
    const transcript = resolve(meta.transcript);
    if (!isUnder(transcript, home)) return false;
    const start = await this.startOf(meta.ppid);
    if (!start) return false;
    const session = this.sessions.get(meta.session);
    if (!session) {
      this.sessions.set(meta.session, { id: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false });
      return true;
    }
    return transcript === session.transcript && meta.cwd === session.cwd && meta.ppid === session.pid && start === session.start;
  }

  /** Binds a deep mcp to the one live session whose checked hooks came from its parent process, or to none. */
  mcpHello(parent: { pid: number; start: string }): Promise<string | null> {
    return this.queue(async () => {
      const actual = await this.startOf(parent.pid, true);
      if (!actual || actual !== parent.start) return null;
      const served = [...this.sessions.values()].filter((s) => s.pid === parent.pid && s.start === actual && !s.ended);
      return served.length === 1 ? served[0]!.id : null;
    });
  }

  // ---- Methods.

  /**
   * One socket method. It sees every hook that arrived before it, but holds the queue only to bind a deep_*
   * call to its session, so a long call (a run's start, a file read, a test load) holds up no session's hooks.
   */
  call(method: string, params: unknown, context: CallContext): Promise<unknown> {
    const p = isObj(params) ? params : {};
    // deep_status reads only what belongs to no session, so it needs no binding.
    if (method === 'mcp.call' && p.tool === 'deep_status') {
      return this.queue(async () => undefined).then(() => ({ session: context.session ?? null, gates: { watch_only: this.blocked !== undefined, reason: this.blocked ?? null } }));
    }
    if (method === 'mcp.call') {
      return this.queue(async () => this.bindCall(p, context)).then(({ tool, args, session }) => (tool === 'deep_claim' ? this.claim(session, args) : this.attach(session, args)));
    }
    return this.queue(async () => undefined).then(() => this.dispatch(method, p));
  }
  private async dispatch(method: string, params: Obj): Promise<unknown> {
    switch (method) {
      case 'hub.health': return this.health();
      case 'events.read': return this.read(params);
      case 'ask.answer': throw new Refused(refusal('not_found', '/params/ask', `No open ask ${String(params.ask)}; answer an ask the hub lists.`, params.ask));
      case 'gates.off': throw new Refused(refusal('unconfirmed', '/method', 'deep off takes effect only once the OS confirms you (#19); nothing changed.', 'gates.off'));
      case 'evidence.paste': return this.paste(params);
      case 'run.start': return this.runStart(params);
      case 'test.load': return this.testLoad(params);
      case 'env.up': return this.envUp(params);
      case 'env.down': return this.envDown(params);
      default: throw new Refused(refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method));
    }
  }

  async health(): Promise<Obj> {
    const network = Object.values(networkInterfaces()).flat().some((i) => i && !i.internal) ? 'reachable' : 'unreachable';
    return { gates: { watch_only: this.blocked !== undefined, reason: this.blocked ?? null }, secrets: await this.secretStore(), network };
  }
  /** Whether this process can reach the OS secret store, read at most every ten seconds. */
  private secretStore(): Promise<string> {
    const at = Date.now();
    if (this.secrets && at - this.secrets.at < SECRETS_TTL) return this.secrets.value;
    const value = new Promise<string>((done) => {
      // securityd answers the keychain list for this process's security session, whatever HOME is.
      if (process.platform === 'darwin') execFile('/usr/bin/security', ['list-keychains'], (error) => done(error ? 'unreachable' : 'reachable'));
      else done(process.env.DBUS_SESSION_BUS_ADDRESS ? 'reachable' : 'unreachable');
    });
    this.secrets = { at, value };
    return value;
  }

  private eventJson(event: Event): Obj {
    const out = JSON.parse(toJson(event)) as Obj;
    delete out.unverified;
    out.verified = !event.unverified;
    return out;
  }
  private async read(params: Obj): Promise<Obj> {
    await Promise.allSettled([...this.inflight]);
    const after = Number.isSafeInteger(params.after) && (params.after as number) >= 0 ? (params.after as number) : 0;
    const limit = Number.isSafeInteger(params.limit) && (params.limit as number) > 0 ? Math.min(params.limit as number, 1000) : 1000;
    const events = (await this.record.read({ after, limit })).map((e) => this.eventJson(e));
    return { log_pos: events.length ? events[events.length - 1]!.log_pos : after, events };
  }

  /** Streams every event after `after` to the subscriber, then each one appended from then on. */
  async subscribe(sub: string, after: number): Promise<void> {
    await this.ready;
    this.subscribers.set(sub, after);
    this.stream();
  }
  unsubscribe(sub: string): void {
    this.subscribers.delete(sub);
  }
  private stream(): void {
    if (!this.subscribers.size || this.streaming) return;
    this.streaming = true;
    setImmediate(() => void this.flushStream().finally(() => { this.streaming = false; }));
  }
  private async flushStream(): Promise<void> {
    for (const [sub, after] of this.subscribers) {
      let last = after;
      for (;;) {
        const events = await this.record.read({ after: last, limit: 1000 });
        if (!this.subscribers.has(sub)) break;
        for (const event of events) this.emit(sub, this.eventJson(event));
        if (events.length) last = events[events.length - 1]!.log_pos;
        if (events.length < 1000) break;
      }
      if (this.subscribers.has(sub)) this.subscribers.set(sub, last);
    }
  }

  // ---- deep mcp.

  private bindCall(params: Obj, context: CallContext): { tool: string; args: Obj; session: string } {
    const tool = params.tool;
    const args = isObj(params.arguments) ? params.arguments : {};
    if (tool !== 'deep_claim' && tool !== 'deep_evidence') throw new Refused(refusal('not_found', '/params/tool', 'Call one of the deep_* tools the hub serves: deep_status, deep_claim, deep_evidence.', tool));
    return { tool, args, session: this.bind(tool, args, context) };
  }
  /** The session a deep_* call acts for: its deep mcp's own, or the one unspent PreToolUse stamped for this very call. */
  private bind(tool: string, args: Obj, context: CallContext): string {
    const live = (id: string) => { const s = this.sessions.get(id); return s && !s.ended ? s : undefined; };
    if (context.session) {
      if (!live(context.session)) throw new Refused(refusal('unbound', '/params/tool', `Session ${context.session} has ended; this deep mcp acts for no session now.`, tool));
      return context.session;
    }
    const parent = context.parent;
    const digest = sha256Hex(canonicalize(args as JsonValue));
    const matches = parent ? this.stamps.filter((s) => {
      const session = live(s.session);
      return !s.spent && s.tool === tool && s.digest === digest && session !== undefined && session.pid === parent.pid && session.start === parent.start;
    }) : [];
    // A call more than one unspent stamp matches binds to none.
    if (matches.length !== 1) throw new Refused(refusal('unbound', '/params/arguments', `This ${tool} call binds to no session: ${matches.length ? 'more than one' : 'no'} PreToolUse stamped for it is unspent.`, tool));
    matches[0]!.spent = true;
    return matches[0]!.session;
  }
  private async claim(session: string, args: Obj): Promise<Obj> {
    // While appends fail, no claim is acknowledged.
    if (this.blocked) throw new Refused(refusal('unavailable', '/params/tool', `${this.blocked}; the claim was not recorded. Claim again once appends work.`, 'deep_claim', true));
    const data = Object.fromEntries(['task_ref', 'attempt', 'commit', 'scope'].filter((k) => k in args).map((k) => [k, args[k]]));
    const ts = this.now();
    const id = ulid(ts);
    const agent = this.sessions.get(session)?.agent;
    try {
      await this.append(this.connection(`mcp:${session}`, { session, ...(agent ? { agent } : {}) }), { v: 1, id, kind: 'claim.made', ts, data: data as JsonValue });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_claim');
    }
    return { session, event: id };
  }
  private refusedAppend(error: unknown, what: string): Refused {
    if (error instanceof RecordError && error.code === 'storage') return new Refused(refusal('unavailable', '', `BLOCKED: appends fail: ${error.message}; ${what} was not recorded.`, what, true));
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(\w+) at /.exec(message)?.[1] ?? 'type';
    return new Refused(refusal(code, error instanceof RecordError && error.path ? `/params/arguments${error.path.replace(/^\/data/, '')}` : '/params/arguments', message, what));
  }

  /** The peer a store writer is bound to: from the connection's credential, never from what the payload says. */
  private peer(fromCredential: Peer, claimed: unknown, session?: string): Peer {
    if (this.options.plant !== 'origin-from-payload') return fromCredential;
    if (claimed === 'deepbuild') return { role: 'deepbuild', via: 'job' };
    if (claimed === 'you') return { role: 'you', via: 'paste' };
    if (claimed === 'agent' && session) return { role: 'agent', session };
    return fromCredential;
  }
  private async stored(put: PutResult, what: string): Promise<Evidence> {
    if (put.status !== 'stored') throw new Refused(refusal('unavailable', '', `The evidence store refused ${what}: ${put.reason}`, what, true));
    this.durable.point('evidence_rename');
    const ev = put.evidence;
    await this.appendCore('evidence.stored', {
      sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [],
    }).catch(() => undefined);
    return ev;
  }
  private async attach(session: string, args: Obj): Promise<Obj> {
    const folder = this.sessions.get(session)!.cwd;
    const path = typeof args.path === 'string' ? resolve(folder, args.path) : '';
    if (!path || !isUnder(path, folder)) throw new Refused(refusal('pattern', '/params/arguments/path', `Name a file inside the session's working folder ${folder}.`, args.path));
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw new Refused(refusal('not_found', '/params/arguments/path', `Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`, args.path));
    }
    const claimed = typeof args.origin === 'string' ? args.origin : undefined;
    const writer = this.store.connect(this.peer({ role: 'agent', session }, claimed, session));
    const put = await writer.put({
      bytes: new Uint8Array(bytes), kind: typeof args.kind === 'string' && args.kind ? args.kind : 'file', source: relative(folder, path),
      redaction: 'unknown', license: { name: 'session', allows: [] }, ...(claimed && ['deepbuild', 'you', 'agent'].includes(claimed) ? { origin: claimed as Origin } : {}),
    });
    return { sha256: (await this.stored(put, relative(folder, path))).sha256 };
  }
  private async paste(params: Obj): Promise<Obj> {
    if (typeof params.bytes !== 'string' || !params.bytes) throw new Refused(refusal('required', '/params/bytes', 'Send the pasted image as base64 in bytes.', params.bytes));
    const bytes = new Uint8Array(Buffer.from(params.bytes, 'base64'));
    const declares = params.type === 'png' || params.type === 'jpeg' ? params.type : undefined;
    const writer = this.store.connect(this.peer({ role: 'you', via: 'paste' }, params.origin));
    const put = await writer.put({ bytes, kind: 'image', source: 'app:paste', redaction: 'unknown', license: { name: 'yours', allows: [] }, ...(declares ? { declares } : {}) });
    return { sha256: (await this.stored(put, 'the pasted image')).sha256 };
  }

  // ---- The supervisor's runs.

  private journal(): Record<string, Run> {
    try {
      return JSON.parse(readFileSync(this.root.runs, 'utf8')) as Record<string, Run>;
    } catch {
      return {};
    }
  }
  private writeJournal(update: (runs: Record<string, Run>) => void): void {
    const runs = this.journal();
    update(runs);
    writeFileSync(`${this.root.runs}.tmp`, JSON.stringify(runs), { mode: 0o600 });
    renameSync(`${this.root.runs}.tmp`, this.root.runs);
  }

  private async runStart(params: Obj): Promise<Obj> {
    const { check, claim, commit, argv, env = {}, cwd = process.cwd(), grant = RUN_AS_YOU, environment = false } = params;
    if (typeof check !== 'string' || !check) throw new Refused(refusal('required', '/params/check', 'Name the check the run is for.', check));
    if (typeof claim !== 'string' || !/^claim:[0-9A-Za-z]+$/.test(claim)) throw new Refused(refusal('pattern', '/params/claim', 'Name the claim as claim:<id>.', claim));
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Refused(refusal('pattern', '/params/commit', 'Name the commit by its 40-character SHA.', commit));
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) throw new Refused(refusal('type', '/params/argv', 'Give the run its program and arguments as strings.', argv));
    if (!isObj(env) || Object.values(env).some((v) => typeof v !== 'string')) throw new Refused(refusal('type', '/params/env', 'Give env as names to string values.', env));
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Refused(refusal('type', '/params/cwd', 'Give the run its folder as an absolute path.', cwd));
    if (!isObj(grant) || Object.keys(grant).some((k) => k !== 'run_as_you' && !(GRANT_LISTS as readonly string[]).includes(k))) {
      throw new Refused(refusal('type', '/params/grant', 'Give the grant as read, write, hosts and sockets lists, or run_as_you.', grant));
    }
    for (const k of GRANT_LISTS) {
      const list = grant[k];
      if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || (k !== 'hosts' && !isAbsolute(v))))) {
        throw new Refused(refusal('type', `/params/grant/${k}`, k === 'hosts' ? 'List hosts as host:port strings.' : 'List absolute paths.', list));
      }
    }
    if (grant.run_as_you !== undefined && typeof grant.run_as_you !== 'boolean') throw new Refused(refusal('type', '/params/grant/run_as_you', 'Give run_as_you as true or false.', grant.run_as_you));
    if (typeof environment !== 'boolean') throw new Refused(refusal('type', '/params/environment', 'Give environment as true when the run needs its folder\'s stack running.', environment));
    const run = await this.launch({
      run: `run:${ulid(this.now())}`, check, claim, commit, argv: argv as string[], env: env as Record<string, string>, cwd, grant: grant as Grant, ...(environment ? { environment } : {}),
    });
    return { run };
  }

  /** Starts a run through the host, sandboxed, with the hub's run token injected; its output becomes scrubbed evidence. */
  private async launch(run: Run): Promise<string> {
    this.writeJournal((runs) => { runs[run.run] = run; });
    await this.appendCore('run.started', { run: run.run, check: run.check, claim: run.claim, commit: run.commit }, { subject: run.run });
    const token = randomBytes(24).toString('base64url');
    const env = { ...run.env, DEEP_RUN_TOKEN: token };
    const values = this.options.plant === 'no-run-values' ? undefined : { env, held: [token, ...this.held] };
    const writer = this.store.connect({ role: 'deepbuild', via: 'job' });
    const label = { source: run.run, redaction: 'complete' as const, license: { name: 'local', allows: [] }, ...(values ? { run: values } : {}) };
    const sinks = [writer.text({ kind: 'run.stdout', ...label }), writer.text({ kind: 'run.stderr', ...label })];
    let writes = Promise.resolve();
    const output = {
      stdout: (chunk: Buffer) => { writes = writes.then(() => sinks[0]!.write(chunk)); },
      stderr: (chunk: Buffer) => { writes = writes.then(() => sinks[1]!.write(chunk)); },
    };
    let stop: () => void;
    let ended: Promise<{ code: number | null; failed?: string; missing?: string }>;
    if (this.options.plant === 'run-spawns-itself') {
      // The planted wrong program: the hub spawns the run itself, past the host and its sandbox.
      const child = spawn(run.argv[0]!, run.argv.slice(1), { cwd: run.cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', output.stdout);
      child.stderr!.on('data', output.stderr);
      ended = new Promise((done) => {
        child.on('error', (error) => done({ code: null, failed: error.message }));
        child.on('close', (code) => done({ code }));
      });
      stop = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } };
    } else {
      // A run that needs the app has its stack brought up from its own folder first, its check's checkout; a stack
      // that isn't ready makes the run missing, and its own process never starts.
      const stackRun = run.environment ? newRun(this.now()) : undefined;
      if (stackRun) this.stackRuns.add(stackRun);
      const stack: Promise<Up | undefined> = stackRun
        ? upStack(this.host, { run: stackRun, folder: run.cwd }).catch((error: Error) => ({ status: 'BLOCKED' as const, run: stackRun, cause: error.message }))
        : Promise.resolve(undefined);
      const started = stack.then<Started | { run: string; status: 'missing'; cause: string }>((up) => {
        if (up?.status === 'BLOCKED') return { run: run.run, status: 'missing', cause: up.cause };
        const ports = Object.entries(up?.stack.ports ?? {});
        const hosts = ports.map(([, port]) => `127.0.0.1:${port}`);
        return this.host.start({
          run: run.run, argv: run.argv, cwd: run.cwd, env: { ...env, ...Object.fromEntries(ports.map(([name, port]) => [name, String(port)])) },
          grant: hosts.length ? { ...run.grant, hosts: [...(run.grant.hosts ?? []), ...hosts] } : run.grant, output,
        });
      });
      ended = started.then(async (s) => {
        if (s.status === 'missing') return { code: null, missing: s.cause };
        if (s.status === 'BLOCKED') return { code: null, failed: `BLOCKED: no ${s.kind} free` };
        const exit = await this.host.wait(run.run);
        return { code: exit.code };
      }, (error: Error) => ({ code: null, failed: error.message }));
      // The stack goes down once the run has ended, its leases released by its cleanup.
      if (stackRun) ended = ended.then(async (end) => { await this.takeDown(stackRun).catch(() => undefined); return end; });
      stop = () => {
        void started.then(() => this.host.signal(run.run, 'SIGTERM')).catch(() => undefined);
        // A run still held on a resource never starts: given up on, its start resolves BLOCKED.
        void this.supervisor.status(run.run).then((s) => (s.state === 'held' ? this.supervisor.cleanup(run.run) : undefined)).catch(() => undefined);
      };
    }
    const done = ended.then(async ({ code, failed, missing }) => {
      // What the run left behind is stopped and its leases released before its finish is recorded.
      if (this.options.plant !== 'run-spawns-itself') await this.supervisor.cleanup(run.run).catch(() => undefined);
      await writes;
      const evidence: string[] = [];
      for (const sink of sinks) {
        const put = await sink.close();
        if (put.status === 'stored') evidence.push((await this.stored(put, `${run.run}'s output`)).sha256);
      }
      const outcome = this.stopping ? 'stopped' : missing ? 'missing' : code === 0 ? 'passed' : 'failed';
      const findings = this.stopping ? ['hub stopped'] : missing ? [`its stack never came up: ${missing}`] : failed ? [failed] : [];
      await this.finish(run, outcome, findings, evidence);
    });
    this.runs.set(run.run, { run, done, stop });
    void done.finally(() => this.runs.delete(run.run));
    return run.run;
  }
  private async finish(run: Run, outcome: string, findings: string[], evidence: string[]): Promise<void> {
    await this.appendCore('run.finished', {
      run: run.run, outcome, tests_run: 0, passed: 0, runs: 1, evidence, check: run.check, assertion: null, expected: null, actual: null, step: null,
      points_to: null, findings, environment: `${process.platform}-${process.arch}`,
    }, { subject: run.run });
    // The journal keeps the run until its finish is durable, so a cut before then reruns it.
    await this.record.sync();
    this.writeJournal((runs) => { delete runs[run.run]; });
  }
  /** After a start with runs still in the journal: each was in flight when the hub stopped without a clean stop. */
  private async recoverRuns(): Promise<void> {
    const recorded = async (kind: string, run: string) => (await this.record.raw(`SELECT 1 FROM events WHERE kind = '${kind}' AND json_extract(data, '$.run') = '${run.replace(/'/g, "''")}' LIMIT 1`)).length > 0;
    for (const run of Object.values(this.journal())) {
      if (await recorded('run.finished', run.run)) {
        this.writeJournal((runs) => { delete runs[run.run]; });
        continue;
      }
      // Its processes were reaped when the supervisor opened.
      if (await recorded('run.started', run.run)) await this.finish(run, 'stopped', ['hub restarted'], []);
      else this.writeJournal((runs) => { delete runs[run.run]; });
      // Its claim's check runs again.
      await this.launch({ ...run, run: `run:${ulid(this.now())}`, cwd: run.cwd ?? process.cwd(), grant: run.grant ?? RUN_AS_YOU });
    }
  }

  // ---- deep env up and down (#331): a worktree's stack through env-local, every process through the host.

  private worktreeOf(params: Obj): string {
    const { worktree } = params;
    if (typeof worktree !== 'string' || !isAbsolute(worktree) || !existsSync(worktree)) throw new Refused(refusal('type', '/params/worktree', 'Name the worktree by its absolute path.', worktree));
    return realpathSync(worktree);
  }
  /** Runs the worktree's env call once every earlier one for it has finished: a second up waits and finds the first's stack, an up during a down starts after it. */
  private inTurn(worktree: string, call: () => Promise<Obj>): Promise<Obj> {
    const turn = (this.turns.get(worktree) ?? Promise.resolve()).catch(() => undefined).then(call);
    this.turns.set(worktree, turn);
    void turn.catch(() => undefined).then(() => { if (this.turns.get(worktree) === turn) this.turns.delete(worktree); });
    return turn;
  }
  /** Signals a stack run down through the host, then the supervisor stops what's left of it and releases its leases. */
  private async takeDown(run: string): Promise<{ stopped: number[]; left: string[] }> {
    try {
      await downStack(this.host, run);
      return await this.supervisor.cleanup(run);
    } finally {
      this.stackRuns.delete(run);
    }
  }
  private envUp(params: Obj): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    return this.inTurn(worktree, () => this.riseIn(worktree));
  }
  private async riseIn(worktree: string): Promise<Obj> {
    const running = this.stacks.get(worktree);
    // A stack is reused only while its process runs and its health route still answers 200.
    if (running && (await this.supervisor.status(running.run)).state === 'running' && (await answers(running))) return { status: 'ready', run: running.run, worktree, ports: running.ports };
    // Any other is taken down, and a new one started.
    if (running) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
    }
    if (this.stopping) return { status: 'BLOCKED', worktree, cause: 'the hub is stopping' };
    const run = newRun(this.now());
    this.stackRuns.add(run);
    this.rising.set(worktree, run);
    const up = await upStack(this.host, { run, folder: worktree })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }))
      .finally(() => this.rising.delete(worktree));
    if (up.status === 'BLOCKED') {
      // What it started is stopped and its leases released; a stack that never started has nothing to clean.
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: up.cause };
    }
    this.stacks.set(worktree, up.stack);
    return { status: 'ready', run, worktree, ports: up.stack.ports };
  }
  /**
   * Takes the worktree's stack down: signalled through the host, then the supervisor's cleanup stops what it can
   * prove is the run's and ends its leases once every recorded process is gone. A process it can't prove, or one
   * that was never recorded and still listens on a leased port, is reported with its PID and the port, never stopped.
   */
  private envDown(params: Obj): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    // A stack still coming up is signalled down now: its up ends BLOCKED, and this down's turn follows it.
    const rising = this.rising.get(worktree);
    if (rising) void downStack(this.host, rising);
    return this.inTurn(worktree, () => this.downIn(worktree, rising));
  }
  private async downIn(worktree: string, interrupted?: string): Promise<Obj> {
    const stack = this.stacks.get(worktree);
    // The up it interrupted took its own stack down and cleaned it up.
    if (!stack && interrupted) return { run: interrupted, stopped: [], left: [] };
    if (!stack) throw new Refused(refusal('not_found', '/params/worktree', `No stack runs for ${worktree}; start one with deep env up.`, worktree));
    const ports = Object.values(stack.ports);
    const recorded = (await this.record.raw(`SELECT DISTINCT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = '${stack.run}'`) as { pid: number }[]).map((r) => r.pid);
    const before = recorded.filter(running);
    // The planted wrong program stops whatever listens on the leased ports, the run's or not.
    if (this.options.plant === 'env-kills-by-port') for (const port of ports) for (const pid of await listening(port)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    this.stacks.delete(worktree);
    const cleaned = await this.takeDown(stack.run);
    const stopped = [...new Set([...before.filter((pid) => !running(pid)), ...cleaned.stopped])];
    const left = new Map<number, { pid: number; port?: number }>();
    for (const name of cleaned.left) if (name.startsWith('pid:')) left.set(Number(name.slice(4)), { pid: Number(name.slice(4)) });
    for (const port of ports) for (const pid of await listening(port)) left.set(pid, { pid, port });
    return { run: stack.run, stopped, left: [...left.values()] };
  }

  // ---- Spool, retention and the test load.

  /** Replays deep-hook's spool: each line once, and a file removed only once its events are in a FULL commit. */
  private async replaySpool(): Promise<void> {
    if (!existsSync(this.root.spool)) return;
    for (const name of readdirSync(this.root.spool).filter((f) => f.endsWith('.jsonl')).sort()) {
      const file = join(this.root.spool, name);
      const text = readFileSync(file);
      this.durable.point('spool_read');
      let offset = 0;
      let failed = false;
      while (offset < text.length) {
        const end = text.indexOf(0x0a, offset);
        if (end < 0) {
          process.stderr.write(`deep hub: ${file}: refused a cut line at offset ${offset}\n`);
          break;
        }
        const parsed = parseLine(text.subarray(offset, end), true, this.held);
        if (parsed.kind === 'hook') {
          const { drafts, meta } = parsed;
          await this.queue(() => this.handleHook(drafts, meta, 'hook'), true).then(({ settled }) => settled).catch(() => { failed = true; });
        } else {
          process.stderr.write(`deep hub: ${file}: refused the line at offset ${offset}: ${parsed.kind === 'refused' ? `${parsed.error.code} at ${parsed.error.path}` : 'not a hook request'}\n`);
        }
        offset = end + 1;
      }
      if (failed) continue;
      await this.record.sync();
      rmSync(file);
      this.durable.point('spool_removal');
    }
  }

  /** The retention pass: keeps the files decisions and verdicts cite and the transcripts transcript.archived links. */
  private async retain(): Promise<void> {
    const rows = (await this.record.raw("SELECT evidence FROM events WHERE kind IN ('decision.created', 'decision.applied', 'verdict.made') AND evidence IS NOT NULL")) as { evidence: string }[];
    const cited = new Set<string>(this.options.plant === 'empty-cited' ? [] : rows.flatMap((r) => JSON.parse(r.evidence) as string[]));
    const linked = (await this.record.raw("SELECT json_extract(data, '$.evidence') AS sha FROM events WHERE kind = 'transcript.archived'")) as { sha: string | null }[];
    const archived = new Set(linked.flatMap((r) => (r.sha ? [r.sha] : [])));
    const { removed } = await this.store.retain({ cited, archived });
    for (const sha256 of removed) await this.appendCore('evidence.removed', { sha256 }).catch(() => undefined);
  }

  /** test.load: ten verdicts each in its own FULL commit, a checkpoint and a transcript backfill, as the hub would do them. */
  private async testLoad(params: Obj): Promise<Obj> {
    if (!this.options.vfs) throw new Refused(refusal('unknown_method', '/method', 'test.load is served only to a hub running under the test VFS.', 'test.load'));
    const verdicts = Number.isSafeInteger(params.verdicts) ? (params.verdicts as number) : 0;
    const template = (fixtures('verdict.made@1')[0] as Obj).data as Obj;
    for (let i = 0; i < verdicts; i++) {
      const ts = this.now();
      const id = ulid(ts);
      await this.append(this.connection('core'), { v: 1, id, kind: 'verdict.made', ts, data: { ...template, verdict: `verdict:${id}`, claim: `claim:${ulid(ts)}`, requirements: [] } as JsonValue });
    }
    // The test image has no WAL of its own: a checkpoint costs the hub one sync.
    if (params.checkpoint === true) this.durable.sync();
    let backfilled = 0;
    if (isObj(params.backfill)) backfilled = await this.backfill(params.backfill);
    return { done: true, verdicts, backfilled };
  }
  /** Reads a transcript and appends what its lines say, scrubbed: each prompt, and each turn's end; each once whatever the number of passes. */
  private async backfill(spec: Obj): Promise<number> {
    const session = String(spec.session ?? '');
    const agent = String(spec.agent ?? '');
    const handle = session.replace(/[^0-9A-Za-z]/g, '');
    const text = await readFile(String(spec.transcript), 'utf8');
    const appends: Promise<void>[] = [];
    let msg = 0;
    let turn = 0;
    let worked = false;
    for (const [i, raw] of text.split('\n').entries()) {
      if (!raw) continue;
      let line: Obj;
      try {
        line = JSON.parse(raw) as Obj;
      } catch {
        continue;
      }
      if (!isObj(line.message) || (line.type !== 'user' && line.type !== 'assistant')) continue;
      const content = line.message.content;
      const parts = Array.isArray(content) ? content.filter(isObj) : [];
      const ts = Date.parse(String(line.timestamp)) || this.now();
      const id = derivedId(ts, `${session}:${String(line.uuid ?? i)}`);
      const connection = this.connection('hook', { session, agent });
      if (line.type === 'user') {
        // A person's prompt; a user line that only carries tool results is part of the turn.
        if (parts.length && parts.every((c) => c.type === 'tool_result')) continue;
        const said = typeof content === 'string' ? content : parts.flatMap((c) => (typeof c.text === 'string' ? [c.text] : [])).join('\n');
        appends.push(this.append(connection, { v: 1, id, kind: 'user.ask', ts, data: { msg: msg++, text: scrubText(said, { held: this.held }), tasks: [], from: 'person' } }, true));
      } else if (parts.some((c) => c.type === 'tool_use')) {
        worked = true;
      } else if (handle) {
        // An assistant message that calls no tool ends its turn.
        appends.push(this.append(connection, { v: 1, id, kind: 'agent.stop', subject: `session:${handle}`, ts, data: { turn: ++turn, did_work: worked } }, true));
        worked = false;
      }
    }
    await Promise.allSettled(appends);
    return appends.length;
  }


  // ---- Stop.

  /** A clean stop: in-flight runs stopped and recorded, the stop and its reason appended, the record closed FULL. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    try {
      await this.ready;
    } catch {
      return;
    }
    await this.chain;
    for (const { stop } of this.runs.values()) stop();
    // Each worktree's stack goes down with the hub, through the supervisor.
    await Promise.race([Promise.allSettled([...this.stackRuns].map((run) => this.takeDown(run))), new Promise((done) => setTimeout(done, 5000))]);
    await Promise.race([Promise.allSettled([...this.runs.values()].map((r) => r.done)), new Promise((done) => setTimeout(done, 5000))]);
    await this.appendCore('hub.stopped', { reason }).catch(() => undefined);
    await this.supervisor.close();
    await this.record.close();
    this.writeState('stopped');
  }
}
