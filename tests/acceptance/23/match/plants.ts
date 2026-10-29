// The wrong programs the criteria name, planted around the real asks core, resolver-decisions and record: each is
// the real program with one part done wrong, so a scenario that passes on the real one fails on its plant for the
// reason its criterion names. plants.test.ts runs each criterion's scenario against them.
//
// A key is DeepBuild's, computed from an ask's structured subject, so a resolver "keyed on" something else is
// planted as the real program fed a subject that carries only that thing: the question's text, the ask's kind
// alone, or the PR's number. Every decision saved and every ask matched goes through the same wrong key.

import type { RecordStore } from '../../../../packages/record/src/index.ts';
import type { Asks, Resolver } from '../../../../packages/asks/src/index.ts';
import { REPO_A, type Obj, type Planting, type World } from './helpers.ts';

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The real asks core, with each ask's subject rewritten before it is raised. */
const subjectsAs = (rewrite: (subject: Obj, ask: Obj) => Obj) => (asks: Asks): Asks => ({
  ...asks,
  raise: (connection, source, ask, plan) => {
    const raised = isObj(ask) && isObj(ask.subject) ? { ...ask, subject: rewrite(structuredClone(ask.subject), ask) } : ask;
    return asks.raise(connection, source, raised, plan);
  },
});
const words = (text: unknown): string => String(text).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** #23.2395159c: a resolver keyed on the question's text: the requirement a choice is pinned to replaced by its words. */
export const keyedOnText: Planting = {
  asks: subjectsAs((subject, ask) => ('point' in subject ? { point: `text:${words(ask.question)}` } : subject)),
};

/** #23.2395159c: a resolver keyed on kind alone: every choice and definition pinned to one and the same point. */
export const keyedOnKind: Planting = {
  asks: subjectsAs((subject) => ('point' in subject ? { point: 'kind-only' } : subject)),
};

/** #23.cf7a32f5: a resolver keyed on the PR's number: the number folded into the target's kind. */
export const keyedOnNumber: Planting = {
  asks: subjectsAs((subject) => (isObj(subject.target) ? { ...subject, target: { ...subject.target, kind: `${String(subject.target.kind)}${String(subject.target.ref)}` } } : subject)),
};

/** #23.eba26419: a resolver that never reads who opened the PR: every PR counted as the asking thread's own. */
export const ownerIgnored: Planting = {
  asks: subjectsAs((subject) => (isObj(subject.target) ? { ...subject, target: { ...subject.target, owner: 'thread:T1' } } : subject)),
};

/** #23.eba26419: a resolver that never reads a change's size: every change counted as one line. */
export const sizeIgnored: Planting = {
  asks: subjectsAs((subject) => (isObj(subject.change) ? { ...subject, change: { ...subject.change, lines: 1 } } : subject)),
};

const CI = /^(\.github\/workflows\/|\.gitlab-ci\.yml$)/;
/** #23.b439b4e7: a resolver that applies the decision's size and kind bounds alone, never reading which files a change touches. */
export const boundsOnly: Planting = {
  asks: subjectsAs((subject) => (isObj(subject.change) && Array.isArray(subject.change.paths)
    ? { ...subject, change: { ...subject.change, paths: (subject.change.paths as string[]).filter((p) => !CI.test(p)) } } : subject)),
};

/** #23.6ab3f608: a resolver that keeps answering from the old decision, the one saved for all your repos, in repo A. */
export const oldDecisionKept: Planting = {
  resolver: (real: Resolver, world: World): Resolver => async (ask) => {
    const old = (await world.events('decision.created')).find((e) => isObj(e.data) && e.data.scope === 'all' && e.data.key === ask.key);
    if (old && ask.repo === REPO_A && isObj(old.data)) return { answer: String(old.data.answer), because: `decision:${old.id}` };
    return real(ask);
  },
};

/** #23.d5c718b3: a program that saves every answer for all your repos, so another repo is answered without your confirmation. */
export const savedForAll: Planting = {
  record: (record: RecordStore): RecordStore => {
    const append: RecordStore['append'] = (connection, event) => (event.kind === 'decision.created' && isObj(event.data) && String(event.data.scope).startsWith('repo:')
      ? record.append(connection, { ...event, data: { ...event.data, scope: 'all' } })
      : record.append(connection, event));
    return new Proxy(record, {
      get: (target, property) => {
        if (property === 'append') return append;
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  },
};

/**
 * #23.d5c718b3: a resolver that answers in another repo without your confirmation: it names any decision of the
 * ask's key, wherever it was saved, on a core whose gate (#349's planted one) lets it through.
 */
export const answersElsewhere: Planting = {
  core: 'decision-exists-only',
  resolver: (real: Resolver, world: World): Resolver => async (ask) => {
    const any = (await world.events('decision.created')).find((e) => isObj(e.data) && e.data.key === ask.key);
    if (any && isObj(any.data)) return { answer: String(any.data.answer), because: `decision:${any.id}` };
    return real(ask);
  },
};

/** #23.86908fce: a core that takes the first resolver's answer: every resolver registered is asked in turn, as one. */
export const firstAnswerWins: Planting = {
  asks: (asks: Asks): Asks => {
    const chain: Resolver[] = [];
    return {
      ...asks,
      registerResolver: (name, resolver) => {
        chain.push(resolver);
        if (chain.length > 1) return () => undefined;
        return asks.registerResolver(name, async (ask) => {
          for (const r of chain) {
            const answer = await r(ask);
            if (answer) return answer;
          }
          return undefined;
        });
      },
    };
  },
};
