// The data the #69 tests build: a virtual clock, ULIDs, authority asks from ask.sources@1's fixtures, the
// plans they carry, and the card number nobody may store. It loads only the asks package's types and data.

import { createHash } from 'node:crypto';
import { askSources } from '../../../packages/asks/src/index.ts';
import type { PlanStep } from '../../../packages/asks/src/index.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/**
 * 2026-10-29 15:00 UTC: every world's clock starts here. With the settings setup drafts (batches at 00:00, 08:00
 * and 16:00 UTC), an ask raised now with its 1-day deadline waits for the 16:00 batch.
 */
export const T0 = Date.UTC(2026, 9, 29, 15, 0, 0);
export const BATCH_1 = Date.UTC(2026, 9, 29, 16, 0, 0);
export const BATCH_2 = Date.UTC(2026, 9, 30, 0, 0, 0);
/** A budget approved in these tests ends 30 days after the clock starts. */
export const ENDS = T0 + 30 * DAY;

/** What the core marks a step with no undo. */
export const CANT_UNDO = "can't undo";

export type Obj = { [key: string]: unknown };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

// ---- ULIDs and run handles minted from the virtual clock, in minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
/** A purchase is named as a paid run is: `run:<ULID>`. */
export const purchaseId = (ms: number): string => `run:${ulid(ms)}`;

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

// ---- Authority asks, from the fixtures of ask.sources@1's own rows.
/** The fixture ask of a source row, with a deadline from now and a key of its own. */
export function fixtureAsk(source: string, now: number, over: Obj = {}): Obj {
  const row = askSources().find((r) => r.source === source);
  if (!row) throw new Error(`ask.sources@1 has no row ${source}`);
  const ask = structuredClone(row.fixture.ask) as Obj;
  return { ...ask, deadline: now + DAY, key: sha256(`${source}:${String(over.question ?? ask.question)}`), ...over };
}
/** Every row of ask.sources@1 that raises authority asks. */
export const authoritySources = (): string[] => askSources().filter((r) => r.kind === 'authority').map((r) => r.source);

/** A plan as raise() takes it: its steps and the digest of the diff it shows. */
export interface Plan { steps: PlanStep[]; diff: string }
/** A step whose undo is null: one with no undo, which the core marks "can't undo". */
export const step = (does: string, changes: string[], undo: string | null, cost = 0, publicStep = false): PlanStep =>
  ({ does, changes, undo, public: publicStep, cost }) as unknown as PlanStep;
export const plan = (steps: PlanStep[], what = 'plan'): Plan => ({ steps, diff: sha256(`diff for ${what}`) });

/** A deletion of branches on origin, each restorable from its last commit. */
export const deleteBranch = (name: string): PlanStep =>
  step(`Delete branch ${name} on origin`, [`origin/${name}`], `git push origin 3f9c2ab:refs/heads/${name}`, 0, true);
/** A deletion nothing can restore. */
export const emptyBucket = (name: string): PlanStep => step(`Empty and delete the bucket s3://${name}`, [`s3://${name}`], null);
export const dropTable = (name: string): PlanStep => step(`Drop table ${name} on the production database`, [`db/${name}`], null);
export const postNotes = (channel: string): PlanStep =>
  step(`Post the v1.4.0 release notes to ${channel}`, [`slack ${channel}`], `Delete the post from ${channel}`, 0, true);

// ---- The card number DeepBuild never stores or sees: a test number that passes the Luhn check.
export const PAN = '4000056655665556';
/** How a person or a receipt writes it. */
export const PAN_FORMS = ['4000056655665556', '4000 0566 5566 5556', '4000-0566-5566-5556'] as const;
/** The processor's reference to the card it holds: what a card rule names instead of a number. */
export const CARD_REF = 'pm_1Q2w3E4r5T6yU7iO';
/** True when text holds the card number, whatever spaces or dashes split it. */
export const holdsPan = (text: string): boolean => text.replace(/[\s-]/g, '').includes(PAN);
