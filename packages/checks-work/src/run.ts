// One run of a work check (#68): the kind's work in a process group of its own, ended at the deadline. A run still
// going then is overran; one that stopped on an error is failed, its error kept as a failure that isn't the check's
// assertion, so a crash is never read as the work holding or as nothing to say.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isCheckResult, type CheckContext, type CheckResult } from '@deepbuild/conformance';
import type { WorkKind, WorkSpec } from './types.js';

const PROBE = fileURLToPath(new URL('../runtime/probe.mjs', import.meta.url));
/** What a crash keeps of its stderr: the last lines, where the error is. */
const KEPT = 4000;

/** The file a kind's failures point at. */
export const subject = (spec: WorkSpec): string =>
  spec.kind === 'service' ? spec.url : spec.kind === 'data' ? spec.database : spec.kind === 'document' ? spec.document : spec.mailbox;

/** One run of the `kind` check on `spec`. */
export function runWork(kind: WorkKind, spec: WorkSpec, ctx: CheckContext): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PROBE], { cwd: ctx.checkout, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let late = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-KEPT); });
    const timer = setTimeout(() => {
      late = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }, Math.max(1, ctx.deadline));
    const crashed = (why: string): CheckResult => ({
      outcome: 'failed', testsRun: 0, evidence: [], read: [], mask: null,
      failures: [{ test: `${spec.kind}: run`, file: subject(spec), line: 1, stack: err || null, assertion: false, message: `the ${spec.kind} check stopped before its assertion: ${why}` }],
    });
    child.on('error', (e) => { clearTimeout(timer); resolve(crashed(e.message)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (late) return resolve({ outcome: 'overran', testsRun: 0, failures: [], evidence: [], read: [], mask: null });
      const line = out.trim().split('\n').at(-1);
      if (code !== 0 || !line) return resolve(crashed(err.trim().split('\n').find((l) => /Error|error:/.test(l))?.trim() || err.trim() || `exited ${code ?? signal}`));
      let report: unknown;
      try { report = { ...JSON.parse(line), evidence: [], mask: null }; }
      catch { return resolve(crashed('the probe returned invalid JSON')); }
      resolve(isCheckResult(report) ? report : crashed('the probe returned an invalid check result'));
    });
    child.stdin.end(JSON.stringify({ kind, spec, checkout: ctx.checkout }));
  });
}
