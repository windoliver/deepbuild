// One run of a numbers check (#87): through the hub's host@1, or locally for standalone kit fixtures (runProbe).
import { fileURLToPath } from 'node:url';
import type { CheckContext, CheckResult } from '@deepbuild/conformance';
import { runProbe } from '@deepbuild/conformance/findings';
import type { NumbersSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));

/** One run of the numbers check on `spec`. */
export function runNumbers(spec: NumbersSpec, ctx: CheckContext): Promise<CheckResult> {
  return runProbe(PROBE, { spec }, ctx, { kind: 'numbers', file: spec.numbers[0]?.query.database ?? spec.added[0]?.sample ?? '' });
}
