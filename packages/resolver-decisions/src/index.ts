// @deepbuild/resolver-decisions: the first-party resolver that ships on by default (#23). It answers an ask only by
// naming a decision you saved that covers it by kind (the key DeepBuild computed from the ask's subject) and scope
// (its session, its repo, or all your repos), never by wording. The asks core gates every answer it gives; this
// package only finds the covering decisions in the record.
//
// A decision covers an ask when it is active, of the ask's key, saved at a scope that covers the ask's session, not
// overruled at a scope that does, within the size bound of the change it was saved from, and when no file in the
// ask's change needs you. When the covering decisions agree it answers with one, the narrowest and then the latest;
// when they disagree it gives each, so the core applies none and the ask reaches you showing both.
//
// A paid or live run's request that no decision covers is answered by naming the budget you approved for its repo
// to the ledger (#86), which checks it has room counting runs reserved and not yet charged, and applies it; the
// answer says how much is left. A budget the ledger refuses is named back, so the ask reaches you showing it.
import type { BudgetLeft, Resolver, ResolverAnswer, ResolverAsk } from '@deepbuild/asks';
import { BudgetRefused, type Ledger } from '@deepbuild/budget';
import type { Connection, RecordStore } from '@deepbuild/record';

export { evidence, judge, type Evidence } from './rules.js';

interface Saved { handle: string; key: string; scope: string; answer: string; bound: number | null; revoked: boolean; overruled: Set<string>; pos: number }

const KINDS = ['session.start', 'session.end', 'decision.created', 'decision.revoked', 'decision.overruled', 'decision.judged', 'spend.approved'] as const;
/** How many ended sessions' decisions at their own scope stay in memory; the record keeps them all. */
const ENDED_KEPT = 64;
const PAGE = 1000;
/** How the ledger knows the one extension that answers a paid run's request for you. */
const WRITER = 'ext:resolver-decisions';
/** A session or project ID as a scope names it: letters and digits only. */
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Narrower first: a session's decision before its repo's, before all your repos'. */
const width = (scope: string): number => (scope.startsWith('session:') ? 0 : scope.startsWith('repo:') ? 1 : 2);

export function resolverDecisions(options: { record: RecordStore; ledger?: Ledger }): Resolver {
  let cursor = 0;
  const byKey = new Map<string, Saved[]>();
  const byHandle = new Map<string, Saved>();
  /** The project budgets you approved, by the repo they cover, in the order you approved them. */
  const projects = new Map<string, string[]>();
  /** The sessions that ended, oldest first. */
  const ended = new Set<string>();

  /**
   * Past the newest ended sessions, each one's decisions at its own scope leave memory (#824). The record keeps them
   * all: the session starting again reads them back (`rehydrate`), so it is never asked what it answered (invariant 4).
   * One overruled at a scope stays, since the record's table doesn't keep the scopes.
   */
  const forgetEnded = (): void => {
    for (const session of [...ended].slice(0, Math.max(0, ended.size - ENDED_KEPT))) {
      ended.delete(session);
      for (const saved of [...byHandle.values()].filter((s) => s.scope === `session:${letters(session)}` && !s.overruled.size)) {
        byHandle.delete(saved.handle);
        const rest = (byKey.get(saved.key) ?? []).filter((s) => s !== saved);
        if (rest.length) byKey.set(saved.key, rest);
        else byKey.delete(saved.key);
      }
    }
  };
  /** An ask as it was raised, from the record: the size of its change, and whom it was raised for. */
  const askOf = async (ask: string): Promise<{ lines: number | undefined; who: { actor: string; scope: string } } | undefined> => {
    const [row] = (await options.record.raw('SELECT actor, scope, data FROM events WHERE id = ? AND kind = ?', [ask.slice(4), 'ask.created'])) as { actor: string; scope: string; data: string }[];
    if (!row) return undefined;
    const d: unknown = JSON.parse(row.data);
    const change = isObj(d) && isObj(d.subject) && isObj(d.subject.change) ? d.subject.change : undefined;
    return { lines: typeof change?.lines === 'number' ? change.lines : undefined, who: { actor: row.actor, scope: row.scope } };
  };
  const bound = (lines: number | undefined): number | null => (lines === undefined ? null : Math.max(2 * lines, 50));
  /** Holds a decision once: one already held, read back or folded, stays as it is. */
  const hold = (saved: Saved): void => {
    if (byHandle.has(saved.handle)) return;
    byHandle.set(saved.handle, saved);
    byKey.set(saved.key, [...(byKey.get(saved.key) ?? []), saved]);
  };
  /** A decision held from the record's table row: one that left memory with its session (#824). */
  const readBack = async (row: { id: string; key: string; scope: string; answer: string; ask_id: string; state: string; log_pos: number | bigint }): Promise<Saved> => {
    const from = await askOf(`ask:${row.ask_id}`);
    const saved: Saved = { handle: `decision:${row.id}`, key: row.key, scope: String(JSON.parse(row.scope)), answer: String(JSON.parse(row.answer)), bound: bound(from?.lines), revoked: row.state === 'revoked', overruled: new Set(), pos: Number(row.log_pos) };
    hold(saved);
    return byHandle.get(saved.handle)!;
  };
  const COLUMNS = 'd.id, d.key, d.scope, d.answer, d.ask_id, d.state, e.log_pos FROM decisions d JOIN events e ON e.id = d.id';
  /** A decision by its handle: held, or read back for one that left memory, so what happens to it later still lands on it. */
  const savedOf = async (handle: string): Promise<Saved | undefined> => {
    const known = byHandle.get(handle);
    if (known) return known;
    const [row] = (await options.record.raw(`SELECT ${COLUMNS} WHERE d.id = ?`, [handle.replace(/^decision:/, '')])) as Parameters<typeof readBack>[0][];
    return row ? readBack(row) : undefined;
  };
  /**
   * A session starting: the decisions saved at its scope before that, which left memory with it, come back from the
   * record (#824). Later ones arrive through the log, so a replay holds each once.
   */
  const rehydrate = async (session: string, before: number): Promise<void> => {
    const rows = (await options.record.raw(`SELECT ${COLUMNS} WHERE d.scope = ? AND e.log_pos < ?`, [JSON.stringify(`session:${letters(session)}`), before])) as Parameters<typeof readBack>[0][];
    for (const row of rows) if (!byHandle.has(`decision:${row.id}`)) await readBack(row);
  };

  const sync = async (): Promise<void> => {
    for (;;) {
      const page = await options.record.read({ after: cursor, limit: PAGE, kinds: KINDS });
      for (const e of page) {
        if (e.log_pos <= cursor) continue;
        cursor = e.log_pos;
        const d = isObj(e.data) ? e.data : {};
        if (e.kind === 'session.start') {
          if (e.session) {
            ended.delete(e.session);
            await rehydrate(e.session, e.log_pos);
          }
        } else if (e.kind === 'session.end') {
          // Only a verified end counts: an unverified one ends nothing, as in the hub.
          if (e.session && !e.unverified) ended.add(e.session);
          forgetEnded();
        } else if (e.writer !== 'core') {
          // Only the core records a decision or a budget you approved; anything else is no decision of yours.
        } else if (e.kind === 'spend.approved') {
          if (isObj(d.scope) && d.scope.kind === 'project' && typeof d.scope.ref === 'string') {
            const repo = letters(d.scope.ref);
            projects.set(repo, [...(projects.get(repo) ?? []), e.id]);
          }
        } else if (e.kind === 'decision.created') {
          // The bound comes from the ask it was saved from, read from the record: nothing here keeps every ask.
          hold({ handle: `decision:${e.id}`, key: String(d.key), scope: String(d.scope), answer: String(d.answer), bound: bound((await askOf(String(d.ask)))?.lines), revoked: false, overruled: new Set(), pos: e.log_pos });
        } else {
          // Revoked, overruled everywhere or at one scope, or judged: a frozen rule keeps deciding at its scope. One that
          // left memory is read back for it, and an overrule at a scope then keeps it, since the table has no scopes.
          const saved = await savedOf(String(d.decision));
          if (!saved) continue;
          if (e.kind === 'decision.overruled' && typeof d.at === 'string') saved.overruled.add(d.at);
          else if (e.kind !== 'decision.judged' || d.state === 'revoked') saved.revoked = true;
        }
      }
      if (page.length < PAGE) return;
    }
  };

  const covers = (scope: string, ask: ResolverAsk): boolean =>
    scope === 'all' || (scope.startsWith('session:') && letters(scope.slice(8)) === letters(ask.session)) || (ask.repo !== null && scope === `repo:${ask.repo}`);

  /**
   * A paid run's request, answered from the budget you approved for the ask's repo: the ledger checks its room and
   * applies it. The budget the ledger refused, when none had room. Nothing for any other ask, which the ledger
   * refuses without naming a budget.
   */
  const fromBudget = async (ledger: Ledger, ask: ResolverAsk): Promise<ResolverAnswer | undefined> => {
    const allow = ask.options.find((o) => o.decision === 'allow');
    const who = (await askOf(ask.ask))?.who;
    if (!allow || !who || ask.repo === null) return undefined;
    const connection: Connection = { writer: WRITER, ...who, ...(ask.session ? { session: ask.session } : {}) };
    let refused: BudgetLeft | undefined;
    for (const budget of projects.get(ask.repo) ?? []) {
      // Your approval of the budget is the decision that answers for you.
      const decision = `decision:${budget}`;
      try {
        const outcome = await ledger.resolve(connection, ask.ask, { decision, budget });
        if (outcome.status !== 'started') continue;
        return { answer: allow.id, because: decision, budget: { budget, left_usd: (await ledger.budget(budget)).left_usd } };
      } catch (error) {
        if (!(error instanceof BudgetRefused) || error.budget === undefined) return undefined;
        refused ??= { budget: error.budget, left_usd: (await ledger.budget(error.budget)).left_usd };
      }
    }
    return refused ? { answer: allow.id, because: `decision:${refused.budget}`, budget: refused } : undefined;
  };

  return async (ask: ResolverAsk): Promise<ResolverAnswer | undefined> => {
    await sync();
    // A change that touches a CI workflow file or a git hook script needs you, whatever you decided.
    if (ask.needs_person.length) return undefined;
    const size = ask.subject && 'change' in ask.subject ? ask.subject.change?.lines ?? null : null;
    const covering = (byKey.get(ask.key) ?? []).filter((d) => !d.revoked && covers(d.scope, ask)
      && ![...d.overruled].some((at) => covers(at, ask)) && (d.bound === null || size === null || size <= d.bound)
      && ask.options.some((o) => o.id === d.answer));
    const [cited, ...rest] = [...covering].sort((a, b) => width(a.scope) - width(b.scope) || b.pos - a.pos);
    if (!cited) return options.ledger && ask.kind === 'authority' ? fromBudget(options.ledger, ask) : undefined;
    // Decisions that disagree are each given, so the core applies none and the ask reaches you showing them.
    if (rest.some((d) => d.answer !== cited.answer)) return { answer: cited.answer, because: cited.handle, also: rest.map((d) => ({ answer: d.answer, because: d.handle })) };
    return { answer: cited.answer, because: cited.handle };
  };
}
