// AC4 #27.e6116d56 "Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its
// deadline": the ask, the hold, the check run and the agent command (blind redraft for #3178; README). The Oct 9 cases
// stay ../outcomes-redraft/'s. Each fixture runs on the real hub, setup's entries
// and the session's own deep mcp, with ../outcomes-redraft/'s Claude Code stand-in as the session, and asks a choice
// that waits on you (no recommendation, so not provisional; README: The dispute):
//   - an ask nobody answers, its deadline 1 minute in your settings: `ask.defaulted` by the deadline, its default the
//     first option, never answered;
//   - a stop held for an open ask nobody answers: let through by the end of its 60 s hold, the record says how that
//     hold ended, naming the ask, and the session doesn't read as finished;
//   - a stop held for an open ask you answer during the hold: the held stop is continued with your answer, before the
//     hold's end, and the record says `delivered via stop_hold`, once, and nothing else;
//   - a check run that never ends on its own, its deadline 1 minute in the repo's spec: `run.finished` with outcome
//     overran by the deadline, its processes gone (brought over from ../waits.test.ts, its session the waiting one);
//   - an agent command still running long past its expected time: an overrun recorded for that call while it runs
//     (brought over likewise).
// "Done when": each reports its own outcome, and none reads as finished, answered or delivered where it isn't.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HOOK_KINDS, about, allEvents, answer, assistantSays, callId, editConfig, firedShown, inboxRows, makeHome, makeRepo, msOf, outcomeList, outcomes,
  payload, processes, run, sleep, startHub, stateOf, tag, toolValue, waitFor, within, type Ev, type Fired,
} from '../helpers.ts';
import { cleanup } from '../outcomes-redraft/standin.ts';
import { beginAsk, carriesGreen, setupHome, stopAfterAsking, waitingQuestion } from './world.ts';

afterAll(cleanup, 60_000);

const ID = '#27.e6116d56';
const SLACK_MS = 5000;
const DEADLINE = '1m';
const DEADLINE_MS = 60_000;
/** The stop hold, 60 s by default (design: Numbers, Stop holds). */
const HOLD_MS = 60_000;
/** A command whose last run took 1.5 s, still running this long after it started, is past any expected time (README: Readings). */
const COMMAND_BOUND_MS = 5 * 60_000;
/**
 * You trusted the repo in Claude Code (its workspace trust in ~/.claude.json, a file Claude Code owns): the hub runs a
 * repo's spec checks only in a project you trust (#322), and reads Claude Code's trust so you needn't answer twice.
 */
function trustInClaudeCode(home: string, dir: string): void {
  const file = join(home, '.claude.json');
  const user = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>) : {};
  user.projects = { ...(user.projects ?? {}), [dir]: { ...(user.projects?.[dir] ?? {}), hasTrustDialogAccepted: true } };
  writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
}
const KINDS = ['taste', 'authority', 'unblock', 'exception', 'choice', 'definition'];

describe(`${ID} Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its deadline`, () => {
  it(`${ID} (ask) an ask nobody answers reaches its default, the first option, by its deadline (${DEADLINE} in your settings), recorded as defaulted, never as answered`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    editConfig(home, (config) => { config.asks = { ...(config.asks ?? {}), deadline: Object.fromEntries(KINDS.map((k) => [k, DEADLINE])) }; });
    const hub = await startHub(home, { noAskWait: true });
    await setupHome(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, q: waitingQuestion() })).finish();
    const said = toolValue(a.reply);
    expect(said.status, `${ID} precondition: the ask waits on you (not provisional, not answered): deep_ask replied ${JSON.stringify(a.reply).slice(0, 800)}`).toBe('waiting');
    const due = typeof a.created.data?.deadline === 'number' ? msOf(a.created.data.deadline) : msOf(a.created.ts) + DEADLINE_MS;
    expect(due - msOf(a.created.ts), `${ID} ${a.handle}'s deadline comes from your settings, ${DEADLINE}: ${JSON.stringify(a.created.data).slice(0, 600)}`).toBeLessThanOrEqual(DEADLINE_MS + SLACK_MS);
    const defaulted = await within(Math.max(0, due + SLACK_MS - Date.now()) + 1000, async () => (await allEvents(hub)).find((e) => e.kind === 'ask.defaulted' && (e.subject === a.handle || JSON.stringify(e.data).includes(a.id))));
    expect(defaulted, `${ID} ${a.handle}, unanswered, must reach its default by its deadline ${new Date(due).toISOString()} (+${SLACK_MS} ms): the record has no ask.defaulted for it`).toBeDefined();
    expect(msOf(defaulted!.ts), `${ID} ${a.handle} defaulted at ${new Date(msOf(defaulted!.ts)).toISOString()}, past its deadline ${new Date(due).toISOString()}`).toBeLessThanOrEqual(due + SLACK_MS);
    expect(JSON.stringify(defaulted!.data), `${ID} ${a.handle}'s default is its first option, blue: ${JSON.stringify(defaulted!.data).slice(0, 600)}`).toMatch(/"blue"/);
    const events = await allEvents(hub);
    expect(events.filter((e) => e.kind === 'ask.answered' && (e.subject === a.handle || JSON.stringify(e.data).includes(a.id))), `${ID} nobody answered ${a.handle}: no ask.answered for it`).toEqual([]);
    const row = (await inboxRows(hub)).find((r) => r.ask === a.handle);
    expect(row?.outcome, `${ID} ${a.handle} reads defaulted, never answered: ${JSON.stringify(row)}`).toBe('defaulted');
  }, 300_000);

  it(`${ID} (hold, nobody answers) a stop held for an open ask goes through by the end of its hold, the record says how the hold ended, naming the ask, and the session doesn't read as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true });
    await setupHome(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, q: waitingQuestion() })).finish();
    const before = (await allEvents(hub)).at(-1)!.log_pos;
    const started = Date.now();
    const fired = await stopAfterAsking(a);
    const ended = Date.now();
    expect(fired.blocked, `nothing was answered, so the held stop isn't sent back (the control): ${firedShown(fired)}`).toBeUndefined();
    expect(ended - started, `${ID} precondition: ${a.s.id}'s stop is held while ${a.handle} waits on you: it took ${ended - started} ms (${firedShown(fired)})`).toBeGreaterThan(5000);
    expect(ended - started, `${ID} ${a.s.id}'s stop must be let through by the end of its ${HOLD_MS} ms hold; it took ${ended - started} ms`).toBeLessThanOrEqual(HOLD_MS + SLACK_MS);
    const outcome = await within(SLACK_MS, async () => (await allEvents(hub)).find((e) => e.log_pos > before && !HOOK_KINDS.has(e.kind) && about(e, a.s.id)
      && /\bhold|\bheld\b/i.test(JSON.stringify(e.data)) && JSON.stringify(e).includes(a.id)));
    const since = (await allEvents(hub)).filter((e) => e.log_pos > before).map((e) => ({ kind: e.kind, session: e.session, data: e.data }));
    expect(outcome, `${ID} by the end of ${a.s.id}'s hold the record must say how it ended (held, nothing answered), naming ${a.handle}; it recorded since the stop: ${JSON.stringify(since).slice(0, 3000)}`).toBeDefined();
    expect(msOf(outcome!.ts), `${ID} the hold's outcome was recorded by the hold's end`).toBeLessThanOrEqual(ended + SLACK_MS);
    expect(await stateOf(hub, a.s.id), `${ID} ${a.s.id} waits on you for ${a.handle}: it must never read as finished (design: Unknown, not finished)`).not.toBe('finished');
  }, 300_000);

  it(`${ID} (hold, you answer during it) a stop held for an open ask is continued with your answer before the hold ends, and the record says delivered via stop_hold, once, and nothing else`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true });
    await setupHome(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, q: waitingQuestion() })).finish();
    let stopped: Fired | undefined;
    const started = Date.now();
    const stopping = stopAfterAsking(a).then((f) => (stopped = f));
    await sleep(3000);
    if (stopped) throw Error(`${ID} BLOCKED: ${a.s.id}'s stop went through within 3 s with ${a.handle} open, so no stop was held to answer into: ${firedShown(stopped)}`);
    expect(await stateOf(hub, a.s.id), `${ID} a session whose stop is held for ${a.handle} never reads as finished`).not.toBe('finished');
    await answer(home, a.handle, a.green.id);
    await stopping;
    const ended = Date.now();
    expect(carriesGreen(stopped!.blocked ?? '', a), `${ID} your answer to ${a.handle} (${a.green.label}) must continue the held stop: ${firedShown(stopped!)}`).toBe(true);
    expect(ended - started, `${ID} the held stop reached its outcome by the end of its ${HOLD_MS} ms hold; it took ${ended - started} ms`).toBeLessThanOrEqual(HOLD_MS + SLACK_MS);
    // The turn the held stop continued uses the answer and ends.
    assistantSays(a.s, `Going with ${a.green.label}.`);
    const last = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `Going with ${a.green.label}.`, stop_hook_active: true }));
    expect(carriesGreen(last.blocked ?? '', a), `${ID} the held stop carried ${a.handle}; the continued turn's stop isn't sent back with it again: ${firedShown(last)}`).toBe(false);
    await within(30_000, async () => (await outcomes(hub, a.id)).find((e) => e.data?.outcome === 'delivered'));
    await sleep(3000);
    const all = await outcomes(hub, a.id);
    expect(all.map((e) => `${e.data?.outcome} via ${e.data?.via}`), `${ID} ${a.handle} reads delivered by the stop hold, once, within 30 s of the turn that showed it, and nothing else: ${outcomeList(all)}`).toEqual(['delivered via stop_hold']);
    expect(a.claude.wakes.find((w) => w.session === a.s.id && carriesGreen(w.stderr, a)), `${ID} one answer goes by one route: the held stop took ${a.handle}, so no waiter wakes the session with it`).toBeUndefined();
  }, 300_000);

  it(`${ID} (check run) a check run that never ends on its own reaches overran by its deadline (${DEADLINE} in the repo's spec), its processes stopped`, async () => {
    const { home } = makeHome();
    const marker = `dh27run${tag(4)}`;
    // A Node program, which the run's tracers see into (a shell's `sleep` is an untraced program, read uncounted at once).
    const repo = makeRepo(home, { '.deepbuild/done.yaml': `checks:\n  forever:\n    type: command\n    run: "node -e 'setTimeout(() => {}, 600000)' ${marker}"\n    deadline: ${DEADLINE}\n` });
    const hub = await startHub(home, { noAskWait: true });
    await setupHome(home);
    trustInClaudeCode(home, repo.dir);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, q: waitingQuestion() })).finish();
    const claimed = await a.claude.tool(a.s, 'deep_claim', { task_ref: `session:${a.s.id.replace(/[^0-9A-Za-z]/g, '')}#start`, attempt: 1, commit: repo.commit, scope: 'session', predictions: null });
    expect(JSON.stringify(claimed), `precondition: deep_claim records the session's claim: ${JSON.stringify(claimed).slice(0, 800)}`).toMatch(/claim:/);
    let said: unknown;
    const ran = a.claude.tool(a.s, 'deep_run', { check: 'forever', claim: null }, 180_000).then((r) => (said = r));
    const started = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'run.started' && JSON.stringify(e.data).includes('forever')), 60_000, 'the check run to start')
      .catch(async (e: Error) => { throw Error(`${ID} BLOCKED: ${e.message}; deep_run replied ${JSON.stringify(said ?? 'nothing yet').slice(0, 1500)}; recorded since the claim: ${JSON.stringify((await allEvents(hub)).filter((x) => !HOOK_KINDS.has(x.kind)).slice(-12).map((x) => ({ kind: x.kind, data: x.data }))).slice(0, 2500)}`); });
    const due = msOf(started.ts) + DEADLINE_MS;
    const handle = String(started.data?.run ?? started.subject);
    const finished = await within(Math.max(0, due + 2 * SLACK_MS - Date.now()), async () => (await allEvents(hub)).find((e) => e.kind === 'run.finished' && (e.subject === handle || e.data?.run === handle)));
    expect(finished, `${ID} check run ${handle} never ends on its own; it must reach a recorded outcome by its deadline, ${new Date(due).toISOString()} (+${2 * SLACK_MS} ms): no run.finished for it`).toBeDefined();
    expect(finished!.data?.outcome, `${ID} a check run past its deadline reads overran, never passed: ${JSON.stringify(finished!.data).slice(0, 600)}`).toBe('overran');
    expect(msOf(finished!.ts), `${ID} ${handle} reached its outcome after its deadline`).toBeLessThanOrEqual(due + 2 * SLACK_MS);
    const left = processes().filter((p) => p.command.includes(marker));
    expect(left.map((p) => `${p.pid} ${p.command}`), `${ID} an overran run is stopped: its processes are gone`).toEqual([]);
    await ran.catch(() => undefined);
  }, 300_000);

  it(`${ID} (agent command) an agent command still running far past its expected time is recorded as an overrun while it runs, never as finished`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home, { noAskWait: true });
    await setupHome(home);
    const a = await (await beginAsk(hub, home, { cwd: repo.dir, q: waitingQuestion() })).finish();
    const command = `node -e "setTimeout(() => {}, 1500)"`;
    // Its history: the same command ran once, for 1.5 s (run here, as the Bash tool would; the hub sees its hooks).
    const first = callId();
    await a.claude.hook('PreToolUse', payload(a.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: first }));
    const done = await run('/bin/sh', ['-c', command], { cwd: repo.dir });
    await a.claude.hook('PostToolUse', payload(a.s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: first, tool_response: { stdout: done.stdout, stderr: done.stderr, interrupted: false } }));
    // Again, and this time it doesn't end: Claude Code waits on the call, and no PostToolUse comes.
    const call = callId();
    const started = Date.now();
    await a.claude.hook('PreToolUse', payload(a.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: call }));
    const overrun = await within(COMMAND_BOUND_MS, async () => (await allEvents(hub)).find((e: Ev) => !HOOK_KINDS.has(e.kind) && JSON.stringify(e).includes(call) && /overr/i.test(JSON.stringify(e.data))));
    expect(overrun, `${ID} call ${call} (\`${command}\`, which took 1.5 s last time) still runs ${Math.round((Date.now() - started) / 1000)} s on; the record must hold its overrun, naming the call, while it runs`).toBeDefined();
    expect(await stateOf(hub, a.s.id), `${ID} a session whose command overran is still working on it: it must never read as finished`).not.toBe('finished');
  }, COMMAND_BOUND_MS + 180_000);
});
