// @deepbuild/checks-numbers: the numbers check (#87), a check.kind@1 plug-in. It re-runs the query behind each number
// a claim states, and its independent recount where one exists, showing both values when they differ; runs each
// scoring term, filter, input or data source a change adds on a read-only sample of real data, failing one that
// changes nothing there; and re-runs a stated speed through the timing check behind it.
import type { CheckContext } from '@deepbuild/conformance';
import { numbersKit as kitFor } from './kit.js';
import { runNumbers } from './run.js';
import type { NumbersFill, NumbersSpec } from './types.js';

export type { AddedTerm, NumbersFill, NumbersSpec, Query, Side, SpeedClaim, SpeedPlant, SpeedResult, StatedNumber, TimingCheck, Toolchain } from './types.js';
export { checkSpeed } from './speed.js';

/** The numbers kind's runner, as the check.kind@1 fill deep.registerCheck registers: local queries, so no cost. */
export function numbersFill(): NumbersFill {
  return { slot: 'check.kind@1', revision: 1, kind: 'numbers', budget: { time_ms: 30_000, cost_usd: 0 }, run: (spec: NumbersSpec, ctx: CheckContext) => runNumbers(spec, ctx) };
}

/** The numbers kind's own check.kind@1 kit, run by the conformance package's runKit. */
export const numbersKit = (): ReturnType<typeof kitFor> => kitFor(numbersFill);

/** The plug-in: registers the numbers kind. */
export default function register(deep: { registerCheck(type: string, runner: NumbersFill['run']): void }): void {
  deep.registerCheck('numbers', numbersFill().run);
}
