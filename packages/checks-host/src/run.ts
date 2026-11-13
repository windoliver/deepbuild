// One run of a host check (#1943): the kind's work in the probe's process group, ended at the deadline with its ssh
// (runProbe). `restart: false` is only the machine kit's planted runner that never restarts the service.
import { fileURLToPath } from 'node:url';
import type { CheckContext, CheckResult } from '@deepbuild/conformance';
import { runProbe } from '@deepbuild/conformance/findings';
import type { HostKind, HostLink, HostSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));

/** What a crash's failure points at: the host and the file or unit the check reads. */
const subject = (spec: HostSpec): string =>
  `${spec.host}:${spec.kind === 'setting' ? spec.file : spec.service ?? spec.disk?.path ?? ''}`;

/** One run of the `kind` check on `spec`, over `link`. */
export function runHost(kind: HostKind, spec: HostSpec, ctx: CheckContext, link: HostLink, restart = true): Promise<CheckResult> {
  return runProbe(PROBE, { kind, spec, config: link.config, restart }, ctx, { kind, file: subject(spec) });
}
