// Readings from the record: held time, what the budget costs, stale runs, loops, usage and billing, a session at a time so
// an update refolds only the sessions it touches.
import { isItDone, isRework } from './classify.js';
import type { Cost, HeldBy, Reading, RecordEvent } from './types.js';

const RECORD = 'record';
const WINDOW_30S = 30_000;
/** The fast-lane budget the hub's gate runs under, the band of held time. */
const BUDGET_MS = 10_000;
/** Kinds whose meaning isn't a session's: a reading, an ask and a verdict are read across the record. */
const ACROSS = new Set(['reading.recorded', 'ask.created', 'ask.answered', 'verdict.made']);

/** How a recorded reading's id ends when a classifier counted it. */
export const CLASSIFIED = 'classified';
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** Handles drop what a session's id may hold besides letters and digits, so an event from either side joins. */
const canon = (session: string): string => session.replace(/^session:/, '').replace(/[^0-9A-Za-z]/g, '');
const sessionOf = (e: RecordEvent): string | null => {
  const named = e.session ?? str(e.data.session) ?? (e.subject?.startsWith('session:') ? e.subject : null);
  return named ? canon(named) : null;
};
const inOrder = (events: readonly RecordEvent[]): RecordEvent[] => events.map((e, i) => ({ e, i })).sort((a, b) => a.e.ts - b.e.ts || a.i - b.i).map((x) => x.e);
const noHold = (): HeldBy => ({ question: 0, slow: 0, fast: 0, snapshot_start: 0, queue_wait: 0 });
const addBy = (to: HeldBy, e: RecordEvent): void => { for (const k of Object.keys(to) as (keyof HeldBy)[]) to[k] += num(e.data[k]); };
const nearestRank = (sorted: readonly number[], p: number): number | null => (sorted.length ? sorted[Math.ceil(p * sorted.length) - 1]! : null);
function bySession(events: readonly RecordEvent[]): Map<string, RecordEvent[]> {
  const out = new Map<string, RecordEvent[]>();
  for (const e of inOrder(events)) {
    const s = sessionOf(e);
    if (s) (out.get(s) ?? (out.set(s, []), out.get(s)!)).push(e);
  }
  return out;
}

export function heldTime(events: RecordEvent[], options: { budget_ms: number }) {
  const stops: { stop: string; session: string; turn: string; total_ms: number; by: HeldBy; code_changing: boolean; at: number }[] = [];
  const turns = new Map<string, { turn: string; session: string; total_ms: number; by: HeldBy }>();
  const sessions: { session: string; total_ms: number; by: HeldBy; code_changing: { stops: number; p50_ms: number | null; p95_ms: number | null; budget_ms: number; band: 'inside' | 'over'; slow_hold_ms: number } }[] = [];
  for (const [session, list] of bySession(events)) {
    const asks = list.filter((e) => e.kind === 'user.ask' && e.data.no_model !== true);
    const by = noHold();
    let total = 0;
    let holds = 0;
    const changing: number[] = [];
    let slowHold = 0;
    for (const e of list) {
      if (e.kind !== 'stop.held') continue;
      holds++;
      const hold = num(e.data.total);
      const began = e.ts - hold;
      const turn = asks.filter((a) => a.ts <= began).at(-1)?.id ?? `none:${session}`;
      const own = noHold();
      addBy(own, e);
      const code_changing = e.data.code_changing === true;
      stops.push({ stop: String(e.data.stop), session, turn, total_ms: hold, by: own, code_changing, at: e.ts });
      const t = turns.get(turn) ?? { turn, session, total_ms: 0, by: noHold() };
      t.total_ms += hold;
      addBy(t.by, e);
      turns.set(turn, t);
      total += hold;
      addBy(by, e);
      slowHold += own.slow;
      if (code_changing) changing.push(hold - own.slow);
    }
    if (!holds) continue;
    changing.sort((a, b) => a - b);
    const p95 = nearestRank(changing, 0.95);
    sessions.push({ session, total_ms: total, by, code_changing: { stops: changing.length, p50_ms: nearestRank(changing, 0.5), p95_ms: p95, budget_ms: options.budget_ms, band: p95 !== null && p95 > options.budget_ms ? 'over' : 'inside', slow_hold_ms: slowHold } });
  }
  return { stops, turns: [...turns.values()], sessions };
}

export function budgetCost(events: RecordEvent[]) {
  const items: { check: string; claim: string; turn_started: string | null }[] = [];
  let left = 0;
  let failed_after_reply = 0;
  for (const list of bySession(events).values()) {
    const started = new Map(list.filter((e) => e.kind === 'run.started').map((e) => [String(e.data.run), e]));
    for (const stop of list) {
      if (stop.kind !== 'stop.held' || !Array.isArray(stop.data.budget_cost)) continue;
      const claim = String(stop.data.claim);
      for (const check of stop.data.budget_cost as string[]) {
        left++;
        const failed = list.find((e) => e.kind === 'run.finished' && e.data.outcome === 'failed' && e.ts >= stop.ts && e.data.check === check && started.get(String(e.data.run))?.data.claim === claim);
        if (!failed) continue;
        failed_after_reply++;
        items.push({ check, claim, turn_started: list.find((e) => e.kind === 'user.ask' && e.ts > failed.ts)?.id ?? null });
      }
    }
  }
  return { left, failed_after_reply, items };
}

export function staleRuns(events: RecordEvent[]) {
  const sessions: { session: string; count: number; within_30s: number; runs: { run: string; check: string; outdated_by: string; after_ms: number | null }[] }[] = [];
  for (const [session, list] of bySession(events)) {
    const stale = list.filter((e) => e.kind === 'run.stale');
    if (!stale.length) continue;
    const runs = stale.map((e) => {
      // A claim can span stops; the run started at its last.
      const reply = list.filter((x) => x.kind === 'stop.held' && x.data.claim === e.data.claim).at(-1);
      // The turn that made the newer claim outdated it; a claim the record doesn't hold falls to the first ask after the reply.
      const newer = list.find((x) => x.kind === 'claim.made' && `claim:${x.id}` === e.data.newer_claim);
      const after = reply ? list.filter((x) => x.kind === 'user.ask' && x.ts > reply.ts) : [];
      const ask = newer ? after.filter((x) => x.ts <= newer.ts).at(-1) ?? after[0] : after[0];
      return { run: String(e.data.run), check: String(e.data.check), outdated_by: ask ? String(ask.data.from) : 'unknown', after_ms: ask && reply ? ask.ts - reply.ts : null };
    });
    sessions.push({ session, count: runs.length, within_30s: runs.filter((r) => r.after_ms !== null && r.after_ms <= WINDOW_30S).length, runs });
  }
  return { sessions };
}

export function loopHolds(events: RecordEvent[]) {
  const sessions: { session: string; places_taken: number; runs_saved: number; runs_started: number; starts: { check: string; claim: string; by: string; waited_ms: number | null }[] }[] = [];
  for (const [session, list] of bySession(events)) {
    const holds = list.filter((e) => e.kind === 'check.held');
    const begun = list.filter((e) => e.kind === 'check.held_start');
    if (!holds.length && !begun.length) continue;
    const places = holds.filter((e) => e.data.replaced !== null && e.data.replaced !== undefined).length;
    const starts = begun.map((e) => {
      const reply = list.find((x) => x.kind === 'stop.held' && x.data.claim === e.data.claim);
      return { check: String(e.data.check), claim: String(e.data.claim), by: String(e.data.by), waited_ms: reply ? e.ts - reply.ts : null };
    });
    sessions.push({ session, places_taken: places, runs_saved: places, runs_started: starts.length, starts });
  }
  return { sessions };
}

export function billingMode(sessionStart: RecordEvent): 'api_key' | 'plan' | 'unknown' {
  const { billing } = sessionStart.data;
  if (typeof billing !== 'object' || billing === null) return 'unknown';
  const set = Object.values(billing);
  return set.includes(true) ? 'api_key' : set.length ? 'plan' : 'unknown';
}
/** A session's spend as turn.usage records it: per turn as it stands, a running total as the difference from the one before. */
interface Used { id: string; turn: string; tokens: number; cost: Cost; ts: number; tasks: string[]; mode: ReturnType<typeof billingMode> }
const tasksOf = (ask: RecordEvent): string[] => (Array.isArray(ask.data.tasks) ? (ask.data.tasks as string[]) : []);
function usedIn(list: readonly RecordEvent[]): Used[] {
  const out: Used[] = [];
  let tasks: string[] = [];
  let last = { tokens: 0, usd: 0 };
  // The mode in force when the tokens were spent: a resume can change it.
  let mode: ReturnType<typeof billingMode> = 'unknown';
  for (const e of list) {
    if (e.kind === 'session.start') mode = billingMode(e);
    // An ask naming no task, a "thanks" or a goal's next turn, works on for the one before, as the hub's claims do.
    if (e.kind === 'user.ask' && tasksOf(e).length) tasks = tasksOf(e);
    if (e.kind !== 'turn.usage') continue;
    const t = e.data.tokens as { input?: unknown; cached?: unknown; output?: unknown } | undefined;
    const tokens = num(t?.input) + num(t?.cached) + num(t?.output);
    const cost = e.data.cost as Cost;
    if (e.data.covers === 'session') {
      const usd = 'usd' in cost ? cost.usd : 0;
      // A running total is a baseline, never new use: what a resumed thread starts from was counted already. One that
      // hasn't grown says nothing about the turn, which stays unknown rather than reading zero.
      if (tokens <= last.tokens) continue;
      out.push({ id: e.id, turn: String(e.data.turn), tokens: tokens - last.tokens, cost: 'usd' in cost ? { ...cost, usd: Math.max(0, usd - last.usd) } : cost, ts: e.ts, tasks, mode });
      last = { tokens, usd: Math.max(usd, last.usd) };
    } else out.push({ id: e.id, turn: String(e.data.turn), tokens, cost, ts: e.ts, tasks, mode });
  }
  return out;
}
export function planWindowTokens(events: RecordEvent[]) {
  const sessions: { session: string; mode: 'api_key' | 'plan' | 'unknown'; tokens: number; counted: boolean }[] = [];
  let counted_tokens = 0;
  for (const [session, list] of bySession(events)) {
    const start = list.filter((e) => e.kind === 'session.start').at(-1);
    const mode = start ? billingMode(start) : 'unknown';
    const used = usedIn(list);
    const tokens = used.reduce((sum, u) => sum + u.tokens, 0);
    // Only tokens known to be on a plan count; an unknown session's are never read as using its window.
    counted_tokens += used.reduce((sum, u) => sum + (u.mode === 'plan' ? u.tokens : 0), 0);
    sessions.push({ session, mode, tokens, counted: mode === 'plan' });
  }
  return { counted_tokens, sessions };
}

/** `card` is the rate card behind any estimated part: a sum with any estimate in it is an estimate. */
interface Spend { usd: number; priced: boolean; card: string | null; complete: boolean; as_of: number }
const addSpend = (to: Map<string, Spend>, key: string, s: Spend): void => {
  const o = to.get(key) ?? { usd: 0, priced: false, card: null, complete: true, as_of: 0 };
  to.set(key, { usd: o.usd + s.usd, priced: o.priced || s.priced, card: o.card ?? s.card, complete: o.complete && s.complete, as_of: Math.max(o.as_of, s.as_of) });
};
const spendCost = (s: Spend): Cost => (!s.priced ? { basis: 'unpriced' } : s.card ? { basis: 'estimated', usd: s.usd, rate_card: s.card } : { basis: 'reported', usd: s.usd });
const spendReading = (subject: string, s: Spend): Reading => ({ id: 'spend.usd', subject, value: s.priced ? s.usd : null, unit: 'usd', source: RECORD, as_of: s.as_of, basis: s.priced && !s.card ? 'observed' : 'modeled', complete: s.complete, cost: spendCost(s) });

/** What one session gives: its own readings, and what is summed across sessions. */
interface Part { readings: Reading[]; tasks: Map<string, Spend>; plan: number; failed: Map<string, { n: number; as_of: number }> }
function foldSession(session: string, list: RecordEvent[]): Part {
  const subject = `session:${session}`;
  const readings: Reading[] = [];
  const count = (id: string, value: number, as_of: number, unit = 'count', detail?: Record<string, unknown>[]) => readings.push({ id, subject, value, unit, source: RECORD, as_of, basis: 'observed', ...(detail?.length ? { detail } : {}) });

  const held = heldTime(list, { budget_ms: BUDGET_MS });
  const lastHold = (stopIds: Set<string>) => Math.max(...list.filter((e) => e.kind === 'stop.held' && stopIds.has(String(e.data.stop))).map((e) => e.ts));
  for (const t of held.turns) {
    const as_of = lastHold(new Set(held.stops.filter((s) => s.turn === t.turn).map((s) => s.stop)));
    readings.push({ id: 'held.turn', subject: t.turn, value: t.total_ms, unit: 'ms', source: RECORD, as_of, basis: 'observed', by: t.by });
  }
  for (const s of held.stops) readings.push({ id: 'held.stop', subject: s.stop, value: s.total_ms, unit: 'ms', source: RECORD, as_of: s.at, basis: 'observed', by: s.by });
  for (const s of held.sessions) {
    const as_of = lastHold(new Set(held.stops.map((x) => x.stop)));
    readings.push({ id: 'held.session', subject, value: s.total_ms, unit: 'ms', source: RECORD, as_of, basis: 'observed', by: s.by });
    if (s.code_changing.stops) {
      readings.push({ id: 'held.p50', subject, value: s.code_changing.p50_ms, unit: 'ms', source: RECORD, as_of, basis: 'observed' });
      readings.push({ id: 'held.p95', subject, value: s.code_changing.p95_ms, unit: 'ms', source: RECORD, as_of, basis: 'observed', band: s.code_changing.band });
    }
    if (s.code_changing.slow_hold_ms) count('held.slow', s.code_changing.slow_hold_ms, as_of, 'ms');
  }
  const cost = budgetCost(list);
  const newest = list.at(-1)?.ts ?? 0;
  if (cost.left) { count('budget.left', cost.left, newest); count('budget.failed_after_reply', cost.failed_after_reply, newest, 'count', cost.items); }
  for (const s of staleRuns(list).sessions) { count('stale.count', s.count, newest, 'count', s.runs); count('stale.within_30s', s.within_30s, newest); }
  for (const s of loopHolds(list).sessions) { count('loop.places_taken', s.places_taken, newest); count('loop.runs_started', s.runs_started, newest, 'count', s.starts); }

  const tasks = new Map<string, Spend>();
  const own = new Map<string, Spend>();
  const used = usedIn(list);
  const byTurn = new Map<string, { usd: number | null; cost: Cost; as_of: number }>();
  let tokens = 0;
  let plan = 0;
  for (const u of used) {
    tokens += u.tokens;
    if (u.mode === 'plan') plan += u.tokens;
    const usd = 'usd' in u.cost ? u.cost.usd : null;
    // Two stops of one turn are one row: what the turn spent.
    const turn = byTurn.get(u.turn);
    if (!turn) byTurn.set(u.turn, { usd, cost: u.cost, as_of: u.ts });
    // An unpriced part leaves the turn unpriced, and any estimated part makes it an estimate.
    else if (turn.usd === null || usd === null) byTurn.set(u.turn, { usd: null, cost: { basis: 'unpriced' }, as_of: u.ts });
    else {
      const sum = turn.usd + usd;
      const card = turn.cost.basis === 'estimated' ? turn.cost.rate_card : u.cost.basis === 'estimated' ? u.cost.rate_card : null;
      byTurn.set(u.turn, { usd: sum, cost: card ? { basis: 'estimated', usd: sum, rate_card: card } : { basis: 'reported', usd: sum }, as_of: u.ts });
    }
    const s: Spend = { usd: usd ?? 0, priced: usd !== null, card: u.cost.basis === 'estimated' ? u.cost.rate_card : null, complete: usd !== null, as_of: u.ts };
    addSpend(own, subject, s);
    for (const task of u.tasks) addSpend(tasks, task, s);
  }
  for (const [turn, t] of byTurn) readings.push({ id: 'cost.turn', subject: turn, value: t.usd, unit: 'usd', source: RECORD, as_of: t.as_of, basis: t.cost.basis === 'estimated' ? 'modeled' : 'observed', cost: t.cost });
  // A turn with no usage, such as one that crashed, leaves what it sums short: the session's, and its tasks'. A turn runs
  // from its first ask to its usage: a message typed mid-turn is the same turn, a subagent's stop ends none, and an ask no
  // model read opens none. After a failed stop or a new start the next ask opens another, but usage first means the turn
  // went on, as it does across a compaction's start.
  const asks = list.filter((e) => e.kind === 'user.ask');
  const grew = new Set(used.map((u) => u.id));
  let turn: { at: number; tasks: string[]; spent: boolean; broke: boolean } | undefined;
  let named: string[] = [];
  let unknownTurns = 0;
  const close = (): void => {
    if (!turn || turn.spent) return;
    unknownTurns++;
    for (const task of turn.tasks) addSpend(tasks, task, { usd: 0, priced: false, card: null, complete: false, as_of: turn.at });
  };
  for (const e of list) {
    if (e.kind === 'session.start' || (e.kind === 'agent.stop' && typeof e.data.cause === 'string' && e.data.cause !== 'unknown')) { if (turn) turn.broke = true; }
    else if (e.kind === 'user.ask' && e.data.no_model !== true) {
      if (tasksOf(e).length) named = tasksOf(e);
      if (turn && !turn.spent && !turn.broke) continue;
      close();
      turn = { at: e.ts, tasks: named, spent: false, broke: false };
    } else if (turn && grew.has(e.id)) turn.spent = true;
  }
  close();
  if (used.length) {
    if (unknownTurns) addSpend(own, subject, { usd: 0, priced: false, card: null, complete: false, as_of: 0 });
    readings.push(spendReading(subject, own.get(subject)!));
    readings.push({ id: 'tokens.session', subject, value: tokens, unit: 'tokens', source: RECORD, as_of: used.at(-1)!.ts, basis: 'observed', complete: !unknownTurns });
  }
  const start = list.filter((e) => e.kind === 'session.start').at(-1);
  const mode = start ? billingMode(start) : 'unknown';
  if (start) readings.push({ id: 'billing.mode', subject, value: mode, unit: 'mode', source: 'deep-hook', as_of: start.ts, basis: 'observed' });

  const typed = asks.filter((a) => a.data.from === 'person' && typeof a.data.text === 'string');
  if (typed.length) {
    const as_of = typed.at(-1)!.ts;
    for (const [id, classify] of [['is_it_done', isItDone], ['rework', isRework]] as const) {
      readings.push({ id, subject, value: typed.filter((a) => classify(String(a.data.text))).length, unit: 'count', source: RECORD, as_of, basis: 'modeled', classifier: null });
    }
    let wait = 0;
    let waited = 0;
    // A main stop writes usage behind it where the agent's usage is read; a subagent's stop never does.
    const ended = used.length ? 'turn.usage' : 'agent.stop';
    for (const a of typed) {
      const stop = list.filter((e) => e.kind === ended && e.ts < a.ts).at(-1);
      const before = list.filter((e) => e.kind === 'user.ask' && e.ts < a.ts).at(-1);
      if (stop && (!before || before.ts < stop.ts)) { wait += a.ts - stop.ts; waited = a.ts; }
    }
    if (waited) count('review.wait', wait, waited, 'ms');
  }
  const failed = new Map<string, { n: number; as_of: number }>();
  for (const e of list) {
    const sig = e.kind === 'tool.after' && e.data.outcome === 'failed' ? str(e.data.signature) : null;
    if (sig) failed.set(sig, { n: (failed.get(sig)?.n ?? 0) + 1, as_of: e.ts });
  }
  return { readings, tasks, plan, failed };
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]!;
function foldAcross(list: RecordEvent[]): Reading[] {
  const readings = new Map<string, Reading>();
  const asked = new Map<string, { kind: string; ts: number }>();
  const waits = new Map<string, { ms: number[]; as_of: number }>();
  const blocked = new Map<string, number>();
  let blockedMs = 0;
  let blockedAt = 0;
  let closed = false;
  for (const e of list) {
    if (e.kind === 'reading.recorded') {
      const id = String(e.data.reading);
      // A recorded count of a classifier's is its pattern's reading of your words, modeled like the live one.
      const classified = id.endsWith(CLASSIFIED);
      readings.set(id, { id, subject: null, value: e.data.value as number, unit: String(e.data.unit), source: String(e.data.source), as_of: num(e.data.as_of), basis: classified ? 'modeled' : 'observed', ...(classified ? { classifier: null } : {}) });
    } else if (e.kind === 'ask.created' && e.subject) {
      asked.set(e.subject, { kind: String(e.data.kind), ts: e.ts });
    } else if (e.kind === 'ask.answered' && e.subject) {
      const ask = asked.get(e.subject);
      if (!ask) continue;
      const w = waits.get(ask.kind) ?? { ms: [], as_of: 0 };
      w.ms.push(e.ts - ask.ts);
      w.as_of = e.ts;
      waits.set(ask.kind, w);
    } else if (e.kind === 'verdict.made') {
      const claim = String(e.data.claim);
      const since = blocked.get(claim);
      if (since !== undefined) { blockedMs += e.ts - since; closed = true; blockedAt = e.ts; blocked.delete(claim); }
      if (e.data.outcome === 'BLOCKED') { blocked.set(claim, e.ts); blockedAt = e.ts; }
    }
  }
  const out = [...readings.values()];
  for (const [kind, w] of waits) out.push({ id: 'approval.wait', subject: kind, value: median(w.ms), unit: 'ms', source: RECORD, as_of: w.as_of, basis: 'observed' });
  // A claim still blocked has no end yet, so the sum is short of it.
  if (blockedAt) out.push({ id: 'blocked.time', subject: null, value: closed ? blockedMs : null, unit: 'ms', source: RECORD, as_of: blockedAt, basis: 'observed', complete: blocked.size === 0 });
  return out;
}

interface Folded { events: RecordEvent[]; part: Part }
export interface ReadingsState { sessions: Map<string, Folded>; across: { events: RecordEvent[]; readings: Reading[] } }

export function recompute(events: RecordEvent[]): ReadingsState {
  return update({ sessions: new Map(), across: { events: [], readings: [] } }, events);
}
/** Refolds only the sessions the new events touch. */
export function update(state: ReadingsState, events: RecordEvent[]): ReadingsState {
  const sessions = new Map(state.sessions);
  const fresh = new Map<string, RecordEvent[]>();
  const across: RecordEvent[] = [];
  for (const e of events) {
    const s = sessionOf(e);
    if (ACROSS.has(e.kind) || !s) across.push(e);
    else (fresh.get(s) ?? (fresh.set(s, []), fresh.get(s)!)).push(e);
  }
  for (const [s, added] of fresh) {
    const all = inOrder([...(sessions.get(s)?.events ?? []), ...added]);
    sessions.set(s, { events: all, part: foldSession(s, all) });
  }
  if (!across.length) return { sessions, across: state.across };
  const allAcross = inOrder([...state.across.events, ...across]);
  return { sessions, across: { events: allAcross, readings: foldAcross(allAcross) } };
}
export function readingsOf(state: ReadingsState): Reading[] {
  const out = [...state.across.readings];
  const tasks = new Map<string, Spend>();
  const failed = new Map<string, { n: number; as_of: number }>();
  let plan = 0;
  let planAt = 0;
  for (const { part, events } of state.sessions.values()) {
    out.push(...part.readings);
    for (const [task, s] of part.tasks) addSpend(tasks, task, s);
    for (const [sig, f] of part.failed) { const o = failed.get(sig); failed.set(sig, { n: (o?.n ?? 0) + f.n, as_of: Math.max(o?.as_of ?? 0, f.as_of) }); }
    if (part.plan) { plan += part.plan; planAt = Math.max(planAt, events.at(-1)!.ts); }
  }
  for (const [task, s] of tasks) out.push(spendReading(task, s));
  for (const [sig, f] of failed) out.push({ id: 'failed_calls', subject: sig, value: f.n, unit: 'count', source: RECORD, as_of: f.as_of, basis: 'observed' });
  if (planAt) out.push({ id: 'plan.tokens', subject: null, value: plan, unit: 'tokens', source: RECORD, as_of: planAt, basis: 'observed' });
  return out;
}
