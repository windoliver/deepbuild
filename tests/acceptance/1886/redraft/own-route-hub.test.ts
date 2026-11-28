import { afterAll, describe, expect, it } from 'vitest';
import { AC2, cleanup, lastVerdict, reviewText, reviewedClaim, verdictText } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC2} a session on the agent's own route reads as it does today on a real hub`, () => {
  it(`${AC2} PR 21's claim from a Claude Code session started with no ANTHROPIC_BASE_URL: the review counts and passes, names no unknown model, and the claim is PASS`, async () => {
    const r = await reviewedClaim(AC2, undefined);
    const outcomes = r.review.map((x) => String(x.finished?.data.outcome ?? 'unfinished'));
    expect(outcomes, `${AC2} ${r.claim}'s review runs on the agent's own route: ${reviewText(r)}`).toEqual(outcomes.map(() => 'passed'));
    expect(reviewText(r), `${AC2} ${r.claim}'s review on the agent's own route names an unknown model`).not.toContain('model unknown');
    expect(lastVerdict(r), `${AC2} ${r.claim} on the agent's own route, green commands and a counted clean review: ${verdictText(r)}`).toBe('PASS');
  }, 600_000);
});
