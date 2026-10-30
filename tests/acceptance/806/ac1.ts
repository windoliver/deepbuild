// What every replay test of criterion 1 asserts about one scenario of the sibling suites (scenarios.ts).

import { expect } from 'vitest';
import { replay, mutantProblems, clockProblems, type Replayed } from './replay.ts';
import type { Entry } from './scenarios.ts';
import { requireMacos, type JsonObject } from './helpers.ts';

/**
 * Plays the scenario on the stand-in and on the hub (with the app when it has the user's calls) and asserts: the hub's replies are the
 * stand-in's, field for field, evidence hashes by content; each call's time is within the bound the scenario names; and the comparison
 * itself fails when one field of a hub reply is changed.
 */
export async function expectReplayed(entry: Entry, standIn: (scenario: JsonObject) => JsonObject[], appReady: () => void): Promise<Replayed> {
  if (entry.app) { requireMacos(); appReady(); }
  const r = await replay(entry.build, entry.assets, { app: entry.app, standIn, ...(entry.reused ? { reused: entry.reused } : {}), ...(entry.compare ? { compare: entry.compare } : {}) });
  const what = `${entry.from}, ${entry.about}`;
  expect(r.failures, `${what}: the hub's replies against the stand-in's`).toEqual([]);
  for (const [call, bound] of Object.entries(entry.bounds ?? {})) {
    const ms = r.hub.ms[Number(call) - 1]!;
    if (bound.min !== undefined) expect(ms, `${what}: call ${call} waits for the frame to settle (${Math.round(ms)} ms)`).toBeGreaterThanOrEqual(bound.min);
    if (bound.max !== undefined) expect(ms, `${what}: call ${call} answers within 2 s (${Math.round(ms)} ms)`).toBeLessThanOrEqual(bound.max);
  }
  expect(mutantProblems(r.calls, r.standNorm, r.hubNorm, entry.compare), `${what}: the comparison fails when a field of the hub's reply is changed`).toEqual([]);
  if (entry.compare?.clock) expect(await clockProblems(r, entry.compare), `${what}: the comparison fails when the hub's clock readings are out of order`).toEqual([]);
  return r;
}
