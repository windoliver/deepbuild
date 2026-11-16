// A claim refused before its checks: the validity floor, snapshot budget or failed setup (#2074).
import type { HubEvents } from './hub-capabilities.js';
import { ulid } from './wire.js';

export async function recordRefusal(events: Pick<HubEvents, 'append' | 'connection'>, ts: number, claim: string, commit: string, reason: string, outcome: 'INVALID' | 'INCONCLUSIVE' | 'BLOCKED', code?: string): Promise<void> {
  const id = ulid(ts);
  await events.append(events.connection('core'), {
    v: code ? 2 : 1, id, kind: 'verdict.made', ts, subject: claim,
    data: {
      outcome, verdict: `verdict:${id}`, claim, reasons: [reason.slice(0, 8192)], ...(code ? { why: [{ reason: code, text: reason.slice(0, 8192) }] } : {}), requirements: [], smallest: null, points_to: null, commit,
      key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: `${process.platform}-${process.arch}`, tools: [] },
    },
  });
}
