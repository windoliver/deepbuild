// AC1: agent.stop@2 validates a stop with each cause in the closed set and refuses one outside it;
// plan_resets is accepted only with plan_window_spent and required there.
import { describe, expect, it } from 'vitest';
import { CAUSES, expectAccepted, expectRefused, RESETS, stop, stopData, USAGE_REPORTED, V2 } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

const without = (data: JsonObject, key: string): JsonObject => {
  const copy = structuredClone(data);
  delete copy[key];
  return copy;
};

describe('AC1 agent.stop@2 names its cause from the closed set', () => {
  it('AC1 a stop with each of the eleven causes validates, with usage null and with a usage', () => {
    expect(CAUSES).toHaveLength(11);
    for (const cause of CAUSES) {
      expectAccepted(V2, stop(stopData(cause)), `cause ${cause}, usage not captured`);
      expectAccepted(V2, stop(stopData(cause, USAGE_REPORTED)), `cause ${cause}, a reported usage`);
    }
  });

  it('AC1 a cause outside the set, of another type, or missing is refused at /data/cause', () => {
    // A schema that takes any string, or the agent's own error names, fails here.
    const outside = ['overloaded', 'rate_limit', 'authentication_failed', 'model_not_found', 'finished', 'end_turn', 'Unknown', 'UNKNOWN', 'unknown ', 'rate-limited', ''];
    for (const cause of outside) expectRefused(V2, stop(stopData(cause)), '/data/cause', `cause ${JSON.stringify(cause)}`);
    for (const cause of [null, 0, true, ['unknown'], { cause: 'unknown' }]) {
      expectRefused(V2, stop({ ...stopData('unknown'), cause } as unknown as JsonObject), '/data/cause', `cause ${JSON.stringify(cause)}`);
    }
    expectRefused(V2, stop(without(stopData('unknown'), 'cause')), '/data/cause', 'no cause at all');
  });
});

describe('AC1 plan_resets belongs to plan_window_spent alone', () => {
  it('AC1 plan_window_spent requires plan_resets, a time in ms', () => {
    expectAccepted(V2, stop(stopData('plan_window_spent')), 'plan_window_spent with its reset time');
    expectRefused(V2, stop(without(stopData('plan_window_spent'), 'plan_resets')), '/data/plan_resets', 'plan_window_spent without plan_resets');
    for (const resets of ['tomorrow', String(RESETS)]) {
      expectRefused(V2, stop({ ...stopData('plan_window_spent'), plan_resets: resets }), '/data/plan_resets', `plan_resets ${JSON.stringify(resets)}`);
    }
  });

  it('AC1 every other cause refuses plan_resets', () => {
    // A schema that lists plan_resets as an optional field on every stop fails here.
    for (const cause of CAUSES.filter((c) => c !== 'plan_window_spent')) {
      expectRefused(V2, stop({ ...stopData(cause), plan_resets: RESETS }), '/data/plan_resets', `cause ${cause} with plan_resets`);
    }
  });
});
