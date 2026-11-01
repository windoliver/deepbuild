// AC4 #27.e6116d56 Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its
// deadline. One fixture per kind of wait, each on the real hub, setup's entries and the session's own deep mcp, with
// the Claude Code stand-in as the session (README: Readings, 4):
//   - an ask nobody answers, its deadline 1 minute in your settings: `ask.defaulted` by the deadline, never answered;
//   - a stop held for an open ask nobody answers: the stop goes through by the end of its hold (60 s by default), and
//     by then the record says how that hold ended, naming the ask, and the session doesn't read as finished;
//   - a check run that never ends on its own, its deadline 1 minute in the repo's spec: `run.finished` with outcome
//     overran by the deadline, its processes gone;
//   - an agent command still running long past its expected time: an overrun recorded for that call while it runs.
// "Done when": each reports its own outcome, and none reads as finished, answered or passed.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC4, about, allEvents, beginAsk, callId, cleanup, editConfig, firedShown, HOOK_KINDS, inboxRows, makeHome, makeRepo, msOf, payload, processes,
  setup, startHub, stateOf, stopAfterAsking, tag, waitFor, within, type Ev,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const SLACK_MS = 5000;
const DEADLINE = '1m';
const DEADLINE_MS = 60_000;
/** The stop hold, 60 s by default (design: Numbers, Stop holds). */
const HOLD_MS = 60_000;
/** A command whose last run took 1.5 s, still running this long after it started, is past any expected time (README: Readings, 4). */
const COMMAND_BOUND_MS = 5 * 60_000;

describe(`${AC4} Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its deadline`, () => {
  it(`${AC4} an ask nobody answers reaches its default by its deadline (${DEADLINE} in your settings), recorded as defaulted, never as answered`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    editConfig(home, (config) => { config.asks = { ...(config.asks ?? {}), deadline: { taste: DEADLINE, authority: DEADLINE, unblock: DEADLINE, exception: DEADLINE, choice: DEADLINE, definition: DEADLINE } }; });
    const hub = await startHub(home);
    await setup(home);
    const begun = await beginAsk(hub, home, { cwd: repo.dir });
    const created = (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === begun.s.id)!;
    const a = await begun.finish();
    const due = (typeof created.data?.deadline === 'number' ? msOf(created.data.deadline) : msOf(created.ts) + DEADLINE_MS);
    expect(due - msOf(created.ts), `${AC4} ${a.handle}'s deadline comes from your settings, ${DEADLINE}: ${JSON.stringify(created.data).slice(0, 600)}`).toBeLessThanOrEqual(DEADLINE_MS + SLACK_MS);
    const defaulted = await within(Math.max(0, due + SLACK_MS - Date.now()) + 1000, async () => (await allEvents(hub)).find((e) => e.kind === 'ask.defaulted' && (e.subject === a.handle || JSON.stringify(e.data).includes(a.id))));
    expect(defaulted, `${AC4} ${a.handle}, unanswered, must reach its default by its deadline ${new Date(due).toISOString()} (+${SLACK_MS} ms): the record has no ask.defaulted for it`).toBeDefined();
    expect(msOf(defaulted!.ts), `${AC4} ${a.handle} defaulted at ${new Date(msOf(defaulted!.ts)).toISOString()}, past its deadline ${new Date(due).toISOString()}`).toBeLessThanOrEqual(due + SLACK_MS);
    const row = (await inboxRows(hub)).find((r) => r.ask === a.handle);
    expect(row?.outcome, `${AC4} ${a.handle} reads defaulted, never answered: ${JSON.stringify(row)}`).toBe('defaulted');
  }, 300_000);

  it(`${AC4} a stop held for an open ask nobody answers goes through by the end of its hold, the record says how the hold ended, naming the ask, and the session doesn't read as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir })).finish();
    const before = (await allEvents(hub)).at(-1)!.log_pos;
    const started = Date.now();
    const fired = await stopAfterAsking(a);
    const ended = Date.now();
    expect(fired.blocked, `nothing was answered, so the held stop isn't sent back (the control): ${firedShown(fired)}`).toBeUndefined();
    expect(ended - started, `${AC4} ${a.s.id}'s stop must be let through by the end of its ${HOLD_MS} ms hold; it took ${ended - started} ms`).toBeLessThanOrEqual(HOLD_MS + SLACK_MS);
    expect(ended - started, `the stop was held while ${a.handle} was open (the control): it took ${ended - started} ms`).toBeGreaterThan(5000);
    const outcome = await within(SLACK_MS, async () => (await allEvents(hub)).find((e) => e.log_pos > before && !HOOK_KINDS.has(e.kind) && about(e, a.s.id)
      && /\bhold|\bheld\b/i.test(JSON.stringify(e.data)) && JSON.stringify(e).includes(a.id)));
    const since = (await allEvents(hub)).filter((e) => e.log_pos > before).map((e) => ({ kind: e.kind, session: e.session, data: e.data }));
    expect(outcome, `${AC4} by the end of ${a.s.id}'s hold the record must say how it ended (held, nothing answered), naming ${a.handle}; it recorded since the stop: ${JSON.stringify(since).slice(0, 3000)}`).toBeDefined();
    expect(msOf(outcome!.ts), `${AC4} the hold's outcome was recorded after the hold ended`).toBeLessThanOrEqual(ended + SLACK_MS);
    const state = await stateOf(hub, a.s.id);
    expect(state, `${AC4} ${a.s.id} waits on you for ${a.handle}, its waiter waiting: it must never read as finished (design: Unknown, not finished)`).not.toBe('finished');
  }, 300_000);

  it(`${AC4} a check run that never ends on its own reaches overran by its deadline (${DEADLINE} in the repo's spec), its processes stopped`, async () => {
    const { home } = makeHome();
    const marker = `dh27run${tag(4)}`;
    const repo = makeRepo(home, { '.deepbuild/done.yaml': `checks:\n  forever:\n    type: command\n    run: "sh -c 'sleep 600; : ${marker}'"\n    deadline: ${DEADLINE}\n` });
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir })).finish();
    const claimed = await a.claude.tool(a.s, 'deep_claim', { task_ref: `session:${a.s.id.replace(/[^0-9A-Za-z]/g, '')}#start`, attempt: 1, commit: repo.commit, scope: 'session', predictions: null });
    expect(JSON.stringify(claimed), `precondition: deep_claim records the session's claim: ${JSON.stringify(claimed).slice(0, 800)}`).toMatch(/claim:/);
    const ran = a.claude.tool(a.s, 'deep_run', { check: 'forever', claim: null }, 180_000);
    const run = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'run.started' && JSON.stringify(e.data).includes('forever')), 60_000, 'the check run to start')
      .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
    const due = msOf(run.ts) + DEADLINE_MS;
    const handle = String(run.data?.run ?? run.subject);
    const finished = await within(Math.max(0, due + 2 * SLACK_MS - Date.now()), async () => (await allEvents(hub)).find((e) => e.kind === 'run.finished' && (e.subject === handle || e.data?.run === handle)));
    expect(finished, `${AC4} check run ${handle} never ends on its own; it must reach a recorded outcome by its deadline, ${new Date(due).toISOString()} (+${2 * SLACK_MS} ms): no run.finished for it`).toBeDefined();
    expect(finished!.data?.outcome, `${AC4} a check run past its deadline reads overran, never passed: ${JSON.stringify(finished!.data).slice(0, 600)}`).toBe('overran');
    expect(msOf(finished!.ts), `${AC4} ${handle} reached its outcome after its deadline`).toBeLessThanOrEqual(due + 2 * SLACK_MS);
    const left = processes().filter((p) => p.command.includes(marker));
    expect(left.map((p) => `${p.pid} ${p.command}`), `${AC4} an overran run is stopped: its processes are gone`).toEqual([]);
    await ran.catch(() => undefined);
  }, 300_000);

  it(`${AC4} an agent command still running far past its expected time is recorded as an overrun while it runs, never as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir })).finish();
    const command = `node -e "setTimeout(() => {}, 1500)"`;
    // Its history: the same command ran once, for 1.5 s.
    const first = callId();
    await a.claude.hook('PreToolUse', payload(a.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: first }));
    const done = await a.claude.exec(command, repo.dir);
    await a.claude.hook('PostToolUse', payload(a.s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: first, tool_response: { stdout: done.stdout, stderr: done.stderr, interrupted: false } }));
    // Again, and this time it doesn't end: Claude Code waits on the call, and no PostToolUse comes.
    const call = callId();
    const started = Date.now();
    await a.claude.hook('PreToolUse', payload(a.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
    const overrun = await within(COMMAND_BOUND_MS, async () => (await allEvents(hub)).find((e: Ev) => !HOOK_KINDS.has(e.kind) && JSON.stringify(e).includes(call) && /overr/i.test(JSON.stringify(e.data))));
    expect(overrun, `${AC4} call ${call} (\`${command}\`, which took 1.5 s last time) still runs ${Math.round((Date.now() - started) / 1000)} s on; the record must hold its overrun, naming the call, while it runs`).toBeDefined();
    const state = await stateOf(hub, a.s.id);
    expect(state, `${AC4} a session whose command overran is still working on it: it must never read as finished`).not.toBe('finished');
  }, COMMAND_BOUND_MS + 180_000);
});
