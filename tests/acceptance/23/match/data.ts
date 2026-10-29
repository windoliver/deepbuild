// The values the #23 match tests build: a virtual clock, ULIDs minted from it, the repos, threads and
// sessions asks are raised in, and the asks themselves as ask.created data with their structured subjects.
// It loads no package, so a file that fails to load names the module that is missing.

import { createHash } from 'node:crypto';

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-27 12:00 UTC: every world's clock starts here. */
export const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A commit a pin names: 40 hex digits made from a word. */
export const commit = (word: string): string => sha256(`commit:${word}`).slice(0, 40);

// ---- ULIDs minted from the virtual clock, in minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

// ---- Where asks are raised. A repo is the project a session starts in; its scope is `repo:<project>`.
export const REPO_A = 'repoA';
export const REPO_B = 'repoB';
export const REPO_C = 'repoC';
export const repoScope = (repo: string): string => `repo:${repo}`;
/** A PR's owner, as an authority ask's subject names it: the agent thread that opened it. */
export const byThread = (thread: string): string => `thread:${thread}`;

// ---- Requirements and decision points a choice is pinned to, as record handles.
export const REQ_INDENT = 'req:01JREQINDENT0000000000000A';
export const REQ_INDENT_OTHER = 'req:01JREQINDENT0000000000000B';
export const REQ_STORE = 'req:01JREQSTORE00000000000000A';
export const REQ_LOCKFILE = 'req:01JREQLOCKFILE000000000000A';
export const REQ_SECRETS = 'req:01JREQSECRETS0000000000000A';
export const REQ_FORMAT = 'req:01JREQFORMAT00000000000000A';
export const POINT_OFFLINE = 'req:01JREQOFFLINE0000000000000A';
export const POINT_OFFLINE_OTHER = 'req:01JREQOFFLINE0000000000000B';

export type Obj = Record<string, unknown>;
const opt = (id: string, decision: 'allow' | 'deny' | 'none' = 'none') => ({ id, label: id, decision });

/** A choice an agent asks through deep_ask, pinned to a requirement: its subject names the requirement, never the words. */
export function choiceAsk(question: string, point: string, options: readonly string[], now: number): Obj {
  return {
    kind: 'choice', question, options: options.map((o) => opt(o)), recommended: options[0], deadline: now + 2 * DAY,
    fallback: 'you', default: options[0], provisional: false, owner: 'you',
    subject: { point }, pinned_to: { kind: 'evidence', ref: sha256(`shows:${point}`) },
  };
}
/** A question about what done means, from the definition's draft: its subject is the decision point. */
export function definitionAsk(question: string, point: string, options: readonly string[], now: number): Obj {
  return { ...choiceAsk(question, point, options, now), kind: 'definition' };
}
/** A taste call on a screen's element, pinned to the commit it shows. */
export function tasteAsk(question: string, screen: string, element: string, pin: string, now: number, options: readonly string[] = ['blue', 'green']): Obj {
  return {
    kind: 'taste', question, options: options.map((o) => opt(o)), recommended: options[0], deadline: now + 3 * DAY,
    fallback: 'you', default: options[0], provisional: false, owner: 'you',
    subject: { screen, element }, pinned_to: { kind: 'commit', ref: pin },
  };
}

/** The change a merge or a push carries: its kind, its size in changed lines, and the repo paths it touches. */
export interface ChangeSpec { kind: string; lines: number; paths: string[] }
/** A PR merge DeepBuild's merge guard raises: who opened the PR, and the change, set from the record, never the agent's words. */
export function mergeAsk(pr: number, opener: string, change: ChangeSpec, now: number, question = `Merge #${pr}?`): Obj {
  return {
    kind: 'authority', question, options: [opt('merge', 'allow'), opt('hold', 'deny')], recommended: null, deadline: now + DAY,
    fallback: 'you', default: 'hold', provisional: false, owner: 'you',
    subject: { effect: 'merge', target: { kind: 'pr', ref: `pr:${pr}`, owner: byThread(opener) }, change },
    pinned_to: { kind: 'commit', ref: commit(`pr ${pr} ${change.lines} ${change.paths.join(',')}`) },
  };
}
/** A 30-line fix touching only the code: what the decision to merge your own fix PRs covers. */
export const FIX_30: ChangeSpec = { kind: 'fix', lines: 30, paths: ['src/checkout/total.ts', 'src/checkout/total.test.ts'] };
/** The 40-line fix the decision is saved from. */
export const FIX_40: ChangeSpec = { kind: 'fix', lines: 40, paths: ['src/cart/sum.ts', 'src/cart/sum.test.ts'] };
/** The same fix as FIX_30 plus one changed line in a CI workflow file. */
export const FIX_30_PLUS_CI: ChangeSpec = { kind: 'fix', lines: 31, paths: [...FIX_30.paths, '.github/workflows/release.yml'] };
/** A fix far past any size bound a 40-line fix sets. */
export const FIX_HUGE: ChangeSpec = { kind: 'fix', lines: 4000, paths: ['src/cart/sum.ts', 'src/cart/rewrite.ts'] };
/** A feature the size of a small fix: another kind of change. */
export const FEATURE_30: ChangeSpec = { kind: 'feature', lines: 30, paths: ['src/cart/coupon.ts'] };
