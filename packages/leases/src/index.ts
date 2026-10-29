// @deepbuild/leases (#237): the kernel's one lease table. Every lease, for a port, an account, a screen, a GPU, a
// path or a document ID, is granted or refused here, through `deep.lease(resource, mode)`; env-local, the gate
// runner, parallel sessions, document patches and hosts all lease through it. Resource kinds are `lease.kind@1`
// data: the core declares its own and any plug-in adds one, and the match forms are closed, so the kernel computes
// overlap from them alone.
//
// Its state is a function of the record: each call first reads what the log gained, then decides on what it read
// and appends, with no await between that decision and the append (design: Budget). Past its expiry a lease is only
// stale. It ends when its holder has ended (its SessionEnd, or its agent's process gone by ID and start time) and
// every process the supervisor recorded for its run is proven gone, and the release cites those events.
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { validate } from '@deepbuild/contracts';
import { ulid, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';

/** lease.kind@1: a resource kind, as data a plug-in's manifest (or the core) declares. */
export interface LeaseKind {
  name: string;
  /** Closed: 'exact' | 'glob' | 'prefix' | 'pool(<n>)'. */
  match: string;
  /** At most this many of the kind's leases held at once on a host; a request past it is BLOCKED. */
  cap: number;
  /** Milliseconds after a key's lease ended before that key is leased again. */
  cooldown: number;
  cost: number;
}
export interface DeclaredKind extends LeaseKind { plugin: string }
/** `host` is 'local' in R1; leases on two hosts never overlap. */
export interface Resource { host: string; kind: string; key: string }
export type Mode = 'exclusive' | 'shared';
export interface Lease { id: string; resource: Resource; holder: string; mode: Mode; expires: number }
/** Who asks: in the hub, `deep.lease(resource, mode)` fills this from the caller's connection and session. */
export interface Caller {
  holder: string;
  /** The run whose recorded processes hold the lease open until the supervisor proves them gone. */
  run?: string;
  /** The holder session's agent process, by ID and start time (`ps -o lstart=` under LC_ALL=C). */
  agent?: { pid: number; start: string };
}
export type LeaseResult =
  | { status: 'granted'; lease: Lease }
  | { status: 'refused'; reason: 'held' | 'pool' | 'cooldown' | 'taken'; holders: Lease[]; message: string }
  | { status: 'BLOCKED'; reason: 'cap'; holders: Lease[]; message: string };
/** A lease held now. `reading` is set while stale, and names each process recorded for it that still runs. */
export interface LeaseView { lease: Lease; state: 'held' | 'stale'; reading?: string }

export type Overlap = (form: 'glob' | 'prefix', a: string, b: string) => boolean;

/** The planted wrong programs the acceptance tests select; tests only. */
export type Plant =
  | 'ignores-mode' | 'pool-as-exact-key' | 'pool-ignores-n' | 'any-match-form' | 'redeclare-replaces' | 'fixed-kinds'
  | 'releases-at-expiry' | 'ignores-cooldown' | 'ignores-cap' | 'checks-held-mode-only' | 'await-before-append'
  | 'pid-only-liveness' | 'host-blind' | 'pool-across-hosts';
export interface LeasesOptions {
  /** Grants, stale marks and releases are appended here as `core`; holders' ends and the supervisor's proofs are read from it. */
  record: RecordStore;
  /** The clock of grants, expiries and cooldowns. */
  now: () => number;
  /** The cores `cpu.slot` is half of, on each host; this machine's unless given. */
  cores?: number;
  /** How long a lease is granted for; past it, a lease whose holder still runs is only stale. A day unless a test sets it. */
  lease_ms?: number;
  plant?: Plant;
}
export interface LeaseTable {
  /** Declares a kind; refuses, naming it, a match form outside the closed four, and a name another plug-in holds. */
  declare(plugin: string, kind: LeaseKind, free?: (key: string) => Promise<boolean>): Promise<void>;
  kinds(): Promise<DeclaredKind[]>;
  /** One grant or refusal, decided on the log state it read, with no await between that decision and its append. */
  lease(caller: Caller, resource: Resource, mode: Mode): Promise<LeaseResult>;
  /** Marks leases past their expiry stale, and ends each whose holder has ended and whose processes are proven gone. */
  tick(): Promise<void>;
  /**
   * Ends a lease whose holder is no session, citing the events that prove it over: the supervisor's, for a run, once
   * every process recorded for the run is proven gone. A session's lease ends only on the table's own tick, unless it
   * was taken for one run (the gate runner's `cpu.slot`, #29): that one ends with its run, once no process recorded
   * for the run still runs.
   */
  release(lease: string, proof: string[]): Promise<void>;
  leases(): Promise<LeaseView[]>;
}

// ---- Overlap: one kernel function over the two match forms, symmetric by construction.

/** ID prefixes are `.`-separated parts: whether b's parts start a's. Two overlap when either starts the other. */
const prefixes = (a: string[], b: string[]): boolean => b.length <= a.length && b.every((part, i) => part === a[i]);
/**
 * Path globs are `/`-separated, each segment a name, `*` (one segment) or `**` (zero or more): two overlap when
 * some path matches both. A walk over both globs at once, each step either `**` matching nothing or one segment
 * both can match.
 */
function globs(a: string[], b: string[]): boolean {
  const memo = new Map<number, boolean>();
  const walk = (i: number, j: number): boolean => {
    const at = i * (b.length + 1) + j;
    let shared = memo.get(at);
    if (shared !== undefined) return shared;
    const [x, y] = [a[i], b[j]];
    shared = (i === a.length && j === b.length)
      || (x === '**' && walk(i + 1, j))
      || (y === '**' && walk(i, j + 1))
      || (x !== undefined && y !== undefined && !(x === '**' && y === '**') && (x === y || x === '*' || x === '**' || y === '*' || y === '**')
        && walk(x === '**' ? i : i + 1, y === '**' ? j : j + 1));
    memo.set(at, shared);
    return shared;
  };
  return walk(0, 0);
}
export const overlap: Overlap = (form, a, b) => (form === 'prefix'
  ? prefixes(a.split('.'), b.split('.')) || prefixes(b.split('.'), a.split('.'))
  : globs(a.split('/'), b.split('/')));
/** The planted wrong program of AC11; tests only: tests A against B but not B against A. */
export const plantedOverlap: { 'one-way': Overlap } = {
  'one-way': (form, a, b) => (form === 'prefix' ? prefixes(a.split('.'), b.split('.')) : globs(a.split('/'), b.split('/'))),
};

// ---- The table.

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** How long a lease is granted for; past it, a lease whose holder still runs is only stale. */
const DAY = 86_400_000;
const FORM = /^(?:exact|glob|prefix|pool\(([1-9][0-9]*)\))$/;
/** The kinds a table with a fixed list of resources leases: the planted wrong program of AC4. */
const FIXED = ['port', 'cpu.slot'];
/** The kinds the table's state is folded from. */
const FOLDED = ['lease.acquired', 'lease.stale', 'lease.released', 'session.end', 'session.gone', 'process.tracked', 'process.ended'];

interface Kind extends DeclaredKind { n?: number; free?: (key: string) => Promise<boolean> }
interface Held { lease: Lease; run?: string; agent?: { pid: number; start: string }; stale: boolean }
const keyOf = (r: Resource): string => JSON.stringify([r.host, r.kind, r.key]);
const names = (leases: Lease[]): string => leases.map((l) => `${l.holder} (${l.id}, ${l.mode})`).join(', ');

/** A process's start time as `ps -o lstart=` prints it under LC_ALL=C, or undefined when no process has the ID. */
const startOf = (pid: number): Promise<string | undefined> => new Promise((resolve) => {
  execFile('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (_, stdout) => resolve(stdout.trim() || undefined));
});

class Table implements LeaseTable {
  private readonly kindsByName = new Map<string, Kind>();
  private readonly held = new Map<string, Held>();
  /** When each key's last lease ended, for its kind's cooldown. */
  private readonly endedAt = new Map<string, number>();
  /** Each holder that has ended: the event that says so. */
  private readonly ends = new Map<string, string>();
  /** Each run's recorded processes: by ID, the process.ended that proves it gone, once there is one. */
  private readonly procs = new Map<string, Map<number, string | undefined>>();
  private cursor = 0;
  private reading: Promise<void> = Promise.resolve();

  constructor(private readonly options: LeasesOptions) {}

  private get plant(): Plant | undefined { return this.options.plant; }

  private async append(kind: string, v: number, subject: string, data: Record<string, unknown>, ts = this.options.now(), id = ulid(ts)): Promise<void> {
    const event: EventInput = { v, id, kind, subject, ts, data: data as EventInput['data'] };
    await this.options.record.append(CORE, event);
  }

  /**
   * Folds what the log gained since the last read, only the kinds the table reads, so a hub's busy log costs it a
   * scan and never a decode; reads run one after another. The cursor moves to the head read first: what lands
   * after it is read next time.
   */
  sync(): Promise<void> {
    const next = this.reading.then(async () => {
      const [row] = (await this.options.record.raw('SELECT max(log_pos) AS head FROM events')) as { head: number | bigint | null }[];
      const head = Number(row?.head ?? 0);
      for (;;) {
        const page = await this.options.record.read({ after: this.cursor, limit: 1000, kinds: FOLDED });
        for (const e of page) this.fold(e);
        if (page.length) this.cursor = page[page.length - 1]!.log_pos;
        if (page.length < 1000) break;
      }
      this.cursor = Math.max(this.cursor, head);
    });
    this.reading = next.catch(() => undefined);
    return next;
  }
  private fold(e: Event): void {
    const d = e.data as Record<string, unknown>;
    const resource = d.resource as Resource | undefined;
    // A lease another writer recorded (the supervisor's, for a run) is named by its event; the table's own by its subject,
    // and only by it: one already ended here never stands for another its holder holds on the same key.
    const find = (): Held | undefined => (e.subject?.startsWith('lease:') ? this.held.get(e.subject)
      : [...this.held.values()].find((h) => keyOf(h.lease.resource) === keyOf(resource!) && h.lease.holder === d.holder));
    switch (e.kind) {
      case 'lease.acquired': {
        const id = e.subject?.startsWith('lease:') ? e.subject : `lease:${e.id}`;
        if (this.held.has(id)) break;
        const run = (d.run as string | undefined) ?? (e.subject?.startsWith('run:') ? e.subject : undefined);
        const lease: Lease = { id, resource: { ...resource! }, holder: d.holder as string, mode: d.mode as Mode, expires: d.expires as number };
        this.held.set(id, { lease, ...(run ? { run } : {}), ...(d.agent ? { agent: d.agent as { pid: number; start: string } } : {}), stale: false });
        break;
      }
      case 'lease.stale': {
        const h = find();
        if (h) h.stale = true;
        break;
      }
      case 'lease.released': {
        const h = find();
        if (h) this.held.delete(h.lease.id);
        this.endedAt.set(keyOf(resource!), e.ts);
        break;
      }
      case 'session.end':
      case 'session.gone': {
        const holder = e.subject?.startsWith('session:') ? e.subject : e.session ? `session:${e.session}` : undefined;
        if (holder && !this.ends.has(holder)) this.ends.set(holder, e.id);
        break;
      }
      case 'process.tracked':
      case 'process.ended': {
        const run = d.run as string;
        const procs = this.procs.get(run) ?? this.procs.set(run, new Map()).get(run)!;
        procs.set(d.pid as number, e.kind === 'process.ended' ? e.id : undefined);
        break;
      }
    }
  }

  async declare(plugin: string, kind: LeaseKind, free?: (key: string) => Promise<boolean>): Promise<void> {
    const form = FORM.exec(String(kind.match));
    if (this.plant !== 'any-match-form') {
      if (!form) throw Error(`${plugin}'s kind ${kind.name} matches by ${String(kind.match)}, which is not a match form: one of exact, glob, prefix or pool(n)`);
      const checked = validate('lease.kind@1', kind);
      if (!checked.ok) throw Error(`${plugin}'s kind ${kind.name} is not lease.kind@1 data: ${checked.issues.map((i) => `${i.path || '/'}: ${i.remediation}`).join('; ')}`);
    }
    const holder = this.kindsByName.get(kind.name);
    if (holder && this.plant !== 'redeclare-replaces') throw Error(`the kind ${kind.name} is already declared by ${holder.plugin}`);
    if (this.plant === 'fixed-kinds' && !FIXED.includes(kind.name)) return;
    this.kindsByName.set(kind.name, { ...kind, plugin, ...(form?.[1] ? { n: Number(form[1]) } : {}), ...(free ? { free } : {}) });
  }

  async kinds(): Promise<DeclaredKind[]> {
    return [...this.kindsByName.values()].map(({ name, match, cap, cooldown, cost, plugin }) => ({ name, match, cap, cooldown, cost, plugin }));
  }

  async lease(caller: Caller, resource: Resource, mode: Mode): Promise<LeaseResult> {
    await this.sync();
    const kind = this.kindsByName.get(resource.kind);
    if (!kind) {
      if (this.plant === 'fixed-kinds') return { status: 'refused', reason: 'taken', holders: [], message: `${resource.kind} is not one of the resources this table knows` };
      throw Error(`no lease.kind@1 named ${resource.kind} is declared`);
    }
    let refused = this.decide(caller, kind, resource, mode);
    if (refused) return refused;
    // A key nobody here holds is asked of its kind's free check: one something outside DeepBuild holds is refused.
    // Other requests go on while it is open, so the decision is taken again once it answers.
    if (kind.free && !this.overlapping(kind, resource).length) {
      if (!(await kind.free(resource.key).catch(() => false))) {
        return { status: 'refused', reason: 'taken', holders: [], message: `${resource.kind} ${resource.key} on ${resource.host} is taken outside DeepBuild: its free check said so` };
      }
      refused = this.decide(caller, kind, resource, mode);
      if (refused) return refused;
    }
    if (this.plant === 'await-before-append') await Promise.resolve();
    const now = this.options.now();
    const id = ulid(now);
    const lease: Lease = { id: `lease:${id}`, resource: { host: resource.host, kind: resource.kind, key: resource.key }, holder: caller.holder, mode, expires: now + (this.options.lease_ms ?? DAY) };
    // Held before the append's first await, so every later decision sees it.
    this.held.set(lease.id, { lease, ...(caller.run ? { run: caller.run } : {}), ...(caller.agent ? { agent: caller.agent } : {}), stale: false });
    try {
      await this.append('lease.acquired', 2, lease.id, {
        resource: lease.resource, holder: lease.holder, mode, expires: lease.expires, ...(caller.run ? { run: caller.run } : {}), ...(caller.agent ? { agent: caller.agent } : {}),
      }, now, id);
    } catch (error) {
      this.held.delete(lease.id);
      throw error;
    }
    return { status: 'granted', lease: structuredClone(lease) };
  }

  /** The kind's leases on the resource's host. */
  private onHost(kind: Kind, host: string, everyHost = false): Lease[] {
    return [...this.held.values()].map((h) => h.lease).filter((l) => l.resource.kind === kind.name && (everyHost || l.resource.host === host));
  }
  /** Leases whose key could match the resource's. */
  private overlapping(kind: Kind, resource: Resource): Lease[] {
    const form = kind.n !== undefined && this.plant === 'pool-as-exact-key' ? 'exact' : kind.match;
    return this.onHost(kind, resource.host, this.plant === 'host-blind').filter((l) => (form === 'glob' || form === 'prefix'
      ? overlap(form, l.resource.key, resource.key)
      : form === 'exact' && l.resource.key === resource.key));
  }
  /** A refusal on what the table holds now, or undefined when the lease may be granted. Never awaits. */
  private decide(caller: Caller, kind: Kind, resource: Resource, mode: Mode): LeaseResult | undefined {
    const now = this.options.now();
    const where = `${kind.name} on ${resource.host}`;
    if (kind.n !== undefined && this.plant !== 'pool-as-exact-key') {
      const pool = this.onHost(kind, resource.host, this.plant === 'pool-across-hosts');
      if (this.plant !== 'pool-ignores-n' && pool.length >= kind.n) {
        return { status: 'refused', reason: 'pool', holders: pool, message: `the pool ${where} is full: ${pool.length} of ${kind.n} held, by ${names(pool)}` };
      }
    } else {
      const conflicts = (held: Mode): boolean => (this.plant === 'ignores-mode' ? true
        : this.plant === 'checks-held-mode-only' ? held === 'exclusive'
          : held === 'exclusive' || mode === 'exclusive');
      // A holder's own lease blocks it only from another run of its own, whose process may still use the key.
      const other = (l: Lease): boolean => {
        const run = this.held.get(l.id)?.run;
        return l.holder !== caller.holder || (caller.run !== undefined && run !== undefined && run !== caller.run);
      };
      const blocking = this.overlapping(kind, resource).filter((l) => other(l) && conflicts(l.mode));
      if (blocking.length) return { status: 'refused', reason: 'held', holders: blocking, message: `${where} ${resource.key} is held by ${names(blocking)}` };
    }
    const all = this.onHost(kind, resource.host);
    if (this.plant !== 'ignores-cap' && all.length >= kind.cap) {
      return { status: 'BLOCKED', reason: 'cap', holders: all, message: `${where} is at its cap of ${kind.cap} leases held at once` };
    }
    const ended = this.endedAt.get(keyOf(resource));
    if (this.plant !== 'ignores-cooldown' && ended !== undefined && now < ended + kind.cooldown) {
      return {
        status: 'refused', reason: 'cooldown', holders: [],
        message: `${where} ${resource.key} is in its kind's cooldown of ${kind.cooldown / 60_000} min: its last lease ended at ${new Date(ended).toISOString()}, so it can be leased again at ${new Date(ended + kind.cooldown).toISOString()}`,
      };
    }
    return undefined;
  }

  async tick(): Promise<void> {
    await this.sync();
    const now = this.options.now();
    for (const h of [...this.held.values()]) {
      if (!this.held.has(h.lease.id)) continue;
      if (now > h.lease.expires && this.plant === 'releases-at-expiry') {
        await this.end(h, []);
        continue;
      }
      // Past its expiry a lease is only stale: marked once, still its holder's.
      if (now > h.lease.expires && !h.stale) {
        h.stale = true;
        await this.append('lease.stale', 1, h.lease.id, { resource: h.lease.resource, holder: h.lease.holder, mode: h.lease.mode, expires: h.lease.expires });
      }
      const end = await this.ended(h);
      const { running, proof } = this.processes(h.run);
      if (end && !running.length) await this.end(h, [end, ...proof]);
      // A package's lease on a run ends once the supervisor proved each process of the run gone; the supervisor ends
      // its own run's leases itself, after its kind's cleanup check.
      else if (h.lease.holder.startsWith('ext:') && proof.length && !running.length) await this.end(h, proof);
    }
  }
  /** The event that says the lease's holder session has ended, recording its agent's end when it is proven gone. */
  private async ended(h: Held): Promise<string | undefined> {
    const holder = h.lease.holder;
    // Only a session ends on its own; a lease another writer holds (the supervisor's, for a run) is released by it.
    if (!holder.startsWith('session:')) return undefined;
    if (this.ends.has(holder) || !h.agent) return this.ends.get(holder);
    const start = await startOf(h.agent.pid);
    const gone = this.plant === 'pid-only-liveness' ? start === undefined : start !== h.agent.start;
    if (!gone || this.ends.has(holder)) return this.ends.get(holder);
    const ts = this.options.now();
    const id = ulid(ts);
    this.ends.set(holder, id);
    await this.append('session.gone', 1, holder, { pid: h.agent.pid, start: h.agent.start }, ts, id);
    return id;
  }
  /** The run's recorded processes still running, and the process.ended events that prove the others gone. */
  private processes(run: string | undefined): { running: number[]; proof: string[] } {
    const procs = [...(run ? this.procs.get(run) ?? [] : [])];
    return { running: procs.filter(([, ended]) => !ended).map(([pid]) => pid), proof: procs.flatMap(([, ended]) => (ended ? [ended] : [])) };
  }
  async release(lease: string, proof: string[]): Promise<void> {
    await this.sync();
    const h = this.held.get(lease);
    if (!h) return;
    if (h.lease.holder.startsWith('session:')) {
      if (!h.run) throw Error(`${lease} is ${h.lease.holder}'s: a session's lease ends only once the table reads it ended`);
      const { running } = this.processes(h.run);
      if (running.length) throw Error(`${lease} is held open by ${h.run}'s processes still running: ${running.join(', ')}`);
    }
    await this.end(h, proof);
  }
  private async end(h: Held, proof: string[]): Promise<void> {
    // A tick and its holder's release can each reach a lease across an await: it ends once.
    if (!this.held.has(h.lease.id)) return;
    const now = this.options.now();
    this.held.delete(h.lease.id);
    this.endedAt.set(keyOf(h.lease.resource), now);
    await this.append('lease.released', 2, h.lease.id, { resource: h.lease.resource, holder: h.lease.holder, mode: h.lease.mode, expires: h.lease.expires, proof });
  }

  async leases(): Promise<LeaseView[]> {
    await this.sync();
    const now = this.options.now();
    return [...this.held.values()].map((h) => {
      const lease = structuredClone(h.lease);
      if (!h.stale && now <= h.lease.expires) return { lease, state: 'held' as const };
      const { running } = this.processes(h.run);
      const parts = [
        `past its expiry at ${new Date(h.lease.expires).toISOString()}`,
        this.ends.has(h.lease.holder) ? `${h.lease.holder} has ended` : `${h.lease.holder} still runs`,
        ...running.map((pid) => `pid ${pid} of ${h.run} still runs`),
      ];
      return { lease, state: 'stale' as const, reading: `stale: ${parts.join('; ')}` };
    });
  }
}

/** Opens the table on the record, its state folded from the log; the core declares `cpu.slot` before it resolves. */
export async function openLeases(options: LeasesOptions): Promise<LeaseTable> {
  const table = new Table(options);
  await table.sync();
  // Half the cores are the gate runner's machine slots; the cap is the cores themselves, which the pool keeps clear of.
  const cores = Math.max(1, options.cores ?? availableParallelism());
  await table.declare('core', { name: 'cpu.slot', match: `pool(${Math.max(1, Math.floor(cores / 2))})`, cap: cores, cooldown: 0, cost: 0 });
  return table;
}
