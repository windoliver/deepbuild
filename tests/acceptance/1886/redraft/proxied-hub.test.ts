// AC1: on a real hub, a session started with a base URL override in its environment has its review read "model
// unknown: proxied route"; on the merge base the transcript's model is trusted (issue Scope: "A session's route is
// read once at its start, from the environment its start reports, through its adapter's routeAtStart"; "The review's
// change session carries that route"; design, Plan usage: "The adapter also records at session start whether the
// session runs on the agent's own route").
//
// A Claude Code session whose own process, and so every deep-hook run of it, has ANTHROPIC_BASE_URL at a loopback
// listener; its transcript names claude-haiku-5-5. It opens PR 21 with green commands and a clean diff. The review's
// second model (the fake, answering as claude-sonnet-5-5) finds nothing. On the merge base the hub's review reads the
// transcript's model, so the review counts and the claim passes; this test fails there at its first expect.
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
