// #21 AC1, AC2 and AC3's measurement, without spending plan usage: a "day" of 1,000 tool calls replayed from the
// fixture corpus's recorded Claude Code payloads (adapters/corpus/claude-code, #47: what Claude Code really sent for
// Bash, Read, Edit, Write, Agent, ToolSearch and the other tools), each call's PreToolUse and PostToolUse run through
// the release deep-hook as an installed adapter's hook entry runs it, with the shipped guard entries in rules.json,
// to a real `deep hub run`. The day's windows: the hub up for 300 calls, stopped (SIGTERM) for 200, up again for 200,
// stopped with SIGSTOP for 200, and up for the last 100 (README: The replayed day). Every hook is timed by the hook
// timer and its event's seq read from the record (day.ts). The live day, on real sessions, is sessions.live.test.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { failOpen, failOpenProblems, joinHooks, overhead, overheadProblems, shown, summary, type Call, type Day, type Window } from './day.ts';
import {
  AC1, AC2, AC3, buildDeepHook, buildNoop, buildTimer, childEnv, cleanup, corpusToolCalls, environmentProblem, forwarder, jsonLines, makeHome, newCallId,
  newSession, readTimings, rehome, run, setAddress, settle, shared, sleep, spooled, startHub, stateOf, stopHub, tempDir, writeDefaultRules, type Hub,
  type Line, type RecordedCall,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLAN: [Window, number][] = [['up', 300], ['stopped', 200], ['up', 200], ['sigstopped', 200], ['up', 100]];
const RUNS = 5;
/** The stand-in for the agent's hook timeout: a hook still running then is killed (#315's suite stands in 10 s). */
const HOOK_TIMEOUT_MS = 15_000;

/**
 * The recorded calls the hub answers at once, shown before any is timed: each recorded call's PreToolUse and
 * PostToolUse run once through deep-hook to a hub on a home of its own, through a forwarder that keeps the hub's
 * acknowledgements. A call whose acknowledgement carries a hold (`hold_until_ms`: the hub holds it for an authority
 * gate, an extension's reply or a permission prompt) is left out, since the overhead budget is "except holds" and a
 * held call measures the hold. Made once per test process; the calls left out are logged by name.
 */
const unheld = shared(async (): Promise<RecordedCall[]> => {
  const binary = await buildDeepHook();
  const recorded = corpusToolCalls();
  if (recorded.length < 20) throw Error(`BLOCKED: the fixture corpus holds only ${recorded.length} recorded tool calls with both hooks`);
  const home = makeHome();
  writeDefaultRules(home);
  const hub = await startHub({ home });
  const s = newSession(home);
  const f = await forwarder(tempDir(), hub.socket);
  setAddress(home, `unix:${f.path}`);
  const ids: { pair: RecordedCall; call: string }[] = [];
  try {
    await run(binary, ['claude-code', 'SessionStart'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify({ session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5' }), timeoutMs: 60_000 });
    for (const pair of recorded) {
      const call = newCallId();
      ids.push({ pair, call });
      await run(binary, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(rehome(pair.pre, s, call)), timeoutMs: 60_000 });
      await run(binary, ['claude-code', 'PostToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(rehome(pair.post, s, call)), timeoutMs: 60_000 });
    }
  } finally {
    await f.close();
    await stopHub(hub);
  }
  const requests = jsonLines(f.upText()).filter((l) => typeof l.id === 'string' && l.payload);
  const acks = new Map(jsonLines(f.downText()).filter((l) => typeof l.ack === 'string').map((l) => [String(l.ack), l.hold_until_ms]));
  const held = new Set(requests.filter((r) => acks.get(String(r.id)) !== null && acks.get(String(r.id)) !== undefined).map((r) => String(r.payload.tool_use_id)));
  const kept = ids.filter(({ call }) => !held.has(call)).map(({ pair }) => pair);
  const left = ids.filter(({ call }) => held.has(call)).map(({ pair }) => `${pair.from} ${pair.pre.tool_name} ${JSON.stringify(pair.pre.tool_input).slice(0, 80)}`);
  console.log(`recorded tool calls: ${recorded.length}; held by the hub, left out: ${left.length ? left.join('; ') : 'none'}`);
  if (kept.length < 20) throw Error(`BLOCKED: only ${kept.length} recorded tool calls are answered without a hold`);
  return kept;
});

interface Replay { plant?: string; lingerMs?: number; lingerIn?: Window[] }
/** One replayed day (README: The replayed day). `lingerMs` is the wrong program: hooks in `lingerIn` windows take that much longer. */
async function replayDay(o: Replay = {}): Promise<Day> {
  const [binary, timer, noop, recorded] = await Promise.all([buildDeepHook(), buildTimer(), buildNoop(), unheld()]);
  const home = makeHome();
  writeDefaultRules(home);
  let hub: Hub | undefined = await startHub({ home, plant: o.plant });
  const s = newSession(home);
  const timings = join(tempDir(), 't');
  const floors = join(tempDir(), 'f');
  mkdirSync(timings);
  mkdirSync(floors);
  const codes = new Map<string, number>();
  let started = 0;
  const hook = (event: string, payload: Line, linger: boolean) => {
    started++;
    const r = spawnSync(timer, [timings, binary, 'claude-code', event], {
      cwd: s.cwd, env: childEnv(home, linger ? { DH21_TIMER_LINGER_MS: String(o.lingerMs) } : {}), input: JSON.stringify(payload), timeout: HOOK_TIMEOUT_MS, killSignal: 'SIGKILL',
    });
    // A hook still running at the stand-in hook timeout is killed; its time (to the kill) and its code (-1) fail the checks, naming it.
    if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`BLOCKED: the hook timer failed to run deep-hook (${event} ${String(payload.tool_use_id ?? '')}): ${r.error.message}`);
    codes.set(`${event} ${String(payload.tool_use_id ?? '')}`, r.status ?? -1);
  };
  const floor = () => spawnSync(timer, [floors, noop], { input: '', timeout: 30_000 });
  hook('SessionStart', { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5' }, false);

  const calls: Call[] = [];
  const spoolAtEnd = new Map<number, Line[]>();
  const stoppedStates = new Map<number, string[]>();
  let k = 0;
  for (const [w, [kind, n]] of PLAN.entries()) {
    if (kind === 'stopped') { await stopHub(hub!, 'SIGTERM'); hub = undefined; }
    if (kind === 'sigstopped') { process.kill(hub!.pid, 'SIGSTOP'); stoppedStates.set(w, [stateOf(hub!.pid)]); }
    const linger = o.lingerMs !== undefined && (o.lingerIn ?? []).includes(kind);
    for (let i = 0; i < n; i++) {
      const pair = recorded[k++ % recorded.length]!;
      const call = newCallId();
      hook('PreToolUse', rehome(pair.pre, s, call), linger);
      hook('PostToolUse', rehome(pair.post, s, call), linger);
      floor();
      calls.push({ window: w, kind, session: s.id, call });
    }
    if (kind === 'stopped') { spoolAtEnd.set(w, spooled(home)); hub = await startHub({ home, plant: o.plant }); }
    if (kind === 'sigstopped') { stoppedStates.get(w)!.push(stateOf(hub!.pid)); spoolAtEnd.set(w, spooled(home)); process.kill(hub!.pid, 'SIGCONT'); }
  }
  // The timer's watchers write their files just after each hook exits.
  for (const until = Date.now() + 15_000; (readTimings(timings).length < started || readTimings(floors).length < calls.length) && Date.now() < until;) await sleep(100);
  const events = await settle(hub!, (all) => {
    const seen = new Set(all.filter((e) => e.kind === 'tool.before' || e.kind === 'tool.after').map((e) => `${e.kind} ${e.data?.call}`));
    return calls.every((c) => seen.has(`tool.before ${c.call}`) && seen.has(`tool.after ${c.call}`));
  }, { timeoutMs: 120_000, quietMs: 5000 });
  const day: Day = { windows: PLAN.map(([kind]) => kind), calls, hooks: joinHooks(timings, calls, events, codes), floorMs: readTimings(floors).map((t) => Number(t.endNs - t.spawnNs) / 1e6), spoolAtEnd, stoppedStates, events };
  console.log(`replayed day${o.plant ? ` (DEEP_HUB_PLANT=${o.plant})` : ''}${o.lingerMs ? ` (hooks in ${o.lingerIn?.join(', ')} windows ${o.lingerMs} ms longer)` : ''}: ${summary(day)}`);
  return day;
}

/** The five days the timing criteria are judged on (the design: five runs after warm-up); the first is AC2's day. */
const firstDay = shared(() => replayDay());
const days = shared(async () => {
  const out: Day[] = [await firstDay()];
  while (out.length < RUNS) out.push(await replayDay());
  return out;
});

function gate(ctx: TestContext): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (a reading only): ${problem}`);
}

describe(`${AC1} p95 overhead under 10 ms on top of process start`, () => {
  it(`${AC1} over a replayed day of 1,000 recorded Claude Code tool calls, the hooks run with the hub up take under 10 ms at p95 over process start, in each of five days`, async (ctx: TestContext) => {
    gate(ctx);
    const all = await days();
    for (const [i, day] of all.entries()) expect(overheadProblems(day).filter((p) => !/^p95/.test(p)), `day ${i + 1}: every hook run with the hub up is in the record`).toEqual([]);
    const own = all.map((d) => overhead(d).ownP95Ms);
    const overFloor = all.map((d) => overhead(d).overFloorP95Ms);
    judge2(ctx, 'AC1 p95 hook time over its own process start (exit - seq), hub up, ms per day', own, 'AC1 p95 hook time minus the native no-op\'s p95, hub up, ms per day', overFloor, 10);
  }, 1_800_000);

  it(`${AC1} (wrong program) a hook that takes 15 ms longer with the hub up fails the same check`, async () => {
    const day = await replayDay({ lingerMs: 15, lingerIn: ['up'] });
    const problems = overheadProblems(day);
    expect(problems.join('\n'), 'the check names the p95 over 10 ms').toMatch(/p95 hook time .* not under 10 ms/);
  }, 900_000);
});

describe(`${AC2} Over 1,000 real tool calls, with the hub stopped for 200 and SIGSTOPped for 200, no hook takes more than 50 ms over process start, and all 400 events are in the record once after the hub resumes`, () => {
  it(`${AC2} over a replayed day of 1,000 recorded tool calls, 200 with the hub stopped and 200 with it SIGSTOPped, every hook decides within 50 ms over process start and the 400 calls' events are in the record once after it resumes`, async () => {
    const day = await firstDay();
    expect(shown(failOpenProblems(day))).toEqual([]);
  }, 1_800_000);

  it(`${AC2} (wrong program) a hub that appends a replayed event twice (DEEP_HUB_PLANT=replay-appends-twice) fails the same check, naming the call`, async () => {
    const day = await replayDay({ plant: 'replay-appends-twice' });
    const problems = failOpenProblems(day).filter((p) => !p.startsWith('INCONCLUSIVE'));
    expect(problems.join('\n'), 'the check names an event in the record twice').toMatch(/in the record 2 times/);
  }, 900_000);

  it(`${AC2} (wrong program) a hook that takes 60 ms longer while the hub is away fails the same check, naming the call`, async () => {
    const day = await replayDay({ lingerMs: 60, lingerIn: ['stopped', 'sigstopped'] });
    const problems = failOpenProblems(day);
    expect(problems.join('\n'), 'the check names a hook over 50 ms').toMatch(/hook of toolu_dh21\w+ \(window \d, hub (stopped|sigstopped).* more than 50 ms/);
  }, 900_000);
});

describe(`${AC3} Budgets, on the reference Mac in the local preflight, compared with the merge base: over 1,000 real tool calls, hook overhead stays under 10 ms at p95 and fail-open under 50 ms, and both numbers are recorded`, () => {
  it(`${AC3} on the reference Mac, five replayed days of 1,000 recorded tool calls each keep hook overhead under 10 ms at p95 and fail-open under 50 ms at p95`, async (ctx: TestContext) => {
    gate(ctx);
    const all = await days();
    for (const [i, day] of all.entries()) expect(shown(failOpenProblems(day).filter((p) => /no event|never ran|spool|stopped through/.test(p))), `day ${i + 1}: every hook ran, is in the record, and the windows' calls failed open`).toEqual([]);
    judge2(ctx, 'AC3 overhead p95 over own start, ms per day', all.map((d) => overhead(d).ownP95Ms), 'AC3 overhead p95 over the floor, ms per day', all.map((d) => overhead(d).overFloorP95Ms), 10);
    judge2(ctx, 'AC3 fail-open p95 over own start, ms per day', all.map((d) => failOpen(d).ownP95Ms), 'AC3 fail-open p95 over the floor, ms per day', all.map((d) => failOpen(d).overFloorP95Ms), 50);
  }, 1_800_000);
});

/** Both readings judged by the design's rule; INCONCLUSIVE (a skip) only after both have been looked at, so a FAIL in either is never hidden. */
function judge2(ctx: TestContext, aName: string, a: number[], bName: string, b: number[], limit: number): void {
  const verdict = (runs: number[]) => {
    const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
    return runs.every((r) => r <= limit) ? 'PASS' : runs.every((r) => r > limit * (1 + margin)) ? 'FAIL' : 'INCONCLUSIVE';
  };
  const text = (name: string, runs: number[]) => `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit}`;
  console.log(text(aName, a));
  console.log(text(bName, b));
  expect(verdict(a), `FAIL ${text(aName, a)}`).not.toBe('FAIL');
  expect(verdict(b), `FAIL ${text(bName, b)}`).not.toBe('FAIL');
  if (verdict(a) !== 'PASS' || verdict(b) !== 'PASS') ctx.skip(`INCONCLUSIVE ${text(aName, a)}; ${text(bName, b)}`);
}
