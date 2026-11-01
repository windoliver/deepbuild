// The gate runner in the hub (#29; design: An agent says it's done): a claim's checks run on its snapshot, in a
// temporary checkout of its own, never the live worktree; each is admitted to the fast lane when it fits the stop's
// budget, counted from the stop with the snapshot and checkout, the wait for a CPU slot behind the checks already
// admitted, and its expected time, `on_base: fails` checks first and then the rest, shortest first; the rest wait in
// the slow lane. The stop's hold replies once, when every admitted check has ended or the hold ends; slow checks join
// the queue only once the fast lane is green and the reply ends the turn, and the newest snapshot wins the queue. Each
// check's verdict is made from its runs by the verdict engine's run counts, and every stop's held time is recorded
// with its split. Background work the session still runs holds its slow checks in their places until it ends, and at
// most 30 minutes from the stop (#907). Pure rules live in @deepbuild/gate; this module drives them with the hub's runs
// and record.
import { rmSync } from 'node:fs';
import { checkoutOf, snapshotOf } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';


/** A check of a claim, as the definition locks it: its approved bytes and its lane facts. */
export interface ClaimCheck { check: string; approved: string; on_base: 'fails' | 'passes' }
export interface GateOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  now: () => number;
  append(connection: Connection, input: EventInput): Promise<void>;
  core: Connection;
  /** Starts one run of a claim's check in `cwd`, in its lane with its expected time; resolves with its run handle. */
  start(r: { claim: string; check: string; approved: string; commit: string; cwd: string; lane: 'fast' | 'slow'; expected_ms: number | null }): Promise<string>;
  /** Resolves with the run's outcome once it has finished. */
  ended(run: string): Promise<string>;
  /** CPU slots free now. */
  slots(): { free: number };
  budget_ms: number;
  hold_ms: number;
  /** Background work held a session's slow checks for 30 minutes and they start now, the work still running (#907). */
  capped?(session: string, checks: string[]): void;
}
/** The longest background work holds a stop's slow checks, from that stop (#907). */
const BACKGROUND_MS = 30 * 60_000;

/** A claim's check on one snapshot: its runs, its lane, and whether a newer claim outdated it. */
interface Entry { check: ClaimCheck; claim: string; commit: string; lane: 'fast' | 'slow'; runs: string[]; outcome: string | null; running: boolean; stale: boolean }
interface Claim { claim: string; session: string; cwd: string; checkout: string | null; entries: Map<string, Entry> }

const RESULT = (outcome: string | null): 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'pending' =>
  outcome === null ? 'pending' : outcome === 'passed' ? 'PASS' : outcome === 'failed' || outcome === 'overran' ? 'FAIL' : outcome === 'missing' ? 'BLOCKED' : 'INCONCLUSIVE';

export class GateRunner {
  /** Each session's claims, oldest first. */
  private readonly claims = new Map<string, Claim[]>();
  /** The slow lane's queue: at most one place per session and check, the newest snapshot's. */
  private readonly queue = new Map<string, Entry>();
  /** Each session's slow checks held for its background work, with the timer that starts them 30 minutes from the stop. */
  private readonly holding = new Map<string, { entries: Entry[]; timer: NodeJS.Timeout }>();
  constructor(private readonly o: GateOptions) {}

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
  async stop(r: { session: string; claim: string; cwd: string; checks: ClaimCheck[]; stopAt: number }): Promise<{ fast: string[]; slow: string[]; snapshot: string; fastEndedAt: number; readyAt: number }> {
    const snapshot = await snapshotOf(r.cwd);
    const checkout = await checkoutOf(r.cwd, snapshot);
    const readyAt = this.o.now();
    const claim: Claim = { claim: r.claim, session: r.session, cwd: r.cwd, checkout, entries: new Map() };
    const older = this.claims.get(r.session) ?? [];
    this.claims.set(r.session, [...older, claim]);
    // Older claims' queued places for the same check give way to this one: the newest snapshot wins the queue.
    for (const c of r.checks) {
      const key = `${r.session}\0${c.check}`;
      const queued = this.queue.get(key);
      if (queued) { queued.stale = true; this.queue.delete(key); }
      for (const o of older) { const e = o.entries.get(c.check); if (e) e.stale = true; }
    }
    // The fast lane: on_base fails first, then the rest, each group shortest first, ties in the definition's order.
    const timed = await Promise.all(r.checks.map(async (c, i) => ({ c, i, ms: (await this.expectedMs(c.check)) ?? 0 })));
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
      const e: Entry = { check: c, claim: r.claim, commit: snapshot, lane: 'fast', runs: [], outcome: null, running: true, stale: false };
      claim.entries.set(c.check, e);
      const run = await this.o.start({ claim: r.claim, check: c.check, approved: c.approved, commit: snapshot, cwd: checkout, lane: 'fast', expected_ms: ms || null });
      e.runs.push(run);
      e.outcome = await this.o.ended(run);
      e.running = false;
    });
    for (const c of slow) claim.entries.set(c.check, { check: c, claim: r.claim, commit: snapshot, lane: 'slow', runs: [], outcome: null, running: false, stale: false });
    // The hold replies once: when every admitted check has ended, or when the hold ends.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(runs), new Promise<void>((done) => { timer = setTimeout(done, Math.max(0, r.stopAt + this.o.hold_ms - this.o.now())); })]).finally(() => clearTimeout(timer));
    void Promise.allSettled(runs).then(() => this.cleanup(claim));
    return { fast: fast.map((f) => f.c.check), slow: slow.map((c) => c.check), snapshot, fastEndedAt: this.o.now(), readyAt };
  }

  /** The claim's checks as they stand: each check's result, and the slow checks still to start. */
  standing(claim: string): { check: string; lane: 'fast' | 'slow'; result: ReturnType<typeof RESULT>; stale: boolean }[] {
    for (const list of this.claims.values()) {
      const c = list.find((x) => x.claim === claim);
      if (c) return [...c.entries.values()].map((e) => ({ check: e.check.check, lane: e.lane, result: RESULT(e.outcome), stale: e.stale }));
    }
    return [];
  }

  /**
   * The stop's reply let the turn end with its fast lane green: its slow checks join the queue, each taking the place
   * an older snapshot's held for the same check; a reply that keeps the agent working starts none of them. While the
   * session still runs work in the background they are held in their places instead, with the session's older held
   * checks, for at most 30 minutes from this stop; with none running, the held ones start too.
   */
  turnEnded(claim: string, background: string[] = [], stopAt = this.o.now()): void {
    for (const list of this.claims.values()) {
      const c = list.find((x) => x.claim === claim);
      if (!c) continue;
      const slow = [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.runs.length && !e.stale);
      if (!background.length) {
        this.backgroundEnded(c.session);
        for (const e of slow) this.queue.set(`${c.session}\0${e.check.check}`, e);
        continue;
      }
      const older = this.holding.get(c.session);
      clearTimeout(older?.timer);
      const timer = setTimeout(() => {
        const started = this.backgroundEnded(c.session);
        if (started.length) this.o.capped?.(c.session, started);
      }, Math.max(0, stopAt + BACKGROUND_MS - this.o.now()));
      timer.unref();
      this.holding.set(c.session, { entries: [...(older?.entries ?? []), ...slow], timer });
    }
    void this.pump();
  }
  /** The session's background work has ended, or held its checks 30 minutes: they take their queued places. Returns them. */
  backgroundEnded(session: string): string[] {
    const held = this.holding.get(session);
    if (!held) return [];
    clearTimeout(held.timer);
    this.holding.delete(session);
    const started: string[] = [];
    for (const e of held.entries) {
      if (e.stale || e.runs.length) continue;
      this.queue.set(`${session}\0${e.check.check}`, e);
      started.push(e.check.check);
    }
    void this.pump();
    return started;
  }
  /** Starts queued slow checks while CPU slots are free; a run going is never stopped for a newer snapshot. */
  private async pump(): Promise<void> {
    for (const [key, e] of [...this.queue]) {
      if (this.o.slots().free <= 0) return;
      this.queue.delete(key);
      const c = [...this.claims.values()].flat().find((x) => x.claim === e.claim)!;
      // The slow run gets its own checkout of the snapshot: the fast lane's may be gone by now. A snapshot that can't
      // be checked out any more, its worktree gone, leaves the check missing, never passed.
      const cwd = c.checkout ??= await checkoutOf(c.cwd, e.commit).catch(() => null);
      if (!cwd) { e.outcome = 'missing'; continue; }
      e.running = true;
      const run = await this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, commit: e.commit, cwd, lane: 'slow', expected_ms: await this.expectedMs(e.check.check) });
      e.runs.push(run);
      void this.o.ended(run).then((outcome) => { e.outcome = outcome; e.running = false; void this.pump(); this.cleanup(c); });
    }
  }
  /** A claim's checkout is removed once no run on it is running or queued. */
  private cleanup(c: Claim): void {
    const busy = [...c.entries.values()].some((e) => e.running || [...this.queue.values()].includes(e));
    if (busy || !c.checkout) return;
    rmSync(c.checkout, { recursive: true, force: true });
    c.checkout = null;
  }

  /** Records a stop's held time and its split: each moment goes to the first reason that applies. */
  async held(r: { session: string; stop: string; claim: string | null; stopAt: number; readyAt: number; fastEndedAt: number; replyAt: number; question: boolean; codeChanging: boolean }): Promise<void> {
    const total = Math.max(0, r.replyAt - r.stopAt);
    const split = r.question
      ? { question: total, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 }
      : { question: 0, slow: Math.max(0, r.replyAt - r.fastEndedAt), fast: Math.max(0, Math.min(r.replyAt, r.fastEndedAt) - Math.min(r.replyAt, r.readyAt)), snapshot_start: Math.max(0, Math.min(r.replyAt, r.readyAt) - r.stopAt), queue_wait: 0 };
    const ts = this.o.now();
    await this.o.append(this.o.core, {
      v: 1, id: ulid(ts), kind: 'stop.held', ts,
      data: { session: `session:${r.session.replace(/[^0-9A-Za-z]/g, '')}`, stop: r.stop, claim: r.claim, total, ...split, code_changing: r.codeChanging, budget_cost: [] },
    });
  }
}
