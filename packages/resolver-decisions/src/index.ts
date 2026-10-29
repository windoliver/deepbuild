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

const KINDS = ['ask.created', 'decision.created', 'decision.revoked', 'decision.overruled', 'decision.judged', 'spend.approved'] as const;
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
  /** The size of each ask's change, by ask handle, for the bound a decision saved from it sets. */
  const lines = new Map<string, number>();
  /** Who each ask was raised for, by ask handle: whom an answer naming a budget is made for. */
  const raisedFor = new Map<string, { actor: string; scope: string }>();
  /** The project budgets you approved, by the repo they cover, in the order you approved them. */
  const projects = new Map<string, string[]>();

  const sync = async (): Promise<void> => {
    for (;;) {
      const page = await options.record.read({ after: cursor, limit: PAGE, kinds: KINDS });
      for (const e of page) {
        if (e.log_pos <= cursor) continue;
        cursor = e.log_pos;
        const d = isObj(e.data) ? e.data : {};
        if (e.kind === 'ask.created') {
          const change = isObj(d.subject) && isObj(d.subject.change) ? d.subject.change : undefined;
          if (typeof change?.lines === 'number') lines.set(`ask:${e.id}`, change.lines);
          raisedFor.set(`ask:${e.id}`, { actor: e.actor, scope: e.scope });
        } else if (e.writer !== 'core') {
          // Only the core records a decision or a budget you approved; anything else is no decision of yours.
        } else if (e.kind === 'spend.approved') {
          if (isObj(d.scope) && d.scope.kind === 'project' && typeof d.scope.ref === 'string') {
            const repo = letters(d.scope.ref);
            projects.set(repo, [...(projects.get(repo) ?? []), e.id]);
          }
        } else if (e.kind === 'decision.created') {
          const size = lines.get(String(d.ask));
          const saved: Saved = {
            handle: `decision:${e.id}`, key: String(d.key), scope: String(d.scope), answer: String(d.answer),
            bound: size === undefined ? null : Math.max(2 * size, 50), revoked: false, overruled: new Set(), pos: e.log_pos,
          };
          byHandle.set(saved.handle, saved);
          byKey.set(saved.key, [...(byKey.get(saved.key) ?? []), saved]);
        } else {
          // Revoked, overruled everywhere or at one scope, or judged: a frozen rule keeps deciding at its scope.
          const saved = byHandle.get(String(d.decision));
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
    const who = raisedFor.get(ask.ask);
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
