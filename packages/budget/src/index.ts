// @deepbuild/budget: the kernel's Budget (#86), the one ledger of the spending you approved. A paid run
// reserves its price against every budget that covers it, all in one append, before it starts; the
// reservation holds, unpriced, until the run's cost reading lands, when the run is charged and the
// reservation released. A run that doesn't fit is BLOCKED (cause: budget, owner: you) and raises one
// authority ask to raise the budget; a price nobody knows is BLOCKED, never free.
//
// Its state is a function of the record: every method first reads what the log gained, then decides on
// what it read and appends, with no await between that read and the append. Price lookups run before the
// decision, so a slow lookup never holds the others. Your yes reaches it only as the asks core's answer.
import { canonicalize, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import type { Asks, PlanStep } from '@deepbuild/asks';
import { readSince, ulid } from '@deepbuild/record';
import type { Connection, Event, EventInput, RecordStore } from '@deepbuild/record';

export type ScopeKind = 'issue' | 'resource' | 'project' | 'work';
/** A spending budget you approve. `ends` is in ms since the epoch; `runs`, when given, is how many runs it covers. */
export interface BudgetInput { scope: { kind: ScopeKind; ref: string }; runs?: number; cap_usd: number; ends: number }
/** A paid run, asking to start. `inputs` is the digest of its inputs; `resource` the key of the resource it runs on. */
export interface RunRequest { run: string; check: string; inputs: string; issue: string; resource?: string }
export interface Reserved { budget: string; usd: number }
export type Outcome =
  | { run: string; status: 'started'; reserved: Reserved[] }
  | { run: string; status: 'BLOCKED'; cause: 'budget'; owner: 'you'; budget: string; ask: string }
  | { run: string; status: 'BLOCKED'; cause: 'price'; missing: string }
  | { run: string; status: 'asked'; ask: string };
/** A budget as the ledger shows it. left_usd = cap_usd - reserved_usd - spent_usd. */
export interface BudgetView {
  budget: string;
  scope: { kind: ScopeKind; ref: string };
  cap_usd: number;
  /** How many runs it covers, or null for any number; runs_used counts every run reserved against it, charged or not. */
  runs: number | null;
  runs_used: number;
  ends: number;
  reserved_usd: number;
  spent_usd: number;
  left_usd: number;
  reservations: { run: string; usd: number }[];
}

/** Every refusal the ledger makes, naming what it refuses. */
export class BudgetRefused extends Error {
  readonly run?: string;
  readonly budget?: string;
  constructor(message: string, named: { run?: string; budget?: string } = {}) {
    super(message);
    this.name = 'BudgetRefused';
    Object.assign(this, named);
  }
}

export interface LedgerOptions {
  record: RecordStore;
  asks: Asks;
  now: () => number;
  /** The price lookup: null is a price nobody knows. */
  price: (run: RunRequest) => Promise<number | null>;
}
export interface Ledger {
  approve(connection: Connection, budget: BudgetInput): Promise<string>;
  request(connection: Connection, run: RunRequest): Promise<Outcome>;
  resolve(connection: Connection, ask: string, answer: { decision: string; budget: string }): Promise<Outcome>;
  /** A run's cost reading; `evidence` names what it was read from, such as a purchase's receipt (#69). */
  charge(connection: Connection, run: string, usd: number, evidence?: string[]): Promise<void>;
  budget(id: string): Promise<BudgetView>;
  /**
   * A run priced by its caller against the budget it names (#69: a purchase, against a budget you approved for a
   * project or a kind of work): reserved when that budget has room, counting runs reserved and not yet charged;
   * otherwise BLOCKED, with one authority ask to raise it, whose plan shows `step` at its price.
   */
  reserveIn(connection: Connection, run: RunRequest, budget: string, usd: number, step: PlanStep): Promise<Outcome>;
}

const DAY = 86_400_000;
/** A budget raise waits a day, then takes its default: no. */
const RAISE_WAIT = DAY;
/** Your yes to a run no budget covers approves a budget for that run alone at its price, for this long. */
const ONE_RUN_ENDS = DAY;
/** A paid run that ended any other way spent money on inputs that didn't pass. */
const PASSED = 'passed';
/** The trusted path: only you approve a budget, on the card or from `deep inbox answer`. */
const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
/** The one extension that answers a paid run's request for you, by naming a budget (resolver-decisions, #23). */
const RESOLVER = 'ext:resolver-decisions';
const SCOPES = new Set<string>(['issue', 'resource', 'project', 'work']);
/** The asks that close an ask; the first to append decides, and no agent closes one. */
const CLOSE_KINDS = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot'] as const;
const CLOSES = new Set<string>(CLOSE_KINDS);
/** The kinds `fold` reads: its switch is on this type, so a case for a kind left out of the list fails to compile. */
const FOLDED = ['spend.approved', 'spend.reserved', 'spend.charged', 'spend.asked', 'run.finished', 'ask.created', 'decision.applied', ...CLOSE_KINDS] as const;
type Folded = (typeof FOLDED)[number];
const RUN = /^run:[0-9A-Za-z]+$/;
const DECISION = /^decision:[0-9A-Za-z]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
type Obj = { [key: string]: JsonValue };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Money is counted in micro-dollars, so sums of cents stay exact. A price or cost coming in rounds up and a
 * cap rounds down, so the rounding never makes room; the tolerance keeps 0.1's float error from moving it.
 */
const micro = (usd: number): number => Math.round(usd * 1e6);
const microUp = (usd: number): number => Math.ceil(usd * 1e6 - 1e-6);
const microDown = (usd: number): number => Math.floor(usd * 1e6 + 1e-6);
const usd = (m: number): number => m / 1e6;
const dollars = (m: number): string => `$${usd(m).toFixed(2)}`;
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v * 1e6 <= Number.MAX_SAFE_INTEGER;

interface Budget {
  id: string;
  scope: { kind: ScopeKind; ref: string };
  cap: number;
  /** How many runs it covers; unset covers any number. */
  runs?: number;
  /** Every run reserved against it, charged or not. */
  started: Set<string>;
  ends: number;
  /** Held, unpriced, per run, until its cost reading lands. */
  reserved: Map<string, number>;
  /** The runs whose entry in reserved is the room your yes to a raise holds for them until they start. */
  held: Set<string>;
  spent: number;
  /** Set on the budget your yes approved for one run no budget covered: it covers that run alone. */
  run?: string;
}
/** A reserved run; a resolver's reservation keeps the ask it answered and the decision it applied. */
interface Run { check: string; inputs: string; budgets: Reserved[]; charged: boolean; ask: string | null; decision: string | null }
type Because = 'raise' | 'rerun' | 'uncovered';
interface Waiting {
  run: RunRequest;
  usd: number;
  because: Because;
  /** For a raise, every covering budget without room for the run: your yes adds its price to each. */
  budgets: string[];
}

/** Each record's decision queue, shared by every ledger opened on it. */
const QUEUES = new WeakMap<RecordStore, Promise<unknown>>();

const reservedOf = (b: Budget): number => [...b.reserved.values()].reduce((sum, m) => sum + m, 0);
const left = (b: Budget): number => b.cap - b.spent - reservedOf(b);
/** What's left for one run: the room your yes holds for it is its own. */
const roomFor = (b: Budget, run: string): number => left(b) + (b.held.has(run) ? b.reserved.get(run)! : 0);
/** Runs reserved against it, and the runs your yes holds room for. */
const runsUsed = (b: Budget): number => b.started.size + b.held.size;
/** Whether one more run fits: its price in what's left, and a run left of those it covers, counting the room your yes holds for it. */
const fits = (b: Budget, run: string, cost: number): boolean =>
  roomFor(b, run) >= cost && (b.runs === undefined || runsUsed(b) - (b.held.has(run) ? 1 : 0) < b.runs);
/** A budget's size as a raise names it: its runs, when it counts them, and its cap. */
const size = (runs: number | undefined, cap: number): string => `${runs === undefined ? '' : `${runs} runs and `}${dollars(cap)}`;
const sameInputs = (check: string, inputs: string): string => `${check}\u0000${inputs}`;
// Your yes to run failed inputs again is for that ask's issue and resource, not another's.
const sameAsked = (check: string, inputs: string, issue: string, resource?: string | null): string => `${sameInputs(check, inputs)}\u0000${issue}\u0000${resource ?? ''}`;

class BudgetLedger implements Ledger {
  private cursor = 0;
  private readonly budgets = new Map<string, Budget>();
  private readonly runs = new Map<string, Run>();
  /** The asks paid runs wait on, by ask handle. */
  private readonly waiting = new Map<string, Waiting>();
  private readonly closed = new Set<string>();
  /** The decision applied for you on each ask whose first close it was. */
  private readonly decided = new Map<string, string>();
  /** Yeses not yet applied: an answer can land before its ask's spend.asked. */
  private readonly yeses = new Map<string, Event>();
  /** For each check and inputs, where its paid run last failed, and where your yes to running it again landed, until a run takes it. */
  private readonly failed = new Map<string, number>();
  private readonly rerunYes = new Map<string, number>();
  /** Each ask the core raised, by its key: how the ask a request is raising is found while it's being raised. */
  private readonly created = new Map<string, string>();
  /**
   * The paid run's request whose ask is being raised, under this ledger's turn: the asks core consults the resolvers
   * before the raise returns, so resolver-decisions' answer to that ask (#23), and its read of what's left, run in
   * that turn instead of waiting behind it.
   */
  private raising: { key: string; waiting: Waiting } | undefined;

  constructor(private readonly options: LedgerOptions) {}

  /** In the turn of the request raising this ask, or in a turn of its own. */
  private async within<T>(ask: string | null, run: () => Promise<T>): Promise<T> {
    if (this.raising) {
      await this.sync();
      if (ask === null || this.created.get(this.raising.key) === ask) return run();
    }
    return this.exclusive(run);
  }

  /**
   * One decision at a time per record, across every ledger opened on it: each reads the log, then appends
   * from what it read. Readers of the log by position, this ledger and the asks core alike, take one open
   * record per database (a second open hands out positions from a block of its own), so every ledger on that
   * log shares this queue.
   */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = (QUEUES.get(this.options.record) ?? Promise.resolve()).then(run, run);
    QUEUES.set(this.options.record, next.catch(() => undefined));
    return next;
  }

  approve(connection: Connection, input: BudgetInput): Promise<string> {
    return this.exclusive(async () => {
      const via = TRUSTED[connection.writer];
      if (via === undefined) throw new BudgetRefused(`only you approve a budget, on the card or from deep inbox, not ${connection.writer}`);
      if (!isObj(input) || !isObj(input.scope) || !SCOPES.has(input.scope.kind as string) || !isText(input.scope.ref)) throw new BudgetRefused('a budget names its scope: an issue, a resource, a project or a kind of work');
      if (!isPrice(input.cap_usd)) throw new BudgetRefused('a budget has a cap in dollars, zero or more');
      if (input.runs !== undefined && !(Number.isSafeInteger(input.runs) && input.runs >= 1)) throw new BudgetRefused('a budget covers a whole number of runs, one or more');
      const now = this.options.now();
      if (!Number.isSafeInteger(input.ends) || input.ends <= now) throw new BudgetRefused('a budget ends after it is approved');
      const id = ulid(now);
      await this.append(this.core(connection), {
        v: 2, id, kind: 'spend.approved', ts: now,
        data: { scope: { kind: input.scope.kind, ref: input.scope.ref }, ...(input.runs === undefined ? {} : { runs: input.runs }), cap_usd: usd(microDown(input.cap_usd)), ends: input.ends, via },
      });
      return id;
    });
  }

  async request(connection: Connection, input: RunRequest): Promise<Outcome> {
    const run = checkRun(input);
    // The lookup runs before the decision, never under it, so every competing lookup can be open at once.
    let price: number | null;
    try {
      price = await this.options.price(structuredClone(run));
    } catch {
      price = null;
    }
    return this.exclusive(async () => {
      await this.sync();
      if (this.runs.has(run.run)) throw new BudgetRefused(`${run.run} already reserved its price`, { run: run.run });
      if (!isPrice(price)) return { run: run.run, status: 'BLOCKED', cause: 'price', missing: `the price of check ${run.check}` };
      const cost = microUp(price);
      const now = this.options.now();
      // A failed paid run isn't run again on the same inputs without a change or your yes.
      const key = sameInputs(run.check, run.inputs);
      if ((this.failed.get(key) ?? 0) > (this.rerunYes.get(sameAsked(run.check, run.inputs, run.issue, run.resource)) ?? 0)) {
        const ask = await this.wait(connection, { run, usd: cost, because: 'rerun', budgets: [] },
          `Run ${run.check} again for ${dollars(cost)} on the same inputs, whose last paid run didn't pass (${run.run})?`, 'Run it again', "Don't run it");
        return { run: run.run, status: 'asked', ask };
      }
      const covering = this.covering(run, now);
      if (covering.length === 0) {
        const ask = await this.wait(connection, { run, usd: cost, because: 'uncovered', budgets: [] },
          `No budget covers ${run.issue}. Approve ${dollars(cost)} for ${run.check} (${run.run})?`, 'Approve it', "Don't run it");
        // A resolver that named a budget with room while the ask was raised started the run.
        const started = this.runs.get(run.run);
        if (started?.ask === ask) return { run: run.run, status: 'started', reserved: started.budgets.map((b) => ({ ...b })) };
        return { run: run.run, status: 'asked', ask };
      }
      const short = covering.filter((b) => !fits(b, run.run, cost));
      if (short.length > 0) {
        // One ask raises every budget without room, each by the run and its price, so each yes holds room for its own run.
        const raises = short.map((b) => `${b.scope.ref} from ${size(b.runs, b.cap)} to ${size(b.runs === undefined ? undefined : b.runs + 1, b.cap + cost)}`).join(' and ');
        const ask = await this.wait(connection, { run, usd: cost, because: 'raise', budgets: short.map((b) => b.id) },
          `Raise the budget for ${raises}, to start ${run.check} (${run.run})?`, 'Raise it', 'Keep it as it is', 'budget.raise');
        return { run: run.run, status: 'BLOCKED', cause: 'budget', owner: 'you', budget: short[0]!.id, ask };
      }
      return this.reserve(connection, run, covering.map((b) => b.id), cost, null, now);
    });
  }

  resolve(connection: Connection, ask: string, answer: { decision: string; budget: string }): Promise<Outcome> {
    return this.within(ask, async () => {
      await this.sync();
      // The ask being raised has no spend.asked yet: its request is what it waits on.
      const waiting = this.waiting.get(ask) ?? (this.raising && this.created.get(this.raising.key) === ask ? this.raising.waiting : undefined);
      const run = waiting?.run.run;
      if (connection.writer !== RESOLVER) throw new BudgetRefused(`only ${RESOLVER} answers a paid run's request for you, not ${connection.writer}`, run ? { run } : {});
      if (!waiting || waiting.because !== 'uncovered') throw new BudgetRefused(`${ask} is no paid run's request a budget can answer`);
      if (!isObj(answer) || !isText(answer.decision) || !DECISION.test(answer.decision)) throw new BudgetRefused('a resolver answers with the decision it applies', { run: waiting.run.run });
      const now = this.options.now();
      const held = this.runs.get(waiting.run.run);
      // The same answer again, after both its appends landed, reports the start.
      if (held && held.ask === ask && held.decision === answer.decision && held.budgets.some((b) => b.budget === answer.budget)) {
        return { run: waiting.run.run, status: 'started', reserved: held.budgets.map((b) => ({ ...b })) };
      }
      if (held) throw new BudgetRefused(`${waiting.run.run} already reserved its price`, { run: waiting.run.run });
      // The decision appends before the reservation, so a failure between them strands no money: the same
      // decision sent again finds its ask decided and only reserves.
      const recovering = this.decided.get(ask) === answer.decision;
      if (this.closed.has(ask) && !recovering) throw new BudgetRefused(`${ask} has closed`, { run: waiting.run.run });
      const named = isText(answer.budget) ? this.live(answer.budget, now) : undefined;
      if (!named) throw new BudgetRefused(`${String(answer.budget)} is no budget in force`, { run: waiting.run.run, budget: String(answer.budget) });
      // The named budget, and every budget that covers the run, must each have room for its price, counting reservations.
      const budgets = [named, ...this.covering(waiting.run, now).filter((b) => b !== named)];
      const short = budgets.find((b) => !fits(b, waiting.run.run, waiting.usd));
      if (short) {
        const why = roomFor(short, waiting.run.run) < waiting.usd ? `${dollars(left(short))} left, not ${dollars(waiting.usd)}` : `no run left of its ${String(short.runs)}`;
        throw new BudgetRefused(`budget ${short.id} has ${why} for ${waiting.run.run}`, { run: waiting.run.run, budget: short.id });
      }
      if (!recovering) await this.append(this.core(connection), { v: 1, id: ulid(now), kind: 'decision.applied', subject: ask, ts: now, data: { decision: answer.decision, ask } });
      return this.reserve(connection, waiting.run, budgets.map((b) => b.id), waiting.usd, { ask, decision: answer.decision }, now);
    });
  }

  charge(connection: Connection, run: string, cost: number, evidence: string[] = []): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      if (connection.writer !== 'core') throw new BudgetRefused(`a cost reading comes from the core's runner, not ${connection.writer}`, { run });
      const held = this.runs.get(run);
      if (!held || held.charged) throw new BudgetRefused(`${String(run)} holds no reservation to charge`, { run });
      if (!isPrice(cost)) throw new BudgetRefused('a cost reading is in dollars, zero or more', { run });
      const now = this.options.now();
      await this.append(this.core(connection), { v: 1, id: ulid(now), kind: 'spend.charged', subject: run, ts: now, data: { run, usd: usd(microUp(cost)) }, ...(evidence.length ? { evidence } : {}) });
    });
  }

  budget(id: string): Promise<BudgetView> {
    return this.within(null, async () => {
      await this.sync();
      const b = this.budgets.get(id);
      if (!b) throw new BudgetRefused(`${String(id)} is no budget`, { budget: id });
      return {
        budget: b.id, scope: { ...b.scope }, cap_usd: usd(b.cap), runs: b.runs ?? null, runs_used: runsUsed(b), ends: b.ends,
        reserved_usd: usd(reservedOf(b)), spent_usd: usd(b.spent), left_usd: usd(left(b)),
        reservations: [...b.reserved].map(([r, m]) => ({ run: r, usd: usd(m) })),
      };
    });
  }

  async reserveIn(connection: Connection, input: RunRequest, id: string, price: number, step: PlanStep): Promise<Outcome> {
    const run = checkRun(input);
    return this.exclusive(async () => {
      await this.sync();
      if (this.runs.has(run.run)) throw new BudgetRefused(`${run.run} already reserved its price`, { run: run.run });
      if (!isPrice(price)) return { run: run.run, status: 'BLOCKED', cause: 'price', missing: `the price of ${run.run}` };
      const now = this.options.now();
      const named = this.live(id, now);
      if (!named) throw new BudgetRefused(`${String(id)} is no budget in force`, { run: run.run, budget: String(id) });
      const cost = microUp(price);
      if (!fits(named, run.run, cost)) {
        const runsLeft = named.runs === undefined ? '' : ` and ${Math.max(0, named.runs - runsUsed(named))} of its ${named.runs} runs`;
        const ask = await this.wait(connection, { run, usd: cost, because: 'raise', budgets: [named.id] },
          `${run.check} costs ${dollars(cost)}, and the budget for ${named.scope.ref} has ${dollars(left(named))}${runsLeft} left, counting what's reserved and not yet charged. Raise it from ${size(named.runs, named.cap)} to ${size(named.runs === undefined ? undefined : named.runs + 1, named.cap + cost)}?`,
          'Raise it', 'Keep it as it is', 'budget.raise', { ...step, cost: usd(cost) });
        return { run: run.run, status: 'BLOCKED', cause: 'budget', owner: 'you', budget: named.id, ask };
      }
      return this.reserve(connection, run, [named.id], cost, null, now);
    });
  }

  /**
   * The one append that reserves a run's price against all of its budgets, or none. Callers reach it with no
   * await since their read, and it appends before its own first await.
   */
  private async reserve(connection: Connection, run: RunRequest, budgets: string[], cost: number, answered: { ask: string; decision: string } | null, now: number): Promise<Outcome> {
    const reserved = budgets.map((budget) => ({ budget, usd: usd(cost) }));
    await this.append(this.core(connection), {
      v: 1, id: ulid(now), kind: 'spend.reserved', subject: run.run, ts: now,
      data: { run: run.run, check: run.check, inputs: run.inputs, issue: run.issue, resource: run.resource ?? null, budgets: reserved, ask: answered?.ask ?? null, decision: answered?.decision ?? null },
    });
    return { run: run.run, status: 'started', reserved };
  }

  /** Raises the ask a paid run waits on, and records what your yes to it does. */
  private async wait(connection: Connection, waiting: Waiting, question: string, yes: string, no: string, source = 'generation.paid', step?: PlanStep): Promise<string> {
    const { run } = waiting;
    const now = this.options.now();
    const key = sha256Hex(canonicalize({ because: waiting.because, check: run.check, inputs: run.inputs, run: run.run, budgets: waiting.budgets }));
    this.raising = { key, waiting };
    let ask: string;
    try {
      ask = await this.options.asks.raise(this.core(connection), source, {
        kind: 'authority', question,
        options: [{ id: 'approve', label: yes, decision: 'allow' }, { id: 'decline', label: no, decision: 'deny' }],
        recommended: null, deadline: now + RAISE_WAIT, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key,
        pinned_to: { kind: 'evidence', ref: run.inputs },
      }, { steps: [step ?? this.stepOf(waiting)], diff: run.inputs });
    } finally {
      this.raising = undefined;
    }
    await this.append(this.core(connection), {
      v: 1, id: ulid(now), kind: 'spend.asked', subject: run.run, ts: now,
      data: {
        run: run.run, check: run.check, inputs: run.inputs, issue: run.issue, resource: run.resource ?? null, usd: usd(waiting.usd), ask,
        because: waiting.because, budgets: waiting.budgets,
      },
    });
    return ask;
  }

  /** What your yes to a paid run's ask does, as its plan's one step: money a run spends can't be undone. */
  private stepOf(waiting: Waiting): PlanStep {
    const { run } = waiting;
    const raised = waiting.budgets.map((id) => this.budgets.get(id)).filter((b): b is Budget => b !== undefined);
    return waiting.because === 'raise'
      ? { does: `Raise ${raised.map((b) => `the budget for ${b.scope.ref}`).join(' and ')} by ${dollars(waiting.usd)} and start ${run.check} (${run.run})`,
        changes: raised.map((b) => `budget:${b.id}`), undo: null, public: false, cost: usd(waiting.usd) }
      : { does: `Start ${run.check} (${run.run}) for ${dollars(waiting.usd)}${waiting.because === 'rerun' ? ' on inputs whose last paid run didn\'t pass' : ', under a budget for this run alone'}`,
        changes: [run.issue], undo: null, public: false, cost: usd(waiting.usd) };
  }

  /**
   * The budgets in force that cover a run on their own: its issue's, its resource's, and one your yes approved
   * for it alone. A run names no project or kind of work, so those budgets count only when a resolver names one.
   */
  private covering(run: RunRequest, now: number): Budget[] {
    return [...this.budgets.values()].filter((b) => b.ends > now && (b.run !== undefined ? b.run === run.run
      : (b.scope.kind === 'issue' && b.scope.ref === run.issue) || (b.scope.kind === 'resource' && run.resource !== undefined && b.scope.ref === run.resource)));
  }

  private live(id: string, now: number): Budget | undefined {
    const b = this.budgets.get(id);
    return b && b.ends > now ? b : undefined;
  }

  /** The core's connection, appending for the person behind this one. */
  private core(connection: Connection): Connection {
    return { writer: 'core', actor: connection.actor, scope: connection.scope, ...(connection.session ? { session: connection.session } : {}) };
  }

  private async append(connection: Connection, event: EventInput): Promise<void> {
    await this.options.record.append(connection, event);
    await this.sync();
  }

  /**
   * Reads what the log gained since the last call, only the kinds `fold` reads, the rest never decoded. The cursor
   * moves to the head read first, so a busy log's other events are scanned once.
   */
  private async sync(): Promise<void> {
    const end = await readSince(this.options.record, this.cursor, FOLDED, (e) => {
      // A read in the raising request's turn can overlap another: each event is folded once.
      if (e.log_pos <= this.cursor) return;
      this.fold(e);
      this.cursor = e.log_pos;
    });
    this.cursor = Math.max(this.cursor, end);
  }

  private fold(e: Event): void {
    const d = isObj(e.data) ? e.data : {};
    switch (e.kind as Folded) {
      case 'spend.approved': {
        const scope = d.scope as { kind: ScopeKind; ref: string };
        this.budgets.set(e.id, {
          id: e.id, scope, cap: micro(d.cap_usd as number), ...(typeof d.runs === 'number' ? { runs: d.runs } : {}), started: new Set(), ends: d.ends as number, reserved: new Map(), held: new Set(), spent: 0,
        });
        return;
      }
      case 'spend.reserved': {
        const run = String(d.run);
        const budgets = (d.budgets as { budget: string; usd: number }[]);
        this.runs.set(run, { check: String(d.check), inputs: String(d.inputs), budgets: budgets.map((b) => ({ budget: b.budget, usd: b.usd })), charged: false,
          ask: typeof d.ask === 'string' ? d.ask : null, decision: typeof d.decision === 'string' ? d.decision : null });
        // Room held for this run by your yes becomes its reservation.
        for (const held of this.budgets.values()) if (held.held.delete(run)) held.reserved.delete(run);
        for (const b of budgets) {
          this.budgets.get(b.budget)?.reserved.set(run, micro(b.usd));
          this.budgets.get(b.budget)?.started.add(run);
        }
        // Your yes to running failed inputs again covers one run.
        this.rerunYes.delete(sameAsked(String(d.check), String(d.inputs), String(d.issue), d.resource as string | null));
        return;
      }
      case 'spend.charged': {
        const run = this.runs.get(String(d.run));
        if (!run || run.charged) return;
        run.charged = true;
        // The cost reading is what the run spent, even past its reservation: the next run sees what's left.
        for (const { budget: id } of run.budgets) {
          const b = this.budgets.get(id);
          if (!b) continue;
          b.reserved.delete(String(d.run));
          b.spent += micro(d.usd as number);
        }
        return;
      }
      case 'spend.asked': {
        const ask = String(d.ask);
        const run: RunRequest = { run: String(d.run), check: String(d.check), inputs: String(d.inputs), issue: String(d.issue) };
        if (typeof d.resource === 'string') run.resource = d.resource;
        if (this.waiting.has(ask)) return;
        this.waiting.set(ask, { run, usd: micro(d.usd as number), because: d.because as Because, budgets: (d.budgets as string[]).map(String) });
        this.grant(ask);
        return;
      }
      case 'run.finished': {
        const run = this.runs.get(String(d.run));
        if (run && d.outcome !== PASSED) this.failed.set(sameInputs(run.check, run.inputs), e.log_pos);
        return;
      }
      case 'ask.created':
        if (e.writer === 'core' && typeof d.key === 'string') this.created.set(d.key, `ask:${e.id}`);
        return;
      case 'decision.applied':
        if (e.writer !== 'core') return;
        if (!this.closed.has(String(d.ask))) this.decided.set(String(d.ask), String(d.decision));
        this.closed.add(String(d.ask));
        return;
      default:
        if (CLOSES.has(e.kind) && e.subject && !isAgent(e.writer)) this.close(e.subject, e);
    }
  }

  /** The first close of an ask decides; a yes may land before the ask's spend.asked, which then applies it. */
  private close(ask: string, e: Event): void {
    if (this.closed.has(ask)) return;
    this.closed.add(ask);
    if (e.kind !== 'ask.answered' || e.writer !== 'core' || (e.data as Obj).decision !== 'allow') return;
    this.yeses.set(ask, e);
    this.grant(ask);
  }

  /** Your yes does what the ask said it would, once both the ask's spend.asked and the yes are in. */
  private grant(ask: string): void {
    const waiting = this.waiting.get(ask);
    const e = this.yeses.get(ask);
    if (!waiting || !e) return;
    this.yeses.delete(ask);
    if (waiting.because === 'rerun') this.rerunYes.set(sameAsked(waiting.run.check, waiting.run.inputs, waiting.run.issue, waiting.run.resource), e.log_pos);
    else if (waiting.because === 'raise') {
      // Each yes adds its run's price and holds that room for its run, so no other run takes it first.
      const run = waiting.run.run;
      for (const id of waiting.budgets) {
        const b = this.budgets.get(id);
        if (!b) continue;
        b.cap += waiting.usd;
        if (b.runs !== undefined) b.runs += 1;
        if (this.runs.has(run) || b.reserved.has(run)) continue;
        b.reserved.set(run, waiting.usd);
        b.held.add(run);
      }
    } else {
      // Your yes to a run no budget covers approves a budget for that run alone, at its price.
      const id = ask.replace(/^ask:/, '');
      this.budgets.set(id, {
        id, scope: { kind: 'issue', ref: waiting.run.issue }, cap: waiting.usd, started: new Set(), ends: e.ts + ONE_RUN_ENDS, reserved: new Map(), held: new Set(), spent: 0, run: waiting.run.run,
      });
    }
  }
}

/** A run's request, as the ledger takes it; anything else is refused, naming the run. */
function checkRun(input: RunRequest): RunRequest {
  const run = isObj(input) && typeof input.run === 'string' ? input.run : undefined;
  if (!run || !RUN.test(run)) throw new BudgetRefused('a paid run is named by its run: handle', run ? { run } : {});
  if (!isText(input.check) || !isText(input.issue)) throw new BudgetRefused(`${run} names its check and its issue`, { run });
  if (typeof input.inputs !== 'string' || !SHA256.test(input.inputs)) throw new BudgetRefused(`${run}'s inputs are named by their SHA-256`, { run });
  if (input.resource !== undefined && !isText(input.resource)) throw new BudgetRefused(`${run}'s resource is named by its key`, { run });
  return { run, check: input.check, inputs: input.inputs, issue: input.issue, ...(input.resource === undefined ? {} : { resource: input.resource }) };
}

/** The ledger as a plain object of its methods, so a caller can wrap or spread it. */
export async function openLedger(options: LedgerOptions): Promise<Ledger> {
  const ledger = new BudgetLedger(options);
  return {
    approve: (connection, budget) => ledger.approve(connection, budget),
    request: (connection, run) => ledger.request(connection, run),
    resolve: (connection, ask, answer) => ledger.resolve(connection, ask, answer),
    charge: (connection, run, cost, evidence) => ledger.charge(connection, run, cost, evidence),
    budget: (id) => ledger.budget(id),
    reserveIn: (connection, run, budget, cost, step) => ledger.reserveIn(connection, run, budget, cost, step),
  };
}
