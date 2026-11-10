// Whether a review counts (#87): the model that answered it, as the runner read it from the job's own output, against
// the model that made the change, read from its session's transcript only on the agent's own route. Models are
// compared by canonical ID; a model's family is the agent whose facts name it, so another model of the change's
// family counts and says so, the change's own model or one no facts name doesn't count.
import { shipped, type SessionRoute } from '@deepbuild/adapters';
import type { KindBudget } from '@deepbuild/conformance';
import type { JobRecord } from '@deepbuild/runner';
import type { ClaimCheck, Run } from '@deepbuild/verdicts';

export interface ChangeSession { agent: string; transcript: string; route: SessionRoute }
export interface ReviewAt { claim: string; commit: string; check: ClaimCheck }
export interface Independence { answered: string; change: string; counted: boolean; reason: string | null; note: string | null }
export interface ReviewJobRun { run: Run; independence: Independence | null }
/** Planted wrong programs; tests only. */
export type ModelPlant = 'drops-same-family' | 'raw-names' | 'raw-family' | 'trusts-proxied-transcript';

/** A review's budget per run: a second model's turn on a diff, from its job's submission to its run record. */
export const reviewBudget: KindBudget = { time_ms: 600_000, cost_usd: 2 };

/** Routes on which the transcript's model is a proxy's word: a base URL or model provider other than the agent's. */
const PROXIED = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'model_provider'];

/** The model's canonical ID: no context suffix ([1m]), cloud prefix (us.anthropic.), Bedrock version (-v1:0), Vertex
 *  or date suffix (@20250805, -20250805) or -latest. */
const canonicalModel = (name: string): string => name.trim()
  .replace(/\[[^\]]*\]$/, '')
  .replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '')
  .replace(/-v\d+(?::\d+)?$/, '')
  .replace(/[@-]\d{8}$/, '')
  .replace(/-latest$/, '');

let families: Map<string, string> | undefined;
/** The family a model belongs to: the agent whose facts name it, or undefined. */
function familyOf(model: string): string | undefined {
  if (!families) {
    const registry = shipped();
    families = new Map(registry.names().flatMap((agent) => {
      const facts = registry.get(agent).facts as { modelFamily?: { families?: Record<string, string> } };
      return Object.keys(facts.modelFamily?.families ?? {}).map((m) => [m, agent] as const);
    }));
  }
  return families.get(model);
}

/** The model a session's transcript names last: Claude Code's assistant messages, Codex's turn contexts. */
function transcriptModel(transcript: string): string | undefined {
  let model: string | undefined;
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    let e: { message?: { model?: unknown }; type?: unknown; payload?: { model?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    const named = e.message?.model ?? (e.type === 'turn_context' ? e.payload?.model : undefined);
    if (typeof named === 'string' && named !== '<synthetic>') model = named;
  }
  return model;
}

export function independence(answeredRaw: string, change: ChangeSession, plant?: ModelPlant): Independence {
  const canon = plant === 'raw-names' ? (m: string) => m : canonicalModel;
  const family = (m: string): string | undefined => familyOf(plant === 'raw-family' ? m : canonicalModel(m));
  const proxied = plant !== 'trusts-proxied-transcript' && PROXIED.some((k) => change.route[k]);
  const named = proxied ? undefined : transcriptModel(change.transcript);
  const changeModel = named === undefined ? 'unknown' : canon(named);
  const answered = answeredRaw || 'unknown';
  const uncounted = (reason: string): Independence => ({ answered, change: changeModel, counted: false, reason, note: null });
  if (proxied) return uncounted('model unknown: proxied route');
  if (answered === 'unknown' || named === undefined) return uncounted('model unknown');
  if (canon(answered) === changeModel) return uncounted('review not independent: same model');
  const [a, c] = [family(answered), family(named)];
  if (a === undefined || c === undefined) return uncounted('model unknown');
  if (a !== c) return { answered, change: changeModel, counted: true, reason: null, note: null };
  if (plant === 'drops-same-family') return uncounted('review not independent: same family');
  return { answered, change: changeModel, counted: true, reason: null, note: 'same-family review' };
}

/** A review job, as the runner recorded it, turned into its run for the claim. */
export function reviewJobRun(job: JobRecord, change: ChangeSession, at: ReviewAt, plant?: ModelPlant): ReviewJobRun {
  const c = at.check;
  const ended = job.ran?.to ?? job.ran?.from ?? job.blocked?.since ?? 0;
  const run = (outcome: Run['outcome'], more: Partial<Run> = {}): Run => ({
    run: job.job, check: c.check, claim: at.claim, commit: at.commit, digest: c.digest, environment: { ...c.environment }, tools: { ...c.tools },
    outcome, ...(job.ran ? { started: job.ran.from } : {}), ended, tests_run: outcome === 'passed' ? 1 : 0, reads: [], failures: [], evidence: [], kept: true, ...more,
  });
  if (job.state === 'waiting' && job.blocked) {
    return { run: run('missing', { missing: { cause: job.blocked.cause, owner: job.blocked.owner, since: job.blocked.since } }), independence: null };
  }
  if (job.state !== 'finished') return { run: run('stopped'), independence: null };
  const ind = independence(job.model ?? 'unknown', change, plant);
  return { run: ind.counted ? run('passed') : run('uncounted', { uncounted_because: ind.reason! }), independence: ind };
}
