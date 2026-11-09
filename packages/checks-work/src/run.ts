// One run of a work check (#68): the kind's work in the probe's process group, ended at the deadline (runProbe).
import { fileURLToPath } from 'node:url';
import { runProbe, type CheckContext, type CheckResult } from '@deepbuild/conformance';
import type { WorkKind, WorkSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));

/** The file a kind's failures point at. */
const subject = (spec: WorkSpec): string =>
  spec.kind === 'service' ? spec.url : spec.kind === 'data' ? spec.database : spec.kind === 'document' ? spec.document : spec.mailbox;

/** One run of the `kind` check on `spec`. */
export function runWork(kind: WorkKind, spec: WorkSpec, ctx: CheckContext): Promise<CheckResult> {
  return runProbe(PROBE, { kind, spec }, ctx, { kind: spec.kind, file: subject(spec) });
}
