// The gate runner's scheduler (#29; design: An agent says it's done, from Fast and slow lanes to Stale results stay
// stale, and Held time is counted): which of a stop's checks run while the agent waits, when its hold replies, when
// the checks left to the slow lane start, which snapshot each runs on, and where each result goes. It is a pure
// function of its inputs on a virtual clock (`simulate`): the hub drives the same rules from its stops, and the
// dogfood week's replays read them back from the record.
import { moreRuns } from '@deepbuild/verdicts';
import type { Result, RunOutcome } from '@deepbuild/verdicts';
import { matches } from './glob.js';
import { attributeStack, type Served, type StackRecords, type Trees } from './stack.js';
import type { ClaimSource } from './claims.js';

export type Agent = 'claude' | 'codex-observed' | 'codex-woken';
export type Origin = 'human' | 'app' | 'answer' | 'continuation' | 'scheduled' | 'subagent' | 'session' | 'unknown';
export interface Config { budget_ms: number; hold_ms: number; slots: number; grace_ms: number; stop_timeout_ms: number }
export const DEFAULTS: Config = { budget_ms: 10_000, hold_ms: 60_000, slots: 4, grace_ms: 60_000, stop_timeout_ms: 600_000 };
export interface Needs { cores: number; memory_mb: number; stack_slot: number; gpus: number }
export interface StackStep { name: string; median_ms: number; inputs: string[] }
export interface StackDef { steps: StackStep[]; per_run_ms: number; wait_ms?: number; kept: boolean; start(ctx: { attempt: number; kept_product: boolean; checkout: string; worktree: string }): StackRecords }
export interface RunContext { snapshot: string; attempt: number; run: number; started_ms: number; load: number; worktree_at(ms: number): string }
export interface CheckDef {
  id: string;
  on_base: 'fails' | 'passes';
  inputs: string[];
  expected_ms: number;
  deadline_ms?: number;
  runs?: number;
  needs?: Partial<Needs>;
  stack?: StackDef;
  timing?: boolean;
  run(ctx: RunContext): { took_ms: number; outcome: 'passed' | 'failed'; load?: number };
}
export type SortedAs = 'proceed' | 'provisional_ask' | 'completion_prompt' | 'deep_ask' | 'question_holds';
export interface LoopFacts { goal: 'none' | 'active' | 'paused' | 'complete'; heartbeat_due: number | null; wakeup_due: number | null; cron_due: number | null; subagent_report_due: number | null }
export type ScriptEvent =
  | { at: number; kind: 'prompt'; origin: Origin }
  | { at: number; kind: 'words'; via: 'typed' | 'app' | 'answer' }
  | { at: number; kind: 'edit'; snapshot: string; changed: string[] }
  | { at: number; kind: 'claim'; via: 'deep_claim' | 'gh_pr_create' }
  | { at: number; kind: 'facts'; facts: Partial<LoopFacts> }
  | { at: number; kind: 'tool_call' }
  | { at: number; kind: 'retention' }
  | { at: number; kind: 'stop'; snapshot: string; changed: string[]; checkout_ms?: number; sorted?: SortedAs; id?: string };
export interface SessionScript { id: string; agent: Agent; ask?: string; checks: CheckDef[]; events: ScriptEvent[]; facts?: Partial<LoopFacts> }
export interface Scenario { config?: Partial<Config>; sessions: SessionScript[]; foreign?: { at: number; ms: number; slots: number }[] }
export type SchedulerPlant =
  | 'hold-sized-by-own-time' | 'definition-order' | 'sums-times' | 'reply-at-first-verdict' | 'ignores-fast-lane-budget'
  | 'stops-run-on-newer-snapshot' | 'queues-every-green-snapshot' | 'ignores-fast-lane-results' | 'starts-on-every-green-stop' | 'starts-beside-fast-lane'
  | 'checks-delivery-at-queue' | 'queues-every-check' | 'finishes-older-runs' | 'runs-in-worktree' | 'reruns-every-check' | 'ignores-loops' | 'waits-grace-not-facts'
  | 'holds-claim-stop-for-loop' | 'words-only-at-turn-start' | 'holds-every-loop-check' | 'starts-at-question-stop' | 'holds-only-the-hold-length'
  | 'one-reason-per-record' | 'takes-environments-word' | 'sizes-lane-by-run-alone' | 'leaves-host-empty' | 'fast-lane-waits';

export interface Held { total: number; question: number; slow: number; fast: number; snapshot_start: number; queue_wait: number }
export interface StopReply {
  session: string; stop: string; at: number; reply_at: number; ends_turn: boolean;
  kind: 'ends_turn' | 'send_back' | 'proceed' | 'provisional_ask' | 'completion_prompt' | 'deep_ask' | 'question_holds';
  line: string; counted: string[]; verdict: Result; admitted: string[]; slow: string[]; claim: string; snapshot: string;
  held: Held; code_changing: boolean; budget_cost: string[];
}
type StartedBy = 'fast_lane' | 'turn_end' | 'loop_paused' | 'claim' | 'words' | 'answer';
export interface RunRecord {
  run: string; session: string; check: string; claim: string; snapshot: string;
  lane: 'fast' | 'slow';
  queued_at: number | null; started_at: number; ended_at: number;
  outcome: RunOutcome; took_ms: number;
  host: string; needs: Needs; expected_ms: number | null;
  started_by: StartedBy | null;
  stale_by?: { origin: Origin; at: number };
  stack?: { steps: { name: string; ms: number }[]; from: 'checkout' | 'worktree'; served: Served; attempt: number; kept_product: boolean };
  reason?: string;
  under_load: boolean; load: number | null;
  ran_in: 'checkout' | 'worktree';
  result_snapshot: string;
}
export interface QueueEvent { at: number; session: string; check: string; snapshot: string; op: 'queued' | 'replaced' | 'emptied' | 'held' | 'started'; by?: string }
export interface HeldRecord { session: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: 'loop_paused' | 'claim' | 'words' | 'answer' | null; replaced_by: string | null }
export interface Delivery { at: number; session: string; claim: string; check: string; snapshot: string; result: Result; how: 'woke' | 'sent_back' | 'held_reply' | 'next_tool_call' | 'next_prompt' | 'recorded_only'; stale: boolean; carried: boolean }
type NeverStarted = 'quick_check_failed' | 'kept_working' | 'loop' | 'newer_claim';
export interface CheckOnClaim { outcome: Result; runs: string[]; carried_from: string | null; carried_runs: string[]; stale: boolean; never_started: NeverStarted | null; late: { snapshot: string; outcome: Result; stops_back: number } | null }
export interface ClaimRecord { claim: string; session: string; source: ClaimSource; snapshot: string; at: number; stale: boolean; verdict: Result; checks: Record<string, CheckOnClaim>; line_at_reply: string; line: string }
export interface Trace {
  stops: StopReply[]; runs: RunRecord[]; queue: QueueEvent[]; held: HeldRecord[]; deliveries: Delivery[]; claims: ClaimRecord[];
  stacks: { run: string; at: number; from: 'checkout' | 'worktree' }[];
  peak_running: number; max_running_by_ask_check: number; ended_at: number;
}

// ---- Internal state.

/** A check's results on one snapshot: its runs, and what may still start for it. */
interface RSet {
  n: number; sess: Sess; def: CheckDef; snapshot: string; claim: Claim; changed: string[];
  runs: RunRecord[]; running: RunRecord | null; lane: 'fast' | 'slow';
  kept: boolean;
  /** A newer claim changed the check's inputs: no further run starts here. */
  cancelled: { by: string; prompt: { origin: Origin; at: number } } | null;
  fastWaiting: boolean; place: Place | null; startedBy: StartedBy | null;
  attempt: number; keptProduct: boolean;
  delivered: Set<Claim>; lateNoted: boolean;
  never: NeverStarted | null;
}
interface Place { set: RSet; at: number; held: HeldRecord | null; grace: boolean; starter: StartedBy }
interface Entry { set: RSet | null; carried: boolean; late: CheckOnClaim['late'] }
interface Claim { rec: ClaimRecord; idx: number; sess: Sess; entries: Map<string, Entry>; stop: Stop; stale: boolean }
interface Stop {
  rec: StopReply; claim: Claim; T: number; R: number; admitted: RSet[]; slowSets: RSet[]; replied: boolean; capAt: number;
  fastEnd: number | null; holdingFor: RSet[] | null; holdUntil: number; sorted: SortedAs | undefined; question: boolean;
  forceSendBack: boolean;
}
interface Sess {
  def: SessionScript; i: number; facts: LoopFacts; looping: boolean; origin: Origin | null; inTurn: boolean; lastPrompt: { origin: Origin; at: number } | null;
  words: 'words' | 'answer' | null; claimVia: 'deep_claim' | 'gh_pr_create' | null;
  worktree: { at: number; snapshot: string }[]; claims: Claim[]; current: Map<string, RSet>; stops: Stop[];
  pendingDeliveries: { set: RSet; claim: Claim; stale: boolean }[]; graceAt: number | null; promptSinceReply: boolean;
}

const RANK: Record<Result, number> = { FAIL: 5, INVALID: 4, BLOCKED: 3, INCONCLUSIVE: 2, pending: 1, PASS: 0 };
const worst = (rs: Result[]): Result => rs.reduce<Result>((a, b) => (RANK[b] > RANK[a] ? b : a), 'PASS');
const AUTOMATIC = new Set<Origin>(['continuation', 'scheduled', 'subagent', 'session', 'unknown']);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const minutes = (ms: number) => `about ${Math.max(1, Math.round(ms / 60_000))} min`;

export function simulate(scenario: Scenario, options: { plant?: SchedulerPlant } = {}): Trace {
  return new Sim(scenario, options.plant).run();
}

class Sim {
  private readonly cfg: Config;
  private readonly trace: Trace = { stops: [], runs: [], queue: [], held: [], deliveries: [], claims: [], stacks: [], peak_running: 0, max_running_by_ask_check: 0, ended_at: 0 };
  private readonly sessions: Sess[];
  private now = 0;
  private seq = 0;
  private runN = 0;
  private claimN = 0;
  private readonly running = new Set<RunRecord>();
  private readonly ends = new Map<RunRecord, { at: number; set: RSet; outcome: RunOutcome; reason?: string }>();
  private readonly fastQueue: RSet[] = [];
  private readonly places: Place[] = [];
  private readonly timers: { at: number; fn: () => void }[] = [];
  private readonly openStops: Stop[] = [];
  private readonly runningByKey = new Map<string, number>();

  constructor(private readonly sc: Scenario, private readonly plant: SchedulerPlant | undefined) {
    this.cfg = { ...DEFAULTS, ...sc.config };
    this.sessions = sc.sessions.map((def, i) => ({
      def, i, facts: { goal: 'none', heartbeat_due: null, wakeup_due: null, cron_due: null, subagent_report_due: null, ...def.facts },
      looping: false, origin: null, inTurn: false, lastPrompt: null, words: null, claimVia: null, worktree: [], claims: [], current: new Map(), stops: [],
      pendingDeliveries: [], graceAt: null, promptSinceReply: false,
    }));
  }

  // ---- The loop: every instant's events in a fixed order, until nothing more happens at it.
  run(): Trace {
    const script = this.sessions.flatMap((s) => s.def.events.map((e, j) => ({ e, s, j }))).sort((a, b) => a.e.at - b.e.at || a.s.i - b.s.i || a.j - b.j);
    let k = 0;
    for (;;) {
      const next = Math.min(script[k]?.e.at ?? Infinity, ...[...this.ends.values()].map((v) => v.at), ...this.timers.map((t) => t.at), ...this.foreignEdges());
      if (next === Infinity) break;
      this.now = next;
      for (let guard = 0; guard < 10_000; guard++) {
        let did = false;
        for (const [run, end] of [...this.ends]) if (end.at <= this.now) { this.ends.delete(run); this.endRun(run, end); did = true; }
        while (k < script.length && script[k]!.e.at <= this.now) { const { e, s } = script[k++]!; this.event(s, e); did = true; }
        for (const t of this.timers.filter((x) => x.at <= this.now)) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); did = true; }
        if (this.dispatch()) did = true;
        if (this.replies()) did = true;
        if (!did) break;
      }
    }
    this.trace.ended_at = this.now;
    this.finish();
    return this.trace;
  }
  private foreignEdges(): number[] {
    return (this.sc.foreign ?? []).flatMap((f) => [f.at, f.at + f.ms]).filter((t) => t > this.now);
  }
  private foreignBusy(at: number): number {
    return (this.sc.foreign ?? []).filter((f) => f.at <= at && at < f.at + f.ms).reduce((n, f) => n + f.slots, 0);
  }

  // ---- Script events.
  private event(s: Sess, e: ScriptEvent): void {
    switch (e.kind) {
      case 'prompt': {
        s.origin = e.origin;
        s.looping = AUTOMATIC.has(e.origin) && this.plant !== 'ignores-loops';
        if (e.origin === 'answer' && this.plant !== 'words-only-at-turn-start') s.words = 'answer';
        s.inTurn = true;
        s.promptSinceReply = true;
        s.lastPrompt = { origin: e.origin, at: e.at };
        s.graceAt = null;
        break;
      }
      case 'words':
        if (this.plant !== 'words-only-at-turn-start') s.words = e.via === 'answer' ? 'answer' : 'words';
        break;
      case 'edit': s.worktree.push({ at: e.at, snapshot: e.snapshot }); break;
      case 'claim': s.claimVia = e.via; break;
      case 'facts':
        s.facts = { ...s.facts, ...e.facts };
        if (!s.inTurn) this.recheckHeld(s);
        break;
      case 'tool_call': this.flushDeliveries(s, 'next_tool_call'); break;
      case 'retention': for (const x of this.sessions) for (const set of x.current.values()) set.kept = false; break;
      case 'stop': this.stop(s, e); break;
    }
  }

  // ---- Inputs, expected times and predicted starts.
  private changedFor(checks: CheckDef[], changed: string[]): (c: CheckDef) => boolean {
    const unmatched = changed.some((p) => !checks.some((c) => c.inputs.some((g) => matches(g, p))));
    return (c) => changed.length > 0 && (c.inputs.length === 0 || unmatched || changed.some((p) => c.inputs.some((g) => matches(g, p))));
  }
  private stackSteps(def: CheckDef, changed: string[], keptProduct: boolean): StackStep[] {
    const st = def.stack;
    if (!st) return [];
    if (!st.kept || !keptProduct) return st.steps;
    return st.steps.filter((step) => changed.some((p) => step.inputs.some((g) => matches(g, p))));
  }
  private startMs(def: CheckDef, changed: string[], keptProduct: boolean): number {
    const st = def.stack;
    if (!st) return 0;
    return this.stackSteps(def, changed, keptProduct).reduce((n, s) => n + s.median_ms, 0) + st.per_run_ms + (st.wait_ms ?? 0);
  }
  private expected(def: CheckDef, changed: string[], keptProduct = true): number {
    return def.expected_ms + this.startMs(def, changed, keptProduct);
  }
  /** The expected time the lanes size a check by; the planted wrong program leaves its stack's start out. */
  private sized(def: CheckDef, changed: string[]): number {
    return this.plant === 'sizes-lane-by-run-alone' ? def.expected_ms : this.expected(def, changed);
  }
  private key(s: Sess, def: CheckDef): string { return `${s.i}\0${def.id}`; }
  /** When each slot frees, as expected now: runs going, other sessions' slots and fast-lane checks admitted but not started. */
  private slotTimes(at: number): { free: number[]; own: Map<string, number> } {
    const free: number[] = [];
    const own = new Map<string, number>();
    for (const r of this.running) {
      const set = this.ends.get(r)!.set;
      const end = Math.max(at, r.started_at + (r.expected_ms ?? set.def.expected_ms));
      free.push(end);
      own.set(this.key(set.sess, set.def), Math.max(own.get(this.key(set.sess, set.def)) ?? 0, end));
    }
    for (const f of this.sc.foreign ?? []) if (f.at <= at && at < f.at + f.ms) for (let i = 0; i < f.slots; i++) free.push(f.at + f.ms);
    while (free.length < this.cfg.slots) free.push(at);
    free.sort((a, b) => a - b);
    const slots = free.slice(0, Math.max(this.cfg.slots, 0));
    for (const set of this.fastQueue) {
      const stop = set.claim.stop;
      const start = this.assign(slots, Math.max(stop.R, own.get(this.key(set.sess, set.def)) ?? 0));
      const end = start + this.expected(set.def, set.changed, set.keptProduct);
      this.take(slots, start, end);
      own.set(this.key(set.sess, set.def), end);
    }
    return { free: slots, own };
  }
  private assign(slots: number[], earliest: number): number { return Math.max(earliest, slots[0] ?? Infinity); }
  private take(slots: number[], start: number, end: number): void {
    const i = slots.findIndex((t) => t <= start);
    slots.splice(i >= 0 ? i : 0, 1, end);
    slots.sort((a, b) => a - b);
  }

  // ---- A stop: its claim, its checks' lanes, and its hold.
  private stop(s: Sess, e: Extract<ScriptEvent, { kind: 'stop' }>): void {
    const T = e.at;
    const R = T + (e.checkout_ms ?? 0);
    const n = s.stops.length + 1;
    const stopId = e.id ?? `${s.def.id}#${n}`;
    const checks = s.def.checks;
    const changedFor = this.changedFor(checks, e.changed);
    const claimId = `claim:${s.def.id}-${++this.claimN}`;
    const claim: Claim = {
      idx: s.claims.length, sess: s, entries: new Map(), stale: false, stop: undefined as unknown as Stop,
      rec: { claim: claimId, session: s.def.id, source: s.claimVia ?? 'stop', snapshot: e.snapshot, at: T, stale: false, verdict: 'pending', checks: {}, line_at_reply: '', line: '' },
    };
    const prompt = s.lastPrompt ?? { origin: 'unknown' as Origin, at: T };
    const mustRun: CheckDef[] = [];
    let codeChanging = false;
    for (const def of checks) {
      const cur = s.current.get(def.id);
      const changed = changedFor(def);
      if (changed) codeChanging = true;
      const alive = cur && cur.kept && (cur.runs.length > 0 || cur.running || cur.fastWaiting || cur.place);
      const rerun = this.plant === 'reruns-every-check' || this.plant === 'queues-every-check';
      if (!changed && alive && !rerun) {
        claim.entries.set(def.id, { set: cur!, carried: true, late: null });
        continue;
      }
      if (cur && changed) this.supersede(cur, e.snapshot, prompt);
      mustRun.push(def);
    }
    // Older claims whose checks' inputs this one changed read stale.
    if (codeChanging) for (const c of s.claims) c.stale = true;
    // The fast lane: on_base fails first, then the rest, each group shortest first, ties in the definition's order.
    const order = this.plant === 'definition-order' ? [...mustRun] : [...mustRun].sort((a, b) => (a.on_base === 'fails' ? 0 : 1) - (b.on_base === 'fails' ? 0 : 1)
      || this.sized(a, e.changed) - this.sized(b, e.changed) || checks.indexOf(a) - checks.indexOf(b));
    const { free, own } = this.slotTimes(T);
    const budgetEnd = T + this.cfg.budget_ms;
    const admitted: CheckDef[] = [];
    const slow: CheckDef[] = [];
    let seqEnd = R;
    for (const def of order) {
      const exp = this.sized(def, e.changed);
      const earliest = Math.max(R, own.get(this.key(s, def)) ?? 0);
      let start: number; let fits: boolean;
      if (this.plant === 'hold-sized-by-own-time') { start = earliest; fits = R + exp <= T + this.cfg.hold_ms; } else if (this.plant === 'sums-times') { start = Math.max(seqEnd, earliest); fits = start + exp <= budgetEnd; } else { start = this.assign(free, earliest); fits = start + exp <= budgetEnd; }
      if (this.plant === 'fast-lane-waits') fits = true;
      if (fits) {
        admitted.push(def);
        if (this.plant === 'sums-times') seqEnd = start + exp; else this.take(free, start, start + exp);
        own.set(this.key(s, def), start + exp);
      } else slow.push(def);
    }
    // What the hold alone would have run of what the budget left out.
    const budgetCost: string[] = [];
    for (const def of slow) {
      const exp = this.expected(def, e.changed);
      const start = this.assign(free, Math.max(R, own.get(this.key(s, def)) ?? 0));
      if (start + exp <= T + this.cfg.hold_ms) { budgetCost.push(def.id); this.take(free, start, start + exp); }
    }
    const stop: Stop = {
      T, R, admitted: [], slowSets: [], replied: false, capAt: this.plant === 'hold-sized-by-own-time' ? Infinity : T + this.cfg.hold_ms, fastEnd: null, holdingFor: null, holdUntil: Infinity,
      sorted: e.sorted, question: e.sorted === 'question_holds', forceSendBack: false, claim,
      rec: {
        session: s.def.id, stop: stopId, at: T, reply_at: -1, ends_turn: false, kind: 'ends_turn', line: '', counted: [], verdict: 'pending',
        admitted: admitted.map((d) => d.id), slow: slow.map((d) => d.id), claim: claimId, snapshot: e.snapshot,
        held: { total: 0, question: 0, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 }, code_changing: codeChanging, budget_cost: budgetCost,
      },
    };
    claim.stop = stop;
    for (const def of [...admitted, ...mustRun.filter((d) => !admitted.includes(d))]) {
      const set = this.newSet(s, def, e.snapshot, claim, e.changed, admitted.includes(def) ? 'fast' : 'slow');
      claim.entries.set(def.id, { set, carried: false, late: null });
      s.current.set(def.id, set);
      if (set.lane === 'fast') { set.fastWaiting = true; set.startedBy = 'fast_lane'; this.fastQueue.push(set); stop.admitted.push(set); } else stop.slowSets.push(set);
    }
    stop.slowSets.sort((a, b) => order.indexOf(a.def) - order.indexOf(b.def));
    s.claims.push(claim);
    s.stops.push(stop);
    this.openStops.push(stop);
    this.trace.claims.push(claim.rec);
    s.claimVia = null;
    // A delivery queued for the next tool call goes out now, checked as it goes.
    this.flushDeliveries(s, 'next_tool_call', stop);
    if (this.plant === 'starts-beside-fast-lane') for (const set of stop.slowSets) this.queueSlow(set, 'turn_end');
    if (stop.R > this.now) this.timers.push({ at: stop.R, fn: () => undefined });
  }
  private newSet(s: Sess, def: CheckDef, snapshot: string, claim: Claim, changed: string[], lane: 'fast' | 'slow'): RSet {
    return {
      n: ++this.seq, sess: s, def, snapshot, claim, changed, runs: [], running: null, lane, kept: true, cancelled: null, fastWaiting: false, place: null, startedBy: null,
      attempt: 1, keptProduct: true, delivered: new Set(), lateNoted: false, never: null,
    };
  }
  /** A newer claim changed the check's inputs: the older snapshot starts nothing more, and its place is given up. */
  private supersede(old: RSet, by: string, prompt: { origin: Origin; at: number }): void {
    const more = old.running !== null && moreRuns({ ...(old.def.runs ? { runs: old.def.runs } : {}) }, [...this.counted(old), 'passed']) > 0;
    if (this.plant === 'finishes-older-runs') return;
    old.cancelled = { by, prompt };
    if (this.plant === 'stops-run-on-newer-snapshot' && old.running) {
      const r = old.running;
      const end = this.ends.get(r);
      if (end) { this.ends.delete(r); this.endRun(r, { ...end, at: this.now, outcome: 'stopped' }); }
    }
    if (old.place || more) this.pendingSupersede.set(old, by);
    if (old.place) this.dropPlace(old.place);
    if (old.fastWaiting) { old.fastWaiting = false; this.fastQueue.splice(this.fastQueue.indexOf(old), 1); }
  }
  private readonly pendingSupersede = new Map<RSet, string>();
  private dropPlace(p: Place): void {
    this.places.splice(this.places.indexOf(p), 1);
    p.set.place = null;
  }

  // ---- Slots: fast-lane checks first, then queued places, on_base fails first.
  private dispatch(): boolean {
    let did = false;
    for (;;) {
      const busy = this.running.size + this.foreignBusy(this.now);
      let freeSlots = this.cfg.slots - busy;
      if (freeSlots <= 0) return did;
      const blocked = (set: RSet) => (this.runningByKey.get(this.key(set.sess, set.def)) ?? 0) > 0;
      const fast = this.fastQueue.find((set) => set.claim.stop.R <= this.now && !blocked(set));
      if (fast) {
        this.fastQueue.splice(this.fastQueue.indexOf(fast), 1);
        fast.fastWaiting = false;
        this.startRun(fast, 'fast', null);
        did = true;
        continue;
      }
      // Slots a fast-lane check admitted for a later moment is counted on stay its own.
      freeSlots -= this.fastQueue.filter((set) => set.claim.stop.R > this.now || blocked(set)).length;
      if (freeSlots <= 0) return did;
      const ready = this.places.filter((p) => !p.held && !blocked(p.set)).sort((a, b) => (a.set.def.on_base === 'fails' ? 0 : 1) - (b.set.def.on_base === 'fails' ? 0 : 1) || a.at - b.at || a.set.n - b.set.n);
      const p = ready[0];
      if (!p) return did;
      this.dropPlace(p);
      this.startRun(p.set, 'slow', p.at);
      did = true;
    }
  }
  private startRun(set: RSet, lane: 'fast' | 'slow', queuedAt: number | null): void {
    const s = set.sess;
    const def = set.def;
    const inWorktree = this.plant === 'runs-in-worktree';
    const startMs = this.startMs(def, set.changed, set.keptProduct);
    const live = (ms: number) => [...s.worktree].reverse().find((w) => w.at <= ms)?.snapshot ?? set.snapshot;
    let served: Served | undefined;
    let records: StackRecords | undefined;
    const checkout = `/deepbuild/checkouts/${s.def.id}/${set.snapshot}`;
    const worktree = `/deepbuild/worktrees/${s.def.id}`;
    if (def.stack) {
      records = def.stack.start({ attempt: set.attempt, kept_product: set.keptProduct, checkout, worktree });
      const trees: Trees = { checkout, worktree, others: [], digests: {} };
      served = attributeStack(records, trees, this.plant === 'takes-environments-word' ? { plant: 'takes-environments-word' } : {});
    }
    const readsLive = inWorktree || (served !== undefined && served.served !== 'checkout');
    const snapshot = inWorktree ? live(this.now + this.expected(def, set.changed, set.keptProduct)) : set.snapshot;
    const runIndex = set.runs.length + 1;
    const did = def.run({ snapshot, attempt: set.attempt, run: runIndex, started_ms: this.now, load: 0, worktree_at: (ms) => (readsLive ? live(ms) : set.snapshot) });
    const id = `run:${s.def.id}-${def.id}-${++this.runN}`;
    let outcome: RunOutcome = did.outcome;
    let reason: string | undefined;
    if (served && served.served !== 'checkout') {
      const named = served.named;
      if (set.attempt >= 2) { outcome = 'missing'; reason = `its stack served another tree again: ${named}`; } else { outcome = 'uncounted'; reason = `its stack served ${served.served === 'other' ? 'another tree' : 'a tree the records can\'t place'}: ${named}`; }
    }
    const filledNeeds: Needs = { cores: 1, memory_mb: 0, stack_slot: 0, gpus: 0, ...def.needs };
    const rec: RunRecord = {
      run: id, session: s.def.id, check: def.id, claim: set.claim.rec.claim, snapshot: set.snapshot, lane,
      queued_at: queuedAt, started_at: this.now, ended_at: this.now + startMs + did.took_ms, outcome: 'stopped', took_ms: did.took_ms,
      host: this.plant === 'leaves-host-empty' ? '' : 'local', needs: filledNeeds, expected_ms: this.expected(def, set.changed, set.keptProduct),
      started_by: lane === 'fast' ? 'fast_lane' : set.startedBy ?? 'turn_end', under_load: false, load: did.load ?? null,
      ran_in: inWorktree ? 'worktree' : 'checkout', result_snapshot: snapshot,
      ...(def.stack ? { stack: { steps: this.stackSteps(def, set.changed, set.keptProduct).map((st) => ({ name: st.name, ms: st.median_ms })), from: 'checkout' as const, served: served!, attempt: set.attempt, kept_product: set.keptProduct } } : {}),
    };
    if (def.stack) this.trace.stacks.push({ run: id, at: this.now, from: 'checkout' });
    if (lane === 'slow') this.trace.queue.push({ at: this.now, session: s.def.id, check: def.id, snapshot: set.snapshot, op: 'started' });
    set.running = rec;
    this.running.add(rec);
    const k = this.key(s, def);
    this.runningByKey.set(k, (this.runningByKey.get(k) ?? 0) + 1);
    this.trace.max_running_by_ask_check = Math.max(this.trace.max_running_by_ask_check, this.runningByKey.get(k)!);
    this.trace.peak_running = Math.max(this.trace.peak_running, this.running.size);
    this.ends.set(rec, { at: rec.ended_at, set, outcome, ...(reason ? { reason } : {}) });
    this.trace.runs.push(rec);
    set.runs.push(rec);
    // A held place started later: its record says what started it.
    const heldRec = this.trace.held.find((h) => h.session === s.def.id && h.check === def.id && h.snapshot === set.snapshot && h.started_at === null && h.replaced_by === null);
    if (heldRec && lane === 'slow') { heldRec.started_at = this.now; heldRec.started_by = (rec.started_by === 'turn_end' || rec.started_by === 'fast_lane' ? 'loop_paused' : rec.started_by) as HeldRecord['started_by']; }
  }
  private endRun(rec: RunRecord, end: { at: number; set: RSet; outcome: RunOutcome; reason?: string }): void {
    const set = end.set;
    rec.outcome = end.outcome;
    rec.ended_at = end.at;
    if (end.reason) rec.reason = end.reason;
    this.running.delete(rec);
    const k = this.key(set.sess, set.def);
    this.runningByKey.set(k, (this.runningByKey.get(k) ?? 1) - 1);
    set.running = null;
    if (set.cancelled && set.lane === 'slow') rec.stale_by = set.cancelled.prompt;
    if (end.outcome === 'uncounted') { set.attempt += 1; set.keptProduct = false; }
    // More runs on this snapshot, unless a newer claim changed the check's inputs first.
    const more = moreRuns({ ...(set.def.runs ? { runs: set.def.runs } : {}) }, this.counted(set));
    if (more > 0 && !set.cancelled && end.outcome !== 'stopped') {
      if (!set.startedBy) set.startedBy = 'turn_end';
      this.addPlace(set, this.now, null, false, set.lane === 'fast' ? 'turn_end' : set.startedBy);
    }
    this.landed(set);
  }
  private counted(set: RSet): RunOutcome[] {
    return set.runs.filter((r) => !this.running.has(r) && r.outcome !== 'uncounted').map((r) => r.outcome);
  }
  /** A check's result on its snapshot, as it stands. */
  private outcome(set: RSet): Result {
    if (set.running || set.fastWaiting || set.place) return 'pending';
    const outs = this.counted(set);
    if (outs.includes('missing')) return 'BLOCKED';
    if (outs.includes('stopped')) return 'INCONCLUSIVE';
    if (outs.includes('ran_nothing')) return 'INVALID';
    const passes = outs.filter((o) => o === 'passed').length;
    const fails = outs.filter((o) => o === 'failed' || o === 'overran').length;
    if (passes && fails) return 'INCONCLUSIVE';
    const more = moreRuns({ ...(set.def.runs ? { runs: set.def.runs } : {}) }, outs);
    if (more > 0 || !outs.length) return 'pending';
    if (fails) return 'FAIL';
    return 'PASS';
  }
  private entryOutcome(e: Entry): Result { return e.set ? this.outcome(e.set) : 'pending'; }
  private verdictOf(c: Claim): Result { return worst([...c.entries.values()].map((e) => this.entryOutcome(e))); }

  // ---- Places: queued and held, at most one per check and ask.
  private addPlace(set: RSet, at: number, held: HeldRecord | null, grace: boolean, starter: StartedBy): Place {
    const p: Place = { set, at, held, grace, starter };
    set.place = p;
    set.startedBy = starter;
    this.places.push(p);
    return p;
  }
  /** A slow check takes its queued place, replacing an older snapshot's. */
  private queueSlow(set: RSet, starter: StartedBy): void {
    if (set.cancelled || set.place || set.running || set.runs.length) return;
    this.recordSupersede(set, true);
    this.addPlace(set, this.now, null, false, starter);
    this.trace.queue.push({ at: this.now, session: set.sess.def.id, check: set.def.id, snapshot: set.snapshot, op: 'queued' });
  }
  private holdSlow(set: RSet, reason: string, grace: boolean): void {
    if (set.cancelled || set.place || set.running || set.runs.length) return;
    this.recordSupersede(set, true);
    const h: HeldRecord = { session: set.sess.def.id, check: set.def.id, snapshot: set.snapshot, held_at: this.now, reason, started_at: null, started_by: null, replaced_by: null };
    this.trace.held.push(h);
    this.addPlace(set, this.now, h, grace, 'loop_paused');
    this.trace.queue.push({ at: this.now, session: set.sess.def.id, check: set.def.id, snapshot: set.snapshot, op: 'held' });
  }
  /** The older places this set's claim gave up: taken by it (replaced) or left empty. */
  private recordSupersede(set: RSet, took: boolean): void {
    for (const [old, by] of [...this.pendingSupersede]) {
      if (old.sess !== set.sess || old.def.id !== set.def.id || by !== set.snapshot) continue;
      this.pendingSupersede.delete(old);
      this.trace.queue.push({ at: this.now, session: old.sess.def.id, check: old.def.id, snapshot: old.snapshot, op: took ? 'replaced' : 'emptied', by });
      if (took) for (const h of this.trace.held) if (h.session === old.sess.def.id && h.check === old.def.id && h.snapshot === old.snapshot && h.started_at === null && h.replaced_by === null) h.replaced_by = set.snapshot;
    }
  }

  // ---- Replies.
  private replies(): boolean {
    let did = false;
    for (const stop of [...this.openStops]) {
      if (stop.fastEnd === null) {
        const ended = stop.admitted.every((set) => (!set.fastWaiting && set.runs.length > 0 && !(set.running && set.runs.length === 1)) || (set.cancelled !== null && !set.running && !set.runs.length));
        const firstEnded = stop.admitted.some((set) => set.runs.length > 0 && !(set.running && set.runs.length === 1));
        const done = this.plant === 'reply-at-first-verdict' && stop.admitted.length ? firstEnded : ended;
        if (!done && this.now < stop.capAt) continue;
        if (stop.R > this.now && !stop.admitted.length) continue;
        stop.fastEnd = Math.min(this.now, stop.capAt);
        this.atFastEnd(stop);
        did = true;
      }
      if (stop.holdingFor) {
        const landed = stop.holdingFor.every((set) => this.outcome(set) !== 'pending' || set.cancelled);
        if (!landed && this.now < stop.holdUntil) continue;
      }
      this.reply(stop);
      did = true;
    }
    return did;
  }
  /** The fast lane has ended: the reply's kind, and whether the slow checks start, wait for the loop or never start. */
  private atFastEnd(stop: Stop): void {
    const s = stop.claim.sess;
    const verdict = this.verdictOf(stop.claim);
    const red = verdict === 'FAIL' || verdict === 'INVALID' || stop.forceSendBack;
    const kind: StopReply['kind'] = stop.question ? 'question_holds' : red ? 'send_back' : stop.sorted && stop.sorted !== 'question_holds' ? stop.sorted : 'ends_turn';
    stop.rec.kind = kind;
    const greenEnd = kind === 'ends_turn';
    let startsSlow = greenEnd;
    if ((this.plant === 'queues-every-green-snapshot' || this.plant === 'starts-on-every-green-stop') && !red && !stop.question) startsSlow = true;
    if (this.plant === 'ignores-fast-lane-results' && (kind === 'send_back' || greenEnd)) startsSlow = true;
    if (this.plant === 'starts-beside-fast-lane') startsSlow = false;
    const slowSets = stop.slowSets.filter((set) => !set.cancelled);
    const started: RSet[] = [];
    if (stop.question && this.plant === 'starts-at-question-stop') {
      for (const set of slowSets) { this.queueSlow(set, 'words'); started.push(set); }
    } else if (stop.question) {
      for (const set of slowSets) this.holdSlow(set, 'waits for your answer', false);
    } else if (startsSlow) {
      const starter = this.starterAt(s);
      for (const set of slowSets) {
        if (starter.start) { this.queueSlow(set, starter.by); started.push(set); continue; }
        const fit = this.loopFit(s, set);
        if (fit.starts) { this.queueSlow(set, 'loop_paused'); started.push(set); } else this.holdSlow(set, fit.reason, fit.grace);
      }
      // Held places of this session start too when this stop starts things for your words, a claim or the loop's pause.
      if (starter.start) for (const p of this.places.filter((x) => x.held && x.set.sess === s)) { p.held = null; p.starter = starter.by; p.set.startedBy = starter.by; }
      if (this.places.some((p) => p.held && p.grace && p.set.sess === s)) {
        s.graceAt = this.now + this.cfg.grace_ms;
        const at = s.graceAt;
        s.promptSinceReply = false;
        this.timers.push({ at, fn: () => { if (s.graceAt === at && !s.promptSinceReply) this.releaseHeld(s, (p) => p.grace); } });
      }
      s.words = null;
    } else {
      for (const set of slowSets) set.never = red ? 'quick_check_failed' : 'kept_working';
      for (const set of slowSets) this.recordSupersede(set, false);
    }
    // An observed Codex stop is held for slow checks only when they start at this stop and can land in time.
    if (s.def.agent === 'codex-observed' && startsSlow && started.length) {
      const limit = stop.T + this.cfg.stop_timeout_ms - 5000;
      const fits = started.filter((set) => this.now + (set.def.deadline_ms ?? this.expected(set.def, set.changed)) <= limit);
      if (fits.length) { stop.holdingFor = fits; stop.holdUntil = limit; }
    }
  }
  /** What starts held and slow checks at a green stop of this session: not looping, a claim, or your words. */
  private starterAt(s: Sess): { start: true; by: StartedBy } | { start: false } {
    if (!s.looping) return { start: true, by: 'turn_end' };
    if (s.claimVia !== null || s.claims[s.claims.length - 1]!.rec.source !== 'stop') {
      if (this.plant !== 'holds-claim-stop-for-loop') return { start: true, by: 'claim' };
    }
    if (s.words) return { start: true, by: s.words };
    return { start: false };
  }
  /** Whether the loop pauses for this check: its next automatic prompt can't come before the check would end. */
  private loopFit(s: Sess, set: RSet): { starts: boolean; reason: string; grace: boolean } {
    const f = s.facts;
    const graceAt = this.now + this.cfg.grace_ms;
    let next = Infinity; let reason = 'no prompt foreseen'; let grace = false;
    if (this.plant === 'waits-grace-not-facts') { next = graceAt; reason = 'no prompt foreseen'; grace = true; } else if (f.goal === 'active') { next = graceAt; reason = 'goal active'; grace = true; } else {
      const due: [number | null, string][] = [[f.wakeup_due, 'wake-up'], [f.heartbeat_due, 'heartbeat'], [f.cron_due, 'cron'], [f.subagent_report_due, 'subagent']];
      const soon = due.filter(([t]) => t !== null).sort((a, b) => a[0]! - b[0]!)[0];
      if (soon) { next = soon[0]!; reason = soon[1]; } else if (s.origin === 'session' || s.origin === 'unknown') { next = graceAt; grace = true; }
    }
    if (this.plant === 'holds-every-loop-check') return { starts: false, reason, grace };
    const { free, own } = this.slotTimes(this.now);
    const start = this.assign(free, Math.max(this.now, own.get(this.key(s, set.def)) ?? 0));
    return { starts: start + this.expected(set.def, set.changed) <= next, reason, grace };
  }
  /** Held places the loop has now paused for start. */
  private releaseHeld(s: Sess, which: (p: Place) => boolean): void {
    for (const p of this.places.filter((x) => x.held && x.set.sess === s && which(x))) { p.held = null; p.starter = 'loop_paused'; p.set.startedBy = 'loop_paused'; }
  }
  private recheckHeld(s: Sess): void {
    const f = s.facts;
    if (this.plant === 'waits-grace-not-facts') return;
    const none = f.goal !== 'active' && [f.wakeup_due, f.heartbeat_due, f.cron_due, f.subagent_report_due].every((t) => t === null);
    if (none) this.releaseHeld(s, () => true);
  }
  private reply(stop: Stop): void {
    const s = stop.claim.sess;
    stop.replied = true;
    this.openStops.splice(this.openStops.indexOf(stop), 1);
    const at = this.now;
    this.dispatch();
    stop.rec.reply_at = at;
    stop.rec.verdict = this.verdictOf(stop.claim);
    if (stop.holdingFor && (stop.rec.verdict === 'FAIL' || stop.rec.verdict === 'INVALID')) stop.rec.kind = 'send_back';
    stop.rec.ends_turn = stop.rec.kind === 'ends_turn';
    for (const set of stop.holdingFor ?? []) for (const c of s.claims) if (c.entries.get(set.def.id)?.set === set && !set.delivered.has(c) && this.outcome(set) !== 'pending') {
      set.delivered.add(c);
      this.deliver(set, c, 'held_reply', c !== s.claims[s.claims.length - 1]);
    }
    const counted = [...stop.claim.entries].filter(([, e]) => this.entryOutcome(e) !== 'pending').map(([id]) => id);
    stop.rec.counted = counted;
    stop.rec.line = this.line(stop.claim, stop.rec.kind);
    stop.claim.rec.line_at_reply = stop.rec.line;
    stop.rec.held = this.heldSplit(stop);
    s.inTurn = false;
    s.promptSinceReply = false;
    this.trace.stops.push(stop.rec);
  }
  private heldSplit(stop: Stop): Held {
    const total = stop.rec.reply_at - stop.T;
    const h: Held = { total, question: 0, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 };
    if (this.plant === 'holds-only-the-hold-length') return h;
    if (stop.rec.kind === 'question_holds') { h.question = total; return h; }
    const fastEnd = Math.min(stop.fastEnd ?? stop.rec.reply_at, stop.rec.reply_at);
    h.slow = stop.rec.reply_at - fastEnd;
    const spans = stop.admitted.flatMap((set) => set.runs.slice(0, 1)).map((r) => [Math.max(stop.T, r.started_at), Math.min(fastEnd, r.ended_at)] as [number, number]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let covered = 0; let cur: [number, number] | null = null; let inSnapshot = 0;
    const merged: [number, number][] = [];
    for (const sp of spans) { if (cur && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]); else { if (cur) merged.push(cur); cur = [...sp]; } }
    if (cur) merged.push(cur);
    for (const [a, b] of merged) { covered += b - a; inSnapshot += Math.max(0, Math.min(b, stop.R) - a); }
    h.fast = covered;
    h.snapshot_start = Math.max(0, Math.min(stop.R, fastEnd) - stop.T) - inSnapshot;
    h.queue_wait = fastEnd - stop.T - h.fast - h.snapshot_start;
    if (this.plant === 'one-reason-per-record') { h.fast = fastEnd - stop.T; }
    return h;
  }
  /** The one line in the chat, from the claim's checks as they stand. */
  private line(c: Claim, kind: StopReply['kind'] | null): string {
    const entries = [...c.entries];
    const outs = entries.map(([id, e]) => ({ id, e, o: this.entryOutcome(e) }));
    const done = outs.filter((x) => x.o !== 'pending');
    const failing = done.filter((x) => x.o === 'FAIL' || x.o === 'INVALID');
    const verdict = worst(outs.map((x) => x.o));
    const parts: string[] = [];
    if (verdict === 'PASS') parts.push(`PASS ${done.length}/${done.length} · receipt`);
    else if (failing.length) parts.push(`${kind === 'send_back' ? 'sent back' : 'FAIL'} ${failing.length}/${done.length}: ${failing.map((x) => x.id).join(', ')}`);
    else if (verdict !== 'pending') parts.push(`${verdict} ${done.length - done.filter((x) => x.o === 'PASS').length}/${done.length}`);
    const pend = outs.filter((x) => x.o === 'pending');
    const exp = (x: { e: Entry }) => (x.e.set ? this.expected(x.e.set.def, x.e.set.changed, x.e.set.keptProduct) : 0);
    const groups: [string, typeof pend][] = [
      ['running', pend.filter((x) => x.e.set?.running || x.e.set?.fastWaiting)],
      ['queued', pend.filter((x) => !x.e.set?.running && !x.e.set?.fastWaiting && !x.e.set?.place?.held)],
    ];
    for (const [word, xs] of groups) if (xs.length) parts.push(`${plural(xs.length, 'check')} ${word} · ${minutes(Math.max(...xs.map(exp)))}`);
    const held = pend.filter((x) => x.e.set?.place?.held);
    if (held.length) parts.push(`${plural(held.length, 'check')} waits for the loop · ${[...new Set(held.map((x) => x.e.set!.place!.held!.reason))].join(', ')}`);
    for (const x of outs) if (x.e.late) parts.push(`${x.id} ${x.e.set?.running ? 'running' : this.entryOutcome(x.e)} · ${x.e.late.outcome} on ${x.e.late.snapshot.slice(0, 7)}, ${plural(x.e.late.stops_back, 'stop')} back`);
    return parts.join(' · ');
  }

  // ---- Results landing, and where they go.
  private landed(set: RSet): void {
    const result = this.outcome(set);
    if (result === 'pending') return;
    const s = set.sess;
    const newest = s.claims[s.claims.length - 1]!;
    for (const c of s.claims) {
      const e = c.entries.get(set.def.id);
      if (e?.set !== set || set.delivered.has(c)) continue;
      // A result inside a hold not yet replied goes with that reply.
      if (!c.stop.replied) continue;
      const holding = s.stops.find((st) => !st.replied && st.holdingFor?.includes(set));
      if (holding) continue;
      set.delivered.add(c);
      const stale = c !== newest;
      if (stale) {
        this.deliver(set, c, 'recorded_only', true);
        continue;
      }
      if (s.def.agent === 'codex-observed') this.deliver(set, c, 'next_prompt', false);
      else if (s.inTurn || s.stops.some((st) => !st.replied)) s.pendingDeliveries.push({ set, claim: c, stale: this.plant === 'checks-delivery-at-queue' ? false : stale });
      else this.deliver(set, c, result === 'FAIL' || result === 'INVALID' ? 'sent_back' : result === 'PASS' ? 'next_prompt' : 'woke', false);
    }
    // A late result for an older snapshot is named on the newest claim's line beside that check.
    const origin = set.claim;
    if (origin !== newest && !set.lateNoted) {
      const ne = newest.entries.get(set.def.id);
      if (ne && ne.set !== set) { ne.late = { snapshot: set.snapshot, outcome: result, stops_back: newest.idx - origin.idx }; set.lateNoted = true; }
    }
  }
  private deliver(set: RSet, c: Claim, how: Delivery['how'], stale: boolean): void {
    const e = c.entries.get(set.def.id)!;
    this.trace.deliveries.push({ at: this.now, session: set.sess.def.id, claim: c.rec.claim, check: set.def.id, snapshot: set.snapshot, result: this.outcome(set), how, stale, carried: e.carried });
  }
  /** Deliveries queued while the agent worked go out now, each checked as it goes (or, planted, as it was queued). */
  private flushDeliveries(s: Sess, how: 'next_tool_call', atStop?: Stop): void {
    const newest = s.claims[s.claims.length - 1];
    for (const d of s.pendingDeliveries.splice(0)) {
      const stale = this.plant === 'checks-delivery-at-queue' ? d.stale : d.claim !== newest;
      const result = this.outcome(d.set);
      if (stale) { this.deliver(d.set, d.claim, 'recorded_only', true); continue; }
      if (atStop && (result === 'FAIL' || result === 'INVALID')) { atStop.forceSendBack = true; this.deliver(d.set, d.claim, 'sent_back', false); continue; }
      this.deliver(d.set, d.claim, how, false);
    }
  }

  // ---- The end: each claim as it reads now.
  private finish(): void {
    for (const s of this.sessions) {
      for (const c of s.claims) {
        const checks: Record<string, CheckOnClaim> = {};
        for (const [id, e] of c.entries) {
          const set = e.set;
          const own = set && !e.carried ? set.runs.map((r) => r.run) : [];
          let never: NeverStarted | null = null;
          if (set && !set.runs.length) never = set.never ?? (set.cancelled ? 'newer_claim' : set.place?.held ? 'loop' : null);
          checks[id] = {
            outcome: this.entryOutcome(e), runs: own, carried_from: e.carried && set ? set.snapshot : null, carried_runs: e.carried && set ? set.runs.map((r) => r.run) : [],
            stale: c.stale, never_started: never, late: e.late,
          };
        }
        c.rec.checks = checks;
        c.rec.verdict = this.verdictOf(c);
        c.rec.stale = c.stale;
        c.rec.line = this.line(c, null);
      }
    }
  }
}
