// Structured ask keys and saved-decision matching. No words from a question enter a subject key.
import { canonicalize, sha256Hex } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { isObj, letters } from './model.js';
import type { Ask, AsksPlant, Card, HeldDecision, Obj } from './model.js';
import { UNCOVERED } from './targets.js';
import type { CardTarget } from './targets.js';

interface DecisionKeysOptions {
  session: (session: string) => { project: string | null; worktree: string } | undefined;
  byKey: (key: string) => HeldDecision[];
  byNear: (key: string) => HeldDecision[];
  plant: AsksPlant | undefined;
}

export class DecisionKeys {
  constructor(private readonly options: DecisionKeysOptions) {}

  /**
   * The repo a session started in, as a scope names it: the project its session.start was recorded under, in letters
   * and digits, as the hub writes it when it saves your inbox answer (`repo:<project>`); with no project, an ID derived
   * from its worktree. Null when the record knows neither.
   */
  repoOf(session: string | undefined): string | null {
    const started = session ? this.options.session(session) : undefined;
    if (!started) return null;
    const project = started.project === null ? '' : letters(started.project);
    return project || sha256Hex(new TextEncoder().encode(started.worktree));
  }

  /**
   * The targets of an ask's plan no decision covers and no wider scope is offered for: those only the agent read, or
   * that nothing names (#1098). The planted wrong cores ignore them.
   */
  unplaced(ask: Ask): CardTarget[] {
    if (this.options.plant === 'rule-by-recipient-kind' || this.options.plant === 'wider-scope-offered') return [];
    return (ask.targets ?? []).filter((t) => UNCOVERED.has(t.origin));
  }
  unplacedWhy(ask: Ask): string | null {
    const t = this.unplaced(ask)[0];
    return t ? `can't cover ${ask.handle}'s ${t.kind} ${t.ref}, which nothing you typed or approved names (${t.origin}${t.first ? `, first in ${t.first}` : ''})` : null;
  }

  /** The scope your answer to an ask is saved at: its session's project, or its session when it started in none; null with neither. */
  scopeOf(ask: Ask): string | null {
    const project = letters(this.options.session(ask.session)?.project ?? '');
    return project ? `repo:${project}` : ask.session ? `session:${letters(ask.session)}` : null;
  }

  /** Whether a scope covers an ask: everywhere, its session, or its session's repo. */
  scopeCovers(scope: string, ask: Ask): boolean {
    if (scope === 'all') return true;
    if (scope.startsWith('session:')) return ask.session !== '' && letters(scope.slice('session:'.length)) === letters(ask.session);
    const repo = this.repoOf(ask.session);
    return repo !== null && scope === `repo:${repo}`;
  }

  /**
   * Why a decision doesn't cover an ask, or null when it does: active, of its key, at a scope covering it, not
   * overruled there, within the size bound of the change it was saved from, and no file in the ask's change needs you.
   */
  uncovered(decision: HeldDecision, ask: Ask): string | null {
    // A frozen rule keeps deciding at its scope; only widening waits on more evidence.
    if (decision.state === 'revoked') return 'was revoked';
    if (decision.key !== ask.data.key) return `is a decision of another kind than ${ask.handle}'s`;
    if (!this.scopeCovers(decision.scope, ask)) return `is saved at ${decision.scope}, which doesn't cover ${ask.handle}'s session`;
    const over = [...decision.overruled].find((at) => this.scopeCovers(at, ask));
    if (over) return `was overruled at ${over}`;
    const lines = linesOf(ask.data.subject);
    if (decision.bound !== null && lines !== null && lines > decision.bound) return `covers changes up to ${decision.bound} lines, and ${ask.handle}'s is ${lines}`;
    const person = needsPerson(ask.data);
    if (person.length) return `can't cover a change to ${person.join(', ')}, which needs you`;
    return null;
  }

  /** The decisions that cover an ask. */
  covering(ask: Ask): HeldDecision[] {
    return this.options.byKey(String(ask.data.key)).filter((d) => this.uncovered(d, ask) === null);
  }

  /**
   * The nearest saved decision to an ask none covers, to suggest and never apply: of its key at another scope or
   * past a bound first, else of its ask kind with the most subject fields alike (an authority ask's effect, a
   * choice's or a definition's point, and a taste call's screen or element must match); the latest among equals.
   */
  suggest(ask: Ask): Card['suggested'] {
    if (ask.closed || !isObj(ask.data.subject) || this.covering(ask).length) return null;
    const subject = ask.data.subject;
    const alike = (d: HeldDecision): number => {
      const s = d.subject;
      if (!s || d.kind !== ask.data.kind) return -1;
      if (ask.data.kind === 'authority') {
        if (s.effect !== subject.effect) return -1;
        const [a, b] = [isObj(s.target) ? s.target : {}, isObj(subject.target) ? subject.target : {}];
        const n = Number(a.kind === b.kind) + Number(a.owner === b.owner) + Number((isObj(s.change) ? s.change.kind : null) === (isObj(subject.change) ? subject.change.kind : null));
        return n >= 2 ? n : -1;
      }
      if (ask.data.kind === 'taste') return Number(s.screen === subject.screen) + Number(s.element === subject.element) || -1;
      return s.point === subject.point ? 1 : -1;
    };
    let best: { d: HeldDecision; score: number } | undefined;
    for (const d of [...this.options.byKey(String(ask.data.key)), ...this.options.byNear(nearOf(String(ask.data.kind), subject))]) {
      if (d.state !== 'active' || [...d.overruled].some((at) => this.scopeCovers(at, ask))) continue;
      const score = d.key === ask.data.key ? 100 : alike(d);
      if (score >= 0 && (!best || score >= best.score)) best = { d, score };
    }
    return best ? { decision: best.d.handle, answer: best.d.answer, scope: best.d.scope } : null;
  }
}

/** The ask kinds that name a subject, and so are keyed from it. */
export const SUBJECT_KINDS = new Set(['authority', 'taste', 'choice', 'definition']);

/**
 * An ask's key, from its subject's structured fields alone, never its words: for an authority ask the effect class,
 * the target's kind, its owner (a PR the asking thread opened is its own, whatever its number) and the kind of
 * change; for a taste call the screen and the element; for a choice or a definition the point and its option IDs.
 * The hub reads it too, to tell whether a saved decision covers a permission prompt before raising anything (#23).
 */
export function subjectKey(data: Obj, thread: string): string {
  const s = data.subject as Obj;
  const target = isObj(s.target) ? s.target : {};
  const owner = String(target.owner);
  const fields = data.kind === 'authority'
    ? { effect: String(s.effect), target: String(target.kind), owner: owner === `thread:${thread}` ? 'self' : owner, change: isObj(s.change) ? String(s.change.kind) : null }
    : data.kind === 'taste' ? { screen: String(s.screen), element: String(s.element) }
      : { point: String(s.point), options: (Array.isArray(data.options) ? data.options : []).map((o) => String(isObj(o) ? o.id : o)).sort() };
  return sha256Hex(canonicalize({ key: 1, kind: String(data.kind), ...fields } as JsonValue));
}

/** What a near match must share: an authority ask's effect, a choice's or a definition's point; any taste call. */
export const nearOf = (kind: string, subject: Obj): string =>
  JSON.stringify([kind, kind === 'authority' ? subject.effect : kind === 'taste' ? null : subject.point]);

/** CI workflow files and git hook scripts: a push or merge touching one needs you, whatever a decision says. */
const PERSON_PATHS = /^(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.git\/hooks\/|\.githooks\/|\.husky\/)/;
/** The paths in an ask's change that need a person. */
export const needsPerson = (data: Obj): string[] => {
  const change = isObj(data.subject) && isObj(data.subject.change) ? data.subject.change : undefined;
  return Array.isArray(change?.paths) ? change.paths.filter((p): p is string => typeof p === 'string' && PERSON_PATHS.test(p.replace(/^\.\//, ''))) : [];
};
/** The size of an ask's change in lines, or null when it carries none. */
export const linesOf = (subject: unknown): number | null => (isObj(subject) && isObj(subject.change) && typeof subject.change.lines === 'number' ? subject.change.lines : null);
/** The size bound a decision saved from a change of `lines` sets: up to twice its size, and at least 50 lines. */
export const boundFor = (lines: number | null): number | null => (lines === null ? null : Math.max(2 * lines, 50));

export const FOLD_SOURCE = 'asks.fold';
/** Where the core drafts a request for the owner of a block that isn't yours. */
export const REQUEST_SOURCE = 'request.draft';
/** Where the core raises the task for a stop's block (#85): one per block, shared by every session it stopped. */
export const BLOCK_SOURCE = 'stop.block';

/** The fold's exception is keyed on its thread, never on a session ID that /clear or /compact rotates. */
export const foldKey = (thread: string): string => sha256Hex(new TextEncoder().encode(`${FOLD_SOURCE}:${thread}`));
/** A request is keyed on its block's subject, so a newer block on the same subject supersedes its request too. */
export const requestKey = (block: Ask): string => sha256Hex(new TextEncoder().encode(`${REQUEST_SOURCE}:${String(block.data.key)}`));
/** A stop's task is keyed on its block's signature: the same block in any session is one task (#85). */
export const blockKey = (signature: string): string => sha256Hex(new TextEncoder().encode(`${BLOCK_SOURCE}:${signature}`));
