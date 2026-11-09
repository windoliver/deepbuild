// API journeys (#37): real requests to the running service, with no browser. Each step is one request with an
// expected status, under its deadline; the end state is read back by the kind from the real system afterwards,
// never from what a step's own response claimed, which is why the last response is handed back apart.
import type { Failure, RunOutcome } from '@deepbuild/conformance';

interface ApiStep { id: string; line: number; deadlineMs: number; method: string; path: string; body?: unknown; expect: { status: number } }
interface ApiJourney { id: string; steps: ApiStep[]; endState: never[] }
interface ApiRun { run: string; outcome: RunOutcome; testsRun: number; failures: Failure[]; message: string | null; steps: { id: string; startMs: number; endMs: number; status: number | null }[]; last: unknown }

/** Drives the stack at `url` through the journey's requests. */
export async function runApiJourney(o: { run: string; journey: ApiJourney; url: string; file: string; secrets?: Record<string, string> }): Promise<ApiRun> {
  const t0 = Date.now();
  const failures: Failure[] = [];
  const steps: ApiRun['steps'] = [];
  let outcome: RunOutcome = 'passed';
  let message: string | null = null;
  let last: unknown = null;
  for (const s of o.journey.steps) {
    const started = Date.now() - t0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), s.deadlineMs);
    let status: number | null = null;
    try {
      const headers: Record<string, string> = s.body !== undefined ? { 'content-type': 'application/json' } : {};
      const res = await fetch(new URL(s.path, o.url), { method: s.method, headers, signal: controller.signal, ...(s.body !== undefined ? { body: JSON.stringify(s.body) } : {}) });
      status = res.status;
      last = await res.json().catch(() => null);
      if (res.status !== s.expect.status) throw Object.assign(Error(`${s.method} ${s.path} answered ${res.status}, expected ${s.expect.status}`), { assertion: true });
    } catch (e) {
      const aborted = controller.signal.aborted;
      outcome = aborted ? 'overran' : 'failed';
      message = aborted ? `step ${s.id} overran its deadline of ${s.deadlineMs} ms` : String((e as Error).message ?? e);
      failures.push({ test: `${o.journey.id} › ${s.id}`, file: o.file, line: s.line, stack: null, assertion: !aborted && !!(e as { assertion?: boolean }).assertion, message });
    } finally {
      clearTimeout(timer);
      steps.push({ id: s.id, startMs: started, endMs: Date.now() - t0, status });
    }
    if (outcome !== 'passed') break;
  }
  if (outcome === 'passed' && !o.journey.steps.length) { outcome = 'ran_nothing'; message = 'the journey has no step'; }
  return { run: o.run, outcome, testsRun: steps.length, failures, message, steps, last };
}
