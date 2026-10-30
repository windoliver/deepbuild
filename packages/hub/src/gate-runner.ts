// The gate runner in the hub (#29; design: An agent says it's done): a claim's checks run on its snapshot, in a
// temporary checkout of its own, never the live worktree; each is admitted to the fast lane when it fits the stop's
// budget, counted from the stop with the snapshot and checkout, the wait for a CPU slot behind the checks already
// admitted, and its expected time, `on_base: fails` checks first and then the rest, shortest first; the rest wait in
// the slow lane. The stop's hold replies once, when every admitted check has ended or the hold ends; slow checks join
// the queue only once the fast lane is green and the reply ends the turn, and the newest snapshot wins the queue. Each
// check's verdict is made from its runs by the verdict engine's run counts, and every stop's held time is recorded
// with its split. Pure rules live in @deepbuild/gate; this module drives them with the hub's runs and record.
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { checkoutOf, snapshotOf } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';

const sql = (s: string) => s.replace(/'/g, "''");

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
}

/** A claim's check on one snapshot: its runs, its lane, and whether a newer claim outdated it. */
interface Entry { check: ClaimCheck; claim: string; commit: string; lane: 'fast' | 'slow'; runs: string[]; outcome: string | null; running: boolean; stale: boolean; newer?: string }
interface Claim { claim: string; session: string; checkout: string | null; tree: string | undefined; entries: Map<string, Entry> }
const treeOf = (checkout: string): Promise<string | undefined> => new Promise((done) => {
  execFile('git', ['-C', checkout, 'rev-parse', 'HEAD^{tree}'], { timeout: 5000 }, (error, stdout) => done(error ? undefined : stdout.trim()));
});

const RESULT = (outcome: string | null): 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'pending' =>
  outcome === null ? 'pending' : outcome === 'passed' ? 'PASS' : outcome === 'failed' || outcome === 'overran' ? 'FAIL' : outcome === 'missing' ? 'BLOCKED' : 'INCONCLUSIVE';

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
  async stop(r: { session: string; claim: string; cwd: string; checks: ClaimCheck[]; stopAt: number }): Promise<{ fast: string[]; slow: string[]; snapshot: string; fastEndedAt: number; readyAt: number; budgetCost: string[]; changed: boolean }> {
    const snapshot = await snapshotOf(r.cwd);
    const checkout = await checkoutOf(r.cwd, snapshot);
    const readyAt = this.o.now();
    // Compared by tree: a snapshot of a dirty folder is a new commit even when its files are the last one's.
    const tree = await treeOf(checkout);
    const claim: Claim = { claim: r.claim, session: r.session, checkout, tree, entries: new Map() };
    const older = this.claims.get(r.session) ?? [];
    const last = older.at(-1)?.tree;
    const changed = r.checks.length > 0 && (tree === undefined || last === undefined || tree !== last);
    this.claims.set(r.session, [...older, claim]);
    // Older claims' queued places for the same check give way to this one: the newest snapshot wins the queue.
    for (const c of r.checks) {
      const key = `${r.session}\0${c.check}`;
      const queued = this.queue.get(key);
      if (queued) { queued.stale = true; this.queue.delete(key); }
      for (const o of older) { const e = o.entries.get(c.check); if (e) { e.stale = true; e.newer = r.claim; } }
    }
    // The fast lane: on_base fails first, then the rest, each group shortest first, ties in the definition's order.
    const timed = await Promise.all(r.checks.map(async (c, i) => ({ c, i, ms: (await this.expectedMs(c.check)) ?? 0 })));
    timed.sort((a, b) => (a.c.on_base === 'fails' ? 0 : 1) - (b.c.on_base === 'fails' ? 0 : 1) || a.ms - b.ms || a.i - b.i);
    const free = Array.from({ length: Math.max(0, this.o.slots().free) }, () => readyAt);
    const budgetEnd = r.stopAt + this.o.budget_ms;
    const fast: { c: ClaimCheck; ms: number }[] = [];
    const slow: ClaimCheck[] = [];
    // The checks the budget left to the slow lane that the hold alone would have run: known only once a check has a time.
    const budgetCost: string[] = [];
    const held = [...free];
    for (const t of timed) {
      free.sort((a, b) => a - b);
      held.sort((a, b) => a - b);
      const start = free[0] ?? Infinity;
      const inHold = (held[0] ?? Infinity) + t.ms <= r.stopAt + this.o.hold_ms;
      if (inHold) held[0]! += t.ms;
      if (start + t.ms <= budgetEnd) { free[0] = start + t.ms; fast.push(t); } else {
        slow.push(t.c);
        if (inHold) budgetCost.push(t.c.check);
      }
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
    return { fast: fast.map((f) => f.c.check), slow: slow.map((c) => c.check), snapshot, fastEndedAt: this.o.now(), readyAt, budgetCost, changed };
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
   * an older snapshot's held for the same check; a reply that keeps the agent working starts none of them.
   */
  turnEnded(claim: string): void {
    for (const list of this.claims.values()) {
      const c = list.find((x) => x.claim === claim);
      if (!c) continue;
      for (const e of c.entries.values()) {
        if (e.lane !== 'slow' || e.runs.length || e.stale) continue;
        this.queue.set(`${c.session}\0${e.check.check}`, e);
      }
    }
    void this.pump();
  }
  /** Starts queued slow checks while CPU slots are free; a run going is never stopped for a newer snapshot. */
  private async pump(): Promise<void> {
    for (const [key, e] of [...this.queue]) {
      if (this.o.slots().free <= 0) return;
      this.queue.delete(key);
      const c = [...this.claims.values()].flat().find((x) => x.claim === e.claim)!;
      // The slow run gets its own checkout of the snapshot: the fast lane's may be gone by now.
      const cwd = c.checkout ?? '';
      e.running = true;
      const run = await this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, commit: e.commit, cwd, lane: 'slow', expected_ms: await this.expectedMs(e.check.check) });
      e.runs.push(run);
      void this.o.ended(run).then(async (outcome) => {
        e.outcome = outcome;
        e.running = false;
        // Its result still reports, as that snapshot's; the readings count what outdated it (#45).
        if (e.newer) await this.staleRun(c.session, run, e).catch(() => undefined);
        void this.pump();
        this.cleanup(c);
      });
    }
  }
  private async staleRun(session: string, run: string, e: Entry): Promise<void> {
    const ts = this.o.now();
    await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'run.stale', ts, data: { session: `session:${session.replace(/[^0-9A-Za-z]/g, '')}`, run, check: e.check.check, claim: e.claim, newer_claim: e.newer! } });
  }
  /** A claim's checkout is removed once no run on it is running or queued. */
  private cleanup(c: Claim): void {
    const busy = [...c.entries.values()].some((e) => e.running || [...this.queue.values()].includes(e));
    if (busy || !c.checkout) return;
    rmSync(c.checkout, { recursive: true, force: true });
    c.checkout = null;
  }

  /** Records a stop's held time and its split: each moment goes to the first reason that applies. */
  async held(r: { session: string; stop: string; claim: string | null; stopAt: number; readyAt: number; fastEndedAt: number; replyAt: number; questionMs: number; codeChanging: boolean; budgetCost: string[] }): Promise<void> {
    const total = Math.max(0, r.replyAt - r.stopAt);
    const question = Math.min(r.questionMs, total);
    const split = { question, slow: Math.max(0, r.replyAt - r.fastEndedAt - question), fast: Math.max(0, Math.min(r.replyAt, r.fastEndedAt) - Math.min(r.replyAt, r.readyAt)), snapshot_start: Math.max(0, Math.min(r.replyAt, r.readyAt) - r.stopAt), queue_wait: 0 };
    const ts = this.o.now();
    await this.o.append(this.o.core, {
      v: 1, id: ulid(ts), kind: 'stop.held', ts,
      data: { session: `session:${r.session.replace(/[^0-9A-Za-z]/g, '')}`, stop: r.stop, claim: r.claim, total, ...split, code_changing: r.codeChanging, budget_cost: r.budgetCost },
    });
  }
}
