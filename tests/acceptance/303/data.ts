// The fixtures the #303 tests hand the kernel: a clock, the prompts the issue fixes, work.item@1 readings, and
// definitions of done as the drafting job would hand them over. It loads only the contracts package's types
// and the tasks surface's types, so a file that reads it alone still type-checks against the surface.

import { createHash } from 'node:crypto';
import type { DefinitionInput, From, WorkItem } from '../../../packages/tasks/src/index.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-27 09:00 UTC: every world's clock starts here. Three asks over three days land on the 27th, 28th and 29th. */
export const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);

export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export type Obj = { [key: string]: unknown };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

// ---- The prompts the issue fixes. Only these texts are fixed; the kernel's rule over other text is its own.
/** Asks for new or changed behavior: opens a task. */
export const CHANGE = 'make the auth middleware reject expired tokens';
/** Only asks a question: opens no task. */
export const QUESTION = 'explain how the auth middleware checks expiry';
/** Typed while the agent works: only a question. */
export const MID_QUESTION = 'why did you pick bcrypt?';
/** Typed while the agent works: asks for new behavior. */
export const MID_CHANGE = 'also add a test for expired tokens';
/** Changes no behavior: opens no task (design: "A prompt that changes no behavior, such as a rename"). */
export const RENAME = 'rename `fooBar` to `fooBaz` everywhere';
/** Three asks over three days, each of a shape the issue fixes as asking for a change. */
export const THREE_ASKS = [CHANGE, MID_CHANGE, 'make the auth middleware reject revoked tokens'] as const;
/** Prompts that fire UserPromptSubmit with an origin nobody typed; each would read as a change if a person had typed it. */
export const AUTOMATIC: readonly { from: From; text: string }[] = [
  { from: 'scheduled', text: '/loop iteration 3: make the deploy script retry on a 502' },
  { from: 'subagent', text: 'Background subagent finished: add the missing test for expired tokens' },
  { from: 'session', text: 'Message from session S9: make the auth middleware reject expired tokens' },
];

// ---- work.item@1 readings, as a test source gives them (design: Work source). Roles come from here, never from text.
export const YOU = { handle: 'you', role: 'owner' } as const;
export const COLLABORATOR = { handle: 'sam', role: 'collaborator' } as const;
export const OUTSIDE = { handle: 'mallory', role: 'outside' } as const;
export const BASE_COMMIT = '7b39aa0d0c006301ee72a96c3ce9868181205803';

/** The reading for a session's own ask: you typed it, so you are its one author. */
export function sessionItem(task_ref: string, text: string, updated: number): WorkItem {
  return { source_id: task_ref, link: task_ref, title: text, body: text, criteria: [text], authors: [YOU], updated };
}
/** An issue, as the test source reads it, with a comment from an account outside the repo. */
export function issueItem(comment: string, updated: number): WorkItem {
  return {
    source_id: 'test:303', link: 'test:303', title: 'Expired tokens are accepted',
    body: `The auth middleware accepts an expired token.\n\n---\ncomment by ${OUTSIDE.handle}: ${comment}`,
    criteria: ['the auth middleware rejects an expired token', comment],
    authors: [YOU, COLLABORATOR, OUTSIDE],
    updated,
  };
}

/** A definition as the drafting job would hand it over for one of the session's asks: one requirement per ask, with no check file. */
export function sessionDefinition(task_ref: string, text: string, root: string, n: number, updated: number): DefinitionInput {
  return {
    task_ref,
    requirements: [
      { id: 'R1', text: `${text}: the behavior is proven through its entry point`, author: YOU.handle, checks: [], oracle: 'code', depth: 'unit' },
      { id: 'R2', text: `no visible change on the main routes after ask ${n}`, author: YOU.handle, checks: [], oracle: 'code', depth: 'journey' },
    ],
    deliverables: [`src/auth/middleware.ts`],
    issue_rev: `rev-${n}`,
    base_commit: BASE_COMMIT,
    root,
    item: sessionItem(task_ref, text, updated),
  };
}

/** The issue's definition: your requirement, and one drawn from the outside account's comment. */
export function issueDefinition(task_ref: string, comment: string, root: string, updated: number): DefinitionInput {
  return {
    task_ref,
    requirements: [
      { id: 'R1', text: 'the auth middleware rejects an expired token', author: YOU.handle, checks: [], oracle: 'code', depth: 'unit' },
      { id: 'R2', text: comment, author: OUTSIDE.handle, checks: [], oracle: 'person', depth: 'none' },
    ],
    deliverables: ['src/auth/middleware.ts'],
    issue_rev: 'rev-7',
    base_commit: BASE_COMMIT,
    root,
    item: issueItem(comment, updated),
  };
}

/** The drafted check file under .deepbuild/ that criterion 12 changes after the lock. */
export const CHECK_PATH = '.deepbuild/checks/e2e.sh';
export const CHECK_BYTES = '#!/bin/sh\nset -e\nnpm run e2e -- --grep "expired token"\n';
/** A definition whose requirement names that check file. */
export function checkedDefinition(task_ref: string, root: string, updated: number): DefinitionInput {
  return {
    task_ref,
    requirements: [
      { id: 'R1', text: 'the auth middleware rejects an expired token', author: YOU.handle, checks: [CHECK_PATH], oracle: 'code', depth: 'e2e' },
    ],
    deliverables: ['src/auth/middleware.ts'],
    issue_rev: 'rev-1',
    base_commit: BASE_COMMIT,
    root,
    item: sessionItem(task_ref, CHANGE, updated),
  };
}

/** The three fields every definition.locked carries (issue: Fields, Definition of done; design: Locked). */
export const LOCK_FIELDS = ['hash', 'issue_rev', 'base_commit'] as const;
