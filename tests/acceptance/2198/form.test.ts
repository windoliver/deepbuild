// #2198 AC4: a wrong form is said in words. A deep_claim whose commit is seven characters is refused, and its remediation
// holds "by its full SHA". Today: "Give commit in the form ^[0-9a-f]{40}$."
import { afterEach, describe, expect, it } from 'vitest';
import { AC4, call, claimArgs, cleanup, refusalOf, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC4} A form is said in words`, () => {
  // "Given a `deep_claim` whose commit is seven characters, when it is refused, then the remediation holds "by its full SHA"."
  it(`${AC4} deep_claim with a seven-character commit: the refusal's remediation holds "by its full SHA"`, async () => {
    const w = await world('taste-deadline');
    const short = w.wt.commit.slice(0, 7);
    const r = refusalOf(await call(w, 'deep_claim', claimArgs({ commit: short })), `deep_claim with commit ${short}`);
    expect(String(r.remediation ?? ''), `the remediation says the form in the schema's own words: ${JSON.stringify(r)}`).toContain('by its full SHA');
  }, 240_000);
});
