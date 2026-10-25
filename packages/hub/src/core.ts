// The hub's core: the one writer to the record and the evidence store. It checks each hook against the
// session it claims, binds deep mcp calls to sessions, supervises check runs, replays deep-hook's spool, runs
// retention, and answers the socket's methods. It runs in a worker thread of its own, so a disk sync, a run's
// output or a backfill never holds up the event loop that acknowledges hooks.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, readFile, stat, type FileHandle } from 'node:fs/promises';
import { homedir, networkInterfaces, userInfo } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AskRefused, openAsks, type Asks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { canonicalize, contextBoundFor, fixtures, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, type ExtensionHost } from '@deepbuild/extension-host';
import { openRecord, RecordError, toJson, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import { answers, composeKind, downStack, leaseKinds, newRun, portKind, upStack, type Stack, type Up } from '@deepbuild/env-local';
import { openLeases } from '@deepbuild/leases';
import { openRunner, type JobRecord, type JobSpec, type Runner, type WindowReport } from '@deepbuild/runner';
import { openSupervisor, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import { confirmYou } from './confirm.js';
import { parseLine } from './hookmap.js';
import { rootOf, type Root } from './paths.js';
import { disk, syncPath, testVfs, writeSynced, type Durable } from './vfs.js';
import { EXTENSION_HOOK_MS, Refused, refusal, startOf, ulid, ulidTime, type CoreOptions, type Draft, type ExtensionReply, type HookMeta } from './wire.js';

const DAY = 86_400_000;
/** Your login Keychain, only while HOME is your own account's home: a hub under a test's temp HOME never reads it. */
const keychain = (service: string): Promise<string | undefined> => {
  const own = (() => { try { return realpathSync(process.env.HOME ?? '') === realpathSync(userInfo().homedir); } catch { return false; } })();
  if (process.platform !== 'darwin' || !own) return Promise.resolve(undefined);
  return new Promise((done) => execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (error, out) => done(error ? undefined : out.trim())));
};
const YOU = { actor: 'you', scope: 'you' };
const SECRETS_TTL = 10_000;
/** The spool file every deep-hook appends to. */
const SPOOL = 'spool.jsonl';
const REACHED = 10_000;
/** The reading a session gets for a turn with tool calls none of whose hooks reached the hub. */
const HOOKS_MISSING = 'hooks not reaching DeepBuild';
const TRANSCRIPT_STEP = 64 * 1024 * 1024;
/** How long after the hub reads a turn's end it judges whether any of the turn's hooks reached it. */
const TURN_GRACE = 100;
/** How long cursor changes gather before transcripts.json is written: a busy session writes it once, not per hook. */
const CURSOR_SAVE = 200;
const REQUEST = Buffer.from('{"v":1,"agent":');
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

/**
 * What a connection brings to a call: its role, the session it is bound to, for deep mcp the process it serves, and
 * for the app or the CLI the process its hello named as its own.
 */
export interface CallContext { role: string; session?: string | null; parent?: { pid: number; start: string }; peer?: { pid: number; start: string } }
/** The asks core's refusal as the socket's error@2, with the code that fits what it names. */
const asRefused = (error: unknown): unknown => {
  if (!(error instanceof AskRefused)) return error;
  const code = error.outcome ? 'not_found' : error.option ? 'enum' : error.field === 'writer' ? 'role' : 'type';
  return new Refused(refusal(code, `/params/${error.option ? 'option' : error.field ?? 'ask'}`, error.message, error.option ?? error.ask ?? ''));
};
/** Every process's parent, from one `ps`: how the peer check walks up from a deep command to the agent above it. */
const parents = (): Promise<Map<number, number>> => new Promise((done) => {
  execFile('ps', ['-A', '-o', 'pid=,ppid='], { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 << 20 }, (error, stdout) => {
    const map = new Map<number, number>();
    if (!error) for (const row of String(stdout).split('\n')) { const [pid, ppid] = row.trim().split(/\s+/).map(Number); if (pid && ppid) map.set(pid, ppid); }
    done(map);
  });
});

/**
 * A session as its own hooks established it: the agent process, its working folder and its transcript; and how
 * far the core has read that transcript, the turn it is in there, and the tool calls whose hooks reached the hub.
 */
interface Session {
  id: string; agent: string; pid: number; start: string; cwd: string; transcript: string; ended: boolean;
  read: number; turn: Turn | undefined; closed: Turn[]; reached: Set<string>;
  /** Calls whose hooks' events are on their way to the record, and how many: their turns wait for them. */
  pending: Map<string, number>;
  /** Whether its closed turns wait for a replay's end to be judged. */
  deferred?: boolean;
  /** The timer that judges its closed turns once their grace has passed. */
  judging?: NodeJS.Timeout | undefined;
}
/**
 * A turn of a transcript: where its prompt starts there, its tool calls, and for a closed one when the hub read
 * its end (its monotonic clock).
 */
interface Turn { uuid: string; from: number; calls: string[]; at?: number; recording?: boolean }
/**
 * Where a session's transcript is judged from after a restart, and the calls whose hooks reached the hub past there;
 * for an ended session with turns still to judge, its agent too, since no hook of it comes again.
 */
interface Cursor { transcript: string; read: number; reached: string[]; ended?: { agent: string } }
/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
interface Stamp { session: string; tool: string; digest: string }
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
  private asks!: Asks;
  /** host@1: where every check run starts, is signalled and waited for; the supervisor, unless a test put another in its place. */
  private host!: Host;
  /** env-local's compose kind, with the Docker CLI it found when the hub started (#331). */
  private compose?: ReturnType<typeof composeKind>;
  /** DeepBuild's own headless jobs (#159): their hooks are theirs, never a session's. */
  private runner!: Runner;
  /** Hooks from a running job's folder held until the runner reads that job's session ID, by job. */
  private readonly parked = new Map<string, Promise<void>>();
  /** Each session a reading named a job for, once. */
  private readonly readings = new Set<string>();
  private readonly ready: Promise<void>;
  private readonly sessions = new Map<string, Session>();
  /** The cursors the last hub left for sessions this one hasn't met yet. */
  private cursors = new Map<string, Cursor>();
  /** The pending write of transcripts.json. */
  private saving: NodeJS.Timeout | undefined;
  private readonly counters = new Map<string, { msgs: number; turns: number; worked: boolean }>();
  /** Unspent PreToolUse stamps: a call that binds to one spends it, and SessionEnd spends its session's. */
  private stamps: Stamp[] = [];
  /** Each process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID. */
  private readonly starts = new Map<number, Promise<string | undefined>>();
  /** Hooks and calls run in arrival order: a deep_* call finds the stamp its PreToolUse left. */
  private chain: Promise<unknown> = Promise.resolve();
  private blocked: string | undefined;
  /** Unset until the start opened it: a start that fails before has nothing to close or ask. */
  private extensions: ExtensionHost | undefined;
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
  private replaying: Promise<unknown> | undefined;
  /** Only the drops-post-tool-use and replay-appends-twice plants read them. */
  private dropped = false;
  private doubled = false;
  /** Whether appends came back during a replay, so the files it kept are taken again after it. */
  private retake = false;

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
    if (process.env.DEEP_HUB_TEST_CRASH) this.record = crashing(this.record, process.env.DEEP_HUB_TEST_CRASH);
    // A start that finds the last run still marked running records that run's stop as a crash.
    try {
      // A cursor whose transcript is gone has no session left to judge.
      this.cursors = new Map(Object.entries(JSON.parse(readFileSync(this.root.transcripts, 'utf8')) as Record<string, Cursor>).filter(([, c]) => typeof c?.transcript === 'string' && existsSync(c.transcript)));
    } catch {
      // None yet, or unreadable: the sessions are read from where this hub meets them.
    }
    const crashed = existsSync(this.root.state) && readFileSync(this.root.state, 'utf8').trim() === 'running';
    this.writeState('running');
    if (crashed) await this.appendCore('hub.stopped', { reason: 'crashed' });
    // Opening the supervisor reaps what the record says a run left before this start.
    const asks = this.asks = await openAsks({ record: this.record, now: this.now, deliver: () => undefined });
    // Compose's own folder sits in the hub's, which no run writes: the files a compose stack runs are the hub's.
    const compose = this.compose = composeKind(join(this.root.dir, 'compose'));
    // env-local's port kind (#331): ports from 3000 up, each checked free before it is leased.
    const port = portKind({ free: this.options.plant !== 'env-leases-port-again' });
    // The kernel's one lease table (#237): env-local declares its kinds there with their free checks, the core its
    // cpu.slot, and the supervisor takes every run's keys through it.
    const leases = await openLeases({ record: this.record, now: this.now, ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}) });
    for (const kind of leaseKinds) await leases.declare('env-local', kind, [port, compose].find((k) => k.kind === kind.name)?.free);
    this.timers.push(setInterval(() => void leases.tick().catch(() => undefined), 1000));
    this.supervisor = await openSupervisor({
      record: this.record, asks, now: this.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
      resources: [port, compose], leases,
      ...(this.options.plant === 'env-holds-lease-for-helper' ? { plant: 'holds-lease-while-taken' as const } : {}),
      ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}),
      ...(this.options.crash ? { crash: this.options.crash } : {}),
      // No run, run-as-you included, writes the record, the agents' config folders or the Node the hub runs on;
      // the sandbox profile itself keeps every project's agent hook and MCP files. The runner's jobs/ is left to
      // each run's own grant: a job's checkout writes only its own folder.
      guarded: [
        { path: this.root.dir, except: [join(this.root.dir, 'jobs')] }, join(homedir(), '.claude'), join(homedir(), '.codex'), realpathSync(resolve(fileURLToPath(import.meta.url), '../../..')),
        join(homedir(), 'Library', 'LaunchAgents'),
        process.execPath, resolve(process.execPath, '../../lib/node_modules'),
        ...[process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((p): p is string => !!p && isAbsolute(p)),
        ...compose.guarded,
      ],
    });
    this.host = this.options.host
      ? ((await import(pathToFileURL(this.options.host).href)) as { default: (local: Host) => Host }).default(this.supervisor)
      : this.supervisor;
    this.timers.push(setInterval(() => void this.supervisor.tick().catch(() => undefined), 1000));
    const config = this.config();
    const ledger = await openLedger({ record: this.record, asks, now: this.now, price: async () => null });
    // The runner reaps or reports what a crash cut, and ticks itself.
    this.runner = await openRunner({
      record: this.record, asks, supervisor: this.supervisor, ledger, now: this.now, root: this.root.dir, loginPath: config.loginPath, env: process.env, keychain,
      settings: { plan: { reserve_pct: config.reservePct }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    // Every installed extension loads, sandboxed until a signed release lists it; one refused is named and left out.
    const trust = await openTrust({ record: this.record, now: this.now });
    const extensions = this.extensions = await openExtensionHost({ record: this.record, supervisor: this.supervisor, trust, home: this.root.dir, release: [], now: this.now });
    for (const pkg of await extensions.installed()) {
      const load = await extensions.load(pkg);
      if (load.status === 'refused') process.stderr.write(`deep hub: extension ${pkg.id}@${pkg.version} not loaded: ${load.reason}\n`);
    }
    await this.replaySpool();
    // The replay is done: the extensions start, and each that can't is unloaded and named.
    await extensions.ready().catch((error: unknown) => process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`));
    // A session that ended with turns still to judge sends no hook again: they are judged now.
    for (const [id, cursor] of this.cursors) {
      if (typeof cursor.ended?.agent !== 'string' || typeof cursor.read !== 'number' || !Array.isArray(cursor.reached)) continue;
      this.cursors.delete(id);
      const session: Session = { id, agent: cursor.ended.agent, pid: 0, start: '', cwd: '', transcript: cursor.transcript, ended: true, read: cursor.read, turn: undefined, closed: [], reached: new Set(cursor.reached), pending: new Map() };
      this.sessions.set(id, session);
      await this.readTranscript(session);
      this.endTurn(session);
      this.judge(session);
    }
    await this.recoverRuns();
    await this.retain();
    this.timers.push(setInterval(() => void this.retain().catch(() => undefined), DAY));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && this.durable.probe(this.root.dir)) { this.blocked = undefined; this.replayLate(true); } }, 250));
    for (const timer of this.timers) timer.unref();
  }

  /** What setup wrote to <root>/config.json for the runner: the login shell's PATH and the plan's reserve. */
  private config(): { loginPath: string; reservePct: number } {
    let c: Obj = {};
    try { c = JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as Obj; } catch { /* none yet: no binary resolves, so every job is refused saying so */ }
    const runner = isObj(c.runner) ? c.runner : {};
    const plan = isObj(c.plan) ? c.plan : {};
    return {
      loginPath: typeof runner.login_path === 'string' ? runner.login_path : '',
      reservePct: typeof plan.reserve_pct === 'number' ? plan.reserve_pct : 10,
    };
  }

  private writeState(state: 'running' | 'stopped'): void {
    writeFileSync(`${this.root.state}.tmp`, `${state}\n`, { mode: 0o600 });
    renameSync(`${this.root.state}.tmp`, this.root.state);
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
    // What deep-hook spooled ran before this hook, so a replay this hook starts, or one running, goes first.
    this.replayLate();
    const replayed = this.replaying ?? Promise.resolve();
    return replayed.then(() => this.queue(() => this.handleHook(drafts, meta, writer))).then(({ settled }) => settled);
  }
  /**
   * A hook reaching the running hub shows it answers again: what deep-hook spooled while the hub was late is
   * replayed then, beside the hooks that follow, rather than at the next start.
   */
  private replayLate(kept = false): void {
    if (this.stopping) return;
    if (this.replaying) {
      this.retake ||= kept;
      return;
    }
    // A file a failed replay kept is taken again once appends work again.
    const waiting = existsSync(join(this.root.spool, SPOOL)) || (kept && existsSync(this.root.spool) && readdirSync(this.root.spool).some((f) => f.endsWith('.jsonl')));
    if (!waiting) return;
    // A hub that couldn't start replays nothing; its start reports why.
    this.replaying = this.ready
      .then(() => this.replaySpool(), () => undefined)
      .catch((error: unknown) => process.stderr.write(`deep hub: the spool replay stopped: ${error instanceof Error ? error.message : String(error)}\n`))
      .finally(() => {
        this.replaying = undefined;
        // The turns that waited on the replay are judged now, after the hooks queued before.
        void this.queue(async () => {
          for (const session of this.sessions.values()) {
            if (!session.deferred) continue;
            session.deferred = false;
            this.judge(session);
          }
        }).catch(() => undefined);
        // What was spooled during the replay, and the files it kept if appends came back, are taken now.
        const kept = this.retake;
        this.retake = false;
        if (!this.blocked) this.replayLate(kept);
      });
  }
  /** Runs `work` after everything queued before it, and after the start, which the spool replay is part of. */
  private queue<T>(work: () => Promise<T>, starting = false): Promise<T> {
    const done = this.chain.then(() => (starting ? undefined : this.ready)).then(work);
    this.chain = done.catch(() => undefined);
    return done;
  }
  private async handleHook(drafts: Draft[], meta: HookMeta, writer: string, replayed = false, waited = false): Promise<{ settled: Promise<void> }> {
    // The planted wrong program answers the first PostToolUse it reads and appends nothing for it.
    if (this.options.plant === 'drops-post-tool-use' && meta.event === 'PostToolUse' && !this.dropped) {
      this.dropped = true;
      return { settled: Promise.resolve() };
    }
    // A spooled line whose hook the hub already recorded live changes nothing: no count, no stamp, no append.
    if (replayed && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(meta.id)) {
      // Its live copy may be acknowledged and still on its way to the record.
      await Promise.allSettled([...this.inflight]);
      const known = await this.record.raw(`SELECT json_extract(data, '$.late') AS late FROM events WHERE id = '${meta.id}' LIMIT 1`);
      if (known.length) {
        // Unless deep-hook gave up on an acknowledgement the hub sent just too late: the live copy is in the record
        // unmarked while deep-hook acted on its own, so the session says so rather than the fail-open going unseen.
        if (meta.late && Number((known[0] as { late?: unknown }).late) !== 1) return { settled: this.lateAnswered(meta, meta.late.matched) };
        return { settled: Promise.resolve() };
      }
    }
    const whose = await this.whose(meta, drafts.find((d) => d.seq !== undefined)?.seq);
    if (whose.job) {
      const settled = this.appendCore('job.event', { job: whose.job, event: meta.event });
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.wait && !waited) {
      // Held, not queued: the hooks behind it go on; it is read again once its job's session ID is known.
      const settled = this.park(whose.wait).then(() => this.queue(() => this.handleHook(drafts, meta, writer, replayed, true))).then(({ settled: s }) => s);
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.reading && !this.readings.has(`${meta.session}\0${whose.reading.job}`)) {
      this.readings.add(`${meta.session}\0${whose.reading.job}`);
      const ts = this.now();
      await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading: whose.reading.text } }).catch(() => undefined);
    }
    const verified = await this.verify(meta);
    const session = this.sessions.get(meta.session);
    if (session && (verified || this.options.plant === 'ends-binding')) {
      // Only an event checked against its session acts on it: an unverified SessionEnd ends nothing.
      if (meta.event === 'SessionEnd') {
        session.ended = true;
        this.stamps = this.stamps.filter((stamp) => stamp.session !== session.id);
      }
      // A replayed PreToolUse was let through late; its call has run, so it stamps nothing a later call could bind.
      if (verified && meta.stamp && !replayed) this.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest });
    }
    const call = session && verified && drafts.length ? meta.toolUse : undefined;
    if (session && call) session.pending.set(call, (session.pending.get(call) ?? 0) + 1);
    if (session && verified) {
      await this.readTranscript(session);
      if (meta.event === 'SessionEnd') this.endTurn(session);
      this.judge(session);
      // Written at once, like a session's first cursor: no later hook of the session would write it.
      if (meta.event === 'SessionEnd') this.writeCursors();
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
      // A conflict is an ID the log already holds: a spool replayed again, whose event is there once already.
      const failed = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof RecordError && r.reason.code === 'conflict'));
      for (const result of failed) {
        if (result.status === 'rejected' && !(result.reason instanceof RecordError && result.reason.code === 'storage')) {
          process.stderr.write(`deep hub: hook ${meta.id} (${meta.event}) not recorded: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
        }
      }
      if (failed.length) throw Error(`hook ${meta.id} was not recorded`);
    });
    settled.catch(() => undefined);
    // A call reaches the hub once its hook's event is durable, never before: a restart trusts the cursors kept.
    // Its turn is judged once the append settles, however long past the grace that is.
    if (session && call) {
      void settled.then(() => {
        session.reached.add(call);
      }, () => undefined).finally(() => {
        const left = session.pending.get(call)! - 1;
        if (left) session.pending.set(call, left);
        else session.pending.delete(call);
        // Judged in the start too, as its replay is: queued behind the start, it would hold up the replay that ends it.
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      });
    }
    return { settled };
  }

  /** The hook kinds some loaded extension handles, read once the extensions have started. */
  hooks(): string[] {
    return this.extensions?.hooks() ?? [];
  }
  /**
   * The extensions' joined reply to a tool.before, or null when it takes the hook's fail-open policy: while appends
   * fail every gate is watch-only, and the extensions' denies and context go with them. A handler that failed is
   * named on stderr; its reply is already out of the join.
   */
  async extensionHook(data: unknown): Promise<ExtensionReply | null> {
    if (this.blocked || !this.extensions) return null;
    const reply = await this.extensions.hook({ kind: 'tool.before', data, deadline: EXTENSION_HOOK_MS, bound: contextBoundFor(EXTENSION_HOOK_MS) });
    for (const { reason } of reply.failed) process.stderr.write(`deep hub: tool.before handler failed: ${reason}\n`);
    return { denies: reply.denies, context: reply.context };
  }

  /** Records, once, that a call the hub answered was let through by deep-hook as late, naming its guard entries. */
  private async lateAnswered(meta: HookMeta, matched: string[]): Promise<void> {
    const reading = `deep-hook let ${meta.event} ${meta.id} through as late, after the hub's answer missed its deadline; `
      + (matched.length ? `it matched ${matched.join(', ')}` : 'it matched no guard entry');
    // The ID is a ULID (checked before this is called), so it goes into the query as it is.
    const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'session.reading' AND instr(json_extract(data, '$.reading'), '${meta.id}') > 0 LIMIT 1`);
    if (known.length) return;
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading } });
  }

  /**
   * Reads what the session's transcript gained since the last hook. A turn there that made tool calls, none of
   * whose hooks reached the hub, is recorded once the next prompt shows it ended and a later hook judges it: the
   * session then reads "hooks not reaching DeepBuild", so failing open is never silent.
   */
  private async readTranscript(session: Session): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(session.transcript, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      // At most TRANSCRIPT_STEP is held at once: more growth than that is read a step at a time.
      while (size > session.read) {
        const want = Buffer.alloc(Math.min(size - session.read, TRANSCRIPT_STEP));
        // Only the bytes the read returned: a transcript cut shorter since the stat returns fewer.
        const { bytesRead } = await handle.read(want, 0, want.length, session.read);
        if (!bytesRead) return;
        const text = want.subarray(0, bytesRead);
        // Only whole lines: a line still being written is read with the next hook. A line longer than a step is
        // passed over; what is left of it doesn't parse, as no prompt or call longer than a step would.
        let end = text.lastIndexOf(0x0a) + 1;
        if (!end) {
          if (text.length < TRANSCRIPT_STEP) return;
          end = text.length;
        }
        const base = session.read;
        session.read += end;
        for (let at = 0; at < end;) {
          const from = base + at;
          const next = text.indexOf(0x0a, at) + 1 || end;
          const raw = text.subarray(at, next).toString('utf8');
          at = next;
          let line: unknown;
          try {
            line = JSON.parse(raw);
          } catch {
            continue;
          }
          if (!isObj(line) || line.isSidechain === true || !isObj(line.message)) continue;
          const content = line.message.content;
          const parts = Array.isArray(content) ? content.filter(isObj) : [];
          if (line.type === 'user' && !(parts.length && parts.every((c) => c.type === 'tool_result'))) {
            // A person's prompt ends the turn before it.
            if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
            session.turn = { uuid: typeof line.uuid === 'string' && line.uuid ? line.uuid : `offset:${from}`, from, calls: [] };
          } else if (line.type === 'assistant' && session.turn) {
            for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') session.turn.calls.push(part.id);
          }
        }
      }
    } catch {
      // A transcript that can't be read now is read from the same place with the next hook.
    } finally {
      await handle.close();
    }
  }

  /** A session's last turn ends with it: no prompt comes after it to end it. */
  private endTurn(session: Session): void {
    if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
    session.turn = undefined;
  }

  /**
   * Judges the turns whose end the hub read at least TURN_GRACE ago, on its own monotonic clock: a hook started
   * before that read has reached the hub by then, since deep-hook gives up on the hub after 20 ms and spools. While
   * a replay runs, or a spool waits for one, the turns wait for it: one of their hooks may be there. A turn none of
   * whose calls reached the hub is recorded. Turns still in their grace are judged by a timer.
   */
  private judge(session: Session): void {
    if (session.closed.length) this.replayLate();
    if (this.replaying) {
      session.deferred = true;
      return;
    }
    const now = performance.now();
    const waits = (turn: Turn) => turn.calls.some((call) => session.pending.has(call));
    for (const turn of session.closed.filter((t) => !t.recording && now - t.at! >= TURN_GRACE)) {
      if (waits(turn)) break;
      if (turn.calls.some((call) => session.reached.has(call))) {
        for (const call of turn.calls) session.reached.delete(call);
        session.closed.splice(session.closed.indexOf(turn), 1);
        continue;
      }
      turn.recording = true;
      const ts = this.now();
      // Settled like a hook's drafts: the next hook doesn't wait for its commit. The turn, and so where a restart
      // reads from, stays until its reading is durable; one whose append fails is judged again with the next hook.
      void this.append(this.connection('core', { session: session.id, agent: session.agent }), {
        v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading: HOOKS_MISSING },
      }).then(() => {
        session.closed.splice(session.closed.indexOf(turn), 1);
        this.saveCursors();
      }, () => {
        turn.recording = false;
      });
    }
    const next = session.closed.find((t) => !t.recording);
    if (next && !waits(next) && !session.judging && !this.stopping) {
      session.judging = setTimeout(() => {
        session.judging = undefined;
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      }, Math.max(1, TURN_GRACE - (now - next.at!)));
      session.judging.unref();
    }
    // Calls no read turn holds (a subagent's) are forgotten oldest first; a read turn's are kept until it's judged.
    if (session.reached.size > REACHED) {
      const held = new Set([...session.closed, ...(session.turn ? [session.turn] : [])].flatMap((t) => t.calls));
      for (const call of session.reached) {
        if (session.reached.size <= REACHED) break;
        if (!held.has(call)) session.reached.delete(call);
      }
    }
    this.saveCursors();
  }

  /** Keeps where each live session's transcript is judged from (its oldest unjudged turn), so a restart judges what it missed. */
  private saveCursors(): void {
    if (this.saving || this.stopping) return;
    this.saving = setTimeout(() => this.writeCursors(), CURSOR_SAVE);
    this.saving.unref();
  }
  private writeCursors(): void {
    clearTimeout(this.saving);
    this.saving = undefined;
    const cursors = new Map(this.cursors);
    for (const s of this.sessions.values()) {
      // An ended session is kept until its last turns are judged and their readings durable.
      if (s.ended && !s.closed.length) {
        cursors.delete(s.id);
        continue;
      }
      cursors.delete(s.id);
      cursors.set(s.id, { transcript: s.transcript, read: s.closed[0]?.from ?? s.turn?.from ?? s.read, reached: [...s.reached], ...(s.ended ? { ended: { agent: s.agent } } : {}) });
    }
    // Synced, so a power cut leaves the last whole save; a failed save is made again with the next hook's.
    try {
      writeSynced(this.root.transcripts, Buffer.from(JSON.stringify(Object.fromEntries(cursors))));
    } catch (error) {
      process.stderr.write(`deep hub: ${this.root.transcripts} not saved: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /**
   * Whose a hook is: a job's, when its session ID is the one the runner read from that job's own output and it was
   * sent inside the job's run; held, when it comes from a running job's folder before that ID is read; otherwise
   * the session's own, with a reading when it only looks like a job's.
   */
  private async whose(meta: HookMeta, seq: string | undefined): Promise<{ job?: string; wait?: string; reading?: { job: string; text: string } }> {
    const jobs = await this.runner.list();
    const at = seq ? Number(BigInt(seq) / 1_000_000n) : Date.now();
    const during = (j: JobRecord) => j.ran !== undefined && at >= j.ran.from && (j.ran.to === undefined || at <= j.ran.to);
    const own = jobs.find((j) => meta.session && j.session === meta.session && during(j));
    if (own) return { job: own.job };
    const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || isUnder(meta.cwd, j.folder)));
    if (there && there.session === undefined && (there.state === 'running' || there.state === 'stopping')) return { wait: there.job };
    const resumed = jobs.find((j) => meta.session && j.session === meta.session);
    if (resumed) return { reading: { job: resumed.job, text: `It resumes the session ID of DeepBuild's job ${resumed.job}, which it is not: it is judged as your own session.` } };
    if (there) return { reading: { job: there.job, text: `It works in the folder of DeepBuild's job ${there.job} (${there.folder}), which it is not: it is judged as your own session.` } };
    return {};
  }
  /** Resolves once the runner has read the job's session ID, or the job has ended without one. */
  private park(job: string): Promise<void> {
    let parked = this.parked.get(job);
    if (!parked) {
      parked = (async () => {
        for (;;) {
          const rec = await this.runner.status(job).catch(() => undefined);
          if (!rec || rec.session !== undefined || (rec.state !== 'running' && rec.state !== 'stopping')) return;
          await new Promise((done) => setTimeout(done, 50));
        }
      })();
      this.parked.set(job, parked);
      void parked.finally(() => this.parked.delete(job));
    }
    return parked;
  }

  /** A process's start time, or undefined when it can't be read. Read in this worker, never on the event loop. */
  private startOf(pid: number, fresh = false): Promise<string | undefined> {
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = startOf(pid);
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
      // A session the last hub met is read from where that hub left it; one this hub meets first, from here on:
      // what its transcript held before isn't judged.
      const cursor = this.cursors.get(meta.session);
      this.cursors.delete(meta.session);
      const left = cursor?.transcript === transcript && typeof cursor.read === 'number' && Array.isArray(cursor.reached) ? cursor : undefined;
      const read = left ? left.read : await stat(transcript).then((s) => s.size, () => 0);
      this.sessions.set(meta.session, { id: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false, read, turn: undefined, closed: [], reached: new Set(left?.reached), pending: new Map() });
      // A session's first cursor is written at once: a restart before it would read the session from its end.
      this.writeCursors();
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
    return this.queue(async () => undefined).then(() => this.dispatch(method, p, context));
  }
  private async dispatch(method: string, params: Obj, context: CallContext): Promise<unknown> {
    switch (method) {
      case 'hub.health': return this.health();
      case 'events.read': return this.read(params);
      case 'ask.answer': return this.answer(params, context);
      case 'inbox.read': return this.inbox();
      case 'gates.off': throw new Refused(refusal('unconfirmed', '/method', 'deep off takes effect only once the OS confirms you (#19); nothing changed.', 'gates.off'));
      case 'evidence.paste': return this.paste(params);
      case 'run.start': return this.runStart(params);
      case 'test.load': return this.testLoad(params);
      case 'env.up': return this.envUp(params);
      case 'env.down': return this.envDown(params);
      case 'job.submit': return this.runner.submit(params.spec as JobSpec);
      case 'job.status': return this.runner.status(String(params.job));
      case 'job.list': return { jobs: await this.runner.list() };
      case 'job.output': return { stdout: await this.runner.output(String(params.job)) };
      case 'windows.report': return this.runner.report(params as unknown as WindowReport).then(() => ({ reported: true }));
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

  /** The open asks, as `deep inbox` lists them (#24): the inbox projection's rows, with each ask's question and options. */
  private async inbox(): Promise<Obj> {
    const open = (await this.asks.inbox()).filter((row) => row.status !== 'closed');
    const rows = (await this.record.raw("SELECT id, question, options FROM asks WHERE status IN ('open', 'later')")) as { id: string; question: string | null; options: string | null }[];
    const texts = new Map(rows.map((r) => [r.id, r]));
    return {
      asks: open.map((row) => {
        const text = texts.get(row.ask.slice(4));
        return { ...row, question: text?.question ?? '', options: text?.options ? (JSON.parse(text.options) as { id: string }[]).map((o) => o.id) : [] };
      }),
    };
  }

  /**
   * Your answer to an ask from a control-token holder (#24). It counts only once the OS confirms you, never on the
   * token or the peer check alone, and never from a deep command run inside an agent's process tree, which acts as
   * that agent's session. Counted, the asks core records it and the core saves it as a decision for the ask's repo.
   */
  private async answer(params: Obj, context: CallContext): Promise<Obj> {
    const { ask: handle, ...input } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.record.raw(`SELECT e.session_id AS session, e.project_id AS project, e.data AS data, a.status AS status FROM events e JOIN asks a ON a.id = e.id WHERE e.id = '${handle.slice(4)}' AND e.kind = 'ask.created'`)) as { session: string | null; project: string | null; data: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; answer an ask deep inbox lists.`, handle));
    const answered = (): Promise<void> => this.asks.answer(this.connection(context.role === 'app' ? 'app' : 'cli'), handle, input).catch((error: unknown) => { throw asRefused(error); });
    // A closed ask takes no answer: the asks core records the refusal, and there's nothing to confirm you for.
    if (row.status !== 'open' && row.status !== 'later') {
      await answered();
      throw new Refused(refusal('not_found', '/params/ask', `${handle} is closed.`, handle));
    }
    const ask = JSON.parse(row.data) as { key: string; question: string; options: { id: string; label: string }[] };
    const chosen = ask.options.find((o) => o.id === input.option);
    if (input.option !== undefined && !chosen) {
      throw new Refused(refusal('enum', '/params/option', `${handle} has no option ${String(input.option)}; its options are ${ask.options.map((o) => o.id).join(', ')}.`, input.option));
    }
    // Saved for this repo, from the ask's own events, never wider than its card showed; with no repo, for its session.
    const repo = (row.project ?? '').replace(/[^0-9A-Za-z]/g, '');
    const session = (row.session ?? '').replace(/[^0-9A-Za-z]/g, '');
    const scope = repo ? `repo:${repo}` : session ? `session:${session}` : undefined;
    if (!scope) throw new Refused(refusal('unavailable', '/params/ask', `${handle} belongs to no repo or session, so its answer has no scope to be saved at; answer it on the question card.`, handle));
    const agent = await this.agentAbove(context.peer);
    if (agent) {
      throw new Refused(refusal('role', '/params/ask', `${handle} stays open: this deep command runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent answers an ask. Answer it from your own terminal or on the question card.`, handle));
    }
    const plant = this.options.plant;
    if (plant !== 'answer-on-token' && plant !== 'answer-on-peer-check') {
      const what = chosen ? `“${chosen.label.slice(0, 80)}”` : 'your words';
      const why = await confirmYou(`answer “${ask.question.slice(0, 120)}” with ${what}`, this.options.confirm);
      if (why) {
        throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}). An answer from the CLI counts only once it does; answer again and confirm, or answer on the question card.`, handle, true));
      }
    }
    await answered();
    const answer = chosen?.id ?? String(input.words);
    await this.appendCore('decision.created', { key: ask.key, scope, answer, ask: handle });
    return { ask: handle, answer, scope };
  }

  /**
   * The peer check: the agent session whose process is above the caller's, by PID and start time as that session's
   * hooks established them. It decides whose session a deep command acts as, never whether an answer counts.
   */
  private async agentAbove(peer: CallContext['peer']): Promise<string | undefined> {
    if (!peer || (await this.startOf(peer.pid, true)) !== peer.start) return undefined;
    const up = await parents();
    const seen = new Set<number>();
    for (let pid = up.get(peer.pid); pid !== undefined && pid > 1 && !seen.has(pid); pid = up.get(pid)) {
      seen.add(pid);
      const session = [...this.sessions.values()].find((s) => s.pid === pid);
      if (session && (await this.startOf(pid, true)) === session.start) return session.id;
    }
    return undefined;
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
      return s.tool === tool && s.digest === digest && session !== undefined && session.pid === parent.pid && session.start === parent.start;
    }) : [];
    // A call more than one unspent stamp matches binds to none.
    if (matches.length !== 1) throw new Refused(refusal('unbound', '/params/arguments', `This ${tool} call binds to no session: ${matches.length ? 'more than one' : 'no'} PreToolUse stamped for it is unspent.`, tool));
    this.stamps.splice(this.stamps.indexOf(matches[0]!), 1);
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
    const values = this.options.plant === 'no-run-values' ? undefined : { env, held: [token, ...this.options.held] };
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
        ? upStack(this.host, { run: stackRun, folder: run.cwd, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project' }).catch((error: Error) => ({ status: 'BLOCKED' as const, run: stackRun, cause: error.message }))
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
    if (running && (await this.supervisor.status(running.run)).state === 'running' && (await answers(running))) return { status: 'ready', run: running.run, worktree, ports: running.ports, ...(running.project ? { project: running.project } : {}) };
    // Any other is taken down, and a new one started.
    if (running) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
    }
    if (this.stopping) return { status: 'BLOCKED', worktree, cause: 'the hub is stopping' };
    const run = newRun(this.now());
    this.stackRuns.add(run);
    this.rising.set(worktree, run);
    const up = await upStack(this.host, { run, folder: worktree, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project' })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }))
      .finally(() => this.rising.delete(worktree));
    if (up.status === 'BLOCKED') {
      // What it started is stopped and its leases released; a stack that never started has nothing to clean.
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: up.cause };
    }
    this.stacks.set(worktree, up.stack);
    return { status: 'ready', run, worktree, ports: up.stack.ports, ...(up.stack.project ? { project: up.stack.project } : {}) };
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

  /**
   * Replays deep-hook's spool: each line once, in the order it was written. A line that doesn't parse, cut by a
   * write that never finished, is skipped and recorded naming its offset, and every request after it is kept,
   * one appended right after the cut bytes included. A file is removed only once its events are in a FULL commit.
   */
  private async replaySpool(): Promise<void> {
    if (!existsSync(this.root.spool)) return;
    // Every deep-hook appends to spool.jsonl. It moves aside first, so a hook that spools during the replay begins
    // a new file, which the next replay takes. A hook whose write lands in the moved file sees the path no longer
    // names it and writes the line again to the new one (deep-hook's spool), so nothing written late is lost; the
    // short wait only lets a write in flight finish here rather than read as a cut line.
    const live = join(this.root.spool, SPOOL);
    if (existsSync(live)) {
      // Named after every file a replay kept, whatever the clock says now: the files replay in name order.
      const kept = readdirSync(this.root.spool).filter((f) => /^replay-[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/.test(f)).sort().at(-1);
      const after = kept ? ulidTime(kept.slice(7, 33)) + 1 : 0;
      const moved = join(this.root.spool, `replay-${ulid(Math.max(Date.now(), after))}.jsonl`);
      renameSync(live, moved);
      await new Promise((done) => setTimeout(done, 100));
      // deep-hook syncs spool.jsonl by its name, so a line written just before the move may be synced by no one:
      // the moved file and the move are synced here before any of it is read.
      syncPath(moved);
      syncPath(this.root.spool);
    }
    for (const name of readdirSync(this.root.spool).filter((f) => f.endsWith('.jsonl') && f !== SPOOL).sort()) {
      const file = join(this.root.spool, name);
      const text = readFileSync(file);
      this.durable.point('spool_read');
      let failed = false;
      // A cut line is recorded once, however often its kept file is replayed.
      const skip = async (offset: number, reason: string) => {
        try {
          const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'spool.refused' AND json_extract(data, '$.file') = '${name.replace(/'/g, "''")}' AND json_extract(data, '$.offset') = ${offset} LIMIT 1`);
          if (!known.length) await this.appendCore('spool.refused', { file: name, offset, reason });
        } catch {
          failed = true;
        }
      };
      for (let offset = 0; offset < text.length;) {
        // A stopping hub keeps the rest of the file for its next start.
        if (this.stopping) {
          failed = true;
          break;
        }
        let end = text.indexOf(0x0a, offset);
        if (end < 0) end = text.length;
        const line = text.subarray(offset, end);
        let parsed = line.length ? parseLine(line, true, this.options.held) : undefined;
        if (parsed?.kind === 'refused' && parsed.error.code === 'not_json') {
          await skip(offset, 'a cut line: a spooled write that never finished, so it does not parse');
          if (this.options.plant === 'stops-at-first-bad-line') break;
          // A request appended right after the cut bytes shares their line; each begins as deep-hook writes it.
          parsed = undefined;
          for (let at = line.indexOf(REQUEST, 1); at > 0 && !parsed; at = line.indexOf(REQUEST, at + 1)) {
            const glued = parseLine(line.subarray(at), true, this.options.held);
            if (glued.kind !== 'refused' || glued.error.code !== 'not_json') parsed = glued;
          }
        }
        if (parsed?.kind === 'hook') {
          const { drafts, meta } = parsed;
          await this.queue(() => this.handleHook(drafts, meta, 'hook', true), true).then(({ settled }) => settled).catch((error: unknown) => {
            failed = true;
            process.stderr.write(`deep hub: ${name} kept: ${meta.id} not replayed: ${error instanceof Error ? error.message : String(error)}\n`);
          });
          // The planted wrong program appends the first event it replays a second time, under a new ID.
          if (this.options.plant === 'replay-appends-twice' && !this.doubled) {
            this.doubled = true;
            const again = ulid(Date.now());
            await this.queue(() => this.handleHook(drafts.map((d) => ({ ...d, id: again })), { ...meta, id: again }, 'hook', true), true).then(({ settled }) => settled);
          }
        } else if (parsed) {
          await skip(offset, parsed.kind === 'refused' ? `refused: ${parsed.error.code} at ${parsed.error.path || '/'}` : 'not a hook request');
        }
        offset = end + 1;
      }
      if (failed) continue;
      // The planted wrong program removes the file with its events still in NORMAL commits only.
      if (this.options.plant !== 'remove-spool-after-normal') await this.record.sync();
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
        appends.push(this.append(connection, { v: 1, id, kind: 'user.ask', ts, data: { msg: msg++, text: scrubText(said, { held: this.options.held }), tasks: [], from: 'person' } }, true));
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
    await this.replaying;
    await this.chain;
    this.writeCursors();
    for (const { stop } of this.runs.values()) stop();
    // Each worktree's stack goes down with the hub, through the supervisor.
    await Promise.race([Promise.allSettled([...this.stackRuns].map((run) => this.takeDown(run))), new Promise((done) => setTimeout(done, 5000))]);
    // Each running job is stopped through the supervisor; one still stopping is reaped on the next start.
    const jobs = await this.runner.list().catch(() => [] as JobRecord[]);
    await Promise.race([Promise.allSettled(jobs.filter((j) => j.state === 'running' || j.state === 'waiting').map((j) => this.runner.cancel(j.job))), new Promise((done) => setTimeout(done, 5000))]);
    await this.runner.close();
    await Promise.race([Promise.allSettled([...this.runs.values()].map((r) => r.done)), new Promise((done) => setTimeout(done, 5000))]);
    await this.appendCore('hub.stopped', { reason }).catch(() => undefined);
    await this.extensions?.close();
    await this.supervisor.close();
    await this.record.close();
    this.writeState('stopped');
  }
}

/**
 * The record, killed with SIGKILL right after the append a test names (DEEP_HUB_TEST_CRASH): job.recorded, once a
 * job is recorded and before anything of it starts; job.started, once a job's process is tracked and before its
 * prompt is written. Only tests set it.
 */
function crashing(record: RecordStore, point: string): RecordStore {
  const jobs = new Set<string>();
  const append: RecordStore['append'] = async (connection, input) => {
    // `before:<kind>`: the hub dies before it appends an event of that kind, after what the call that appends it does next.
    if (point === `before:${input.kind}`) {
      await new Promise((done) => setTimeout(done, 50));
      process.kill(process.pid, 'SIGKILL');
    }
    // `slow:<kind>`: an event of that kind takes 300 ms to append.
    if (point === `slow:${input.kind}`) await new Promise((done) => setTimeout(done, 300));
    const event = await record.append(connection, input);
    const run = isObj(input.data) ? String(input.data.job ?? input.data.run) : '';
    if (input.kind === 'job.recorded') jobs.add(run);
    if ((point === 'job.recorded' && input.kind === 'job.recorded') || (point === 'job.started' && input.kind === 'process.tracked' && jobs.has(run))) process.kill(process.pid, 'SIGKILL');
    return event;
  };
  return new Proxy(record, {
    get: (target, key) => {
      if (key === 'append') return append;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
