// AC2, the published shape: a stop names its cause from the closed set, and a plan window spent says when it
// resets. Blind redraft against agent.stop@2 (README, "Redraft of AC2"); the adapters' readings are in
// stop.adapters.test.ts.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixtures, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { deleteAt, expectAccepted, expectRefused, firstFixture, getAt, kindSchema, setAt, STOP_CAUSES } from './helpers.ts';

/** The catalogued agent.stop at version 2: the shape that carries a cause. */
const STOP = () => kindSchema('agent.stop', 2);
/** A reset time, in ms since the epoch. */
const RESETS = 1760031451000;
/** The first published agent.stop@2 without its reset, read once; setAt and deleteAt copy it. */
let base: JsonValue | undefined;
/** A published stop with its cause replaced; plan_window_spent brings its reset, every other cause leaves it out. */
function withCause(cause: JsonValue): JsonValue {
  base ??= firstFixture(STOP());
  if (getAt(base, '/data/plan_resets') !== undefined) base = deleteAt(base, '/data/plan_resets');
  const stop = setAt(base, '/data/cause', cause);
  return cause === 'plan_window_spent' ? setAt(stop, '/data/plan_resets', RESETS) : stop;
}

describe('AC2 a stop event whose cause isn\'t in the closed set fails its schema', () => {
  it('AC2 the catalogue lists agent.stop at version 2, the shape that carries a cause', () => {
    expect(STOP()).toBe('agent.stop@2');
  });

  it.each(STOP_CAUSES)('AC2 a stop with cause %s passes', (cause) => {
    expectAccepted(validate(STOP(), withCause(cause)), `agent.stop@2 cause ${cause}`);
  });

  it.each(['plan_window_exhausted', 'rate_limit', 'overloaded', 'RATE_LIMITED', 'Unknown', '', 'crashed', 'refused', 'sign-in-required', 'unknown '])(
    'AC2 a stop with cause %j fails, naming /data/cause', (cause) => {
      // A schema that knows no cause field refuses the member too; one with cause as a free string, or one that
      // takes the agent's own error names, accepts the stranger. Both fail here.
      expectAccepted(validate(STOP(), withCause('unknown')), 'agent.stop@2 cause unknown');
      expectRefused(validate(STOP(), withCause(cause)), '/data/cause', `agent.stop@2 cause ${JSON.stringify(cause)}`);
    },
  );

  it('AC2 a cause that is not a string, or no cause at all, fails, naming /data/cause', () => {
    expectAccepted(validate(STOP(), withCause('timed_out')), 'agent.stop@2 cause timed_out');
    expectRefused(validate(STOP(), withCause(7)), '/data/cause', 'cause 7');
    expectRefused(validate(STOP(), withCause(null)), '/data/cause', 'cause null');
    expectRefused(validate(STOP(), withCause({ code: 'rate_limited' })), '/data/cause', 'cause as an object');
    // A stop that says nothing of why is not a stop with no cause: unknown is a member, silence is refused.
    expectRefused(validate(STOP(), deleteAt(withCause('unknown'), '/data/cause')), '/data/cause', 'no cause at all');
  });

  it('AC2 every string outside the set is refused, and every member accepted (1,000 cases)', () => {
    const members = new Set<string>(STOP_CAUSES);
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[a-z_]{1,24}$/), fc.constantFrom(...STOP_CAUSES)), (cause) => {
      const result = validate(STOP(), withCause(cause));
      if (members.has(cause)) expectAccepted(result, `cause ${cause}`);
      else expectRefused(result, '/data/cause', `cause ${JSON.stringify(cause)}`);
    }), { numRuns: 1000 });
  });

  it('AC2 a plan window spent carries its reset at /data/plan_resets: a whole number of ms since the epoch', () => {
    const spent = withCause('plan_window_spent'); // accepted with its reset in the per-cause test above
    expectRefused(validate(STOP(), deleteAt(spent, '/data/plan_resets')), '/data/plan_resets', 'plan_window_spent without its reset');
    expectRefused(validate(STOP(), setAt(spent, '/data/plan_resets', '2026-10-09T14:17:31Z')), '/data/plan_resets', 'reset as text');
    expectRefused(validate(STOP(), setAt(spent, '/data/plan_resets', String(RESETS))), '/data/plan_resets', 'reset as a numeric string');
    expectRefused(validate(STOP(), setAt(spent, '/data/plan_resets', -1)), '/data/plan_resets', 'reset before the epoch');
    expectRefused(validate(STOP(), setAt(spent, '/data/plan_resets', 1760031451000.5)), '/data/plan_resets', 'reset as a fraction of a ms');
  });

  it('AC2 every reset time in ms is taken with plan_window_spent, and no text or negative is (1,000 cases)', () => {
    const spent = withCause('plan_window_spent');
    fc.assert(fc.property(fc.oneof(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.integer({ max: -1 }), fc.string()), (resets) => {
      const result = validate(STOP(), setAt(spent, '/data/plan_resets', resets));
      if (typeof resets === 'number' && resets >= 0) expectAccepted(result, `plan_resets ${resets}`);
      else expectRefused(result, '/data/plan_resets', `plan_resets ${JSON.stringify(resets)}`);
    }), { numRuns: 1000 });
  });

  it('AC2 a reset belongs to a plan window spent alone: every other cause refuses /data/plan_resets', () => {
    // A schema that lists plan_resets as an optional field beside every cause fails here.
    for (const cause of STOP_CAUSES.filter((c) => c !== 'plan_window_spent')) {
      expectRefused(validate(STOP(), setAt(withCause(cause), '/data/plan_resets', RESETS)), '/data/plan_resets', `cause ${cause} with a reset`);
    }
  });

  it('AC2 the published fixtures show the shape: one agent.stop@2 fixture names plan_window_spent with its reset', () => {
    const all = fixtures(STOP());
    expect(all.length, 'agent.stop@2 has published fixtures').toBeGreaterThan(0);
    for (const f of all) expectAccepted(validate(STOP(), f), `published fixture with cause ${String(getAt(f, '/data/cause'))}`);
    const spent = all.find((f) => getAt(f, '/data/cause') === 'plan_window_spent');
    expect(spent, 'a published agent.stop@2 fixture with cause plan_window_spent').toBeDefined();
    expect(getAt(spent!, '/data/plan_resets'), 'the plan_window_spent fixture carries its reset in ms').toEqual(expect.any(Number));
    expect(Number.isInteger(getAt(spent!, '/data/plan_resets')), 'the reset is a whole number of ms').toBe(true);
  });

  it('AC2 the stop carries no words of the agent\'s to read a cause from: a text field beside the cause is refused', () => {
    // The cause comes from structure; a shape with room for the agent's message, where a rule could read it, fails here.
    for (const field of ['message', 'last_assistant_message', 'text', 'reason']) {
      expectRefused(validate(STOP(), setAt(withCause('unknown'), `/data/${field}`, 'You are rate limited; please sign in again.')), `/data/${field}`, `a ${field} beside the cause`);
    }
  });
});
