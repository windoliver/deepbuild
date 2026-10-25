// #666's live tests: real Claude Code sessions from the agent test harness, in a fresh checkout of the checkout-web
// fixture, given "Read the README and add one line to it.", with the temporary home's user settings running deep-hook
// for every hook event. They spend plan usage, so they run only by hand, on your own sign-in:
//   DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/666 session.live.test.ts
// Without the opt-in every test fails with BLOCKED in its message; nothing skips. A harness run that is BLOCKED (no
// such scenario, a Claude Code version its facts don't cover, no sign-in) fails every test that needs it as BLOCKED.
//
// Three sessions cover the five criteria (README, Spending): the killed session (the hub up, SIGKILLed once the first
// tool call's PostToolUse has returned, started again after the session stops: AC1, AC3, AC5), the stopped session
// (the hub stopped before it starts and started after it stops: AC1, AC2, AC5) and the keyed session (a made-up
// ANTHROPIC_API_KEY, so its model calls fail and spend nothing, the hub stopped then started: AC4, AC5). The two
// planted programs are fed the real sessions' own hooks: the killed session's recorded hook inputs, run again through
// deep-hook into the planted hub that drops a PostToolUse, and the stopped session's spool, as its bytes, replayed by
// the planted replay that appends an event twice.
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, buildDeepHook, checkout, cleanup, eventsOf, eventsOfSpooled, files, forms, forwarder, hookProof, hookTimeProblems, hubLog,
  installHooks, killProblems, machine, pollEvents, projectionProblems, proof, readHooks, readSpool, recordProblems, recordProof,
  replayProblems, runHooks, runProblem, scopeProblems, setAddress, settleEvents, sha256, shared, startHarness, startHub, stopHub, wallMs, waitFor,
  writeSpool, type Acked, type Ev, type HarnessRun, type HookRun, type Line, type Setup, type SpoolCopy, type Spooled,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const MINUTE = 60_000;
function requireLive(): void {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: these tests start real Claude Code sessions on your plan; run them by hand with DEEP_HARNESS_LIVE=1');
}
const spooledIn = (spooled: readonly Spooled[]) => (events: Ev[]) => spooled.every((r) => eventsOfSpooled(r, events).length > 0);

interface Session {
  s: Setup; work: string; run: Line; hooks: HookRun[]; transcript: string; sessionId: string;
  spoolBefore: SpoolCopy; spoolAfter: SpoolCopy; events: Ev[]; logs: string[]; projections: { problems: string[]; rows: number };
}
/** What every session leaves in the proof: the record with stamps and log positions, the transcript, the spool before and after its replay, each hook's return time; the keyed session's key replaced by its hash. */
function keep(folder: string, x: Session, redact: (text: string) => string = (t) => t): void {
  const put = (name: string, content: unknown) => proof(folder, name, redact(typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`));
  put('run.json', x.run);
  put('record.json', recordProof(x.events));
  put('transcript.jsonl', readFileSync(x.transcript, 'utf8'));
  put('spool-before.json', x.spoolBefore);
  put('spool-after.json', x.spoolAfter);
  put('hooks.json', hookProof(x.hooks));
  put('hub.log', x.logs.join('\n'));
  put('machine.txt', `${machine()}\n`);
}
/** The run's line, or the reason it can't stand as evidence (BLOCKED, INVALID), thrown so each test needing it fails so. */
function accepted(r: HarnessRun, s: Setup, work: string): Line {
  const problem = runProblem(r, s, work);
  if (problem) throw Error(problem);
  return r.run!;
}

/** The killed session: the hub up, SIGKILLed once the first tool call's PostToolUse has returned, started again after the session stops. */
const killed = shared(async (): Promise<Session & { killAtMs: number; restartAtMs: number; served: Map<string, number>; acked: Acked[] }> => {
  const s = installHooks(await buildDeepHook({ release: true }));
  const work = checkout(s);
  const hub = await startHub({ home: s.home });
  const fwd = await forwarder(s.dir, hub.socket);
  setAddress(s.root, fwd.path);
  const poller = pollEvents(hub);
  const harness = startHarness(s, work);
  let finished = false;
  void harness.done.then(() => { finished = true; });
  await waitFor(() => readHooks(s).find((h) => h.event === 'PostToolUse' || h.event === 'PostToolUseFailure'), 10 * MINUTE, () => finished);
  const killAtMs = wallMs();
  process.kill(hub.pid, 'SIGKILL');
  await hub.proc.exit;
  await poller.stop();
  const result = await harness.done;
  await fwd.close();
  const run = accepted(result, s, work);
  const spoolBefore = readSpool(s.root);
  const restartAtMs = wallMs();
  const again = await startHub({ home: s.home });
  const events = await settleEvents(again, spooledIn(spoolBefore.requests), { timeoutMs: 2 * MINUTE });
  const spoolAfter = readSpool(s.root);
  await stopHub(again);
  const x = {
    s, work, run, hooks: readHooks(s), transcript: String(run.transcript), sessionId: String(run.sessionId), spoolBefore, spoolAfter, events,
    logs: [hubLog(hub), hubLog(again)], projections: await projectionProblems(s.root, join(s.dir, 'copy')), killAtMs, restartAtMs, served: poller.served(), acked: fwd.acked(),
  };
  keep('live-killed', x);
  proof('live-killed', 'kill.json', { killedAt: new Date(killAtMs).toISOString(), restartedAt: new Date(restartAtMs).toISOString(), servedBeforeTheKill: Object.fromEntries(x.served), acknowledged: x.acked.map((a) => ({ id: a.request.id, event: a.request.event, call: a.request.payload?.tool_use_id ?? null, at: new Date(a.atMs).toISOString() })) });
  return x;
});

/** A session with the hub stopped before it starts, started once the session has stopped; `env` and `passEnv` go to the harness. */
async function stoppedSession(folder: string, o: { env?: Record<string, string>; passEnv?: string[] } = {}, redact?: (text: string) => string): Promise<Session> {
  const s = installHooks(await buildDeepHook({ release: true }));
  const work = checkout(s);
  const first = await startHub({ home: s.home });
  await stopHub(first);
  const run = accepted(await startHarness(s, work, o).done, s, work);
  const spoolBefore = readSpool(s.root);
  const hub = await startHub({ home: s.home });
  const events = await settleEvents(hub, spooledIn(spoolBefore.requests), { timeoutMs: 2 * MINUTE });
  const spoolAfter = readSpool(s.root);
  await stopHub(hub);
  const x = {
    s, work, run, hooks: readHooks(s), transcript: String(run.transcript), sessionId: String(run.sessionId), spoolBefore, spoolAfter, events,
    logs: [hubLog(first), hubLog(hub)], projections: await projectionProblems(s.root, join(s.dir, 'copy')),
  };
  keep(folder, x, redact);
  return x;
}
const stopped = shared(() => stoppedSession('live-stopped'));

/** A value made at run time in the shape of an Anthropic API key; never a real one. */
const KEY = `sk-ant-api03-${randomBytes(72).toString('base64url').slice(0, 93)}AA`;
const keyed = shared(() => stoppedSession('live-keyed', { env: { ANTHROPIC_API_KEY: KEY }, passEnv: ['ANTHROPIC_API_KEY'] }, (t) => t.split(KEY).join(`<the key, sha256 ${sha256(KEY)}>`)));

describe(`AC1 ${AC1} every hook the session fires is in the record once, under the session's ID, in stamp order`, () => {
  it('AC1 the killed session and the stopped session: SessionStart first, a PreToolUse and a PostToolUse for each tool call the transcript shows, and Stop, each in the record once', async () => {
    requireLive();
    const problems: string[] = [];
    for (const x of [await killed(), await stopped()]) problems.push(...scopeProblems(x.s, AC1), ...recordProblems(x));
    expect(problems).toEqual([]);
  }, 30 * MINUTE);

  it('AC1 (wrong program) the killed session\'s own hook inputs, run again through deep-hook, pass on the merged hub and fail on drops-post-tool-use, naming the call', async () => {
    requireLive();
    const a = await killed();
    const inputs = a.hooks.map((h) => ({ event: h.event, input: h.input }));
    const replay = async (plant?: string) => {
      const s = installHooks(a.s.deepHook);
      const hub = await startHub({ home: s.home, plant });
      await runHooks(s, inputs, a.work);
      const hooks = readHooks(s);
      const events = await settleEvents(hub, (evs) => [...eventsOf(hooks, evs).values()].every((e) => e.length > 0), { quietMs: 5000, timeoutMs: 2 * MINUTE });
      await stopHub(hub);
      const problems = recordProblems({ hooks, events, transcript: a.transcript, sessionId: a.sessionId });
      proof(`live-replay-${plant ?? 'merged'}`, 'record.json', recordProof(events));
      proof(`live-replay-${plant ?? 'merged'}`, 'problems.json', problems);
      return problems;
    };
    const dropped = (problems: string[]) => problems.filter((p) => p.startsWith(`${AC1}: the PostToolUse of call `) && p.endsWith('is not in the record')
      && a.hooks.some((h) => h.event === 'PostToolUse' && p.includes(`${h.input.tool_name} (${h.input.tool_use_id})`)));
    expect(dropped(await replay()), 'on the merged hub no PostToolUse is missing').toEqual([]);
    const planted = await replay('drops-post-tool-use');
    expect(dropped(planted).length, `the check names a dropped PostToolUse of a call the transcript shows; it said: ${JSON.stringify(planted)}`).toBeGreaterThan(0);
  }, 30 * MINUTE);
});

describe(`AC2 ${AC2} with the hub stopped before the session starts`, () => {
  it('AC2 the stopped session runs to its stop with every hook returning within 50 ms of its start; once the hub starts every spooled event is in the record in stamp order, none twice', async () => {
    requireLive();
    const b = await stopped();
    const problems = [...scopeProblems(b.s, AC2), ...hookTimeProblems(b.hooks), ...replayProblems(b.spoolBefore.requests, b.events)];
    if (b.run.verdict !== 'PASS') problems.push(`${AC2}: the session didn't run to its stop: the run is ${b.run.verdict}: ${b.run.reason}`);
    if (!b.hooks.some((h) => h.event === 'Stop')) problems.push(`${AC2}: the session fired no Stop`);
    expect(problems).toEqual([]);
  }, 30 * MINUTE);

  it('AC2 (wrong program) the stopped session\'s spool, replayed by replay-appends-twice, fails the same check, naming the event\'s ID', async () => {
    requireLive();
    const b = await stopped();
    const s = installHooks(b.s.deepHook);
    writeSpool(s.root, b.spoolBefore);
    const hub = await startHub({ home: s.home, plant: 'replay-appends-twice' });
    const events = await settleEvents(hub, spooledIn(b.spoolBefore.requests), { timeoutMs: 2 * MINUTE });
    await stopHub(hub);
    const problems = replayProblems(b.spoolBefore.requests, events);
    proof('live-replay-appends-twice', 'record.json', recordProof(events));
    proof('live-replay-appends-twice', 'problems.json', problems);
    const ids = b.spoolBefore.requests.map((r) => String(r.json.id));
    const named = problems.filter((p) => / is in the record [2-9]\d* times/.test(p) && ids.some((id) => p.startsWith(`${AC2}: spooled event ${id} `)));
    expect(named.length, `the check names a spooled event's ID in the record twice; it said: ${JSON.stringify(problems)}`).toBeGreaterThan(0);
  }, 30 * MINUTE);
});

describe(`AC3 ${AC3} with the hub killed by SIGKILL between two tool calls and started again`, () => {
  it('AC3 the killed session: every event the hub acknowledged before the kill is in the record, log positions only increase, and the hooks fired while it was down arrive from the spool', async () => {
    requireLive();
    const a = await killed();
    expect([...scopeProblems(a.s, AC3), ...killProblems({ ...a, spooled: a.spoolBefore.requests })]).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC4 ${AC4} with ANTHROPIC_API_KEY set for the session`, () => {
  it('AC4 the keyed session\'s SessionStart event says the key is set (the other sessions\' say it isn\'t), and no record row, spool file or hub log holds its value', async () => {
    requireLive();
    const c = await keyed();
    const problems = scopeProblems(c.s, AC4);
    const said = (x: Session): unknown[] => [...eventsOf(x.hooks.filter((h) => h.event === 'SessionStart'), x.events).values()].flat().map((e) => e.data?.billing?.ANTHROPIC_API_KEY);
    const keyedSaid = said(c);
    if (keyedSaid.length !== 1 || keyedSaid[0] !== true) problems.push(`${AC4}: the keyed session's SessionStart event says ANTHROPIC_API_KEY ${JSON.stringify(keyedSaid)}, not one true`);
    for (const [name, x] of [['killed', await killed()], ['stopped', await stopped()]] as const) {
      const other = said(x);
      if (other.length !== 1 || other[0] !== false) problems.push(`${AC4}: the ${name} session, run without the key, has SessionStart billing.ANTHROPIC_API_KEY ${JSON.stringify(other)}, not one false`);
    }
    // Every place: the record's rows (as events.read serves them, and the ledger's bytes), the spool before and after its replay, the hub's log, and every file under the temporary DeepBuild home.
    const places: [string, string][] = [
      ['the record\'s events', JSON.stringify(c.events)],
      ['the spool before its replay', JSON.stringify(c.spoolBefore.files)],
      ['the spool after its replay', JSON.stringify(c.spoolAfter.files)],
      ['the hub\'s log', c.logs.join('\n')],
    ];
    for (const file of files(c.s.root)) if (statSync(file).size < 256 * 1024 * 1024) places.push([file, readFileSync(file).toString('latin1')]);
    for (const [where, text] of places) for (const form of forms(KEY)) if (text.includes(form.core)) problems.push(`${AC4}: ${where} holds the key's value (${form.name})`);
    proof('live-keyed', 'key.json', { sha256: sha256(KEY), searched: places.map(([where]) => where) });
    expect(problems).toEqual([]);
  }, 30 * MINUTE);
});

describe(`AC5 ${AC5} after the run, the record's projections rebuilt from its log equal the live ones`, () => {
  it('AC5 each session\'s ledger, once its hub stopped: every projection equals its rebuild', async () => {
    requireLive();
    const problems: string[] = [];
    for (const [name, x] of [['killed', await killed()], ['stopped', await stopped()], ['keyed', await keyed()]] as const) {
      for (const p of x.projections.problems) problems.push(`${p} (the ${name} session)`);
    }
    expect(problems).toEqual([]);
  }, 30 * MINUTE);
});
