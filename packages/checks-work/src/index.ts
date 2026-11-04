// @deepbuild/checks-work: R2's checks for work beyond code (#68), each a check.kind@1 plug-in under the same rules as
// the core's: service (an endpoint's shape, latency and throughput floor, from where its users are), data (the rows
// or totals a query must return), document (every claim cited, every number matching its source) and message
// (delivered, and acknowledged where the channel can say so). Each kind declares its budget per run and ships its
// own kit with a planted fault it catches. A runner reports a run outcome, never a verdict; the drafting job keeps a
// proposed check only where a kind runs it, and asks early about the rest.
import type { CheckContext, KindBudget } from '@deepbuild/conformance';
import { kitFor } from './kit.js';
import { runWork } from './run.js';
import type { WorkFill, WorkKind, WorkSpec } from './types.js';

export type { DataSpec, Draft, DraftedRequirement, DocumentSpec, EarlyQuestion, JsonType, MessageSpec, ServiceSpec, WorkFill, WorkKind, WorkSpec } from './types.js';
export { draftChecks } from './draft.js';

/** Each kind's budget per run: local work, so no cost; a service check's requests take the longest. */
const BUDGETS: Record<WorkKind, KindBudget> = {
  service: { time_ms: 15_000, cost_usd: 0 },
  data: { time_ms: 5_000, cost_usd: 0 },
  document: { time_ms: 5_000, cost_usd: 0 },
  message: { time_ms: 5_000, cost_usd: 0 },
};

/** The kind's runner, as the check.kind@1 fill deep.registerCheck registers. */
export function workFill(kind: WorkKind): WorkFill {
  return {
    slot: 'check.kind@1', revision: 1, kind, budget: { ...BUDGETS[kind] },
    run: (spec: WorkSpec, ctx: CheckContext) => runWork(kind, spec, ctx),
  };
}

/** The kind's own check.kind@1 kit, run by the conformance package's runKit. */
export const workKit = (kind: WorkKind): ReturnType<typeof kitFor> => kitFor(kind, () => workFill(kind));

/** The plug-in: registers the four kinds. */
export default function register(deep: { registerCheck(type: string, runner: WorkFill['run']): void }): void {
  for (const kind of Object.keys(BUDGETS) as WorkKind[]) deep.registerCheck(kind, workFill(kind).run);
}
