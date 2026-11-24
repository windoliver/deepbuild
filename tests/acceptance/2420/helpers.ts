// Test-side tools for the #2420 acceptance tests, on top of #1106's (the sample stack, the hub, its client) and
// #2399's (the run's filter port, plain requests to it, a second worktree, `deep env up`/`down`), both imported as
// they are: many plain requests under different names, one under a long Host, the record's `sandbox.denied` events
// for a run split into those naming a target and the closing `more`, and the end of a run. Nothing here stands in for
// the hub, the supervisor or its filter.
//
// Safety: as #1106's helpers. Folders are theirs (/tmp/dh1106-*), every process is stopped by PID, HOME is a temp
// folder, and nothing leaves the loopback: every request goes to the filter on 127.0.0.1, and every host it names ends
// in `.invalid`, which resolves nowhere.

import http from 'node:http';
import { type Client, type Hub, type Line, waitFor } from '../1106/helpers.ts';
import { down, type Filter, plain } from '../2399/helpers.ts';

/** The issue's starting values: the ceiling on a run's events naming a target, and the cut, in bytes. */
export const CEILING = 256;
export const CUT = 512;

/** `count` names, each different and ending in `.invalid`: `dh2420-<tag>-<i>.invalid`. */
export const namesFor = (tag: string, count: number): string[] => Array.from({ length: count }, (_, i) => `dh2420-${tag}-${i}.invalid`);

/** One plain request to the filter for each name (#2399's `plain`, 16 at a time): every answer, in the names' order. */
export async function sendAll(f: Filter, names: string[]): Promise<(number | string)[]> {
  const answers: (number | string)[] = new Array(names.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let i = next++; i < names.length; i = next++) answers[i] = await plain(f, names[i]!);
  };
  await Promise.all(Array.from({ length: 16 }, lane));
  return answers;
}
/** The answers that weren't 403, with the name each went under: the first few. */
export const not403 = (names: string[], answers: (number | string)[]): string =>
  JSON.stringify(answers.map((a, i) => [names[i], a]).filter(([, a]) => a !== 403).slice(0, 5));

/**
 * One plain request whose request line is `GET / HTTP/1.1` and whose Host header is `host`: the filter reads its
 * target from the Host when the request line names no absolute URL. The status, or the error's code.
 */
export function plainHost(f: Filter, host: string): Promise<number | string> {
  return new Promise((resolve) => {
    const req = http.request({ host: f.host, port: f.port, method: 'GET', path: '/', headers: { host, connection: 'close', ...f.auth }, agent: false, timeout: 30_000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 'no status'));
      res.on('error', () => resolve(res.statusCode ?? 'no status'));
    });
    req.on('timeout', () => req.destroy(Error('timeout')));
    req.on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? e.message));
    req.end();
  });
}

// ---- The record: a run's sandbox.denied events.
export interface Denied { log_pos: number; operation: string; target: string }
export interface Recorded { naming: Denied[]; closing: Denied[] }
/** Every `sandbox.denied` whose data names the run, in the record's order: those naming a target, and the closing ones (operation `more`). */
export async function recordOf(client: Client, run: string): Promise<Recorded> {
  const all = (await client.events('sandbox.denied')).filter((e: Line) => e.data?.run === run)
    .map((e: Line) => ({ log_pos: e.log_pos as number, operation: String(e.data.operation), target: String(e.data.target) }));
  return { naming: all.filter((d) => d.operation !== 'more'), closing: all.filter((d) => d.operation === 'more') };
}
export const show = (events: Denied[]): string => JSON.stringify(events.slice(0, 4).map((d) => ({ operation: d.operation, target: d.target.length > 80 ? `${d.target.slice(0, 80)}...(${d.target.length})` : d.target }))) + (events.length > 4 ? ` and ${events.length - 4} more` : '');

/** Waits until the record holds at least `count` events naming a target for the run; false at the deadline. */
export async function reached(client: Client, run: string, count: number, waitMs = 60_000): Promise<boolean> {
  // deadline: bounds the wait for the record to take the run's refusals; past it the test reads what is there.
  return waitFor(async () => (await recordOf(client, run)).naming.length >= count, waitMs, `${count} sandbox.denied for ${run}`).catch(() => false);
}

/** Waits until the record holds a `sandbox.denied` for the run whose target names `name`; false at the deadline. */
export async function holds(client: Client, run: string, name: string, waitMs = 60_000): Promise<boolean> {
  // deadline: bounds the wait for one refusal in the record; past it the caller's assertion fails.
  return waitFor(async () => (await recordOf(client, run)).naming.some((d) => d.target.includes(name)), waitMs, `${name} in ${run}'s record`).catch(() => false);
}

/**
 * Ends a run: `deep env down` in its worktree (exit 0), then waits for the record's `run.cleaned` for the run (60 s),
 * then for a closing `sandbox.denied` (operation `more`) for it, for at most `closingMs`. Whether the run was seen
 * cleaned; the record is read by the caller.
 */
export async function endRun(hub: Hub, client: Client, wt: string, run: string, closingMs: number): Promise<{ code: number | null; cleaned: boolean }> {
  const code = await down(hub, wt);
  // deadline: bounds the wait for the run's end in the record; a run never cleaned fails the caller's assertion.
  const cleaned = await waitFor(async () => (await client.events('run.cleaned')).some((e: Line) => e.data?.run === run), 60_000, `run.cleaned for ${run}`).catch(() => false);
  // deadline: bounds the wait for the closing event; with none by then the caller reads the record as it stands.
  await waitFor(async () => (await recordOf(client, run)).closing.length > 0, closingMs, `the closing sandbox.denied for ${run}`).catch(() => false);
  return { code, cleaned };
}
