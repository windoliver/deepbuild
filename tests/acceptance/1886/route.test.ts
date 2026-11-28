import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, PROXIED, cleanup, close, filesHolding, listener, must, outcomeOf, restoreEnv, saidBy, sayRuns, sayVerdicts, story,
} from './helpers.ts';

afterAll(async () => { await cleanup(); restoreEnv(); }, 60_000);

describe(`${AC1} a session started behind a base URL has its review read "${PROXIED}"`, () => {
  it(`${AC1} a Claude Code session started with ANTHROPIC_BASE_URL at a loopback listener opens PR 21; its review on the real hub is uncounted, "${PROXIED}", the claim isn't PASS, and the record never holds the URL`, async () => {
    const proxy = await listener();
    const s = await story(AC1, proxy.url);
    try {
      const { claim, reviews, verdicts, events } = s;
      must(reviews.length > 0 && reviews.every((r) => r.finished), `BLOCKED: ${AC1} ${claim} opened PR 21, so the hub must run its review to its finish: ${sayRuns(reviews)}`);

      const needles = [proxy.url, proxy.host, proxy.marker];
      const inEvents = needles.filter((n) => JSON.stringify(events).includes(n));
      expect(inEvents, `${AC1} the record's events hold the session's base URL`).toEqual([]);
      expect(filesHolding(s.w.root, needles), `${AC1} the hub's root holds the session's base URL`).toEqual([]);
      expect(proxy.requests(), `${AC1} nothing calls the session's base URL`).toBe(0);

      const proxied = reviews.filter((r) => saidBy(r).includes(PROXIED));
      must(proxied.length === reviews.length && reviews.every((r) => r.finished!.data.outcome === 'uncounted'),
        `${AC1} ${claim} was made in a session started with ANTHROPIC_BASE_URL set, so its review must be uncounted, "${PROXIED}"; `
        + `the transcript's model was trusted instead: ${sayRuns(reviews)}. Verdicts: ${sayVerdicts(verdicts)}`);
      must(verdicts.length > 0, `${AC1} ${claim} must be judged: no verdict was recorded`);
      must(!verdicts.some((v) => outcomeOf(v) === 'PASS'), `${AC1} ${claim}'s only review is uncounted, so it is never PASS: ${sayVerdicts(verdicts)}`);
    } finally {
      await close(s);
      await proxy.close();
    }
  }, 600_000);

  it(`${AC1} the same session with ANTHROPIC_BASE_URL unset is on the agent's own route: its transcript's model stands, and the review counts`, async () => {
    const s = await story(AC1, undefined);
    try {
      const { claim, reviews, verdicts } = s;
      must(reviews.length > 0 && reviews.every((r) => r.finished), `BLOCKED: ${AC1} ${claim} opened PR 21, so the hub must run its review to its finish: ${sayRuns(reviews)}`);
      must(!reviews.some((r) => /model unknown/.test(saidBy(r))), `${AC1} ${claim} was made on the agent's own route, so its transcript's model (claude-haiku-5-5) stands: ${sayRuns(reviews)}`);
      must(reviews.every((r) => r.finished!.data.outcome === 'passed'), `${AC1} ${claim}'s review, answered by claude-sonnet-5-5 with no finding, counts and passes: ${sayRuns(reviews)}. Verdicts: ${sayVerdicts(verdicts)}`);
      must(outcomeOf(verdicts.at(-1)) === 'PASS', `${AC1} ${claim}, its commands green and its review counted and clean, is PASS: ${sayVerdicts(verdicts)}`);
    } finally {
      await close(s);
    }
  }, 600_000);
});
