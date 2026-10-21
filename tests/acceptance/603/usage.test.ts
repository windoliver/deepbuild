// AC2: a stop with usage null validates; one with a usage count of 0 and exact false, or a cost with
// basis estimated and no rate_card, is refused as its schema says. A missing usage is refused.
import { describe, expect, it } from 'vitest';
import { CAUSES, check, expectAccepted, expectRefused, stop, stopData, USAGE_ESTIMATED, USAGE_REPORTED, V2 } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

const COUNTS = ['input', 'cached', 'output'] as const;
const withUsage = (usage: JsonObject): JsonObject => stop(stopData('unknown', usage));
const edit = (usage: JsonObject, change: (u: JsonObject) => void): JsonObject => {
  const copy = structuredClone(usage);
  change(copy);
  return copy;
};

describe('AC2 usage is required, and null when not captured', () => {
  it('AC2 usage null validates for every cause', () => {
    for (const cause of CAUSES) expectAccepted(V2, stop(stopData(cause, null)), `cause ${cause}, usage null`);
  });

  it('AC2 a stop without usage is refused, naming /data/usage', () => {
    // A schema that leaves usage optional, so a missing usage could read as nothing spent, fails here.
    for (const cause of ['unknown', 'plan_window_spent', 'rate_limited']) {
      const data = stopData(cause);
      delete data.usage;
      expectRefused(V2, stop(data), '/data/usage', `cause ${cause} with no usage`);
    }
  });

  it('AC2 a usage of the Shape validates: covers turn or session, a reported cost, an estimated cost with its rate card', () => {
    expectAccepted(V2, withUsage(USAGE_REPORTED), 'the turn, reported cost, exact counts');
    expectAccepted(V2, withUsage(USAGE_ESTIMATED), 'the session so far, estimated cost from a named rate card, estimated counts');
    expectAccepted(V2, withUsage(edit(USAGE_REPORTED, (u) => { u.covers = 'session'; })), 'covers session');
    for (const bad of ['week', 'turns', '', null]) {
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { u.covers = bad; })), '/data/usage/covers', `covers ${JSON.stringify(bad)}`);
    }
  });

  it('AC2 a missing count is null, never 0: some null form of a missing count validates', () => {
    // The Shape says "A missing count is null, never 0" without saying whether the count or its value is
    // null; either form is taken (README, Readings).
    for (const count of COUNTS) {
      const forms = [null, { value: null, exact: false }, { value: null, exact: true }];
      const taken = forms.filter((form) => check(V2, withUsage(edit(USAGE_REPORTED, (u) => { u[count] = form; }))).ok);
      expect(taken.length, `a missing ${count} count can be written as null in one of ${JSON.stringify(forms)}`).toBeGreaterThan(0);
    }
  });
});

describe('AC2 every usage count says whether it is exact, and 0 never stands for not captured', () => {
  it('AC2 a count of 0 with exact false is refused at that count; its twin with exact true validates', () => {
    // A schema whose counts are plain {value, exact} with value >= 0 takes the estimated 0 and fails here.
    for (const usage of [USAGE_REPORTED, USAGE_ESTIMATED]) {
      for (const count of COUNTS) {
        expectRefused(V2, withUsage(edit(usage, (u) => { u[count] = { value: 0, exact: false }; })), `/data/usage/${count}`, `${count} {value: 0, exact: false}`);
        expectAccepted(V2, withUsage(edit(usage, (u) => { u[count] = { value: 0, exact: true }; })), `${count} {value: 0, exact: true}, a counted zero`);
        expectAccepted(V2, withUsage(edit(usage, (u) => { u[count] = { value: 5, exact: false }; })), `${count} {value: 5, exact: false}, an estimate`);
      }
    }
  });

  it('AC2 a count without exact, or with a value that is not a whole number from 0, is refused at that count', () => {
    for (const count of COUNTS) {
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { u[count] = { value: 12 }; })), `/data/usage/${count}`, `${count} without exact`);
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { u[count] = 12; })), `/data/usage/${count}`, `${count} as a bare number`);
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { u[count] = { value: -1, exact: true }; })), `/data/usage/${count}`, `${count} of -1`);
    }
  });

  it('AC2 context_fill is a fraction', () => {
    for (const fill of [0, 0.5, 1]) expectAccepted(V2, withUsage(edit(USAGE_REPORTED, (u) => { u.context_fill = fill; })), `context_fill ${fill}`);
    for (const fill of [1.5, -0.1, '42%']) {
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { u.context_fill = fill; })), '/data/usage/context_fill', `context_fill ${JSON.stringify(fill)}`);
    }
  });
});

describe('AC2 a cost says how it was priced, and an estimate names its rate card', () => {
  it('AC2 a cost with basis estimated and no rate_card is refused at /data/usage/cost; its twin with one validates', () => {
    // A schema with rate_card optional on every cost fails here.
    const estimated = edit(USAGE_ESTIMATED, (u) => { delete (u.cost as JsonObject).rate_card; });
    expectRefused(V2, withUsage(estimated), '/data/usage/cost', 'basis estimated, no rate_card');
    expectAccepted(V2, withUsage(USAGE_ESTIMATED), 'basis estimated with rate_card');
  });

  it('AC2 rate_card comes only with an estimate, and basis is one of reported, estimated or unpriced', () => {
    const reported = edit(USAGE_REPORTED, (u) => { (u.cost as JsonObject).rate_card = 'openai-2026-10'; });
    expectRefused(V2, withUsage(reported), '/data/usage/cost', 'basis reported with a rate_card');
    for (const basis of ['free', 'exact', '', null]) {
      expectRefused(V2, withUsage(edit(USAGE_REPORTED, (u) => { (u.cost as JsonObject).basis = basis; })), '/data/usage/cost', `basis ${JSON.stringify(basis)}`);
    }
  });
});
