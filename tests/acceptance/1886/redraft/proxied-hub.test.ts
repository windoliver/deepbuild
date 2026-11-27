import { afterAll, describe, expect, it } from 'vitest';
import { AC1, PROXIED, cleanup, lastVerdict, listener, reviewText, reviewedClaim, verdictText } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} a session started behind a base URL override has its review read "${PROXIED}" on a real hub`, () => {
  it(`${AC1} PR 21's claim from a Claude Code session started with ANTHROPIC_BASE_URL at a local listener: the review check's run reads "${PROXIED}", the claim isn't PASS, and the record never holds the URL`, async () => {
    const proxy = await listener();
    try {
      const r = await reviewedClaim(AC1, proxy.url);
      expect(reviewText(r), `${AC1} ${r.claim}'s review (session started with ANTHROPIC_BASE_URL set) must read "${PROXIED}", not trust the transcript's model. Verdicts: ${verdictText(r)}`).toContain(PROXIED);
      expect(lastVerdict(r), `${AC1} ${r.claim}'s review doesn't count, so the claim is never PASS: ${verdictText(r)}`).not.toBe('PASS');
      for (const value of [proxy.url, proxy.host, 'dh1886-proxy']) expect(r.record.includes(value), `${AC1} the record holds the base URL's value ${value}`).toBe(false);
    } finally {
      await proxy.close();
    }
  }, 600_000);
});
