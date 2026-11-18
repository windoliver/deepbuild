// One run of a check kind's probe: through host@1 in the hub, or locally for standalone kit fixtures.
// Input goes on stdin; the last output line is its report. A crash is never the check's assertion.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isCheckResult } from './result.js';
import type { CheckContext, CheckResult } from './slot-types.js';

/** What a crash keeps of its stderr: the last lines, where the error is. */
const KEPT = 4000;

/** Runs `probe` on `input` in the checkout; a crash's failure names the check `kind` and points at `file`. */
export async function runProbe(probe: string, input: object, ctx: CheckContext, at: { kind: string; file: string; hosts?: string[]; listen?: string[] }): Promise<CheckResult> {
  if (ctx.host) {
    // Standalone kits don't load the supervisor's implementation or its record dependencies.
    const { after, badDeadline } = await import('@deepbuild/supervisor');
    const bad = badDeadline('deadline', ctx.deadline);
    if (bad) throw Error(`a probe's ${bad}`);
    const host = ctx.host;
    const run = `run:${randomBytes(16).toString('hex')}`;
    const stdout = new StringDecoder('utf8'), stderr = new StringDecoder('utf8');
    let out = '', err = '', late = false;
    const empty = { testsRun: 0, failures: [], evidence: [], read: [], mask: null };
    const missing = (why: string): CheckResult => ({ ...empty, outcome: 'missing', failures: [{ test: `${at.kind}: run`, file: at.file, line: 1, stack: null, assertion: false, message: why }] });
    let disarm = (): void => undefined;
    let stopping: Promise<void> = Promise.resolve();
    try {
      const started = await host.start({
        run, argv: [process.execPath, probe], cwd: ctx.checkout, inherit: false,
        env: { LANG: 'en_US.UTF-8', TZ: 'UTC', CI: 'true', DO_NOT_TRACK: '1' },
        input: Buffer.from(JSON.stringify({ ...input, checkout: ctx.checkout })),
        grant: { read: [process.execPath, dirname(probe)], ...(at.hosts?.length ? { hosts: at.hosts } : {}), ...(at.listen?.length ? { listen: at.listen } : {}) },
        output: { stdout: (c) => { out += stdout.write(c); }, stderr: (c) => { err = (err + stderr.write(c)).slice(-KEPT); } },
      });
      if (started.status !== 'started') return missing(`BLOCKED: no ${started.kind} free`);
      disarm = after(ctx.deadline, () => {
        late = true;
        stopping = host.signal(run, 'SIGKILL');
        // Observe refusal immediately; the await below still makes it a missing run, never a pass.
        void stopping.catch(() => undefined);
      });
      // The check-scoped host waits for cleanup as well as exit, including detached descendants.
      const exit = await host.wait(run);
      disarm();
      await stopping;
      out += stdout.end();
      err = (err + stderr.end()).slice(-KEPT);
      if (late) return { ...empty, outcome: 'overran' };
      if (exit.limit) return { ...empty, outcome: 'stopped' };
      return report(out, err, exit.code, exit.signal, at);
    } catch (error) {
      return missing(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    } finally { disarm(); }
  }
  // No host is the standalone kit path; hub runners always supply one and never fall back here on refusal.
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
      resolve(report(out, err, code, signal, at));
    });
    child.stdin.end(JSON.stringify({ ...input, checkout: ctx.checkout }));
  });
}

function report(out: string, err: string, code: number | null, signal: NodeJS.Signals | null, at: { kind: string; file: string }): CheckResult {
  const crashed = (why: string): CheckResult => ({
    outcome: 'failed', testsRun: 0, evidence: [], read: [], mask: null,
    failures: [{ test: `${at.kind}: run`, file: at.file, line: 1, stack: err || null, assertion: false, message: `the ${at.kind} check stopped before its assertion: ${why}` }],
  });
  const line = out.trim().split('\n').at(-1);
  if (code !== 0 || !line) return crashed(err.trim().split('\n').find((l) => /Error|error:/.test(l))?.trim() || err.trim() || `exited ${code ?? signal}`);
  let parsed: unknown;
  try { parsed = { ...JSON.parse(line), evidence: [], mask: null }; }
  catch { return crashed('the probe returned invalid JSON'); }
  return isCheckResult(parsed) ? parsed : crashed('the probe returned an invalid check result');
}
