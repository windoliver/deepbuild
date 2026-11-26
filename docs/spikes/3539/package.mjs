// #3539: one script through the gate package's scheduler (`simulate`, packages/gate/src/scheduler.ts), under the order
// main has (`today`) or the changed one (`person-first`: person-first.patch applied to a copy in memory, load.mjs),
// and the `Trace` it returns read as one row per place and per green stop.
import { join } from 'node:path';
import { HERE, source } from './load.mjs';

export const ORDERS = ['today', 'person-first'];
export const PLANTS = ['times-from-start', 'reports-a-gain'];
const PATCH = join(HERE, 'person-first.patch');

const loaded = new Map();
/** `simulate` under an order: the public entry's own, or the scheduler's copy with the patch applied. */
async function simulateUnder(order) {
  if (!loaded.has(order)) loaded.set(order, (await (order === 'today' ? source('packages/gate/src/index.ts') : source('packages/gate/src/scheduler.ts', PATCH))).simulate);
  return loaded.get(order);
}

/** The `Scenario` a script is: the same data, each check with a `run` that takes `took_ms` and passes. */
function scenarioOf(script) {
  const copy = structuredClone(script);
  return { ...copy, sessions: copy.sessions.map((s) => ({ ...s, checks: s.checks.map(({ took_ms, ...check }) => ({ ...check, run: () => ({ took_ms, outcome: 'passed' }) })) })) };
}

const key = (x) => `${x.session}\0${x.check}\0${x.snapshot}`;
/**
 * A trace's rows. `places`: every slow-lane place, a session's check on one snapshot that took a place in the queue,
 * queued or held, with when it took it (`queued_at`), the start of its first slow-lane run and the end of its last,
 * both null when it never started. `stops`: every green stop, one whose reply ended the turn, with its time and when
 * its claim's verdict landed, the end of the last run its checks rest on, null while the claim reads pending at the
 * script's end. `plant`: the twin that times a slow check from its start (#3539 AC3) reads the runs alone, never the
 * queue, so a place is queued when it starts and one that never started isn't there.
 */
function rowsOf(trace, plant) {
  const places = new Map();
  if (plant !== 'times-from-start') {
    for (const q of trace.queue) if ((q.op === 'queued' || q.op === 'held') && !places.has(key(q))) places.set(key(q), { session: q.session, check: q.check, snapshot: q.snapshot, queued_at: q.at, started_at: null, ended_at: null });
  }
  for (const r of trace.runs) {
    if (r.lane !== 'slow') continue;
    if (!places.has(key(r))) places.set(key(r), { session: r.session, check: r.check, snapshot: r.snapshot, queued_at: plant === 'times-from-start' ? r.started_at : r.queued_at ?? r.started_at, started_at: null, ended_at: null });
    const place = places.get(key(r));
    place.started_at ??= r.started_at;
    place.ended_at = Math.max(place.ended_at ?? r.ended_at, r.ended_at);
  }
  const ends = new Map(trace.runs.map((r) => [r.run, r.ended_at]));
  const claims = new Map(trace.claims.map((c) => [c.claim, c]));
  const stops = trace.stops.filter((s) => s.kind === 'ends_turn').map((s) => {
    const claim = claims.get(s.claim);
    const rests = claim && claim.verdict !== 'pending' ? Object.values(claim.checks).flatMap((c) => [...c.runs, ...c.carried_runs]) : null;
    return { session: s.session, stop: s.stop, snapshot: s.snapshot, at: s.at, verdict_at: rests ? Math.max(s.reply_at, ...rests.map((run) => ends.get(run) ?? s.reply_at)) : null };
  });
  return { places: [...places.values()], stops };
}

/**
 * The script's rows under an order. `plant`: the twin that reports a gain (#3539 AC2) takes the first session of the
 * script that stops for the person's, whoever opened its turns: under `person-first` it starts that session's places
 * first, by marking its checks `on_base: fails`, which main's own order takes first.
 */
export async function runPackage(script, order, plant) {
  if (order === 'person-first' && plant === 'reports-a-gain') {
    const copy = structuredClone(script);
    const taken = copy.sessions.find((s) => s.events.some((e) => e.kind === 'stop'));
    for (const s of copy.sessions) for (const c of s.checks) c.on_base = s === taken ? 'fails' : 'passes';
    return rowsOf((await simulateUnder('today'))(scenarioOf(copy)));
  }
  return rowsOf((await simulateUnder(order))(scenarioOf(script)), plant);
}
