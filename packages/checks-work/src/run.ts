// One run of a work check (#68): through the hub's host@1, or locally for standalone kit fixtures (runProbe).
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import type { CheckContext, CheckResult } from '@deepbuild/conformance';
import { runProbe } from '@deepbuild/conformance/findings';
import type { WorkKind, WorkSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));

/** The file a kind's failures point at. */
const subject = (spec: WorkSpec): string =>
  spec.kind === 'service' ? spec.url : spec.kind === 'data' ? spec.database : spec.kind === 'document' ? spec.document : spec.mailbox;

/** One run of the `kind` check on `spec`. */
export async function runWork(kind: WorkKind, spec: WorkSpec, ctx: CheckContext): Promise<CheckResult> {
  let port: number | undefined;
  const hosts: string[] = [], listen: string[] = [];
  if (ctx.host && spec.kind === 'service' && spec.requests > 0 && Number.isInteger(spec.requests) && Number.isFinite(spec.floor?.latency_ms) && Number.isFinite(spec.floor?.throughput_rps)) {
    const url = new URL(spec.url);
    hosts.push(`${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`);
    // The probe binds its users' source address. Give it one exact client port, not arbitrary listening ports.
    // A competing binder makes the check fail; it never widens the grant or retries on another port.
    const server = createServer();
    port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, spec.from, () => {
        const address = server.address();
        if (!address || typeof address === 'string') { server.close(); reject(Error('no source port')); return; }
        server.close(error => error ? reject(error) : resolve(address.port));
      });
    }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRNOTAVAIL') return undefined;
      throw error;
    });
    if (port !== undefined) listen.push(`localhost:${port}`);
  }
  return runProbe(PROBE, { kind, spec, port }, ctx, { kind: spec.kind, file: subject(spec), hosts, listen });
}
