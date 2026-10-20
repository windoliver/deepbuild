import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import { fixtures, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { corpusPayloads, eventFixture, expectAccepted, expectRefused, getAt, kindSchema, only, request, setAt, STOP_CAUSES } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

const STOP = () => kindSchema('agent.stop');
const withCause = (cause: JsonValue): JsonValue => setAt(eventFixture('agent.stop'), '/data/cause', cause);

describe('AC2 a stop event whose cause isn\'t in the closed set fails its schema', () => {
  it.each(STOP_CAUSES)('AC2 a stop with cause %s passes', (cause) => {
    expectAccepted(validate(STOP(), withCause(cause)), `agent.stop cause ${cause}`);
  });

  it.each(['plan_window_exhausted', 'rate_limit', 'RATE_LIMITED', 'Unknown', '', 'crashed', 'refused', 'sign-in-required'])(
    'AC2 a stop with cause %j fails, naming /data/cause', (cause) => {
      // A schema that knows no cause field refuses the member too; one with cause as a free string accepts the stranger. Both fail here.
      expectAccepted(validate(STOP(), withCause('unknown')), 'agent.stop cause unknown');
      expectRefused(validate(STOP(), withCause(cause)), '/data/cause', `agent.stop cause ${JSON.stringify(cause)}`);
    },
  );

  it('AC2 a cause that is not a string fails, naming /data/cause', () => {
    expectAccepted(validate(STOP(), withCause('timed_out')), 'agent.stop cause timed_out');
    expectRefused(validate(STOP(), withCause(7)), '/data/cause', 'agent.stop cause 7');
    expectRefused(validate(STOP(), withCause(null)), '/data/cause', 'agent.stop cause null');
    expectRefused(validate(STOP(), withCause({ code: 'rate_limited' })), '/data/cause', 'agent.stop cause as an object');
  });

  it('AC2 every string outside the set is refused, and every member accepted (1,000 cases)', () => {
    const members = new Set<string>(STOP_CAUSES);
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[a-z_]{1,24}$/), fc.constantFrom(...STOP_CAUSES)), (cause) => {
      const result = validate(STOP(), withCause(cause));
      if (members.has(cause)) expectAccepted(result, `cause ${cause}`);
      else expectRefused(result, '/data/cause', `cause ${JSON.stringify(cause)}`);
    }), { numRuns: 1000 });
  });

  it('AC2 a plan window spent carries its reset: a time in ms since the epoch, which the schema takes and types', () => {
    const spent = setAt(withCause('plan_window_spent'), '/data/reset', 1760017051123);
    expectAccepted(validate(STOP(), spent), 'plan_window_spent with its reset');
    expectRefused(validate(STOP(), setAt(spent, '/data/reset', '2026-10-09T14:17:31Z')), '/data/reset', 'reset as text');
    expectRefused(validate(STOP(), setAt(spent, '/data/reset', -1)), '/data/reset', 'reset before the epoch');
    // The published fixtures show the shape: one stop fixture names plan_window_spent with its reset.
    const spentFixture = fixtures(STOP()).find((f) => getAt(f, '/data/cause') === 'plan_window_spent');
    expect(spentFixture, 'a published agent.stop fixture with cause plan_window_spent').toBeDefined();
    expect(typeof getAt(spentFixture!, '/data/reset'), 'the plan_window_spent fixture carries its reset').toBe('number');
  });
});

describe('AC2 the adapters read a stop\'s cause from the payload, never from the agent\'s text, and an unparsed one is unknown', () => {
  const stopFailure = (error: JsonValue, text = 'I could not finish.'): JsonObject => ({
    session_id: '28478c8b-7ffe-47d4-a54f-9732928d2a62',
    transcript_path: '~/.claude/projects/-work/28478c8b-7ffe-47d4-a54f-9732928d2a62.jsonl',
    cwd: '/work',
    hook_event_name: 'StopFailure',
    error,
    last_assistant_message: text,
  });
  const causeOf = (payload: JsonObject): JsonValue | undefined =>
    only(shipped().mapHook(request('claude', payload), '2.1.304'), 'agent.stop', `StopFailure ${JSON.stringify(payload.error)}`).data.cause;

  it.each([
    ['rate_limit', 'rate_limited'],
    ['overloaded', 'rate_limited'],
    ['authentication_failed', 'sign_in_required'],
    ['oauth_org_not_allowed', 'sign_in_required'],
    ['model_not_found', 'unknown'],
  ])('AC2 Claude Code\'s StopFailure error %s records cause %s', (error, cause) => {
    expect(causeOf(stopFailure(error))).toBe(cause);
  });

  it('AC2 the agent\'s own words never pick the cause: a message that talks of a rate limit with an unlisted error is unknown', () => {
    expect(causeOf(stopFailure('something_else', 'You are rate limited; please sign in again.'))).toBe('unknown');
  });

  it('AC2 every error text maps into the closed set, and an unlisted one to unknown (1,000 cases)', () => {
    const listed = new Set(['rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed']);
    const members = new Set<string>(STOP_CAUSES);
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[a-z_]{1,24}$/)), (error) => {
      const cause = causeOf(stopFailure(error));
      expect(typeof cause).toBe('string');
      expect(members.has(cause as string), `cause ${String(cause)} for error ${JSON.stringify(error)}`).toBe(true);
      if (!listed.has(error)) expect(cause).toBe('unknown');
    }), { numRuns: 1000 });
  });

  it('AC2 the corpus\'s recorded StopFailure (model_not_found) replays as a failed stop with cause unknown', () => {
    const payloads = corpusPayloads('claude-code', '2.1.304', 'stop-failure').filter((p) => p.hook_event_name === 'StopFailure');
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      const event = only(shipped().mapHook(request('claude', payload), '2.1.304'), 'agent.stop', 'recorded StopFailure');
      expect(event.data.cause).toBe('unknown');
      expect(event.data.outcome).toBe('failed');
    }
  });

  it('AC2 every stop the adapters record names a cause from the set, a finished one included', () => {
    const stops = corpusPayloads('claude-code', '2.1.304', 'tools').filter((p) => p.hook_event_name === 'Stop');
    expect(stops.length).toBeGreaterThan(0);
    for (const payload of stops) {
      const event = only(shipped().mapHook(request('claude', payload), '2.1.304'), 'agent.stop', 'recorded Stop');
      expect(STOP_CAUSES as readonly string[], 'a finished stop still names its cause (unknown when nothing says)').toContain(event.data.cause);
    }
  });
});
