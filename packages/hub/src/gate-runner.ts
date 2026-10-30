// The gate runner in the hub (#29; design: An agent says it's done): a claim's checks run on its snapshot, in a
// temporary checkout of its own, never the live worktree; each is admitted to the fast lane when it fits the stop's
// budget, counted from the stop with the snapshot and checkout, the wait for a CPU slot behind the checks already
// admitted, and its expected time, `on_base: fails` checks first and then the rest, shortest first; the rest wait in
// the slow lane. The stop's hold replies once, when every admitted check has ended or the hold ends; slow checks join
// the queue only once the fast lane is green and the reply ends the turn, and the newest snapshot wins the queue. Each
// check's verdict is made from its runs by the verdict engine's run counts, and every stop's held time is recorded
// with its split. Pure rules live in @deepbuild/gate; this module drives them with the hub's runs and record.
import type { Checkouts, TempCheckout } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';

const sql = (s: string) => s.replace(/'/g, "''");
/** A base run's check, apart from the check's own runs: its failure is the proof and its time isn't the check's. */
export const BASE_RUN = '@base';

/** A check of a claim, as the definition locks it: its approved bytes and its lane facts. */
export interface ClaimCheck { check: string; approved: string; on_base: 'fails' | 'passes' }
export interface GateOptions {
  raw(query: string): Promise<unknown[]>;
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
  /** The base-commit service (#31): every checkout a claim's checks run in comes from it. */
  checkouts(): Checkouts;
  /** Records the INVALID verdict of a claim whose fix check holds on its base. */
  invalid(claim: string, commit: string, reason: string): Promise<void>;
  /** Whether the hub is stopping: what that cuts short says nothing about the claim. */
  stopping(): boolean;
}

/** Ignored dependency folders a checkout gets cloned copy-on-write, so a check starts as it would in the worktree. */
const DEPENDENCIES = ['node_modules', '.venv'];

/** A claim's check on one snapshot: its runs, its lane, and whether a newer claim outdated it. */
interface Entry { check: ClaimCheck; claim: string; commit: string; lane: 'fast' | 'slow'; runs: string[]; outcome: string | null; invalid: boolean; running: boolean; stale: boolean }
interface Claim { claim: string; session: string; worktree: string; base: string; snapshot: string; checkout: Promise<TempCheckout> | null; entries: Map<string, Entry> }

const RESULT = (outcome: string | null, invalid: boolean): 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID' | 'pending' =>
  invalid ? 'INVALID' : outcome === null ? 'pending' : outcome === 'passed' ? 'PASS' : outcome === 'failed' || outcome === 'overran' ? 'FAIL' : outcome === 'missing' ? 'BLOCKED' : 'INCONCLUSIVE';

export class GateRunner {
  /** Each session's claims, oldest first. */
  private readonly claims = new Map<string, Claim[]>();
  /** The slow lane's queue: at most one place per session and check, the newest snapshot's. */
  private readonly queue = new Map<string, Entry>();
  constructor(private readonly o: GateOptions) {}

  /** The median of a check's last clean runs on this machine, from the record; null before it has run clean. */
  private async expectedMs(check: string): Promise<number | null> {
    const rows = (await this.o.raw(`SELECT ended - started AS ms FROM runs WHERE check_id = '${sql(check)}' AND outcome = 'passed' AND ended IS NOT NULL ORDER BY ended DESC LIMIT 5`)) as { ms: number }[];
    if (!rows.length) return null;
    const sorted = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /**
   * A claim made at a stop: its snapshot and checkout, its checks taken in turn for the fast lane, the rest left to
   * the slow lane. Resolves once the fast lane has ended or the hold has, with the claim's checks as they stand.
   */
  async stop(r: { session: string; claim: string; cwd: string; base: string; checks: ClaimCheck[]; stopAt: number }): Promise<{ fast: string[]; slow: string[]; snapshot: string; fastEndedAt: number; readyAt: number }> {
    const { commit: snapshot } = await this.o.checkouts().snapshot(r.cwd);
    const claim: Claim = { claim: r.claim, session: r.session, worktree: r.cwd, base: r.base, snapshot, checkout: null, entries: new Map() };
    const { dir: checkout } = await this.checkoutOf(claim);
    const readyAt = this.o.now();
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
      const e: Entry = { check: c, claim: r.claim, commit: snapshot, lane: 'fast', runs: [], outcome: null, invalid: false, running: true, stale: false };
      claim.entries.set(c.check, e);
      try {
        const run = await this.o.start({ claim: r.claim, check: c.check, approved: c.approved, commit: snapshot, cwd: checkout, lane: 'fast', expected_ms: ms || null });
        e.runs.push(run);
        await this.onBase(claim, e, await this.o.ended(run));
      } catch {
        e.outcome = 'missing';
      } finally {
        e.running = false;
      }
    });
    for (const c of slow) claim.entries.set(c.check, { check: c, claim: r.claim, commit: snapshot, lane: 'slow', runs: [], outcome: null, invalid: false, running: false, stale: false });
    // The hold replies once: when every admitted check has ended, or when the hold ends.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(runs), new Promise<void>((done) => { timer = setTimeout(done, Math.max(0, r.stopAt + this.o.hold_ms - this.o.now())); })]).finally(() => clearTimeout(timer));
    void Promise.allSettled(runs).then(() => this.cleanup(claim));
    return { fast: fast.map((f) => f.c.check), slow: slow.map((c) => c.check), snapshot, fastEndedAt: this.o.now(), readyAt };
  }

  /** The claim's checkout: the one it holds, or a new one of its snapshot once the last has gone. */
  private checkoutOf(c: Claim): Promise<TempCheckout> {
    c.checkout ??= this.o.checkouts().checkout({ worktree: c.worktree, commit: c.snapshot, dependencies: DEPENDENCIES, runs: [c.claim] });
    return c.checkout;
  }
  /**
   * A fix check that passed on the snapshot runs on the merge base, in a temporary checkout from the service (#31):
   * passing there makes the claim INVALID. A base run that can't be made or doesn't finish proves nothing, so the check
   * doesn't stand as passed, and it has no result until then. A failure here is the proof: a raw script reports no
   * assertion to read further.
   */
  private async onBase(c: Claim, e: Entry, head: string): Promise<void> {
    if (e.check.on_base !== 'fails' || head !== 'passed') { e.outcome = head; return; }
    const check = e.check.check;
    try {
      const token = `${e.claim} ${check} base`;
      const base = await this.o.checkouts().baseCheckout({ worktree: c.worktree, onto: c.base, claim: c.snapshot, own: [], dependencies: DEPENDENCIES, runs: [token] });
      try {
        const run = await this.o.start({ claim: e.claim, check: `${check}${BASE_RUN}`, approved: e.check.approved, commit: base.commit, cwd: base.dir, lane: e.lane, expected_ms: null });
        e.runs.push(run);
        const outcome = await this.o.ended(run);
        if (outcome === 'passed') {
          e.invalid = true;
          await this.o.invalid(e.claim, c.snapshot, `${check} passes on the merge base, so it can't prove the fix`);
        }
        e.outcome = outcome === 'passed' || outcome === 'failed' || outcome === 'overran' ? head : outcome;
      } finally {
        await this.o.checkouts().ended(base, token);
      }
    } catch (error) {
      e.outcome = this.o.stopping() ? 'stopped' : 'missing';
      if (!this.o.stopping()) await this.o.invalid(e.claim, c.snapshot, `${check} has no base run to prove it: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
    }
  }

  /** The claim's checks as they stand: each check's result, and the slow checks still to start. */
  standing(claim: string): { check: string; lane: 'fast' | 'slow'; result: ReturnType<typeof RESULT>; stale: boolean }[] {
    for (const list of this.claims.values()) {
      const c = list.find((x) => x.claim === claim);
      if (c) return [...c.entries.values()].map((e) => ({ check: e.check.check, lane: e.lane, result: RESULT(e.outcome, e.invalid), stale: e.stale }));
    }
    return [];
  }

  /**
   * The stop's reply let the turn end with its fast lane green: its slow checks join the queue, each taking the place
   * an older snapshot's held for the same check; a reply that keeps the agent working starts none of them.
   */
  turnEnded(claim: string): void {
    for (const list of this.claims.values()) {
      const c = list.find((x) => x.claim === claim);
      if (!c) continue;
      for (const e of c.entries.values()) {
        if (e.lane !== 'slow' || e.runs.length || e.running || e.stale) continue;
        this.queue.set(`${c.session}\0${e.check.check}`, e);
      }
    }
    void this.pump();
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
        // The fast lane's checkout may be gone by now; the snapshot isn't.
        const { dir: cwd } = await this.checkoutOf(c);
        const run = await this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, commit: e.commit, cwd, lane: 'slow', expected_ms: await this.expectedMs(e.check.check) });
        e.runs.push(run);
        void this.o.ended(run).then(async (outcome) => { await this.onBase(c, e, outcome); e.running = false; void this.pump(); this.cleanup(c); });
      } catch {
        e.outcome = 'missing';
        e.running = false;
        this.cleanup(c);
      }
    }
  }
  /** A claim's checkout is removed once no run on it is running or queued. */
  private cleanup(c: Claim): void {
    const busy = [...c.entries.values()].some((e) => e.running || [...this.queue.values()].includes(e));
    if (busy || !c.checkout) return;
    const held = c.checkout;
    c.checkout = null;
    void held.then((t) => this.o.checkouts().ended(t, c.claim)).catch(() => undefined);
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
