// #3539: one script through the hub's own gate runner (`GateRunner`, packages/hub/src/gate-runner.ts: `stop`,
// `turnEnded`, its queue and `pump`), on a virtual clock. The runner is main's, loaded from source; what stands in is
// its host, the side core.ts and runs.ts give it, which follows their rules:
//
//   slots()   the pool less the runs that hold a slot (core.ts: half the cores less `runs.size`, and a run is in
//             `runs` only once its slot is granted, runs.ts `launch`).
//   start(r)  resolves once the run has its `cpu.slot`. A slow run asks under the key that holds at most all but one
//             slot of a pool of two or more (packages/leases, SLOW_SLOT), and asks for none while a fast one waits
//             (packages/gate/src/exec.ts, `admit`). The real `admit` polls the lease table every 5 to 50 ms, so which
//             waiting run gets a freed slot is decided by when its poll lands; here the run that asked first gets it.
//   ended(run) resolves `passed` when the clock reaches its start plus the check's drafted time. A check marked
//             `on_base: fails` that passed is run again on the merge base (`onBase`), for the same time.
//
// Every worktree and checkout is a folder that doesn't exist, so the runner's reads of git and of installs find
// nothing and no two sessions share a key. Needs packages/evidence/dist/patterns.json and
// packages/record/dist/versions.json, the two files the hub's sources read from a build (README, How to run).
import { source } from './load.mjs';

const HUB_ORIGIN = { human: 'person' };

/** Resolves once nothing this process started is still pending: no read, no child, no timer; never a wait of a set length. */
function settler() {
  const count = () => {
    const seen = new Map();
    for (const r of process.getActiveResourcesInfo()) if (r !== 'Immediate') seen.set(r, (seen.get(r) ?? 0) + 1);
    return seen;
  };
  const base = count();
  return async () => {
    for (let quiet = 0; quiet < 3;) {
      await new Promise((done) => setImmediate(done));
      quiet = [...count()].some(([kind, n]) => n > (base.get(kind) ?? 0)) ? 0 : quiet + 1;
    }
  };
}

/**
 * The script's rows under the hub's order. `places`: every slow check of every green stop, with the stop's time
 * (`queued_at`: the runner places it at the turn's end), when the pump handed it to the host (`handed_at`), and its
 * run's start and end on the script's clock, all three null when a newer snapshot took its place before the pump did;
 * `base_run`: the run on the merge base the runner makes for a check that fails there. `stops`: every stop, with when
 * `turnEnded` returned, which is when stop-reply.ts goes on to the reply.
 */
export async function runHub(script) {
  if (script.foreign?.length) throw Error("the hub's order is run on a script's own sessions: this one holds slots for others (foreign)");
  const { GateRunner } = await source('packages/hub/src/gate-runner.ts');
  const settled = settler();
  const pool = script.config?.slots ?? 4;
  const slowCap = pool > 1 ? pool - 1 : pool;
  let clock = 0;
  let n = 0;
  const live = new Map();
  const waiting = [];
  const held = { fast: 0, slow: 0 };
  const starts = [];
  const took = new Map(script.sessions.flatMap((s) => s.checks.map((c) => [`${s.id}\0${c.id}`, c.took_ms])));
  const sessionOf = new Map();
  const snapshotOf = new Map();
  // A waiting run is granted in the order it asked, a fast one ahead of every slow one.
  const grant = () => {
    for (;;) {
      const fast = waiting.findIndex((w) => w.lane === 'fast');
      const next = fast >= 0 ? fast : waiting.length ? 0 : -1;
      if (next < 0) return;
      const lane = waiting[next].lane;
      if (held.fast + held.slow >= pool || (lane === 'slow' && held.slow >= slowCap)) return;
      held[lane]++;
      waiting.splice(next, 1)[0].go();
    }
  };
  const checkouts = {
    budget: () => ({ since: 0 }),
    snapshot: async (cwd) => ({ commit: snapshotOf.get(cwd), tree: `tree:${snapshotOf.get(cwd)}`, wrote: true }),
    checkout: async ({ commit }) => ({ dir: `/nonexistent-3539/checkouts/${commit}`, commit }),
    baseCheckout: async ({ claim }) => ({ dir: `/nonexistent-3539/checkouts/base-of-${claim}`, commit: `base-of-${claim}`, standIns: [] }),
    ended: async () => undefined,
  };
  const gate = new GateRunner({
    raw: async () => [], now: () => clock, append: async () => undefined, core: { writer: 'core', actor: 'you', scope: 'you' },
    start: async (r) => {
      const run = `run:${++n}`;
      const session = sessionOf.get(r.claim);
      const row = { session, check: r.check, snapshot: r.commit.replace(/^base-of-/, ''), on_base_run: r.commit.startsWith('base-of-'), lane: r.lane, asked_at: clock, started_at: null, ended_at: null };
      starts.push(row);
      await new Promise((go) => { waiting.push({ lane: r.lane, go }); grant(); });
      let end;
      const done = new Promise((resolve) => { end = resolve; });
      row.started_at = clock;
      row.ended_at = clock + took.get(`${session}\0${r.check}`);
      live.set(run, { row, lane: r.lane, done, end });
      return run;
    },
    ended: (run) => live.get(run)?.done ?? Promise.resolve('missing'),
    slots: () => ({ free: Math.max(0, pool - live.size) }),
    budget_ms: script.config?.budget_ms ?? 10_000, hold_ms: script.config?.hold_ms ?? 60_000,
    checkouts: () => checkouts, invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  });
  const events = script.sessions.flatMap((s, i) => s.events.map((e, j) => ({ e, s, i, j }))).sort((a, b) => a.e.at - b.e.at || a.i - b.i || a.j - b.j);
  for (const { e, s } of events) if (e.kind !== 'prompt' && e.kind !== 'stop') throw Error(`the hub's order is run on prompts and stops: session ${s.id} has a ${e.kind} event`);
  const origin = new Map();
  const stops = [];
  const ticks = [];
  let claims = 0;
  const step = async () => { await settled(); grant(); await settled(); };
  for (let k = 0; ;) {
    const next = Math.min(events[k]?.e.at ?? Infinity, ticks[0] ?? Infinity, ...[...live.values()].map((l) => l.row.ended_at));
    if (next === Infinity) break;
    clock = next;
    for (const [run, l] of [...live]) if (l.row.ended_at <= clock) { live.delete(run); held[l.lane]--; l.end('passed'); }
    await step();
    for (; k < events.length && events[k].e.at <= clock; k++) {
      const { e, s } = events[k];
      if (e.kind === 'prompt') { origin.set(s.id, e.origin); gate.prompted(s.id); continue; }
      const claim = `claim:${String(++claims).padStart(12, '0')}`;
      const cwd = `/nonexistent-3539/worktrees/${s.id}`;
      sessionOf.set(claim, s.id);
      snapshotOf.set(cwd, e.snapshot);
      const checks = s.checks.map((c) => ({ check: c.id, approved: null, command: `sh ${c.id}`, covers: ['R1'], depth: 'unit', on_base: c.on_base, asserts: [], expected_ms: c.expected_ms }));
      const stopped = await gate.stop({ session: s.id, claim, task: `task:${s.id}`, cwd, base: `base-of-${e.snapshot}`, requirements: [], checks, stopAt: clock });
      const row = { session: s.id, stop: e.id ?? `${s.id}#${stops.filter((x) => x.session === s.id).length + 1}`, snapshot: e.snapshot, opened_by: origin.get(s.id) ?? 'unknown', at: clock, fast: stopped.fast, slow: stopped.slow, turn_end_returned_at: null };
      stops.push(row);
      void gate.turnEnded(claim, [], clock, { session: s.id, origin: HUB_ORIGIN[row.opened_by] ?? row.opened_by, due: null, starter: null }).then(() => { row.turn_end_returned_at = clock; });
      // A prompt no fact foresees counts as coming within the grace window: the core's beat calls tick, here at its end.
      ticks.push(clock + (script.config?.grace_ms ?? 60_000));
      ticks.sort((a, b) => a - b);
      await step();
    }
    while (ticks.length && ticks[0] <= clock) ticks.shift();
    gate.tick();
    await step();
  }
  await settled();
  const stuck = starts.filter((r) => r.started_at === null);
  if (stuck.length) throw Error(`the hub's run ended with ${stuck.length} runs still waiting for a slot, the first ${JSON.stringify(stuck[0])}`);
  const unreturned = stops.filter((s) => s.turn_end_returned_at === null);
  if (unreturned.length) throw Error(`the hub's run ended with turnEnded still to return for ${unreturned.map((s) => s.stop).join(', ')}`);
  const key = (x) => `${x.session}\0${x.check}\0${x.snapshot}`;
  const head = new Map(starts.filter((r) => !r.on_base_run).map((r) => [key(r), r]));
  const base = new Map(starts.filter((r) => r.on_base_run).map((r) => [key(r), r]));
  const places = stops.flatMap((s) => s.slow.map((check) => {
    const at = { session: s.session, check, snapshot: s.snapshot };
    const run = head.get(key(at));
    const again = base.get(key(at));
    return {
      ...at, queued_at: s.at, handed_at: run ? run.asked_at : null, started_at: run ? run.started_at : null, ended_at: run ? run.ended_at : null,
      ...(again ? { base_run: { asked_at: again.asked_at, started_at: again.started_at, ended_at: again.ended_at } } : {}),
    };
  }));
  return { places, stops: stops.map(({ fast, slow, ...stop }) => stop) };
}
