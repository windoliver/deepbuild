// Resolver replies are collected outside the core's lock and checked under it, before any answer is applied.
import { AskRefused, isObj } from './model.js';
import type { Ask, AsksPlant, BudgetLeft, HeldDecision, Option, Refusal, Resolver, ResolverAsk } from './model.js';

interface GateAnswer { resolver: string; answer: string; decision: string; budget?: BudgetLeft }
interface ResolverGateOptions {
  plant: AsksPlant | undefined;
  decision: (handle: string) => HeldDecision | undefined;
  uncovered: (decision: HeldDecision, ask: Ask) => string | null;
  apply: (ask: Ask, decision: string) => Promise<void>;
  hand: (ask: Ask, option: Option, decision: string, budget?: BudgetLeft) => void;
}

export class ResolverGate {
  /** The resolvers registered, in order, by name. */
  private readonly resolvers = new Map<string, Resolver>();
  /** The refusals made of resolvers' answers, by ask handle. */
  private readonly refused = new Map<string, Refusal[]>();

  constructor(private readonly options: ResolverGateOptions) {}

  get size(): number { return this.resolvers.size; }

  registerResolver(name: string, resolver: Resolver): () => void {
    if (typeof name !== 'string' || !name) throw new AskRefused('a resolver registers under a name', { field: 'name' });
    if (typeof resolver !== 'function') throw new AskRefused(`${name}'s resolver is a function`, { field: 'resolver' });
    this.resolvers.set(name, resolver);
    return () => { if (this.resolvers.get(name) === resolver) this.resolvers.delete(name); };
  }

  refusals(handle: string): Refusal[] {
    return (this.refused.get(handle.startsWith('ask:') ? handle : `ask:${handle}`) ?? []).map((r) => ({ ...r }));
  }

  forget(handle: string): void { this.refused.delete(handle); }

  private refuse(handle: string, resolver: string, decision: string | null, reason: string): void {
    this.refused.set(handle, [...(this.refused.get(handle) ?? []), { ask: handle, resolver, decision, reason }]);
  }

  /** Every resolver, in registration order, outside the lock. */
  async collect(handle: string, asked: ResolverAsk): Promise<GateAnswer[]> {
    const refuse = (resolver: string, decision: string | null, reason: string): void => this.refuse(handle, resolver, decision, reason);
    const answers: GateAnswer[] = [];
    for (const [name, resolver] of [...this.resolvers]) {
      let reply: unknown;
      try {
        reply = await resolver(structuredClone(asked));
      } catch (error) {
        refuse(name, null, `${name} failed on ${handle}: ${(error as Error)?.message ?? String(error)}`);
        continue;
      }
      // Nothing, from a resolver in the hub (undefined) or over the wire (null): the ask goes on.
      if (reply === undefined || reply === null) continue;
      for (const answer of [reply, ...(isObj(reply) && Array.isArray(reply.also) ? reply.also : [])]) {
        if (!isObj(answer) || typeof answer.answer !== 'string') { refuse(name, null, `${name} answered ${handle} with no option`); continue; }
        if (typeof answer.because !== 'string') { refuse(name, null, `${name} answered ${handle} without naming a decision that covers it`); continue; }
        const budget = isObj(answer.budget) && typeof answer.budget.budget === 'string' && typeof answer.budget.left_usd === 'number'
          ? { budget: answer.budget.budget, left_usd: answer.budget.left_usd } : undefined;
        answers.push({ resolver: name, answer: answer.answer, decision: answer.because, ...(budget ? { budget } : {}) });
      }
    }
    return answers;
  }

  /** Under the lock, after reading the log again: an ask closed meanwhile takes no answer. */
  async accept(handle: string, ask: Ask, answers: GateAnswer[]): Promise<void> {
    const refuse = (resolver: string, decision: string | null, reason: string): void => this.refuse(handle, resolver, decision, reason);
    // A paid run's request answered by naming a budget is applied by the ledger, the core's check of what's left
    // (#86), never here: once its decision.applied closed the ask, the agent hears it, naming the budget.
    const paid = answers.find((a) => a.budget && ask.closed?.outcome === 'decided_for_you' && ask.closed.decision === a.decision);
    if (paid) {
      const option = ask.options.find((o) => o.id === paid.answer && o.decision === 'allow');
      if (option) {
        ask.closed!.answer = option.id;
        this.options.hand(ask, option, paid.decision, paid.budget!);
      }
      return;
    }
    if (ask.closed) return;
    // A budget the ledger refused is named on the card, with what's left in it; it answers nothing.
    delete ask.budget;
    for (const a of answers.filter((x) => x.budget)) {
      ask.budget = a.budget!;
      refuse(a.resolver, a.decision, `${a.resolver} named budget ${a.budget!.budget}, which the core refused: $${a.budget!.left_usd} is left in it`);
    }
    const counted = answers.filter((a) => !a.budget).filter(({ resolver, answer, decision: named }) => {
      const decision = this.options.decision(named);
      if (!decision) { refuse(resolver, named, `${resolver} named ${named}, which the record holds no decision for`); return false; }
      const why = this.options.plant === 'decision-exists-only' ? null : this.options.uncovered(decision, ask);
      if (why !== null) { refuse(resolver, named, `${resolver} named ${named}, which ${why}`); return false; }
      if (!ask.options.some((o) => o.id === answer) || answer !== decision.answer) { refuse(resolver, named, `${resolver} answered ${answer}, not what ${named} decided (${decision.answer})`); return false; }
      return true;
    });
    // Answers that disagree answer nothing: the card shows each decision once, by the last resolver that named it.
    ask.conflict = new Set(counted.map((a) => a.answer)).size > 1
      ? [...new Map(counted.map((a) => [a.decision, { resolver: a.resolver, decision: a.decision, answer: a.answer }])).values()]
      : [];
    const [first] = counted;
    if (!first || ask.conflict.length) return;
    const option = ask.options.find((o) => o.id === first.answer)!;
    await this.options.apply(ask, first.decision);
    void option; // Planted fault: the recorded decision is never handed to the agent.
  }
}
