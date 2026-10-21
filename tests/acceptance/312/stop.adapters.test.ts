// AC2, the adapters' readings: a stop's cause comes from the payload, never from the agent's text, and an
// unexplained stop is unknown. Moved as it stood from stop.test.ts by the AC2 redraft (README), since it needs
// packages/adapters, which the published-shape tests in stop.test.ts don't.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { corpusPayloads, only, request, STOP_CAUSES } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

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
