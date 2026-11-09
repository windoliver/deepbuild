// One run of a check kind's probe: a Node program in a process group of its own, given its input on stdin and ended
// at the deadline. A run still going then is overran; one that stopped on an error is failed, its error kept as a
// failure that isn't the check's assertion, so a crash is never read as the check holding or as nothing to say.
import { spawn } from 'node:child_process';
import { isCheckResult } from './result.js';
import type { CheckContext, CheckResult } from './slot-types.js';

/** What a crash keeps of its stderr: the last lines, where the error is. */
const KEPT = 4000;

/** Runs `probe` on `input` in the checkout; a crash's failure names the check `kind` and points at `file`. */
export function runProbe(probe: string, input: object, ctx: CheckContext, at: { kind: string; file: string }): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probe], { cwd: ctx.checkout, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
      failures: [{ test: `${at.kind}: run`, file: at.file, line: 1, stack: err || null, assertion: false, message: `the ${at.kind} check stopped before its assertion: ${why}` }],
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
    child.stdin.end(JSON.stringify({ ...input, checkout: ctx.checkout }));
  });
}
