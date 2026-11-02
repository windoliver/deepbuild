// The gate runner in the hub (#29; design: An agent says it's done): a claim's checks run on its snapshot, in a
// temporary checkout of its own, never the live worktree; each is admitted to the fast lane when it fits the stop's
// budget, counted from the stop with the snapshot and checkout, the wait for a CPU slot behind the checks already
// admitted, and its expected time, `on_base: fails` checks first and then the rest, shortest first; the rest wait in
// the slow lane. The stop's hold replies once, when every admitted check has ended or the hold ends; slow checks join
// the queue only once the fast lane is green and the reply ends the turn, and the newest snapshot wins the queue. Each
// check's verdict is made from its recorded runs by the verdict engine (claimVerdict, #30), and every stop's held time is recorded
// with its split. A looping session's slow checks are held in their places until the loop pauses for them, a claim or
// your words start them (#965; design: A loop's turn end isn't a hand-back), and background work the session still runs
// holds them until it ends, at most 30 minutes from the stop (#907); each held place is recorded as `check.held`. The
// snapshot, every checkout and a fix check's run on the merge base come from the base-commit service (#31). Pure rules
// live in @deepbuild/gate; this module drives them with the hub's runs and record.
import { basename } from 'node:path';
import { baseProof, claimVerdict, ownRead, OverBudget, type Checkouts, type ClaimRequirement, type DeclaredSurface, type RecordedRun, type StandIn, type TempCheckout } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import type { BaseResult, Result, Verdict } from '@deepbuild/verdicts';
import type { Plant } from './plant.js';

/** The surface a drafted check declares it enters through (#874): #31's shape, its check the requirement's own. */
export type Surface = { kind: string } & Record<string, unknown>;
/**
 * A check of a claim, as the definition locks it: its approved bytes, the command its run is, the requirements it
 * covers, its lane facts and the assertions it names; with them the requirement it judges and the surface it declares, for a stand-in on a base
 * with nothing to start (#874).
 */
export interface ClaimCheck { check: string; approved: string; command: string; covers: string[]; depth: 'unit' | 'integration' | 'journey' | 'live'; on_base: 'fails' | 'passes'; asserts: string[]; expected_ms?: number; deadline_ms?: number; req?: string; surface?: Surface | null }
export interface GateOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  now: () => number;
  append(connection: Connection, input: EventInput): Promise<void>;
  core: Connection;
  /** Starts one run of a claim's check in `cwd`, in its lane with its expected time; resolves with its run handle. */
  start(r: { claim: string; check: string; approved: string; command: string; commit: string; cwd: string; lane: 'fast' | 'slow'; expected_ms: number | null; deadline_ms: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[] }): Promise<string>;
  /** Resolves with the run's outcome once it has finished. */
  ended(run: string): Promise<string>;
  /** CPU slots free now. */
  slots(): { free: number };
  budget_ms: number;
  hold_ms: number;
  /** Background work held a session's slow checks for 30 minutes and they start now, the work still running (#907). */
  capped?(session: string, checks: string[]): void;
  /** A run of the claim ended: its verdict as it now stands is read and, once made, recorded (#30). */
  judged?(claim: string): Promise<void>;
  /** The base-commit service (#31): every checkout a claim's checks run in comes from it. */
  checkouts(): Checkouts;
  /** Records the INCONCLUSIVE verdict of a claim whose snapshot went over its budget (#31). */
  invalid(claim: string, commit: string, reason: string, outcome?: 'INVALID' | 'INCONCLUSIVE'): Promise<void>;
  /** Whether the hub is stopping: what that cuts short says nothing about the claim. */
  stopping(): boolean;
  /** Records the stand-in a requirement's check was proven on (#874): the surface it enters through and the stand-in's hash. */
  stoodIn(r: { task: string; req: string; surface: Surface; hash: string }): Promise<void>;
  plant?: Plant | undefined;
}
/**
 * A green stop's loop reading beside its background work (#965): its session, the origin of the prompt that opened its
 * turn, the soonest wake-up or cron job due, and what starts its checks whatever the loop does: a claim the agent made
 * in the turn, or your words since the last turn end. With none, the turn isn't a loop's.
 */
export interface LoopReading { session: string; origin: string | undefined; due: { at: number; what: 'wake-up' | 'cron' } | null; starter: 'claim' | 'words' | 'answer' | null }
/** What started a held place, as the record names it (#965). */
type StartedBy = 'loop_paused' | 'cap' | 'claim' | 'words' | 'answer';
/** A held place as the record has it (`check.held`), the scheduler's HeldRecord. */
interface HeldRecord { session: string; claim: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: StartedBy | null; replaced_by: string | null }
/** The longest background work holds a stop's slow checks, from that stop (#907). */
const BACKGROUND_MS = 30 * 60_000;
/** A prompt no fact foresees counts as coming within this long of the stop's reply (design: a proposal until the dogfood week). */
const GRACE_MS = 60_000;
/** The origins that make a session loop: a prompt nobody typed. */
const AUTOMATIC = new Set(['continuation', 'scheduled', 'subagent', 'session', 'unknown']);
/** Those whose next prompt no fact foresees; a Codex goal's continuation too, until the hub reads its goal (#39). */
const UNFORESEEN = new Set(['continuation', 'session', 'unknown']);
/** Ignored dependency folders a checkout gets cloned copy-on-write, so a check starts as it would in the worktree. */
const DEPENDENCIES = ['node_modules', '.venv'];

/** A claim's check on one snapshot: its runs, its run on the merge base and the stand-in that run had, its lane, and whether a newer claim outdated it. */
interface Entry { check: ClaimCheck; claim: string; commit: string; lane: 'fast' | 'slow'; runs: string[]; base: string | null; standIn?: StandIn; outcome: string | null; running: boolean; stale: boolean; ends?: number }
/** A slow check held in its place: what holds it (background work, a due wake-up or cron job, or a prompt within the grace window) and its record. */
interface Held { entry: Entry; why: 'background' | 'due' | 'grace'; record: HeldRecord }
interface Claim { claim: string; session: string; task: string; cwd: string; base: string; snapshot: string; checkout: Promise<TempCheckout> | null; requirements: ClaimRequirement[]; entries: Map<string, Entry> }

export class GateRunner {
  /** Each session's claims, oldest first. */
  private readonly claims = new Map<string, Claim[]>();
  /** The slow lane's queue: at most one place per session and check, the newest snapshot's. */
  private readonly queue = new Map<string, Entry>();
  /** The held places, at most one per session and check; and the place each newest record stands for, until it starts. */
  private readonly holding = new Map<string, Held>();
  /** Each session's timers on the hub's clock: background work's 30 minutes from the stop, and the grace window from its reply. */
  private readonly caps = new Map<string, number>();
  private readonly graces = new Map<string, number>();
  /** Each run's record as the command check kind closed it (#30), by run handle: what the claim's verdict is made from. */
  private readonly records = new Map<string, RecordedRun>();
  constructor(private readonly o: GateOptions) {}

  /** A run's closed record, kept for the verdicts of the claim it ran for. */
  recorded(run: string, record: RecordedRun): void {
    this.records.set(run, record);
  }
  /** The files a check's last run on the snapshot read under the test, fixture and script folders: its own (#875). */
  private ownOf(e: Entry): string[] {
    const head = e.runs.length ? this.records.get(e.runs[e.runs.length - 1]!) : undefined;
    return head?.read.filter(ownRead) ?? [];
  }
  /**
   * How a fix check ran on the merge base (#31), from that run's record, and why a failure there proves nothing: it
   * proves the fix only by failing at an assertion its check names (#875), never before its tests ran or elsewhere. A
   * base run that never ended as a run (missing, stopped, uncounted) is no run on the base.
   */
  private baseOf(e: Entry): { base: BaseResult; why: string | null } | undefined {
    const r = e.base === null ? undefined : this.records.get(e.base);
    if (!r || (r.outcome !== 'passed' && r.outcome !== 'failed' && r.outcome !== 'overran')) return undefined;
    if (e.standIn && r.outcome === 'passed' && this.o.plant === 'stand-in-pass-proves') return { base: { outcome: 'failed', on_assertion: true, failed_tests: [] }, why: null };
    const outcome = r.outcome === 'passed' ? 'passed' : 'failed';
    const proof = baseProof(r, { own: this.ownOf(e), asserts: e.check.asserts });
    return { base: { outcome, on_assertion: proof.on_assertion, failed_tests: [...new Set(r.failures.map((f) => f.test))] }, why: outcome === 'failed' ? proof.why : null };
  }
  /**
   * The claim's verdict as it stands: its checks' recorded runs judged by the verdict engine through the gate's
   * claimVerdict (#30), each check ended once no run of it is going or queued; undefined for a claim this runner
   * never saw. Pending while runs are still to come.
   */
  verdictOf(claim: string): Verdict | undefined {
    const c = this.claimOf(claim);
    if (!c) return undefined;
    const queued = new Set(this.queue.values());
    // What a base run failed to prove, by name: the engine says only that it failed off its named assertions.
    const whys: string[] = [];
    const v = claimVerdict({
      claim: c.claim, agent: `session:${c.session.replace(/[^0-9A-Za-z]/g, '')}`, repo: c.cwd, task: c.task, commit: c.snapshot, requirements: c.requirements, now: this.o.now(),
      checks: [...c.entries.values()].map((e) => {
        const { base, why } = this.baseOf(e) ?? {};
        if (why) whys.push(`${e.check.check} ${why}`);
        return {
          check: e.check.check, command: e.check.command, source: 'definition' as const, covers: [...e.check.covers], depth: e.check.depth,
          runs: e.runs.flatMap((run) => { const r = this.records.get(run); return r ? [r] : []; }),
          ...(base ? { base } : {}),
          // Running while going or queued; ended once runs exist and none goes; never started once a newer claim took its place.
          ...(e.running || queued.has(e) ? { state: 'running' as const } : e.runs.length ? { state: 'ended' as const } : e.stale ? { state: 'never_started' as const, never_started: 'newer_claim' as const } : {}),
        };
      }),
    });
    return v.outcome === 'INVALID' && whys.length ? { ...v, reasons: [...whys, ...v.reasons] } : v;
  }
  private claimOf(claim: string): Claim | undefined {
    for (const list of this.claims.values()) { const c = list.find((x) => x.claim === claim); if (c) return c; }
    return undefined;
  }

  /** The median of a check's last clean runs on this machine, from the record; null before it has run clean. */
  private async expectedMs(check: string): Promise<number | null> {
    const rows = (await this.o.raw(`SELECT ended - started AS ms FROM runs WHERE check_id = ? AND outcome = 'passed' AND ended IS NOT NULL ORDER BY ended DESC LIMIT 5`, [check])) as { ms: number }[];
    if (!rows.length) return null;
    const sorted = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /**
   * A claim made at a stop: its snapshot and checkout, its checks taken in turn for the fast lane, the rest left to
   * the slow lane. Resolves once the fast lane has ended or the hold has, with the claim's checks as they stand.
   */
  async stop(r: { session: string; claim: string; task: string; cwd: string; base: string; requirements: ClaimRequirement[]; checks: ClaimCheck[]; stopAt: number }): Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number }> {
    // The snapshot and the checkout share one budget (#31): past it the claim is INCONCLUSIVE, naming the reason and
    // the count of untracked files, and none of its checks runs, in the live worktree or anywhere.
    const budget = this.o.checkouts().budget();
    let snapshot = r.base;
    let checkout: string;
    try {
      snapshot = (await this.o.checkouts().snapshot(r.cwd, budget)).commit;
      checkout = (await this.o.checkouts().checkout({ worktree: r.cwd, commit: snapshot, dependencies: DEPENDENCIES, runs: [r.claim], budget })).dir;
    } catch (error) {
      if (!(error instanceof OverBudget)) throw error;
      await this.o.invalid(r.claim, snapshot, error.message, 'INCONCLUSIVE');
      return { fast: [], slow: [], snapshot, readyAt: this.o.now() };
    }
    const readyAt = this.o.now();
    const claim: Claim = { claim: r.claim, session: r.session, task: r.task, cwd: r.cwd, base: r.base, snapshot, checkout: Promise.resolve({ dir: checkout, commit: snapshot }), requirements: r.requirements, entries: new Map() };
    const older = this.claims.get(r.session) ?? [];
    this.claims.set(r.session, [...older, claim]);
    // Older claims' queued places for the same check give way to this one: the newest snapshot wins the queue.
    for (const c of r.checks) {
      const key = `${r.session}\0${c.check}`;
      const queued = this.queue.get(key);
      if (queued) {
        queued.stale = true;
        this.queue.delete(key);
        const owner = older.find((o) => o.claim === queued.claim);
        if (owner) this.cleanup(owner);
      }
      for (const o of older) { const e = o.entries.get(c.check); if (e) e.stale = true; }
    }
    // The fast lane: on_base fails first, then the rest, each group shortest first, ties in the definition's order.
    const timed = await Promise.all(r.checks.map(async (c, i) => ({ c, i, ms: c.expected_ms ?? (await this.expectedMs(c.check)) ?? 0 })));
    timed.sort((a, b) => (a.c.on_base === 'fails' ? 0 : 1) - (b.c.on_base === 'fails' ? 0 : 1) || a.ms - b.ms || a.i - b.i);
    const free = Array.from({ length: Math.max(0, this.o.slots().free) }, () => readyAt);
    const budgetEnd = r.stopAt + this.o.budget_ms;
    const fast: { c: ClaimCheck; ms: number }[] = [];
    const slow: ClaimCheck[] = [];
    for (const t of timed) {
      free.sort((a, b) => a - b);
      const start = free[0] ?? Infinity;
      if (start + t.ms <= budgetEnd) { free[0] = start + t.ms; fast.push(t); } else slow.push(t.c);
    }
    const runs = fast.map(async ({ c, ms }) => {
      const e: Entry = { check: c, claim: r.claim, commit: snapshot, lane: 'fast', runs: [], base: null, outcome: null, running: true, stale: false, ends: this.o.now() + ms };
      claim.entries.set(c.check, e);
      try {
        const run = await this.o.start({ claim: r.claim, check: c.check, approved: c.approved, command: c.command, commit: snapshot, cwd: checkout, lane: 'fast', expected_ms: ms || null, deadline_ms: c.deadline_ms ?? null });
        e.runs.push(run);
        e.outcome = await this.o.ended(run);
        await this.onBase(claim, e);
      } catch {
        e.outcome = 'missing';
      } finally {
        e.running = false;
      }
      await this.o.judged?.(r.claim);
    });
    for (const c of slow) claim.entries.set(c.check, { check: c, claim: r.claim, commit: snapshot, lane: 'slow', runs: [], base: null, outcome: null, running: false, stale: false });
    // The hold replies once: when every admitted check has ended, or when the hold ends.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(runs), new Promise<void>((done) => { timer = setTimeout(done, Math.max(0, r.stopAt + this.o.hold_ms - this.o.now())); })]).finally(() => clearTimeout(timer));
    void Promise.allSettled(runs).then(() => this.cleanup(claim));
    return { fast: fast.map((f) => f.c.check), slow: slow.map((c) => c.check), snapshot, readyAt };
  }

  /** The claim's checkout: the one it holds, or a new one of its snapshot once the last has gone. */
  private checkoutOf(c: Claim): Promise<TempCheckout> {
    c.checkout ??= this.o.checkouts().checkout({ worktree: c.cwd, commit: c.snapshot, dependencies: DEPENDENCIES, runs: [c.claim] });
    return c.checkout;
  }
  /**
   * A fix check that passed on the snapshot runs on the merge base, in a temporary checkout from the service (#31),
   * through the same command check kind, with the files its run read under the test, fixture and script folders taken
   * from the snapshot (#875); its record is what the verdict engine judges the fix by: passing there, or failing off
   * the assertions it names, makes the claim INVALID. A base run that can't be made is no run on the base, which
   * the engine names the same way; what the hub's stopping cuts short says nothing.
   *
   * On a base with nothing to start, the surface the check declares gets the service's stand-in (#874), a program that
   * does nothing: a service or page the run reaches at DEEP_SURFACE_URL, a command on its PATH by name, a module in the
   * checkout. Passing there is INVALID as passing on the base is; failing there records the stand-in's hash in the
   * requirement's `stand_in`.
   */
  private async onBase(c: Claim, e: Entry): Promise<void> {
    if (e.check.on_base !== 'fails' || e.outcome !== 'passed') return;
    const check = e.check.check;
    const token = `${e.claim} ${check} base`;
    const surface = this.o.plant === 'stand-in-surface-dropped' ? null : e.check.surface ?? null;
    try {
      const surfaces = surface ? [{ ...surface, check } as DeclaredSurface] : [];
      const base = await this.o.checkouts().baseCheckout({ worktree: c.cwd, onto: c.base, claim: c.snapshot, own: this.ownOf(e), dependencies: DEPENDENCIES, surfaces, runs: [token] });
      try {
        const standIn = base.standIns.find((s) => s.check === check);
        const reach = standIn?.port ? { env: { DEEP_SURFACE_URL: `http://127.0.0.1:${standIn.port}` }, hosts: [`127.0.0.1:${standIn.port}`] }
          : standIn?.bin ? { standIns: [basename(standIn.bin)] } : {};
        const run = await this.o.start({ claim: e.claim, check, approved: e.check.approved, command: e.check.command, commit: base.commit, cwd: base.dir, lane: e.lane, expected_ms: null, deadline_ms: e.check.deadline_ms ?? null, ...reach });
        e.base = run;
        if (standIn) e.standIn = standIn;
        const outcome = await this.o.ended(run);
        if (standIn && surface && e.check.req && (outcome === 'failed' || outcome === 'overran') && this.o.plant !== 'stand-in-unrecorded') {
          await this.o.stoodIn({ task: c.task, req: e.check.req, surface, hash: standIn.hash });
        }
      } finally {
        await this.o.checkouts().ended(base, token);
      }
    } catch {
      if (this.o.stopping()) e.outcome = 'stopped';
    }
  }

  /** The claim's checks as they stand: each check's result as the verdict engine judges its runs, and the slow checks still to start. */
  standing(claim: string): { check: string; lane: 'fast' | 'slow'; result: Result; stale: boolean }[] {
    const c = this.claimOf(claim);
    if (!c) return [];
    const v = this.verdictOf(claim);
    return [...c.entries.values()].map((e) => ({ check: e.check.check, lane: e.lane, result: v?.checks.find((x) => x.check === e.check.check)?.outcome ?? 'pending', stale: e.stale }));
  }

  /**
   * A stop's reply let the turn end, with its claim's fast lane green (or no claim to judge): its slow checks take
   * their queued places, each the place an older snapshot's held for the same check; a reply that keeps the agent
   * working starts none of them. A looping session's are held there instead (#965) until the loop pauses for them:
   * its next automatic prompt can't come before a check would end, counting its queue wait and expected time, by the
   * wake-up's or cron job's due time, or the grace window for a prompt no fact foresees. Background work holds them
   * until it ends, at most 30 minutes from this stop (#907). A stop that isn't looping, or one after a claim in its turn
   * or your words, starts them and the session's held ones. Resolves once the held places are recorded.
   */
  async turnEnded(claim: string | null, background: string[] = [], stopAt = this.o.now(), reading?: LoopReading): Promise<void> {
    const plant = this.o.plant;
    const c = claim ? this.claimOf(claim) : undefined;
    const session = reading?.session ?? c?.session;
    if (!session) return;
    const loop = { origin: reading?.origin, due: reading?.due ?? null, background, starter: reading?.starter ?? null };
    const slow = c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.runs.length && !e.running && !e.stale) : [];
    const looping = AUTOMATIC.has(loop.origin ?? '') && plant !== 'starts-on-every-green-stop';
    const starter = loop.starter === 'claim' && plant === 'holds-claim-stop-for-loop' ? null : loop.starter;
    const writes: Promise<void>[] = [];
    if ((!looping && !loop.background.length) || starter) {
      const by: StartedBy = starter ?? (loop.origin === 'person' || loop.origin === 'app' ? 'words' : 'loop_paused');
      for (const e of slow) this.place(session, e, by, writes);
      this.release(session, () => true, by, writes);
    } else if (loop.background.length) {
      for (const e of slow) this.hold(session, e, 'background', `${loop.background.join(', ')} in the background`, writes);
      // A newer stop that takes the place gets 30 minutes of its own; the planted wrong programs keep the first stop's, or none.
      if (plant !== 'holds-background-without-limit' && !(plant === 'caps-from-first-stop' && this.caps.has(session))) this.caps.set(session, stopAt + BACKGROUND_MS);
    } else {
      const now = this.o.now();
      const unforeseen = !loop.due && UNFORESEEN.has(loop.origin ?? '');
      const next = loop.due ? loop.due.at : unforeseen ? now + GRACE_MS : Infinity;
      const free = await this.slotTimes(now);
      for (const e of slow) {
        const ms = e.check.expected_ms ?? (await this.expectedMs(e.check.check)) ?? 0;
        free.sort((a, b) => a - b);
        const start = free[0] ?? Infinity;
        if (start + ms <= next && plant !== 'holds-every-loop-check') {
          free[0] = start + ms;
          this.place(session, e, 'loop_paused', writes);
        } else this.hold(session, e, unforeseen ? 'grace' : 'due', loop.due?.what ?? 'no prompt foreseen', writes);
      }
      if (unforeseen && plant !== 'no-grace-window' && [...this.heldOf(session)].some((h) => h.why === 'grace')) this.graces.set(session, now + GRACE_MS);
    }
    const pumped = this.pump();
    await Promise.all(writes);
    await pumped;
  }
  /** A claim's slow checks as they were declared, each with the deadline a hold is measured by; null when it has none. */
  slowDeadlines(claim: string): { check: string; deadline_ms: number | null }[] {
    const c = [...this.claims.values()].flat().find((x) => x.claim === claim);
    return c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.stale).map((e) => ({ check: e.check.check, deadline_ms: e.check.deadline_ms ?? e.check.expected_ms ?? null })) : [];
  }
  /** A claim's slow checks not started yet, for want of a CPU slot. */
  slowUnstarted(claim: string): string[] {
    const c = [...this.claims.values()].flat().find((x) => x.claim === claim);
    return c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.stale && !e.running && !e.runs.length).map((e) => e.check.check) : [];
  }
  /** A claim's slow checks as they stand: whether any is still to end, and each that failed. One a newer claim outdated counts for neither. */
  slowStanding(claim: string): { pending: boolean; failed: string[] } {
    const slow = this.standing(claim).filter((c) => c.lane === 'slow' && !c.stale);
    return { pending: slow.some((c) => c.result === 'pending'), failed: slow.filter((c) => c.result === 'FAIL' || c.result === 'BLOCKED').map((c) => `${c.check} ${c.result}`) };
  }
  /** Resolves once none of a claim's slow checks is running or queued. */
  async slowEnded(claim: string, until: number): Promise<void> {
    while (Date.now() < until) {
      const c = [...this.claims.values()].flat().find((x) => x.claim === claim);
      if (!c || ![...c.entries.values()].some((e) => e.lane === 'slow' && !e.stale && e.outcome === null)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  /** When each CPU slot is expected to free, from now: the free ones now, then the runs going, then the queue's checks in turn. */
  private async slotTimes(now: number): Promise<number[]> {
    const going = [...this.claims.values()].flat().flatMap((c) => [...c.entries.values()]).filter((e) => e.running && e.ends !== undefined).map((e) => Math.max(now, e.ends!));
    const free = [...Array.from({ length: Math.max(0, this.o.slots().free) }, () => now), ...going];
    for (const e of this.queue.values()) {
      free.sort((a, b) => a - b);
      if (free.length) free[0]! += e.check.expected_ms ?? (await this.expectedMs(e.check.check)) ?? 0;
    }
    return free;
  }
  private *heldOf(session: string): Iterable<Held> {
    for (const [key, h] of this.holding) if (key.startsWith(`${session}\0`)) yield h;
  }
  /** A slow check takes its queued place; the held place an older snapshot had for it starts now, by `by`. */
  private place(session: string, e: Entry, by: StartedBy, writes: Promise<void>[]): void {
    const key = `${session}\0${e.check.check}`;
    const older = this.holding.get(key);
    if (older) {
      this.holding.delete(key);
      writes.push(this.record({ ...older.record, started_at: this.o.now(), started_by: by }, older));
    }
    this.queue.set(key, e);
  }
  /** A slow check held in its place, taking the one an older snapshot held for it, and recorded. */
  private hold(session: string, e: Entry, why: Held['why'], reason: string, writes: Promise<void>[]): void {
    const key = `${session}\0${e.check.check}`;
    const older = this.holding.get(key);
    if (older && older.record.started_at === null && older.record.replaced_by === null) writes.push(this.record({ ...older.record, replaced_by: e.commit }, older));
    const h: Held = { entry: e, why, record: { session: `session:${session.replace(/[^0-9A-Za-z]/g, '')}`, claim: e.claim, check: e.check.check, snapshot: e.commit, held_at: this.o.now(), reason, started_at: null, started_by: null, replaced_by: null } };
    this.holding.set(key, h);
    writes.push(this.record(h.record, h));
  }
  /** The session's held places that `which` picks start, by `by`, each taking its queued place. Returns their checks. */
  private release(session: string, which: (h: Held) => boolean, by: StartedBy, writes: Promise<void>[] = []): string[] {
    const started: string[] = [];
    for (const h of [...this.heldOf(session)]) {
      if (!which(h)) continue;
      const key = `${session}\0${h.entry.check.check}`;
      this.holding.delete(key);
      writes.push(this.record({ ...h.record, started_at: this.o.now(), started_by: by }, h));
      if (h.entry.stale || h.entry.runs.length) continue;
      this.queue.set(key, h.entry);
      started.push(h.entry.check.check);
    }
    if (![...this.heldOf(session)].some((h) => h.why === 'background')) this.caps.delete(session);
    void this.pump();
    return started;
  }
  /** Appends a held place's record as it now stands: the newest for its check and snapshot stands. */
  private record(record: HeldRecord, h: Held): Promise<void> {
    h.record = record;
    const ts = this.o.now();
    return this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'check.held', ts, subject: record.claim, data: { ...record } });
  }
  /** A prompt came: the grace window's loop didn't pause. */
  prompted(session: string): void {
    this.graces.delete(session);
  }
  /**
   * The session is idle and its facts have emptied (#965): no background work and no cron job left, so what they held
   * starts now. A wake-up's hold waits for its prompt.
   */
  idle(session: string, facts: { background: number; crons: number }): void {
    if (facts.background || facts.crons) return;
    this.backgroundEnded(session);
    if (this.o.plant !== 'holds-every-loop-check') this.release(session, (h) => h.record.reason === 'cron', 'loop_paused');
  }
  /** The session ended, and its wake-ups and cron jobs with it: no prompt comes, so everything it held starts. */
  ended(session: string): void {
    this.graces.delete(session);
    this.release(session, () => true, 'loop_paused');
  }
  /** The session's background work has ended: the checks it held take their queued places (#907). Returns them. */
  backgroundEnded(session: string): string[] {
    return this.release(session, (h) => h.why === 'background', 'loop_paused');
  }
  /** Fires what came due on the hub's clock: background work's 30 minutes, and each grace window with no prompt in it. */
  tick(): void {
    const now = this.o.now();
    for (const [session, at] of [...this.caps]) {
      if (now < at) continue;
      this.caps.delete(session);
      const started = this.release(session, (h) => h.why === 'background', 'cap');
      if (started.length) this.o.capped?.(session, started);
    }
    for (const [session, at] of [...this.graces]) {
      if (now < at) continue;
      this.graces.delete(session);
      this.release(session, (h) => h.why === 'grace', 'loop_paused');
    }
  }
  /** Starts queued slow checks while CPU slots are free; a run going is never stopped for a newer snapshot. */
  private async pump(): Promise<void> {
    for (const [key, e] of [...this.queue]) {
      if (this.o.slots().free <= 0) return;
      // Another pump took it, or a newer snapshot did, while this one waited on a checkout.
      if (this.queue.get(key) !== e) continue;
      this.queue.delete(key);
      const c = [...this.claims.values()].flat().find((x) => x.claim === e.claim)!;
      e.running = true;
      try {
        // The slow run gets its own checkout of the snapshot: the fast lane's may be gone by now. A snapshot that can't
        // be checked out any more leaves the check missing, never passed.
        const { dir: cwd } = await this.checkoutOf(c);
        const expected = e.check.expected_ms ?? await this.expectedMs(e.check.check);
        e.ends = this.o.now() + (expected ?? 0);
        const run = await this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd, lane: 'slow', expected_ms: expected, deadline_ms: e.check.deadline_ms ?? null });
        e.runs.push(run);
        void this.o.ended(run).then(async (outcome) => {
          e.outcome = outcome;
          await this.onBase(c, e);
          e.running = false;
          await this.o.judged?.(e.claim);
          void this.pump();
          this.cleanup(c);
        });
      } catch {
        e.outcome = 'missing';
        e.running = false;
        await this.o.judged?.(e.claim);
        this.cleanup(c);
      }
    }
  }
  /** A claim's checkout is given back to the service once no run on it is running or queued. */
  private cleanup(c: Claim): void {
    const busy = [...c.entries.values()].some((e) => e.running || [...this.queue.values()].includes(e));
    if (busy || !c.checkout) return;
    const held = c.checkout;
    c.checkout = null;
    void held.then((t) => this.o.checkouts().ended(t, c.claim)).catch(() => undefined);
  }

  /**
   * Records a stop's held time and its split: each moment goes to the first reason that applies. No stop here is held
   * for its slow checks (#965: a loop's stop is held for its quick checks alone), so the fast lane runs to the reply,
   * reading its results included, and the split counts no slow hold.
   */
  async held(r: { session: string; stop: string; claim: string | null; stopAt: number; readyAt: number; replyAt: number; question: boolean; codeChanging: boolean }): Promise<void> {
    const total = Math.max(0, r.replyAt - r.stopAt);
    const split = r.question
      ? { question: total, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 }
      : { question: 0, slow: 0, fast: Math.max(0, r.replyAt - Math.min(r.replyAt, r.readyAt)), snapshot_start: Math.max(0, Math.min(r.replyAt, r.readyAt) - r.stopAt), queue_wait: 0 };
    const ts = this.o.now();
    await this.o.append(this.o.core, {
      v: 1, id: ulid(ts), kind: 'stop.held', ts,
      data: { session: `session:${r.session.replace(/[^0-9A-Za-z]/g, '')}`, stop: r.stop, claim: r.claim, total, ...split, code_changing: r.codeChanging, budget_cost: [] },
    });
  }
}
