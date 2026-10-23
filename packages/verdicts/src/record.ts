// Verdicts into the record: each one a new verdict.made event from the core, never an edit of a row.
import { ulid } from '@deepbuild/record';
import type { Connection, RecordStore } from '@deepbuild/record';
import { staleReason } from './engine.js';
import type { RecordedVerdict, Verdict } from './types.js';

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** verdict.made's string fields hold at most this many characters. */
const CAP = 8192;
const cut = (s: string): string => (s.length > CAP ? s.slice(0, CAP) : s);
/** Its run counts are u16: a count past it reads as the most the field holds. */
const U16 = 65535;

/** Appends the verdict as a new verdict.made event at `at`. A pending verdict isn't made yet, so it is refused. */
export async function recordVerdict(record: RecordStore, verdict: Verdict, at: number): Promise<RecordedVerdict> {
  if (verdict.outcome === 'pending') throw new Error(`${verdict.claim}: a pending verdict isn't made yet and isn't recorded`);
  const id = ulid(at);
  const handle = `verdict:${id}`;
  const { log_pos } = await record.append(CORE, {
    v: 1, id, kind: 'verdict.made', ts: at, subject: verdict.claim,
    data: {
      outcome: verdict.outcome, verdict: handle, claim: verdict.claim,
      reasons: verdict.reasons.map(cut),
      requirements: verdict.requirements.map((r) => ({
        ...r, check: cut(r.check), smallest: r.smallest === null ? null : cut(r.smallest), points_to: r.points_to === null ? null : cut(r.points_to),
        runs: { ...r.runs, clean: Math.min(r.runs.clean, U16) },
      })),
      smallest: verdict.smallest === null ? null : cut(verdict.smallest),
      points_to: verdict.points_to === null ? null : cut(JSON.stringify(verdict.points_to)),
      commit: verdict.commit,
      key: { ...verdict.key, environment: cut(verdict.key.environment), tools: verdict.key.tools.map(cut) },
    },
  });
  return { id, handle, log_pos };
}

/** Appends verdict.stale for a recorded verdict when `commit` isn't its commit, or a workspace's `state` drifted from what it pinned; returns whether it did. */
export async function markStale(record: RecordStore, recorded: RecordedVerdict, verdict: Verdict, commit: string, at: number, state?: readonly string[]): Promise<boolean> {
  const because = staleReason(verdict, commit, state);
  if (because === null) return false;
  await record.append(CORE, { v: 1, id: ulid(at), kind: 'verdict.stale', ts: at, subject: recorded.handle, data: { verdict: recorded.handle, because: cut(because) } });
  return true;
}
