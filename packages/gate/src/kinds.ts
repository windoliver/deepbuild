// The gate's admission of a check kind (#68): every kind declares what one run may take in time and cost, so a claim's
// runs can be planned and billed before they start; a kind with no budget never runs.
import type { CheckRunnerFill } from '@deepbuild/conformance';

/** Admits a check kind only when it declares a time budget above zero and a cost budget of zero or more. */
export function admitKind(fill: CheckRunnerFill): { admitted: boolean; reason: string | null } {
  const b = fill.budget;
  const ok = b !== undefined && Number.isFinite(b.time_ms) && b.time_ms > 0 && Number.isFinite(b.cost_usd) && b.cost_usd >= 0;
  return ok ? { admitted: true, reason: null } : { admitted: false, reason: `the check kind ${fill.kind} declares no time and cost budget per run, so the gate runs none of its checks` };
}
