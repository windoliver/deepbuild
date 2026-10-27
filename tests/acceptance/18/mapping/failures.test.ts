// AC2, AC7 and AC11: failed calls and stops in the record, with their cause read from records only.
// Made-up sessions shaped like the corpus's recorded Claude Code payloads (2.1.304 `tools`, `stop-failure`) run
// through deep-hook into `deep hub run`; the record is read through `events.read`.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC11, AC2, AC7, cleanup, forCall, kindOf, makeHome, ofSession, Session, settle, shown, sleep, startHub, type Ev, type Hub } from './helpers.ts';

afterAll(cleanup, 60_000);

const LS_ERROR = 'Exit code 1\nls: /definitely/not/here: No such file or directory';
const NPM_ERROR = 'Exit code 1\n\n> shop@1.0.0 test\n> vitest run\n\n FAIL  src/cart.test.ts > cart > totals two items\nAssertionError: expected 3 to be 4\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)';
const STOP_CAUSES = ['sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'rate_limited', 'refusal', 'max_turns', 'context_overflow', 'tool_schema_rejected', 'agent_crashed', 'timed_out', 'unknown'];

/** The one tool.after the record holds for a call, or a failure naming what it holds. */
function afterOf(events: readonly Ev[], session: string, call: string): Ev {
  const after = forCall(ofSession(events, session), 'tool.after', call);
  expect(after.length, `one tool.after names call ${call} (data.call); the session's events: ${ofSession(events, session).map(shown).join('; ')}`).toBe(1);
  return after[0]!;
}
const stopsOf = (events: readonly Ev[], session: string) => kindOf(events, session, 'agent.stop');

/** A session whose one turn runs a Bash call that fails with `error`, then stops. */
async function failingCall(hub: Hub, command: string, error: string): Promise<{ s: Session; call: string }> {
  const s = new Session(hub.home);
  await s.start();
  await s.prompt(`Use the Bash tool to run: ${command}`);
  const call = await s.call('Bash', { command, description: 'Run it' }, { error });
  await s.stop('The command failed.');
  return { s, call: call.id };
}

describe(`${AC2} a failed command and a sign-in block each appear with a signature`, () => {
  it(`${AC2} a failed command's tool.after says failed, with a signature that is the same for the same failure in another session and differs for another failure, a cause and an owner`, async () => {
    const hub = await startHub(makeHome());
    const a = await failingCall(hub, 'ls /definitely/not/here', LS_ERROR);
    const b = await failingCall(hub, 'ls /definitely/not/here', LS_ERROR);
    const c = await failingCall(hub, 'npm test', NPM_ERROR);
    const events = await settle(hub, (all) => [a, b, c].every(({ s, call }) => forCall(ofSession(all, s.id), 'tool.after', call).some((e) => typeof e.data.signature === 'string')));
    const [ea, eb, ec] = [a, b, c].map(({ s, call }) => afterOf(events, s.id, call));
    for (const e of [ea!, eb!, ec!]) {
      expect(e.data.outcome, `the failed call reads failed: ${shown(e)}`).toBe('failed');
      expect(typeof e.data.signature === 'string' && e.data.signature.length > 0, `the failed call carries an error signature: ${shown(e)}`).toBe(true);
      expect(typeof e.data.cause === 'string' && e.data.cause.length > 0, `the failed call carries a cause: ${shown(e)}`).toBe(true);
      expect(typeof e.data.owner === 'string' && e.data.owner.length > 0, `the failed call carries an owner: ${shown(e)}`).toBe(true);
    }
    expect(eb!.data.signature, 'the same failure in another session has the same signature: a signature names the failure, not the session or the call').toBe(ea!.data.signature);
    expect(ea!.data.signature).not.toContain(a.call);
    expect(ea!.data.signature).not.toContain(a.s.id);
    expect(ec!.data.signature, 'a different failure has a different signature').not.toBe(ea!.data.signature);
  }, 180_000);

  it(`${AC2} a turn that ends on a sign-in error (StopFailure authentication_failed) is a block: its stop reads sign_in_required, with a signature, and its owner is you`, async () => {
    const hub = await startHub(makeHome());
    const s = new Session(hub.home);
    await s.start();
    await s.prompt('Reply with only the word hi.');
    await s.stopFailure('authentication_failed', 'Please run /login · API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}');
    const events = await settle(hub, (all) => stopsOf(all, s.id).some((e) => typeof e.data.signature === 'string'));
    const stop = stopsOf(events, s.id).at(-1);
    expect(stop, `the stop is recorded; the session's events: ${ofSession(events, s.id).map(shown).join('; ')}`).toBeDefined();
    expect(stop!.data.cause, shown(stop)).toBe('sign_in_required');
    expect(typeof stop!.data.signature === 'string' && stop!.data.signature.length > 0, `the sign-in block carries an error signature: ${shown(stop)}`).toBe(true);
    expect(stop!.data.owner, `only you can sign in, so the block's owner is you: ${shown(stop)}`).toBe('you');
  }, 120_000);
});

describe(`${AC7} "usage limit reached" in the agent's words is never a plan window spent`, () => {
  it(`${AC7} a stop whose last message says "usage limit reached", with no rate-limit or error record behind it, reads cause unknown, never plan_window_spent`, async () => {
    const hub = await startHub(makeHome());
    const s = new Session(hub.home);
    await s.start();
    await s.prompt('Keep going with the cart refactor.');
    const words = 'Claude usage limit reached. Your limit will reset at 5pm (America/Los_Angeles). Usage limit reached: the plan window is spent.';
    await s.stop(words);
    const events = await settle(hub, (all) => stopsOf(all, s.id).some((e) => typeof e.data.cause === 'string'));
    const stop = stopsOf(events, s.id).at(-1);
    expect(stop, `the stop is recorded; the session's events: ${ofSession(events, s.id).map(shown).join('; ')}`).toBeDefined();
    expect(STOP_CAUSES, `the stop names a cause from the closed set: ${shown(stop)}`).toContain(stop!.data.cause);
    expect(stop!.data.cause, `no record names a cause, so the agent's words make it neither plan_window_spent nor rate_limited: ${shown(stop)}`).toBe('unknown');
    expect(stop!.data.plan_resets, 'no reset time from the agent\'s words').toBeUndefined();
  }, 120_000);
});

describe(`${AC11} a failed npm test ends at PostToolUseFailure; a rate limit ends at StopFailure`, () => {
  it(`${AC11} a Bash call to npm test that exits 1 ends at its PostToolUseFailure with exit code 1, and is never recorded as an overrun`, async () => {
    const hub = await startHub(makeHome());
    const s = new Session(hub.home);
    await s.start();
    await s.prompt('Run the tests.');
    // The tests run for 4 s before they fail: the call's only end is its PostToolUseFailure, no PostToolUse follows.
    const call = await s.call('Bash', { command: 'npm test', description: 'Run the tests' }, { error: NPM_ERROR, durationMs: 4000, during: () => sleep(4000) });
    await s.stop('One test fails: the cart total is 3, not 4.');
    // Long enough after the call's end for a reader that waits on a PostToolUse to call it overdue.
    await sleep(8000);
    await s.prompt('Thanks.');
    await s.stop('You are welcome.');
    const events = await settle(hub, (all) => kindOf(all, s.id, 'agent.stop').length >= 2 && forCall(all, 'tool.after', call.id).length > 0, { minMs: 3000 });
    const after = afterOf(events, s.id, call.id);
    expect(after.data.outcome, shown(after)).toBe('failed');
    expect(after.data.exit_code, `the failure's exit code, from the PostToolUseFailure payload: ${shown(after)}`).toBe(1);
    const overruns = ofSession(events, s.id).filter((e) => /overrun|overran/i.test(`${e.kind} ${JSON.stringify(e.data)}`));
    expect(overruns.map(shown), 'a call that ended at PostToolUseFailure never overran').toEqual([]);
  }, 180_000);

  it(`${AC11} a turn that ends on a rate limit fires StopFailure with error: rate_limit, recorded as the stop cause rate limited with no transcript read`, async () => {
    const home = makeHome();
    const hub = await startHub(home);
    // The session's transcript doesn't exist: the cause can only come from the hook payload.
    const missing = join(home, '.claude/projects/-tmp-nowhere/never-written.jsonl');
    const s = new Session(home, { transcript: missing });
    await s.start();
    await s.prompt('Reply with only the word hi.');
    await s.stopFailure('rate_limit', 'API Error: Rate limit reached');
    const events = await settle(hub, (all) => stopsOf(all, s.id).some((e) => typeof e.data.cause === 'string'));
    const stop = stopsOf(events, s.id).at(-1);
    expect(stop, `the stop is recorded; the session's events: ${ofSession(events, s.id).map(shown).join('; ')}`).toBeDefined();
    expect(stop!.data.outcome, shown(stop)).toBe('failed');
    expect(stop!.data.cause, `StopFailure's error rate_limit names the cause, with no transcript to read: ${shown(stop)}`).toBe('rate_limited');
  }, 120_000);
});
