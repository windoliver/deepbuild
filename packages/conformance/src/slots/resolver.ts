// The resolver@1 kit (#349): a resolver answers an ask for you only by naming what covers it, a decision the core
// then checks: active (saved, not revoked), of the ask's kind (saved from the same question class, its key) and at a
// scope that covers the ask's session (its session, its repo, or all). A resolver that answers without naming one,
// or names one that doesn't cover, breaks the one rule each planted fill here isolates. The reference fill looks
// the covering decision up and answers with its option; it answers nothing when none covers. Answering nothing is
// never wrong: a resolver that declines leaves the ask to you.
//
// Shape: the kit has no record, so it hands a fill the decisions as a second argument, `resolve(ask, decisions)`,
// and judges the answer by them. A resolver registered at runtime gets one argument, the ask, and reads the
// decisions from the record itself; the core then gates its answer by the same four rules the judge applies here.
// The published interface's `name` is the registering extension, as refusals name it: the host fills it in, so
// a fill here carries none.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, word } from './shared.js';

export const RESOLVER = 'resolver@1';

/** What the core hands a resolver: the ask, where it was raised, and the decisions the record holds. */
export interface ResolverAsk { ask: string; kind: string; key: string; session: string; repo: string; options: string[] }
export interface HeldDecision { decision: string; key: string; scope: string; answer: string; state: 'active' | 'revoked' }
export interface ResolverAnswer { answer: string; because: string | null }
export interface ResolverFill extends SlotFill {
  slot: 'resolver@1';
  resolve(ask: ResolverAsk, decisions: HeldDecision[]): ResolverAnswer | undefined;
}
interface Input { ask: ResolverAsk; decisions: HeldDecision[] }

const RULES = {
  names: { id: 'names-what-covers', rule: 'An answer names the decision that covers the ask; an answer naming nothing is refused and the ask goes on to you.', message: 'answered without naming a decision that covers the ask' },
  active: { id: 'names-only-active', rule: 'The decision named is active: saved and not revoked.', message: 'named a revoked decision' },
  kind: { id: 'names-the-kind', rule: 'The decision named is of the ask\'s kind: saved from an ask with the same key.', message: 'named a decision of another kind' },
  scope: { id: 'names-a-covering-scope', rule: 'The decision named is at a scope that covers the ask\'s session: that session, its repo, or all.', message: 'named a decision whose scope doesn\'t cover the ask' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

/** Whether a decision's scope covers an ask raised in `session` of `repo`. */
const covers = (scope: string, ask: { session: string; repo: string }): boolean => scope === 'all' || scope === `session:${ask.session}` || scope === `repo:${ask.repo}`;

type Fault = 'none' | 'unnamed' | 'revoked' | 'other-kind' | 'other-repo';
function reference(fault: Fault = 'none'): ResolverFill {
  return {
    slot: RESOLVER, revision: 1,
    resolve(ask, decisions) {
      const covering = decisions.find((d) => d.state === 'active' && d.key === ask.key && covers(d.scope, ask));
      if (fault === 'none') return covering ? { answer: covering.answer, because: covering.decision } : undefined;
      // Each fault takes a decision the core must refuse, when the case holds one; otherwise it behaves.
      const wrong = decisions.find((d) => fault === 'revoked' ? d.state === 'revoked' && d.key === ask.key && covers(d.scope, ask)
        : fault === 'other-kind' ? d.state === 'active' && d.key !== ask.key && covers(d.scope, ask)
          : fault === 'other-repo' ? d.state === 'active' && d.key === ask.key && !covers(d.scope, ask) : false);
      if (fault === 'unnamed') return covering || wrong ? { answer: ask.options[0]!, because: null } : (decisions.length ? { answer: ask.options[0]!, because: null } : undefined);
      if (wrong) return { answer: wrong.answer, because: wrong.decision };
      return covering ? { answer: covering.answer, because: covering.decision } : undefined;
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: ResolverFill): PlantedFill<ResolverFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<ResolverFill>[] => [
  plant('unnamed-decision', 'names', ['decision_unnamed'], reference('unnamed')),
  plant('names-revoked', 'active', ['decision_revoked'], reference('revoked')),
  plant('names-other-kind', 'kind', ['decision_other_kind'], reference('other-kind')),
  plant('names-other-repo', 'scope', ['decision_other_scope'], reference('other-repo')),
];

const PUSH = 'd2d8657f71c5081497de05489d87e82d95083fa201453bd9297aa4a1959715e5';
const MERGE = '3f0e6b2c9a1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b';
const ask = (session: string, repo: string, key = PUSH): ResolverAsk => ({ ask: `ask:${session}A`, kind: 'authority', key, session, repo, options: ['approve', 'decline'] });
const held = (decision: string, key: string, scope: string, state: HeldDecision['state'] = 'active'): HeldDecision => ({ decision: `decision:${decision}`, key, scope, answer: 'approve', state });
// The judge derives what it expects from the input alone: which decision covers, if any.
const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
// In the order the preflight's check meets them, so each planted fill is refused at its first case.
const fixtures: Fixture[] = [
  toCase('nothing-held', 'fixed', { ask: ask('S1', 'R1'), decisions: [] }),
  toCase('repo-covers', 'fixed', { ask: ask('S2', 'R1'), decisions: [held('D1', PUSH, 'repo:R1')] }),
  toCase('revoked-held', 'fixed', { ask: ask('S3', 'R1'), decisions: [held('D2', PUSH, 'repo:R1', 'revoked')] }),
  toCase('other-kind-held', 'fixed', { ask: ask('S4', 'R1'), decisions: [held('D3', MERGE, 'repo:R1')] }),
  toCase('other-repo-held', 'fixed', { ask: ask('S5', 'R1'), decisions: [held('D4', PUSH, 'repo:R2')] }),
  toCase('session-covers', 'fixed', { ask: ask('S6', 'R1'), decisions: [held('D5', PUSH, 'session:S6')] }),
  toCase('all-covers', 'fixed', { ask: ask('S7', 'R3'), decisions: [held('D6', PUSH, 'all')] }),
  toCase('other-session-held', 'fixed', { ask: ask('S8', 'R1'), decisions: [held('D7', PUSH, 'session:S9')] }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three asks from the draw, each with a mix of decisions held, at most one of which covers. */
function generate(random: Random): SlotCase[] {
  return [0, 1, 2].map((i) => {
    const session = word(random, 6).toUpperCase();
    const repo = word(random, 6).toUpperCase();
    const a = ask(session, repo);
    const decisions: HeldDecision[] = [];
    const covering = random.int(0, 1) === 1;
    if (covering) {
      const scope = ['all', `session:${session}`, `repo:${repo}`][random.int(0, 2)]!;
      decisions.push(held(word(random, 5).toUpperCase(), PUSH, scope));
    }
    const noise = random.int(0, 3);
    for (let n = 0; n < noise; n++) {
      const id = word(random, 5).toUpperCase();
      const which = random.int(0, 2);
      decisions.push(which === 0 ? held(id, PUSH, `repo:${repo}`, 'revoked') : which === 1 ? held(id, MERGE, `repo:${repo}`) : held(id, PUSH, `repo:${word(random, 6).toUpperCase()}`));
    }
    return toCase(`seeded-${i + 1}`, 'seeded', { ask: a, decisions: decisions.sort(() => (random.int(0, 1) ? 1 : -1)) });
  });
}

function* judge(fill: ResolverFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { ask: a, decisions } = c.input as unknown as Input;
  const answer = yield () => fill.resolve(structuredClone(a), structuredClone(decisions));
  // Nothing is never wrong: a resolver that declines, a covering decision held or not, leaves the ask to you.
  if (answer === undefined || answer === null) return;
  const o = object('the answer', answer);
  if (typeof o.answer !== 'string' || !a.options.includes(o.answer)) throw fail(RULES.names.message, ['decision_unnamed'], `the answer ${JSON.stringify(o.answer)} is none of ${a.ask}'s options`);
  if (o.because === null || o.because === undefined) throw fail(RULES.names.message, ['decision_unnamed'], `the answer to ${a.ask} names no decision`);
  const named = decisions.find((d) => d.decision === o.because);
  if (!named) throw fail(RULES.names.message, ['decision_unnamed'], `the answer names ${String(o.because)}, which the record doesn't hold`);
  if (named.state !== 'active') throw fail(RULES.active.message, ['decision_revoked'], `${named.decision} was revoked`);
  if (named.key !== a.key) throw fail(RULES.kind.message, ['decision_other_kind'], `${named.decision} was saved from another question, not ${a.ask}'s`);
  if (!covers(named.scope, a)) throw fail(RULES.scope.message, ['decision_other_scope'], `${named.decision} is at ${named.scope}, which doesn't cover session ${a.session} in repo ${a.repo}`);
  if (o.answer !== named.answer) throw fail(RULES.names.message, ['decision_unnamed'], `the answer ${o.answer} isn't ${named.decision}'s, ${named.answer}`);
}

export const resolverKit = (): SlotKitImpl<ResolverFill> => ({
  slot: RESOLVER, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
