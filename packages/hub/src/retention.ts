// The retention pass (design: Evidence): evidence leaves after its retention unless a decision or verdict cites it, or
// a transcript.archived or ci.archived event links it; snapshots nothing holds are let go (#31).
import { sha256Hex } from '@deepbuild/contracts';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Checkouts } from '@deepbuild/gate';

interface RetentionOptions {
  raw(query: string): Promise<unknown[]>;
  store: EvidenceStore;
  checkouts: Checkouts;
  /** Decisions, verdicts and notices' retained series evidence, as the extension host reads it. */
  cited(): Promise<Set<string>>;
  /** The planted wrong program: nothing is cited, so nothing is kept. */
  keepNothing: boolean;
  /** Records each file the pass removed. */
  removed(sha256: string): Promise<void>;
}

/**
 * The retention pass: keeps the files decisions and verdicts cite, the transcripts transcript.archived links and the
 * CI logs ci.archived links, which outlive the forge's own retention only if ours keeps them.
 */
export async function retain(o: RetentionOptions): Promise<void> {
  const cited = o.keepNothing ? new Set<string>() : await o.cited();
  if (!o.keepNothing) {
    const readings = (await o.raw("SELECT evidence FROM events WHERE kind = 'reading.recorded' AND evidence IS NOT NULL")) as { evidence: string }[];
    for (const row of readings) for (const sha of JSON.parse(row.evidence) as string[]) cited.add(sha);
  }
  const linked = (await o.raw("SELECT json_extract(data, '$.evidence') AS sha FROM events WHERE kind = 'transcript.archived'")) as { sha: string | null }[];
  const logs = (await o.raw("SELECT evidence FROM events WHERE kind = 'ci.archived' AND evidence IS NOT NULL")) as { evidence: string }[];
  const archived = new Set([...linked.flatMap((r) => (r.sha ? [r.sha] : [])), ...logs.flatMap((r) => JSON.parse(r.evidence) as string[])]);
  const { removed } = await o.store.retain({ cited, archived });
  for (const sha256 of removed) await o.removed(sha256).catch(() => undefined);
  await pruneSnapshots(o, cited).catch(() => undefined);
}
/**
 * Lets go of the snapshots nothing holds (#31): an open claim's (no verdict, its task not closed), an open ask's, and
 * any with evidence a verdict or decision cites. Empty output is one hash for every run, so it holds none.
 */
async function pruneSnapshots(o: RetentionOptions, cited: ReadonlySet<string>): Promise<void> {
  const open = (await o.raw('SELECT DISTINCT r.commit_sha AS sha FROM runs r JOIN claims c ON c.id = r.claim_id LEFT JOIN tasks t ON t.task_ref = c.subject_ref WHERE c.verdict_id IS NULL AND t.closed IS NULL')) as { sha: string | null }[];
  const asks = (await o.raw("SELECT pinned_to FROM asks WHERE status IN ('open', 'later')")) as { pinned_to: string | null }[];
  const runs = (await o.raw('SELECT commit_sha AS sha, evidence FROM runs WHERE evidence IS NOT NULL')) as { sha: string | null; evidence: string }[];
  const verdicts = (await o.raw("SELECT json_extract(data, '$.commit') AS sha, evidence FROM events WHERE kind = 'verdict.made' AND evidence IS NOT NULL")) as { sha: string | null; evidence: string }[];
  const empty = sha256Hex(new Uint8Array());
  const pins = asks.flatMap((a) => { const pin = JSON.parse(a.pinned_to ?? 'null') as { kind: string; ref: string } | null; return pin?.kind === 'commit' ? [pin.ref] : []; });
  await o.checkouts.prune({
    open_claims: open.flatMap((r) => (r.sha ? [r.sha] : [])), open_asks: pins,
    kept_evidence: [...runs, ...verdicts].flatMap((r) => (r.sha && (JSON.parse(r.evidence) as string[]).some((sha) => sha !== empty && cited.has(sha)) ? [{ snapshot: r.sha, behind_decision: true }] : [])),
  });
}
