// Plug-in schedules (#365). A job runs on a cadence (every so many ms, or a cron line read in the machine's zone);
// runs of one schedule never overlap, a slot that comes due while one runs queues one run behind it, and slots missed
// while nothing ticked (the computer asleep, the hub down) run once. Each run's verdict decides when the next one
// comes: a pass or a declared no-op keeps the cadence; INCONCLUSIVE (a rate limit, a 5xx, the quota) holds the
// schedule, its next calls spaced first by the cadence and then doubling up to 6 h; FAIL waits twice the last gap,
// up to 6 h, and the fifth FAIL in a row pauses the schedule until you resume it; BLOCKED makes no run until what it
// names is supplied, then one at once. Runs are recorded as schedule.run@1, so a restart resumes a run the plug-in had
// taken and records one still queued as stopped before dispatch.
import { randomUUID } from 'node:crypto';
import type { Connection, RecordStore } from '@deepbuild/record';
import type { Ext } from './host-types.js';
import { CORE, isPlain, message, trustedPath, type HostFiles } from './host-shared.js';
import type { HostSources } from './sources.js';
import type { SendRow } from './send-types.js';
import type { ScheduleDecl, ScheduleRun, ScheduleRow, Ended, RunEvent, Cadence, RunCtx } from './schedule-types.js';
export type { Verdict, ScheduleDecl, ScheduleRun, ScheduleRow, Ended, RunEvent, RunCtx } from './schedule-types.js';

interface HostSchedulesOptions {
  record: RecordStore; exts: ReadonlyMap<string, Ext>;
  sources: { holds(extension: string, name: string): Promise<boolean>; workExt(source: string): Ext | undefined };
  sending: { rows(): Promise<SendRow[]> };
}
/** Run scopes, recorded history and dispatch judgment, alongside the cadence engine. */
export class HostSchedules {
  private readonly runCtx = new Map<string, RunCtx>();
  private closed = false;
  constructor(private readonly options: HostSchedulesOptions, private readonly engine: Schedules) {}
  async register(ext: Ext, name: unknown, declared: unknown, files: HostFiles): Promise<null> {
    const id = ext.entry.id;
    const conformance = ext.mode === 'conformance';
    const decl = declareSchedule(name, declared, { plugin: id, sources: (ext.manifest.sources ?? []).map((x) => x.name), notices: ext.manifest.notices ?? [], stores: ext.manifest.stores ?? [] });
    if (conformance) return null;
    const owner = this.engine.has(decl.name);
    if (owner && owner.plugin !== id) throw Error(`deep.schedule: ${decl.name} is already registered by ${owner.plugin}`);
    await this.engine.register(decl, { runs: await this.runs(decl.name), settings: files.read<Settings>('schedules.json')[decl.name] ?? {} });
    return null;
  }
  async read(scope: string | undefined, given: unknown, sources: HostSources): Promise<unknown> {
    const run = this.context(scope);
    if (!run) throw Error(`deep.schedule.read: only a scheduled job reads through its run`);
    const source = given;
    if (typeof source !== 'string' || !run.decl.declares.readings.includes(source)) throw Error(`deep.schedule.read: ${run.decl.name} doesn't declare ${String(source)} among the readings it reads`);
    const owner = [...this.options.exts.values()].find((e) => e.live && e.sources.get(source)?.variant === 'polled');
    if (!owner) {
      run.blocked ??= `missing source ${source}`;
      return { status: 'BLOCKED', source, cause: run.blocked };
    }
    const got = await sources.readPolled(owner, source);
    if (got.read.status === 'reading') {
      if (got.handle) run.changes.push(got.handle);
      return { status: 'reading', reading: { ...got.read.reading, handle: got.handle } };
    }
    if (got.read.status === 'batch') {
      run.changes.push(got.read.batch.handle);
      return got.read;
    }
    if (got.read.status === 'BLOCKED') run.blocked ??= got.read.cause;
    else if (got.held) run.held ??= got.read.cause;
    return got.read;
  }
  close(): void { this.closed = true; }
  context(scope: string | undefined): RunCtx | undefined { return scope === undefined ? undefined : this.runCtx.get(scope); }
  /** A work source's run is BLOCKED while its package isn't loaded or the secret it needs isn't held. */
  async blockedWork(decl: ScheduleDecl): Promise<string | null> {
    const source = decl.declares.readings[0]!;
    const ext = this.options.sources.workExt(source);
    const d = ext?.sources.get(source);
    if (!ext || d?.variant !== 'stream' || !d.work) return `no loaded package registers the work source ${source}`;
    if (d.work.secret && !(await this.options.sources.holds(ext.entry.id, d.work.secret))) return `missing secret ${d.work.secret}`;
    return null;
  }

  /** What keeps a schedule's run from starting (#365): a source it reads that no loaded plug-in registers, or a secret one needs that isn't held. */
  async blockedRun(decl: ScheduleDecl): Promise<string | null> {
    for (const name of decl.declares.readings) {
      const owner = [...this.options.exts.values()].find((e) => e.live && e.sources.has(name));
      const source = owner?.sources.get(name);
      if (!owner || !source) return `missing source ${name}: no loaded plug-in registers it`;
      if (source.variant === 'polled' && source.secret && !(await this.options.sources.holds(owner.entry.id, source.secret))) return `missing secret ${source.secret}, which ${name} needs`;
    }
    return null;
  }

  /** Hands a run to its plug-in's job (#365), its calls carrying the run's scope; resolves with the run's verdict. */
  dispatchRun(decl: ScheduleDecl, run: { run: string; due: number }): Promise<Ended> | undefined {
    const ext = this.options.exts.get(decl.plugin);
    if (!ext?.live || !ext.ask) return undefined;
    const scope = randomUUID();
    const ctx: RunCtx = { run: run.run, decl, changes: [], blocked: null, held: null, ended: false };
    ext.scopes.set(scope, CORE);
    ext.callOf.set(scope, run.run);
    this.runCtx.set(scope, ctx);
    return ext.ask('schedule.run', { name: decl.name, run: run.run, at: run.due, scope }).then((returned) => this.judged(ext, ctx, returned, undefined), (e) => this.judged(ext, ctx, undefined, e ?? 'failed'))
      .finally(() => {
        ctx.ended = true;
        ext.scopes.delete(scope);
        ext.callOf.delete(scope);
        this.runCtx.delete(scope);
      });
  }

  /**
   * A run's verdict, from what the hub saw and recorded for it, never the job's word (#365): its process gone is
   * INVALID; a declared no-op uncounted; a declared change PASS; else a source missing or its secret is BLOCKED, a
   * rate limit, a 5xx or the quota INCONCLUSIVE, and anything else FAIL. A run the hub's stop cut short is interrupted.
   */
  private judged(ext: Ext, ctx: RunCtx, returned: unknown, error: unknown): Ended {
    if (this.closed) return 'interrupted';
    const changes = [...new Set(ctx.changes)];
    if (error !== undefined && (!ext.live || this.options.exts.get(ext.entry.id) !== ext)) return { verdict: 'INVALID', cause: `${ext.entry.id}'s process ended while the run was under way`, changes };
    if (error === undefined && ctx.decl.declares.noop && isPlain(returned) && 'noop' in returned) return { verdict: 'uncounted', cause: 'a no-op its job declares', changes };
    if (error === undefined && changes.length) return { verdict: 'PASS', cause: null, changes };
    if (ctx.blocked) return { verdict: 'BLOCKED', cause: ctx.blocked, changes };
    if (ctx.held) return { verdict: 'INCONCLUSIVE', cause: ctx.held, changes };
    return { verdict: 'FAIL', cause: error === undefined ? 'it ended with no change its job declares' : `its job failed${ext.released ? `: ${message(error)}` : ''}`, changes };
  }

  async schedules(): Promise<ScheduleRow[]> {
    const last = new Map<string, ScheduleRow['last']>();
    for (const d of this.engine.decls()) {
      const ended = (await this.runs(d.name)).filter((r) => r.verdict !== null).sort((a, b) => a.ended! - b.ended!).at(-1);
      last.set(d.name, ended ? { run: ended.run, at: ended.dispatched ?? ended.due, verdict: ended.verdict } : null);
    }
    return this.engine.rows((name) => last.get(name) ?? null);
  }

  async runs(schedule: string): Promise<ScheduleRun[]> {
    const rows = (await this.options.record.raw("SELECT ts, data FROM events WHERE kind = 'schedule.run' AND json_extract(data, '$.schedule') = ? ORDER BY log_pos", [schedule])) as { ts: number; data: string }[];
    const runs = new Map<string, ScheduleRun>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as RunEvent;
      const r = runs.get(d.run) ?? { run: d.run, schedule, due: d.due, dispatched: null, ended: null, verdict: null, cause: null, stopped: null, sends: [], changes: [] };
      if (d.phase === 'dispatched') r.dispatched ??= row.ts;
      if (d.phase === 'ended') Object.assign(r, { ended: row.ts, verdict: d.noop ? 'uncounted' : d.verdict ?? null, cause: d.cause ?? null, stopped: d.stopped ? 'before dispatch' : null, changes: d.changes ?? [] });
      runs.set(d.run, r);
    }
    // Whether each send a run started went out: one still waiting on your answer has not.
    for (const send of await this.options.sending.rows()) if (send.run) runs.get(send.run)?.sends.push({ key: send.key, outcome: send.outcome === 'waiting' ? 'not sent' : send.outcome });
    return [...runs.values()];
  }

  async editSchedule(connection: Connection, name: string, cadence: { every: number } | { cron: string }): Promise<void> {
    trustedPath(connection, 'a schedule is edited');
    await this.engine.edit(name, cadenceOf(cadence));
  }

  async runNow(connection: Connection, name: string): Promise<void> {
    trustedPath(connection, 'a schedule is run now');
    await this.engine.runNow(name);
  }

  async resumeSchedule(connection: Connection, name: string): Promise<void> {
    trustedPath(connection, 'a schedule is resumed');
    await this.engine.resume(name);
  }
}

/** What the scheduler needs of the host. */
interface RunHost {
  now(): number;
  newRun(): string;
  append(event: RunEvent): Promise<void>;
  /** Whether its plug-in is loaded and running, so a run can be handed to it. */
  ready(decl: ScheduleDecl): boolean;
  /** What keeps a run from starting (a secret, grant or source it needs is missing), or null. */
  blocked(decl: ScheduleDecl): Promise<string | null>;
  /** Hands the run to the plug-in, if it is still running; resolves with how the run ended. */
  dispatch(decl: ScheduleDecl, run: { run: string; due: number }): Promise<Ended> | undefined;
  /** Your settings for a schedule changed: its cadence, or paused with its owner. */
  saved(name: string, settings: Settings): void;
}
export interface Settings { cadence?: Cadence; paused?: { owner: string } }

const MINUTE = 60_000;
const CAP_MS = 6 * 3_600_000;
/** FAILs in a row that pause a schedule. */
const PAUSE_AFTER = 5;
const NAME = /^ext\.[a-z0-9][a-z0-9_-]*\.[a-z][a-z0-9_]*$/;
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A cron line's five fields, each the values it allows. */
interface Cron { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; anyDom: boolean; anyDow: boolean }
function field(text: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw Error(`"${part}" isn't a cron field`);
    const from = m[1] === '*' ? min : Number(m[2]);
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : from;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (from < min || to > max || from > to || step < 1) throw Error(`"${part}" is out of ${min}-${max}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}
function parseCron(line: string): Cron {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 5) throw Error(`"${line}" isn't a cron line of five fields`);
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const days = field(dow, 0, 7);
  if (days.has(7)) days.add(0);
  return { minute: field(minute, 0, 59), hour: field(hour, 0, 23), dom: field(dom, 1, 31), month: field(month, 1, 12), dow: days, anyDom: dom === '*', anyDow: dow === '*' };
}
/** The first minute strictly after `after` a cron line matches, in the machine's zone. */
function nextCron(cron: Cron, after: number): number {
  const d = new Date(Math.floor(after / MINUTE) * MINUTE + MINUTE);
  for (let i = 0; i < 100_000; i++) {
    const dayOk = cron.anyDom && cron.anyDow ? true
      : cron.anyDom ? cron.dow.has(d.getDay()) : cron.anyDow ? cron.dom.has(d.getDate()) : cron.dom.has(d.getDate()) || cron.dow.has(d.getDay());
    if (!cron.month.has(d.getMonth() + 1)) d.setMonth(d.getMonth() + 1, 1), d.setHours(0, 0, 0, 0);
    else if (!dayOk) d.setDate(d.getDate() + 1), d.setHours(0, 0, 0, 0);
    else if (!cron.hour.has(d.getHours())) d.setHours(d.getHours() + 1, 0, 0, 0);
    else if (!cron.minute.has(d.getMinutes())) d.setMinutes(d.getMinutes() + 1, 0, 0);
    else return d.getTime();
  }
  throw Error('the cron line matches no time in the years ahead');
}
/** The first slot of a cadence strictly after `after`; never, for a job with none. */
function nextSlot(cadence: Cadence | null, after: number): number {
  if (!cadence) return Infinity;
  return 'every' in cadence ? (Math.floor(after / cadence.every) + 1) * cadence.every : nextCron(parseCron(cadence.cron), after);
}

/** A cadence as declared or edited: every so many ms, or a cron line; anything else is refused, naming why. */
export function cadenceOf(c: unknown): Cadence {
  const d = (typeof c === 'object' && c !== null ? c : {}) as { every?: unknown; cron?: unknown };
  if (d.every !== undefined && d.cron === undefined && Number.isSafeInteger(d.every) && (d.every as number) >= 1000) return { every: d.every as number };
  if (d.cron !== undefined && d.every === undefined && typeof d.cron === 'string') {
    // A line that parses can still name a date that never comes, such as February 31: it must have a time.
    nextCron(parseCron(d.cron), 0);
    return { cron: d.cron };
  }
  throw Error('a cadence is every so many ms (at least 1000), or a cron line, one of the two');
}

/**
 * A `deep.schedule` call, held to the package's manifest: a name of its own, a cadence, a deadline, and what its job
 * may do, each source, notice kind and store kind one its manifest declares.
 */
export function declareSchedule(name: unknown, declared: unknown, own: { plugin: string; sources: string[]; notices: string[]; stores: string[] }): ScheduleDecl {
  const refuse = (why: string): never => { throw Error(`deep.schedule: ${String(name)} ${why}`); };
  if (typeof name !== 'string' || !NAME.test(name) || !name.startsWith(`ext.${own.plugin.slice(own.plugin.indexOf('/') + 1)}.`)) refuse(`isn't a name of ${own.plugin}'s own, ext.<plugin>.<name>`);
  const d = (typeof declared === 'object' && declared !== null ? declared : {}) as Record<string, unknown>;
  let cadence: Cadence | null = null;
  try {
    cadence = cadenceOf({ ...(d.every !== undefined ? { every: d.every } : {}), ...(d.cron !== undefined ? { cron: d.cron } : {}) });
  } catch (e) {
    // A job with neither runs only on the schedules notices give it (#262), so it checks a notice kind.
    const notices = (d.declares as { notices?: unknown } | undefined)?.notices;
    if (d.every !== undefined || d.cron !== undefined || !texts(notices) || !notices.length) return refuse((e as Error).message);
  }
  if (!Number.isSafeInteger(d.deadline) || (d.deadline as number) < 1) refuse('gives no deadline, in ms');
  const x = (d.declares ?? {}) as Record<string, unknown>;
  const list = (key: 'readings' | 'notices' | 'stores' | 'sends', allowed?: string[]): string[] => {
    const v = x[key] ?? [];
    if (!texts(v)) return refuse(`declares ${key} as a list of names`);
    const stray = allowed && v.find((k) => !allowed.includes(k));
    if (stray) refuse(`declares ${key} it may make of ${stray}, which its manifest doesn't declare`);
    return [...v];
  };
  if (x.noop !== undefined && typeof x.noop !== 'boolean') refuse('declares noop as true or false');
  return {
    name: name as string, plugin: own.plugin, cadence, deadline: d.deadline as number,
    declares: { readings: list('readings', own.sources), notices: list('notices', own.notices), stores: list('stores', own.stores), sends: list('sends'), noop: x.noop === true },
  };
}

interface Run { run: string; due: number; dispatched: number | null; resumed?: true; done?: Promise<void> }
interface Schedule {
  decl: ScheduleDecl;
  cadence: Cadence | null;
  /** When its next run is due. */
  next: number;
  paused: { owner: string } | null;
  running: Run | null;
  queued: Run | null;
  /** A run the plug-in had taken when the hub stopped, given to it again once. */
  resume: Run | null;
  fails: number;
  failGap: number;
  holdGap: number;
  blocked: { cause: string; recheck: boolean } | null;
  live: boolean;
}

/** The hub's schedules: when each runs, one run at a time, and what each verdict does to the next. */
export class Schedules {
  private readonly all = new Map<string, Schedule>();
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly host: RunHost) {}

  /** One change to the schedules at a time: ticks, ends, edits and registrations. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const now = this.lock.then(work);
    this.lock = now.catch(() => undefined);
    return now;
  }

  /**
   * A schedule a loaded plug-in registered, with the runs recorded for it and your settings: a run the plug-in had
   * taken before a stop is resumed once, one still queued is recorded as stopped before dispatch, a last run BLOCKED
   * keeps it blocked until what it named is supplied, and its next slot follows its last run's.
   */
  register(decl: ScheduleDecl, history: { runs: ScheduleRun[]; settings: Settings }): Promise<void> {
    return this.serial(async () => {
      // Loaded again in this hub, as after a new install: its runs go on as they were, under its new declaration.
      const before = this.all.get(decl.name);
      if (before) return void Object.assign(before, { decl, live: true });
      const cadence = history.settings.cadence ?? decl.cadence;
      const runs = history.runs;
      const last = runs.reduce((m, r) => Math.max(m, r.due), -Infinity);
      const s: Schedule = {
        decl, cadence, next: Number.isFinite(last) ? nextSlot(cadence, last) : nextSlot(cadence, this.host.now() - 1),
        paused: history.settings.paused ?? null, running: null, queued: null, resume: null, fails: 0, failGap: 0, holdGap: 0, blocked: null, live: true,
      };
      for (const r of runs.filter((x) => x.ended === null)) {
        if (r.dispatched !== null) s.resume ??= { run: r.run, due: r.due, dispatched: r.dispatched, resumed: true };
        else await this.host.append({ run: r.run, schedule: decl.name, plugin: decl.plugin, phase: 'ended', due: r.due, stopped: true, cause: 'queued when the hub stopped; never dispatched', changes: [] });
      }
      const ended = runs.filter((r) => r.verdict !== null).sort((a, b) => a.ended! - b.ended!);
      for (let i = ended.length - 1; i >= 0 && ended[i]!.verdict === 'FAIL'; i--) s.fails++;
      if (ended.at(-1)?.verdict === 'BLOCKED') s.blocked = { cause: ended.at(-1)!.cause ?? 'BLOCKED', recheck: true };
      this.all.set(decl.name, s);
    });
  }
  /** Its plug-in stopped: nothing more is dispatched to it until it registers again. */
  drop(plugin: string): void {
    for (const s of this.all.values()) if (s.decl.plugin === plugin) s.live = false;
  }
  /** Something a blocked schedule may need was supplied: each blocked one checks again at the next tick. */
  supplied(): void {
    for (const s of this.all.values()) if (s.blocked) s.blocked.recheck = true;
  }
  has(name: string): ScheduleDecl | undefined {
    return this.all.get(name)?.decl;
  }
  decls(): ScheduleDecl[] {
    return [...this.all.values()].filter((s) => s.live).map((s) => s.decl);
  }

  /** The hub's timer: every run due now starts, or queues behind its schedule's running run. */
  tick(): Promise<void> {
    return this.serial(async () => {
      for (const s of this.all.values()) await this.due(s);
    });
  }
  private async due(s: Schedule): Promise<void> {
    if (!s.live || !this.host.ready(s.decl)) return;
    const now = this.host.now();
    if (s.running) {
      if (!s.queued && !s.paused && !s.blocked && now >= s.next) {
        s.queued = { run: this.host.newRun(), due: this.slot(s, now), dispatched: null };
        await this.host.append({ run: s.queued.run, schedule: s.decl.name, plugin: s.decl.plugin, phase: 'queued', due: s.queued.due });
        s.next = nextSlot(s.cadence, now);
      }
      return;
    }
    if (s.resume) {
      const run = s.resume;
      s.resume = null;
      return this.start(s, run);
    }
    if (s.blocked) {
      if (!s.blocked.recheck) return;
      s.blocked.recheck = false;
      const cause = await this.host.blocked(s.decl);
      if (cause) return void (s.blocked.cause = cause);
      s.blocked = null;
      s.next = now;
    }
    if (s.paused || now < s.next) return;
    const run = s.queued ?? { run: this.host.newRun(), due: this.slot(s, now), dispatched: null };
    s.queued = null;
    await this.start(s, run);
  }
  /** The time a run starting now is for: the latest slot passed, or when it came due if that is later. */
  private slot(s: Schedule, now: number): number {
    let at = s.next;
    for (let n = nextSlot(s.cadence, at); n <= now; n = nextSlot(s.cadence, n)) at = n;
    return at;
  }
  private async start(s: Schedule, run: Run): Promise<void> {
    const name = s.decl.name;
    const base = { run: run.run, schedule: name, plugin: s.decl.plugin, due: run.due };
    const cause = await this.host.blocked(s.decl);
    if (cause) {
      s.blocked = { cause, recheck: false };
      await this.host.append({ ...base, phase: 'ended', verdict: 'BLOCKED', cause, changes: [] });
      return;
    }
    const dispatched = run.dispatched ?? this.host.now();
    const running: Run = { ...run, dispatched };
    s.running = running;
    // The slot it takes is spent: another tick at this time queues nothing behind it.
    s.next = nextSlot(s.cadence, this.host.now());
    await this.host.append({ ...base, phase: 'dispatched', ...(run.resumed ? { resumed: true } : {}) });
    const ended = this.host.dispatch(s.decl, { run: run.run, due: run.due });
    if (!ended) {
      // Its plug-in is gone: the run waits for it to come back.
      s.running = null;
      s.resume = { ...running, resumed: true };
      return;
    }
    running.done = ended.then((e) => this.serial(() => this.finish(s, running, e)), () => this.serial(() => this.finish(s, running, { verdict: 'FAIL', cause: 'the hub lost the run', changes: [] })));
  }
  private async finish(s: Schedule, run: Run, ended: Ended): Promise<void> {
    if (s.running !== run) return;
    s.running = null;
    if (ended === 'interrupted') return;
    const now = this.host.now();
    let { verdict, cause } = ended;
    if ((verdict === 'PASS' || verdict === 'uncounted') && now - run.dispatched! > s.decl.deadline) {
      verdict = 'FAIL';
      cause = `it ran past its deadline of ${s.decl.deadline} ms`;
    }
    // A declared no-op is recorded without a verdict: schedule.run@1's verdict holds only the five.
    await this.host.append({ run: run.run, schedule: s.decl.name, plugin: s.decl.plugin, phase: 'ended', due: run.due, ...(verdict === 'uncounted' ? { noop: true } : { verdict }), cause, changes: ended.changes });
    const gap = Math.max(1000, nextSlot(s.cadence, run.due) - run.due);
    if (verdict === 'PASS' || verdict === 'uncounted') {
      s.fails = 0;
      s.failGap = 0;
      s.holdGap = 0;
      s.next = s.queued ? now : nextSlot(s.cadence, now);
    } else if (verdict === 'INCONCLUSIVE') {
      s.holdGap = s.holdGap ? Math.min(s.holdGap * 2, CAP_MS) : gap;
      s.next = now + s.holdGap;
    } else if (verdict === 'FAIL') {
      s.fails++;
      s.failGap = Math.min((s.failGap || gap) * 2, CAP_MS);
      s.next = now + s.failGap;
      if (s.fails >= PAUSE_AFTER) {
        s.paused = { owner: 'you' };
        this.host.saved(s.decl.name, this.settings(s));
      }
    } else if (verdict === 'BLOCKED') {
      s.blocked = { cause: cause ?? 'BLOCKED', recheck: false };
    } else {
      s.next = s.queued ? now : nextSlot(s.cadence, now);
    }
    if (s.queued) await this.due(s);
  }

  /** Resolves once nothing the schedules started is still going and nothing due can start. */
  async idle(): Promise<void> {
    for (let i = 0; i < 10_000; i++) {
      await this.lock;
      const going = [...this.all.values()].flatMap((s) => (s.running?.done ? [s.running.done] : []));
      if (going.length) {
        await Promise.all(going);
        continue;
      }
      const now = this.host.now();
      const startable = [...this.all.values()].some((s) => s.live && this.host.ready(s.decl) && (s.resume || (!s.paused && !s.running && (s.blocked ? s.blocked.recheck : now >= s.next))));
      if (!startable) return;
      await this.tick();
    }
  }

  /** Run now, on the trusted path: a run at once, or queued behind the one running. */
  runNow(name: string): Promise<void> {
    return this.serial(async () => {
      const s = this.get(name);
      const now = this.host.now();
      const run = { run: this.host.newRun(), due: now, dispatched: null };
      if (!s.running) return this.start(s, run);
      if (s.queued) return;
      s.queued = run;
      await this.host.append({ run: run.run, schedule: name, plugin: s.decl.plugin, phase: 'queued', due: now });
    });
  }
  /** Your edit of its cadence, on the trusted path: saved, and its next run the new cadence's first slot. */
  edit(name: string, cadence: Cadence): Promise<void> {
    return this.serial(async () => {
      const s = this.get(name);
      s.cadence = cadence;
      s.next = nextSlot(cadence, this.host.now());
      this.host.saved(name, this.settings(s));
    });
  }
  /** Your resume of a paused schedule: on again, its FAILs forgotten, a run at once. */
  resume(name: string): Promise<void> {
    return this.serial(async () => {
      const s = this.get(name);
      s.paused = null;
      s.fails = 0;
      s.failGap = 0;
      s.next = this.host.now();
      this.host.saved(name, this.settings(s));
    });
  }
  private get(name: string): Schedule {
    const s = this.all.get(name);
    if (!s?.live) throw Error(`no loaded plug-in registers the schedule ${name}`);
    return s;
  }
  private settings(s: Schedule): Settings {
    return { ...(s.cadence && s.cadence !== s.decl.cadence ? { cadence: s.cadence } : {}), ...(s.paused ? { paused: s.paused } : {}) };
  }

  /** The schedules list's rows, each with its last run from the record. */
  rows(last: (name: string) => ScheduleRow['last']): ScheduleRow[] {
    return [...this.all.values()].filter((s) => s.live).map((s) => {
      const state = s.paused ? 'paused' : 'on';
      const activity = s.running ? 'running' : s.queued ? 'queued' : 'idle';
      const next = s.paused || s.blocked || !Number.isFinite(s.next) ? null : s.next;
      const owner = s.paused?.owner ?? (s.blocked ? 'you' : null);
      const words = [
        s.paused ? `paused after ${PAUSE_AFTER} FAILs in a row until you resume it` : 'on',
        ...(s.blocked ? [`BLOCKED: ${s.blocked.cause}`] : []),
        activity === 'idle' ? 'nothing running' : activity === 'queued' ? 'a run queued' : s.queued ? 'running, a run queued behind it' : 'running',
        ...(next !== null ? [`next at ${new Date(next).toISOString()}`] : []),
      ].join('; ');
      return { name: s.decl.name, extension: s.decl.plugin, state, activity, words, next, last: last(s.decl.name), owner };
    });
  }
}
