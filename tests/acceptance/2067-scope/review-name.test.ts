import { afterEach, expect, it } from 'vitest';
import { RELEASE_SPEC } from '../325/scenarios.ts';
import { clean, missing, start, world } from './fixture.ts';
afterEach(clean, 60_000);

it('#2067 scope: undefined release review is not satisfied by the automatic PR reviewer', async () => {
  const spec = RELEASE_SPEC.replace('checks: [preflight]', 'checks: [review]').replace(/^  preflight:.*\n/m, '');
  const r = await start(world({ spec }));
  const result = await r.open();
  const closes = await r.closes();
  console.log(`2067 scope review ${JSON.stringify({ verdict: result.verdict.data.outcome, reasons: result.verdict.data.reasons, checks: result.change.checks, closes })}`);
  expect(result.change.checks.some((c: { check: string; outcome: string }) => c.check.includes('review') && c.outcome === 'passed'), 'automatic external reviewer completed with no findings').toBe(true);
  missing(result, 'review', /(?:not|isn't|undefined|no|missing|unknown|cannot|can't).*(?:defin|check)|(?:check|review).*(?:not defined|undefined|missing|unknown)/i);
  expect.soft(closes.allowed, 'the missing release review still holds Closes').toBe(false);
  expect.soft(closes.reason, 'refusal names review').toMatch(/review/i);
}, 540_000);
