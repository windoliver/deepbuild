// Plug-in schedules (#365). A job runs on a cadence (every so many ms, or a cron line read in the machine's zone);
// runs of one schedule never overlap, a slot that comes due while one runs queues one run behind it, and slots missed
// while nothing ticked (the computer asleep, the hub down) run once. Each run's verdict decides when the next one
// comes: a pass or a declared no-op keeps the cadence; INCONCLUSIVE (a rate limit, a 5xx, the quota) holds the
// schedule, its next calls spaced first by the cadence and then doubling up to 6 h; FAIL waits twice the last gap,
// up to 6 h, and the fifth FAIL in a row pauses the schedule until you resume it; BLOCKED makes no run until what it
// names is supplied, then one at once. Runs are recorded as schedule.run@1, so a restart resumes a run the plug-in had
// taken and records one still queued as stopped before dispatch.

/** A run's verdict on its schedule's claim. */
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID' | 'uncounted';
export type Cadence = { every: number } | { cron: string };
/** What a scheduled job may do: the sources it reads, the notice, store and send kinds it may make, and whether it may end with a no-op. */
export interface Declares { readings: string[]; notices: string[]; stores: string[]; sends: string[]; noop: boolean }
export interface ScheduleDecl { name: string; plugin: string; cadence: Cadence; deadline: number; declares: Declares }

/** One run of a schedule, as the hub recorded it. */
export interface ScheduleRun {
  run: string;
  schedule: string;
  due: number;
  dispatched: number | null;
  ended: number | null;
  verdict: Verdict | null;
  cause: string | null;
  stopped: 'before dispatch' | null;
  /** Each send the run started, whether it went out. */
  sends: { key: string; outcome: 'sent' | 'not sent' | 'unknown' }[];
  /** Handles of what the hub recorded for it. */
  changes: string[];
}
/** One row of the schedules list. */
export interface ScheduleRow {
  name: string;
  extension: string;
  state: 'on' | 'paused';
  activity: 'idle' | 'queued' | 'running';
  words: string;
  next: number | null;
  last: { run: string; at: number; verdict: Verdict | null } | null;
  owner: string | null;
}
/** How a dispatched run ended, as the host judged it; `interrupted` when the hub stopped under it. */
export type Ended = { verdict: Verdict; cause: string | null; changes: string[] } | 'interrupted';
/** One schedule.run@1 event's data. */
export interface RunEvent {
  run: string; schedule: string; plugin: string; phase: 'queued' | 'dispatched' | 'ended'; due: number;
  resumed?: boolean; verdict?: Verdict; cause?: string | null; stopped?: boolean; changes?: string[];
}
/** What the scheduler needs of the host. */
export interface RunHost {
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
/** The first slot of a cadence strictly after `after`. */
export function nextSlot(cadence: Cadence, after: number): number {
  return 'every' in cadence ? (Math.floor(after / cadence.every) + 1) * cadence.every : nextCron(parseCron(cadence.cron), after);
}

/** A cadence as declared or edited: every so many ms, or a cron line; anything else is refused, naming why. */
export function cadenceOf(c: unknown): Cadence {
  const d = (typeof c === 'object' && c !== null ? c : {}) as { every?: unknown; cron?: unknown };
  if (d.every !== undefined && d.cron === undefined && Number.isSafeInteger(d.every) && (d.every as number) >= 1000) return { every: d.every as number };
  if (d.cron !== undefined && d.every === undefined && typeof d.cron === 'string') {
    parseCron(d.cron);
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
  let cadence: Cadence;
  try {
    cadence = cadenceOf({ ...(d.every !== undefined ? { every: d.every } : {}), ...(d.cron !== undefined ? { cron: d.cron } : {}) });
  } catch (e) {
    return refuse((e as Error).message);
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
    name: name as string, plugin: own.plugin, cadence: cadence!, deadline: d.deadline as number,
    declares: { readings: list('readings', own.sources), notices: list('notices', own.notices), stores: list('stores', own.stores), sends: list('sends'), noop: x.noop === true },
  };
}

interface Run { run: string; due: number; dispatched: number | null; resumed?: true; done?: Promise<void> }
interface Schedule {
  decl: ScheduleDecl;
  cadence: Cadence;
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
    await this.host.append({ run: run.run, schedule: s.decl.name, plugin: s.decl.plugin, phase: 'ended', due: run.due, verdict, cause, changes: ended.changes });
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
    return { ...(s.cadence !== s.decl.cadence ? { cadence: s.cadence } : {}), ...(s.paused ? { paused: s.paused } : {}) };
  }

  /** The schedules list's rows, each with its last run from the record. */
  rows(last: (name: string) => ScheduleRow['last']): ScheduleRow[] {
    return [...this.all.values()].filter((s) => s.live).map((s) => {
      const state = s.paused ? 'paused' : 'on';
      const activity = s.running ? 'running' : s.queued ? 'queued' : 'idle';
      const next = s.paused || s.blocked ? null : s.next;
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
