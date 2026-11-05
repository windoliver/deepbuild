// #45 AC6, on record events: an API-key session says so and its tokens leave the plan windows unchanged. The real hook and
// hub are in hub.test.ts.
import { describe, expect, it } from 'vitest';
import { billingMode, planWindowTokens } from '../../../packages/readings/src/index.ts';
import { ask, sessionStart, T0, usage } from './events.ts';

const events = (withKey: boolean) => [
  sessionStart('Splan', T0, { ANTHROPIC_API_KEY: false }),
  ask('Splan', T0 + 1),
  usage('Splan', T0 + 2, 'msg_p', { input: 1000, output: 200 }, { basis: 'unpriced' }),
  ...(withKey ? [
    sessionStart('Skey', T0 + 3, { ANTHROPIC_API_KEY: true }),
    ask('Skey', T0 + 4),
    usage('Skey', T0 + 5, 'msg_k', { input: 50_000, output: 7000 }, { basis: 'unpriced' }),
  ] : []),
];

describe('AC6 a session started with ANTHROPIC_API_KEY set', () => {
  it('#45.4768ed8f AC6 reads as billing an API key, a session with the key unset as on a plan, and one with no billing report as unknown, never as a plan', () => {
    expect(billingMode(sessionStart('A', T0, { ANTHROPIC_API_KEY: true }))).toBe('api_key');
    expect(billingMode(sessionStart('B', T0, { ANTHROPIC_API_KEY: false }))).toBe('plan');
    expect(billingMode({ ...sessionStart('C', T0, {}), data: { agent: 'claude-code', worktree: '/work', branch: null, thread: 'C', loads: [] } })).toBe('unknown');
  });

  it('#45.4768ed8f AC6 its 57,000 tokens leave the plan window at the plan session\'s 1,200, as if it had never run', () => {
    const windows = planWindowTokens(events(true));
    expect(windows.counted_tokens, 'only the plan session counts').toBe(1200);
    expect(windows.counted_tokens, 'unchanged by the API-key session').toBe(planWindowTokens(events(false)).counted_tokens);
    const key = windows.sessions.find((s) => s.session === 'Skey');
    expect(key?.mode).toBe('api_key');
    expect(key?.tokens, 'its tokens still read, apart').toBe(57_000);
    expect(key?.counted).toBe(false);
  });
});
