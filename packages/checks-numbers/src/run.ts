// One run of a numbers check (#87): its queries in the probe's process group, ended at the deadline (runProbe).
import { fileURLToPath } from 'node:url';
import { runProbe, type CheckContext, type CheckResult } from '@deepbuild/conformance';
import type { NumbersSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));

/** One run of the numbers check on `spec`. */
export function runNumbers(spec: NumbersSpec, ctx: CheckContext): Promise<CheckResult> {
  return runProbe(PROBE, { spec }, ctx, { kind: 'numbers', file: spec.numbers[0]?.query.database ?? spec.added[0]?.sample ?? '' });
}
