// The supervisor (#236): the hub's trusted-ring part that starts every process, in the platform sandbox and
// with a run token, tracks what each run owns, stops only what it can prove is the run's, and holds a run's
// leases until every process recorded for it is proven gone. Its ownership records live in the event log, so a
// supervisor opened after a crash reaps what the last one left behind.
//
// A run owns: the process it started; every process its sandbox holds (the native helper finds them by the
// run's marker, which no fork, exec, setsid or empty environment sheds), recorded by ID and start time when
// they appear; and every member of its process group. Before a stop each is proven again: its start time, and
// for one recorded with the run token, the token read back from its environment.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import { dirname } from 'node:path';
import type { Connection, Event, EventInput } from '@deepbuild/record';
import type { JsonValue } from '@deepbuild/contracts';
import { HELPER, scan, sha256, table, tokenOf, type Proc } from './procs.js';
import { markerOf, quote, real, seatbeltWith } from './seatbelt.js';
import type { Cleanup, Exit, Grant, HostFacts, ResourceKind, ResourceStep, RunStatus, SandboxBackend, Started, StartSpec, Supervisor, SupervisorOptions } from './types.js';

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const DAY = 86_400_000;
const SCAN_MS = 100;
const GRACE_MS = 2000;
const WARM_MS = 60_000;
/** How long a run's output may stay open after its process exits: a background process holding it is a leftover, reaped by cleanup. */
const DRAIN_MS = 1000;
/** How often a key out of its pool has its cleanup check run again. */
const RECHECK_MS = 60_000;
/** The ask.sources@1 row the supervisor raises its unblock asks from. */
const UNBLOCK_SOURCE = 'supervisor.cleanup';
const RUN = /^run:[0-9A-Za-z]+$/;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return time + Array.from(randomBytes(16), (b) => CROCKFORD[b % 32]).join('');
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

interface Tracked { start: string; token: string | null }
interface Run {
  run: string;
  cwd: string;
  sandboxed: boolean;
  pid?: number;
  pgid?: number;
  /** The run token's digest; the token itself never leaves this process. */
  token: string | null;
  tracked: Map<number, Tracked>;
  ended: Set<number>;
  leases: { kind: string; key: string }[];
  /** What its cleanup recorded, once it has run. */
  cleaned?: Cleanup;
  /** Its cleanup while it runs: a second call shares it. */
  cleaning?: Promise<Cleanup>;
  child?: ChildProcess;
  exit?: Promise<Exit>;
  state: RunStatus['state'];
}
/** One key of a pool: free, held by a run (until `expires`, then stale), left dirty by a run's cleanup, or out of the pool. */
interface Key { holder?: string; expires?: number; stale?: boolean; dirty?: { run: string; ask?: string }; retired?: boolean }
interface Waiter { spec: StartSpec; on: string[]; resolve(started: Started | Promise<Started>): void }

class LocalSupervisor implements Supervisor {
  readonly name = 'local';
  private readonly runs = new Map<string, Run>();
  private readonly kinds = new Map<string, ResourceKind>();
  private readonly keys = new Map<string, Key>();
  private readonly waiters: Waiter[] = [];
  /** Each unblock ask the supervisor raised, by handle: the key it is about. */
  private readonly asked = new Map<string, string>();
  private readonly denied = new Set<string>();
  private cursor = 0;
  private scanning: Promise<void> = Promise.resolve();
  private pumping: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private log: ChildProcess | undefined;
  /** The canary run whose report shows the denial stream is live, and when it last came through. */
  private canary = '';
  private warmAt = 0;
  /** The first warm-up of the denial stream; a sandboxed launch waits for it, opening doesn't. */
  private warming: Promise<unknown> = Promise.resolve();
  private ticking: Promise<void> | undefined;
  private readonly cleaning = new Set<Promise<unknown>>();
  /** Each run between leaving the queue and its launch settling. */
  private readonly launching = new Map<string, Promise<unknown>>();
  private recheckedAt = 0;
  private closed = false;
  private readonly sandbox: SandboxBackend;

  constructor(private readonly options: SupervisorOptions) {
    // The supervisor's own package, whose helper it runs outside any sandbox, is guarded like the caller's paths.
    const guarded = [dirname(dirname(HELPER)), ...(options.guarded ?? [])];
    // Each folder above one is kept from moving, or a run could move it aside and put its own in its place.
    const above = (p: string): string[] => (dirname(p) === p ? [] : [...above(dirname(p)), p]);
    this.sandbox = seatbeltWith('seatbelt', guarded.flatMap((p) => [
      `(deny file-write* (subpath ${quote(real(p))}))`,
      ...above(dirname(real(p))).map((a) => `(deny file-write-unlink (literal ${quote(a)}))`),
    ]));
    for (const kind of options.resources ?? []) {
      this.kinds.set(kind.kind, kind);
      for (const key of kind.keys) this.keys.set(`${kind.kind}:${key}`, {});
    }
  }

  // ---- Records.

  private async append(kind: string, data: Record<string, unknown>, subject?: string): Promise<void> {
    const ts = this.options.now();
    const event: EventInput = { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...(subject ? { subject } : {}) };
    await this.options.record.append(CORE, event);
  }
  private async events(): Promise<Event[]> {
    const all: Event[] = [];
    for (;;) {
      const page = await this.options.record.read({ after: this.cursor, limit: 1000 });
      if (!page.length) return all;
      all.push(...page);
      this.cursor = page[page.length - 1]!.log_pos;
    }
  }
  private async head(): Promise<number> {
    const [row] = (await this.options.record.raw('SELECT max(log_pos) AS head FROM events')) as { head: number | bigint | null }[];
    return Number(row?.head ?? 0);
  }
  private lease(kind: 'lease.acquired' | 'lease.released' | 'lease.stale', run: string, lease: { kind: string; key: string }, expires = this.options.now() + (this.options.lease_ms ?? DAY)): Promise<void> {
    return this.append(kind, { resource: { host: 'local', kind: lease.kind, key: lease.key }, holder: 'core', mode: 'exclusive', expires }, run);
  }
  private async track(r: Run, pid: number, start: string, token: string | null): Promise<void> {
    // A known ID with another start time is a new process of the run's: the one it named is gone.
    if (r.tracked.get(pid)?.start === start) return;
    r.tracked.set(pid, { start, token });
    r.ended.delete(pid);
    await this.append('process.tracked', { run: r.run, pid, start, pgid: r.pgid ?? pid, cwd: r.cwd, token }, r.run);
  }

  // ---- Opening: the record's runs, and what a crash left behind.

  async open(): Promise<void> {
    const left: Run[] = [];
    // Answers are acted on once the whole record is folded, and only those still open then: a replay repeats no step.
    const settled: Event[] = [];
    for (const e of await this.events()) {
      const d = e.data as Record<string, unknown>;
      const run = typeof d.run === 'string' ? d.run : e.subject ?? '';
      const r = this.runs.get(run);
      switch (e.kind) {
        case 'process.starting':
          this.runs.set(run, { run, cwd: String(d.cwd), sandboxed: true, token: null, tracked: new Map(), ended: new Set(), leases: [], state: 'running' });
          break;
        case 'process.tracked':
          if (!r) break;
          if (r.pid === undefined) Object.assign(r, { pid: d.pid, pgid: d.pgid, token: d.token });
          r.tracked.set(d.pid as number, { start: String(d.start), token: (d.token as string | null) ?? null });
          r.ended.delete(d.pid as number);
          break;
        case 'process.ended':
          r?.ended.add(d.pid as number);
          break;
        case 'lease.acquired':
        case 'lease.stale':
        case 'lease.released': {
          const res = d.resource as { kind: string; key: string };
          const name = `${res.kind}:${res.key}`;
          const key = this.keys.get(name) ?? this.keys.set(name, {}).get(name)!;
          if (e.kind === 'lease.acquired') {
            key.holder = run;
            key.expires = d.expires as number;
            r?.leases.push({ kind: res.kind, key: res.key });
          } else if (e.kind === 'lease.stale') {
            key.stale = true;
          } else {
            delete key.holder;
            delete key.expires;
            delete key.stale;
            delete key.dirty;
            delete key.retired;
            // An answer about an earlier spell of this key settles nothing now.
            for (const [handle, of] of this.asked) if (of === name) this.asked.delete(handle);
          }
          break;
        }
        case 'run.cleaned':
          if (!r) break;
          r.state = 'cleaned';
          r.cleaned = { run, outcome: d.outcome as Cleanup['outcome'], left: d.left as string[], stopped: d.stopped as number[] };
          for (const name of d.left as string[]) {
            const key = this.keys.get(name);
            if (key?.holder === run) key.dirty = { run };
          }
          break;
        case 'ask.created':
          if (d.kind === 'unblock' && typeof (d as { proves?: unknown }).proves === 'string') {
            const name = /^cleanup check of (.+)$/.exec(String(d.proves))?.[1];
            const key = name ? this.keys.get(name) : undefined;
            if (key?.dirty) { key.dirty.ask = `ask:${e.id}`; this.asked.set(`ask:${e.id}`, name!); }
          }
          break;
        case 'ask.answered':
        case 'ask.defaulted':
          if (e.subject && this.asked.has(e.subject)) settled.push(e);
          break;
        case 'ask.superseded':
        case 'ask.moot':
        case 'ask.cancelled':
          if (e.subject && this.asked.has(e.subject)) this.dropAsk(e.subject);
          break;
      }
    }
    for (const e of settled) if (this.asked.has(e.subject!)) await this.settleAsk(e);
    for (const r of this.runs.values()) if (r.state !== 'cleaned') left.push(r);
    // A run left in flight by a crash: its leftovers are reaped, from the record and its sandbox's marker.
    for (const r of left) {
      r.state = 'exited';
      await this.cleanup(r.run);
    }
    if (process.platform === 'darwin' && this.options.plant !== 'sandbox-left-to-caller') this.watchDenials();
    this.timer = setInterval(() => void this.scanOnce().catch(() => undefined), SCAN_MS);
    this.timer.unref();
  }

  /**
   * The system log's sandbox reports that carry a run's tag: each a sandbox.denied for that run. The stream
   * announces its filter before it is attached, and after a while idle macOS drops the first reports of a program
   * that isn't Apple's, so it counts as ready only once it has seen a denial of its own: the helper, refused a
   * write in a canary's sandbox, until its report comes through.
   */
  private watchDenials(): void {
    const log = spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--predicate', 'sender == "Sandbox" AND eventMessage CONTAINS "dev.deepbuild.run:"'], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.log = log;
    log.unref();
    (log.stdout as unknown as { unref?: () => void }).unref?.();
    let buffer = '';
    log.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let message = '';
        try { message = String((JSON.parse(line) as { eventMessage?: unknown }).eventMessage ?? ''); } catch { continue; }
        const m = /deny\(\d+\) (\S+) (.*?)\s*\ndev\.deepbuild\.(run:[0-9A-Za-z]+)/.exec(message);
        if (m) this.warmAt = Date.now();
        if (!m || !this.runs.has(m[3]!)) continue;
        const [, operation, target, run] = m as unknown as [string, string, string, string];
        const seen = `${run} ${operation} ${target}`;
        if (this.denied.has(seen)) continue;
        this.denied.add(seen);
        void this.append('sandbox.denied', { run, operation, target: target || '(none)' }, run).catch(() => undefined);
      }
    });
    this.warming = this.warm(10_000).then((live) => {
      if (!live) process.stderr.write('deep supervisor: the system log never showed a sandbox report, so denials go unrecorded\n');
    });
  }

  /** Until the stream shows a canary's report, or `ms` pass; whether it did. */
  private async warm(ms: number): Promise<boolean> {
    const since = Date.now();
    this.canary = `run:canary${randomBytes(8).toString('hex')}`;
    const profile = `(version 1)\n(deny default (with message "dev.deepbuild.${this.canary}"))\n(import "system.sb")\n(allow file-read* process-exec)`;
    // Each try refused on a path of its own: the kernel folds identical reports into one, later.
    for (let n = 0; this.warmAt < since && this.log?.exitCode === null && Date.now() < since + ms; n++) {
      const target = `/tmp/deep-canary-${this.canary.slice(4)}-${n}`;
      await new Promise((done) => spawn('/usr/bin/sandbox-exec', ['-p', profile, HELPER, 'probe', '/dev/null', 'write', target], { stdio: 'ignore' }).on('close', done).on('error', done));
      for (let i = 0; i < 10 && this.warmAt < since; i++) await sleep(25);
    }
    return this.warmAt >= since;
  }

  // ---- host@1.

  async facts(): Promise<HostFacts> {
    return { host: 'local', platform: process.platform, arch: process.arch, cores: availableParallelism(), memory: totalmem() };
  }

  start(spec: StartSpec): Promise<Started> {
    if (!RUN.test(spec.run)) return Promise.reject(Error(`a run is named run:<id>, not ${spec.run}`));
    if (this.runs.has(spec.run) || this.waiters.some((w) => w.spec.run === spec.run)) return Promise.reject(Error(`${spec.run} has already started`));
    return new Promise((resolve) => {
      this.waiters.push({ spec, on: [], resolve });
      // A failed pass leaves the waiter for the next one.
      this.pump().catch(() => undefined);
    });
  }

  /** Starts every held run whose leases are free now, and blocks each one a kind it needs has run out of; one pass at a time. */
  private pump(): Promise<void> {
    const next = this.pumping.then(() => this.pumpOnce());
    this.pumping = next.catch(() => undefined);
    return next;
  }
  private async pumpOnce(): Promise<void> {
    if (this.closed) return;
    for (const waiter of [...this.waiters]) {
      // Given up on while this pass waited on a raise.
      if (!this.waiters.includes(waiter)) continue;
      const wants = await this.choose(waiter.spec);
      // Given up on, or the supervisor closed, while its kinds checked their keys.
      if (this.closed || !this.waiters.includes(waiter)) continue;
      if (wants.kind === 'wait') {
        const first = !this.runs.has(waiter.spec.run);
        waiter.on = wants.on;
        if (first) this.runs.set(waiter.spec.run, { run: waiter.spec.run, cwd: waiter.spec.cwd, sandboxed: true, token: null, tracked: new Map(), ended: new Set(), leases: [], state: 'held' });
        // A failed raise is retried on the next pass; the other waiters go on.
        for (const name of wants.on) await this.ask(name, waiter.spec.run).catch(() => undefined);
        continue;
      }
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      if (wants.kind === 'blocked') {
        this.runs.set(waiter.spec.run, { run: waiter.spec.run, cwd: waiter.spec.cwd, sandboxed: true, token: null, tracked: new Map(), ended: new Set(), leases: [], state: 'BLOCKED' });
        waiter.resolve({ run: waiter.spec.run, status: 'BLOCKED', cause: 'resource', kind: wants.on });
        continue;
      }
      const expires = this.options.now() + (this.options.lease_ms ?? DAY);
      for (const lease of wants.leases) this.keys.set(`${lease.kind}:${lease.key}`, { holder: waiter.spec.run, expires });
      const launched = this.launch(waiter.spec, wants.leases);
      this.launching.set(waiter.spec.run, launched);
      void launched.catch(() => undefined).finally(() => this.launching.delete(waiter.spec.run));
      waiter.resolve(launched.catch(async (error: unknown) => {
        const r = this.runs.get(waiter.spec.run);
        if (r?.child || r?.state === 'running') {
          // Refused after its start was recorded: its cleanup closes the records and gives its keys back.
          await this.cleanup(r.run).catch(() => undefined);
        } else {
          // Refused before anything was recorded or held.
          for (const lease of wants.leases) this.keys.set(`${lease.kind}:${lease.key}`, {});
          this.runs.delete(waiter.spec.run);
          this.pump().catch(() => undefined);
        }
        throw error;
      }));
    }
  }

  private async choose(spec: StartSpec): Promise<{ kind: 'ok'; leases: { kind: string; key: string }[] } | { kind: 'wait'; on: string[] } | { kind: 'blocked'; on: string }> {
    const leases: { kind: string; key: string }[] = [];
    const on: string[] = [];
    for (const want of spec.leases ?? []) {
      const pool = [...this.keys.entries()].filter(([name]) => name.startsWith(`${want.kind}:`)).map(([name, key]) => ({ key: name.slice(want.kind.length + 1), state: key }));
      const candidates = want.key === undefined ? pool : pool.filter((p) => p.key === want.key);
      if (want.key !== undefined && !candidates.length && !this.kinds.has(want.kind)) candidates.push({ key: want.key, state: {} });
      const usable = candidates.filter((c) => !c.state.retired && !leases.some((l) => l.kind === want.kind && l.key === c.key));
      if (!usable.length) return { kind: 'blocked', on: want.kind };
      // A key nobody here holds is asked of its kind too: one something outside DeepBuild holds is skipped.
      const check = this.kinds.get(want.kind)?.free;
      let free: (typeof usable)[number] | undefined;
      let outside = 0;
      for (const c of usable) {
        if (c.state.holder || c.state.dirty) continue;
        if (!check || (await check(c.key).catch(() => false))) { free = c; break; }
        outside++;
      }
      if (free) leases.push({ kind: want.kind, key: free.key });
      else if (outside === usable.length) return { kind: 'blocked', on: want.kind };
      else on.push(...usable.map((c) => `${want.kind}:${c.key}`));
    }
    return on.length ? { kind: 'wait', on } : { kind: 'ok', leases };
  }

  /** One unblock ask per key a cleanup left dirty, raised when a run first waits on it. */
  private async ask(name: string, waiting: string): Promise<void> {
    const key = this.keys.get(name);
    if (!key?.dirty || key.dirty.ask || this.options.plant === 'hold-without-ask') return;
    const kind = this.kinds.get(name.slice(0, name.indexOf(':')));
    const now = this.options.now();
    key.dirty.ask = 'raising';
    // The first open ask reads the record from here on: what came before can't answer it.
    if (!this.asked.size) this.cursor = await this.head();
    const handle = await this.options.asks.raise(CORE, UNBLOCK_SOURCE, {
      kind: 'unblock',
      question: `${key.dirty.run}'s cleanup couldn't release ${name}. Release it yourself?`,
      options: [{ id: 'done', label: 'I did it', decision: 'none' }, { id: 'retire', label: `Take ${name} out of its pool`, decision: 'none' }],
      recommended: 'done', deadline: now + this.options.settings.asks.unblock.deadline_ms, fallback: 'you', default: 'retire', provisional: false,
      owner: 'you', key: sha256(`${UNBLOCK_SOURCE} ${name} ${key.dirty.run}`), pinned_to: { kind: 'evidence', ref: sha256(`${key.dirty.run} left ${name}`) },
      steps: [`Release ${name} where it is held${kind?.release ? `, as ${kind.release.argv.join(' ')} tried to` : ''}`, 'Answer "I did it": the cleanup check runs again'],
      where: 'outside DeepBuild', why: `${waiting} needs ${name.slice(0, name.indexOf(':'))}, and ${name} is still bound`, unblocks: [waiting], proves: `cleanup check of ${name}`,
    }).catch((error: unknown) => {
      // Raised again the next time a run waits on it.
      delete key.dirty?.ask;
      throw error;
    });
    key.dirty.ask = handle;
    this.asked.set(handle, name);
  }

  private async launch(spec: StartSpec, leases: { kind: string; key: string }[]): Promise<Started> {
    if (process.platform !== 'darwin') throw Error(`no platform sandbox backend for ${process.platform} yet (#70); nothing runs outside one`);
    const cwd = real(spec.cwd);
    const sandboxed = this.options.plant !== 'sandbox-left-to-caller';
    const token = spec.env?.DEEP_RUN_TOKEN ?? randomBytes(24).toString('base64url');
    // Each lease's key in the variable it names; the leases come in the order they were asked for.
    const keys = Object.fromEntries((spec.leases ?? []).flatMap((want, i) => (want.env ? [[want.env, leases[i]!.key]] : [])));
    const env = { ...process.env, ...spec.env, ...keys, DEEP_RUN_TOKEN: token } as Record<string, string>;
    // A leased port is one it may listen on, and connect to.
    const ports = leases.filter((l) => this.kinds.get(l.kind)?.port).map((l) => `127.0.0.1:${l.key}`);
    const grant: Grant = ports.length
      ? { ...spec.grant, listen: [...(spec.grant?.listen ?? []), ...ports], hosts: [...(spec.grant?.hosts ?? []), ...ports] }
      : spec.grant ?? {};
    // The profile first: a grant the sandbox can't enforce refuses the start before anything is held or recorded.
    const launch = sandboxed ? await this.sandbox.confine({ argv: spec.argv, cwd, env }, grant, spec.run) : { argv: spec.argv, cwd, env };
    // After a minute with no report, the stream is shown live again before a process can be refused anything.
    if (sandboxed) await this.warming;
    if (sandboxed && this.log && Date.now() - this.warmAt > WARM_MS) await this.warm(2000);
    const r: Run = { run: spec.run, cwd, sandboxed, token: sha256(token), tracked: new Map(), ended: new Set(), leases, state: 'running' };
    this.runs.set(spec.run, r);
    // The run first, so a replay finds its leases on it.
    await this.append('process.starting', { run: spec.run, cwd }, spec.run);
    for (const lease of leases) await this.lease('lease.acquired', spec.run, lease, this.keys.get(`${lease.kind}:${lease.key}`)?.expires);
    if (this.options.crash === 'start-recorded') process.kill(process.pid, 'SIGKILL');
    const child = spawn(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    r.child = child;
    const hashes = { stdout: sha256Stream(), stderr: sha256Stream() };
    child.stdout!.on('data', (chunk: Buffer) => { hashes.stdout.update(chunk); spec.output?.stdout(chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { hashes.stderr.update(chunk); spec.output?.stderr(chunk); });
    child.on('exit', () => {
      if (r.state === 'running') r.state = 'exited';
      // A background process still holding its output doesn't keep the run open: what came by now is its output.
      // Closed after the loop's next read of the pipes, so a stalled loop doesn't cut what was already written.
      setTimeout(() => setImmediate(() => { child.stdout?.destroy(); child.stderr?.destroy(); }), DRAIN_MS).unref();
    });
    r.exit = new Promise((resolve) => {
      child.on('error', () => resolve({ run: spec.run, code: null, signal: null, evidence: { stdout: hashes.stdout.digest(), stderr: hashes.stderr.digest() } }));
      child.on('close', (code, signal) => resolve({ run: spec.run, code, signal, evidence: { stdout: hashes.stdout.digest(), stderr: hashes.stderr.digest() } }));
    });
    const pid = child.pid;
    if (pid === undefined) {
      r.state = 'exited';
      return { run: spec.run, status: 'started', pid: 0, pgid: 0, start: '', leases };
    }
    if (this.options.crash === 'spawned') process.kill(process.pid, 'SIGKILL');
    r.pid = pid;
    r.pgid = pid;
    // A process that is already gone and reaped leaves nothing to track; its group's members are still found.
    const start = (await table([pid])).get(pid)?.start ?? '';
    if (start) await this.track(r, pid, start, r.token);
    return { run: spec.run, status: 'started', pid, pgid: pid, start, leases };
  }

  /** Records each process a live run's sandbox holds that it hasn't recorded yet, by ID and start time. */
  private scanOnce(): Promise<void> {
    if (this.options.plant === 'records-only-started' || this.closed) return this.scanning;
    const next = this.scanning.then(async () => {
      const live = [...this.runs.values()].filter((r) => r.sandboxed && r.state !== 'cleaned' && r.state !== 'BLOCKED' && r.state !== 'held');
      if (!live.length) return;
      const found = await scan(live.map((r) => markerOf(r.run)));
      const held = live.flatMap((r) => (found.get(markerOf(r.run)) ?? []).map((pid) => ({ r, pid })));
      if (!held.length) return;
      // By ID and start time: an ID the run used before may name a new process of its own.
      const procs = await table(held.map((f) => f.pid));
      for (const { r, pid } of held) {
        const p = procs.get(pid);
        if (p && r.tracked.get(pid)?.start !== p.start) await this.track(r, pid, p.start, (await tokenOf(pid)) ?? null);
      }
    });
    this.scanning = next.catch(() => undefined);
    return next;
  }

  /** What the run owns that it can prove now: each tracked process by its start time (and token), and its group's members. */
  private async provable(r: Run): Promise<Proc[]> {
    const procs = await table();
    const candidates = new Map<number, Proc>();
    for (const [pid] of r.tracked) { const p = procs.get(pid); if (p) candidates.set(pid, p); }
    // Its group counts only while the leader it started is alive: a leaderless group's ID may since name another's.
    const leader = r.pgid === undefined ? undefined : procs.get(r.pgid);
    const groupOurs = leader !== undefined && r.tracked.get(leader.pid)?.start === leader.start;
    if (groupOurs) for (const p of procs.values()) if (p.pgid === r.pgid) candidates.set(p.pid, p);
    const proven: Proc[] = [];
    for (const p of candidates.values()) {
      const tracked = r.tracked.get(p.pid);
      if (tracked && tracked.start !== p.start) continue; // the ID now names another process: the tracked one is gone
      const token = await tokenOf(p.pid);
      let ok: boolean;
      switch (this.options.plant) {
        case 'stops-token-bearing-group-members': ok = p.pgid === r.pgid && token === r.token; break;
        case 'requires-token-in-group': ok = token === r.token; break;
        default: ok = !tracked?.token || token === tracked.token;
      }
      if (ok) proven.push(p);
    }
    return proven;
  }

  async signal(run: string, signal: NodeJS.Signals): Promise<void> {
    const r = this.runs.get(run);
    if (!r) throw Error(`${run} is no run of this supervisor`);
    const proven = await this.provable(r);
    // Its process group at once, as the group's own members see a group signal; then each proven process outside it.
    if (r.pgid !== undefined && proven.some((p) => p.pgid === r.pgid)) try { process.kill(-r.pgid, signal); } catch { /* gone */ }
    for (const p of proven) if (p.pgid !== r.pgid) try { process.kill(p.pid, signal); } catch { /* gone */ }
  }

  wait(run: string): Promise<Exit> {
    const r = this.runs.get(run);
    if (!r?.exit) return Promise.reject(Error(`${run} has no process of this supervisor's to wait for`));
    return r.exit;
  }

  async status(run: string): Promise<RunStatus> {
    const r = this.runs.get(run);
    if (!r) throw Error(`${run} is no run of this supervisor`);
    const waiter = this.waiters.find((w) => w.spec.run === run);
    return { run, state: r.state, ...(waiter ? { on: waiter.on } : {}) };
  }

  cleanup(run: string): Promise<Cleanup> {
    // A run on its way out of the queue is cleaned once its launch settles.
    const launching = this.launching.get(run);
    if (launching) return launching.catch(() => undefined).then(() => this.cleanup(run));
    const r = this.runs.get(run);
    if (!r) {
      // A start still in its first pass, given up on before it was held: it never starts.
      const waiter = this.waiters.find((w) => w.spec.run === run);
      if (!waiter) return Promise.reject(Error(`${run} is no run of this supervisor`));
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      this.runs.set(run, { run, cwd: waiter.spec.cwd, sandboxed: true, token: null, tracked: new Map(), ended: new Set(), leases: [], state: 'BLOCKED' });
      waiter.resolve({ run, status: 'BLOCKED', cause: 'resource', kind: waiter.spec.leases?.[0]?.kind ?? '' });
      return Promise.resolve({ run, outcome: 'clean', left: [], stopped: [] });
    }
    // A run that never started has nothing to stop or release, and nothing to record.
    if (r.state === 'held' || r.state === 'BLOCKED') {
      // A held run given up on never starts: its start resolves BLOCKED on what it waited for.
      const waiter = this.waiters.find((w) => w.spec.run === run);
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        const on = waiter.on[0] ?? '';
        waiter.resolve({ run, status: 'BLOCKED', cause: 'resource', kind: on.slice(0, on.indexOf(':')) });
        r.state = 'BLOCKED';
      }
      return Promise.resolve({ run, outcome: 'clean', left: [], stopped: [] });
    }
    if (r.cleaning) return r.cleaning;
    const cleaning = (r.cleaning = this.cleanupOnce(r));
    this.cleaning.add(cleaning);
    void cleaning.finally(() => this.cleaning.delete(cleaning)).catch(() => undefined);
    return cleaning;
  }
  private async cleanupOnce(r: Run): Promise<Cleanup> {
    const run = r.run;
    if (r.cleaned) return r.cleaned;
    const stopped = new Set<number>();
    // Until a scan finds nothing of the run's left to stop: a process forked while the others stop is found too.
    for (const signal of ['SIGTERM', 'SIGKILL', 'SIGKILL', 'SIGKILL'] as const) {
      await this.scanOnce().catch(() => undefined);
      const proven = await this.provable(r);
      if (!proven.length) break;
      for (const p of proven) {
        await this.track(r, p.pid, p.start, (await tokenOf(p.pid)) ?? null);
        try { process.kill(p.pid, signal); stopped.add(p.pid); } catch { /* gone */ }
      }
      const until = Date.now() + GRACE_MS;
      while (proven.some((p) => alive(p.pid)) && Date.now() < until) await sleep(20);
    }
    await this.scanOnce().catch(() => undefined);
    const left = (await this.leftovers(r)).map((pid) => `pid:${pid}`);
    // The leases end only once every process recorded for the run is gone; a key its check finds bound is left,
    // and so is every key while a process is, each one held for the unblock ask.
    if (left.length) {
      for (const lease of r.leases) {
        const name = `${lease.kind}:${lease.key}`;
        this.keys.set(name, { holder: run, dirty: { run } });
        left.push(name);
      }
    } else {
      // Every key is given back and checked first: one its check finds unclean holds all of the run's, since what
      // holds one (a container on its port, say) may hold the others.
      const unclean: string[] = [];
      for (const lease of r.leases) {
        const name = `${lease.kind}:${lease.key}`;
        const kind = this.kinds.get(lease.kind);
        if (kind?.release) await this.step(kind.release, lease.key);
        // The planted wrong program holds the lease while anything at all still takes the key, recorded or not.
        const taken = this.options.plant === 'holds-lease-while-taken' && kind?.free && !(await kind.free(lease.key).catch(() => false));
        if (taken || (kind?.check && !(await this.step(kind.check, lease.key)))) unclean.push(name);
      }
      for (const lease of r.leases) {
        const name = `${lease.kind}:${lease.key}`;
        if (unclean.length) {
          this.keys.set(name, { holder: run, dirty: { run } });
          left.push(name);
          continue;
        }
        await this.lease('lease.released', run, lease);
        this.keys.set(name, {});
      }
    }
    const outcome = left.length ? 'unfinished' : 'clean';
    await this.append('run.cleaned', { run, outcome, left, stopped: [...stopped] }, run);
    r.state = 'cleaned';
    r.cleaned = { run, outcome, left, stopped: [...stopped] };
    await this.pump();
    return r.cleaned;
  }

  /** A resource's cleanup step or check, in the platform sandbox with its folder writable; true when it exits 0. */
  private async step(step: ResourceStep, key: string): Promise<boolean> {
    const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...step.env, DEEP_RESOURCE_KEY: key };
    const launch = await this.sandbox.confine({ argv: step.argv, cwd: step.cwd, env }, { ...step.grant, write: [step.cwd, ...(step.grant?.write ?? [])] });
    return new Promise((resolve) => {
      const child = spawn(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, stdio: 'ignore', detached: true });
      const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, 60_000);
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    });
  }

  /** One tick at a time: a tick asked for while one runs is that one. */
  tick(): Promise<void> {
    this.ticking ??= this.tickOnce().finally(() => { this.ticking = undefined; });
    return this.ticking;
  }
  /** Each tracked process proven gone gets its end recorded; the ones still running with their start times are returned. */
  private async leftovers(r: Run): Promise<number[]> {
    const procs = await table([...r.tracked.keys()]);
    const left: number[] = [];
    for (const [pid, t] of r.tracked) {
      if (r.ended.has(pid)) continue;
      if (procs.get(pid)?.start === t.start) { left.push(pid); continue; }
      r.ended.add(pid);
      await this.append('process.ended', { run: r.run, pid }, r.run);
    }
    return left;
  }

  private async tickOnce(): Promise<void> {
    // A lease past its term whose holder still runs is only stale: marked once, still its holder's.
    for (const [name, key] of this.keys) {
      if (!key.holder || key.stale || key.dirty || key.expires === undefined || this.options.now() <= key.expires) continue;
      key.stale = true;
      await this.lease('lease.stale', key.holder, { kind: name.slice(0, name.indexOf(':')), key: name.slice(name.indexOf(':') + 1) }, key.expires);
    }
    // Nothing to read for until an unblock ask is open, a key is out of its pool or a run waits: a tick then costs nothing.
    if (!this.asked.size && !this.waiters.length && ![...this.keys.values()].some((k) => k.retired)) return;
    if (this.asked.size) await this.options.asks.tick();
    for (const e of this.asked.size ? await this.events() : []) {
      if (!e.subject || !this.asked.has(e.subject)) continue;
      if (e.kind === 'ask.answered' || e.kind === 'ask.defaulted') await this.settleAsk(e);
      else if (e.kind === 'ask.superseded' || e.kind === 'ask.moot' || e.kind === 'ask.cancelled') this.dropAsk(e.subject);
    }
    // A key out of its pool comes back once a later cleanup check finds it clean, checked once a minute.
    const recheck = Date.now() - this.recheckedAt >= RECHECK_MS;
    if (recheck) this.recheckedAt = Date.now();
    for (const [name, key] of recheck ? this.keys : []) {
      const kind = this.kinds.get(name.slice(0, name.indexOf(':')));
      if (key.retired && (await this.released(name)) && (!kind?.check || (await this.step(kind.check, name.slice(kind.kind.length + 1))))) await this.free(name);
    }
    await this.pump();
  }

  /** An unblock ask closed: "I did it" runs the cleanup check again; the default, or a check still failing, takes the key out of its pool. */
  private async settleAsk(e: Event): Promise<void> {
    const name = this.asked.get(e.subject!)!;
    this.asked.delete(e.subject!);
    const key = this.keys.get(name);
    if (!key?.dirty) return;
    const kind = this.kinds.get(name.slice(0, name.indexOf(':')));
    const { answer, verified } = e.data as { answer?: unknown; verified?: unknown };
    const done = e.kind === 'ask.answered' && answer === 'done' && verified !== false;
    if (done && (await this.released(name)) && (!kind?.check || (await this.step(kind.check, name.slice(kind.kind.length + 1))))) await this.free(name);
    else key.retired = true;
  }
  /** Whether every process the run that left `name` dirty is recorded with is gone. */
  private async released(name: string): Promise<boolean> {
    const r = this.runs.get(this.keys.get(name)?.dirty?.run ?? '');
    return !r || !(await this.leftovers(r)).length;
  }
  /** An unblock ask closed with no answer to act on: the next run that waits on its key raises it again. */
  private dropAsk(handle: string): void {
    const key = this.keys.get(this.asked.get(handle)!);
    this.asked.delete(handle);
    if (key?.dirty?.ask === handle) delete key.dirty.ask;
  }
  private async free(name: string): Promise<void> {
    const key = this.keys.get(name)!;
    const holder = key.dirty?.run ?? key.holder;
    if (holder) await this.lease('lease.released', holder, { kind: name.slice(0, name.indexOf(':')), key: name.slice(name.indexOf(':') + 1) });
    this.keys.set(name, {});
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([this.scanning, this.pumping, this.ticking, ...this.cleaning]);
    if (this.log?.pid) try { process.kill(this.log.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}

/** An incremental SHA-256 whose digest can be read, once, when its stream ends. */
function sha256Stream(): { update(chunk: Buffer): void; digest(): string } {
  const hash = createHash('sha256');
  let digest: string | undefined;
  return { update: (chunk) => { hash.update(chunk); }, digest: () => (digest ??= hash.digest('hex')) };
}

/** Opens the supervisor on the record; before it resolves it reaps what the record says a crashed hub left behind. */
export async function openSupervisor(options: SupervisorOptions): Promise<Supervisor> {
  const supervisor = new LocalSupervisor(options);
  await supervisor.open();
  return supervisor;
}
