import { afterEach, expect, it } from 'vitest';
import { AC1, AC2, AC3, fixture, blocked, held, clean } from './fixture.ts';
afterEach(clean, 60_000);
for (const mode of ['trunk', 'develop', 'remote-main', 'remote-master'] as const) {
  it(`${AC1} ${mode}: preflight fails on the recorded mainline merge and Closes is refused`, async () => {
    const r = await fixture(mode);
    expect.soft(r.verdict.data.outcome, 'preflight must FAIL on the merge, not disappear').toBe('FAIL');
    expect.soft(JSON.stringify(r.verdict.data.reasons), 'FAIL names preflight').toMatch(/preflight/i);
    const runs = r.release(r.events);
    expect.soft(runs.length, 'the claim must record a release run of preflight').toBe(1);
    const run = runs[0];
    if (run) {
      expect.soft(run.finished?.data.outcome, 'preflight failed on the merge').toBe('failed');
      const merged = String(run.started.data.commit);
      expect.soft(r.g('rev-parse', `${merged}^{tree}`), 'the run sees the actual merged tree').toBe(r.g('merge-tree', '--write-tree', r.w.head(), r.w.main));
      expect.soft(new Set(r.g('show', '-s', '--format=%P', merged).split(' ')), 'the merge joins the PR and mainline heads').toEqual(new Set([r.w.head(), r.w.main]));
    }
    held(r);
  }, 540_000);
}

it(`${AC2} no mainline: preflight is BLOCKED with cause and owner, and Closes is refused`, async () => {
  blocked(await fixture('missing'), /(?:no|not|missing|unavailable|unable|cannot|can't|couldn't).*main\s*(?:line)?|main\s*(?:line)?.*(?:not found|missing|unavailable|cannot|can't|couldn't)/i);
}, 540_000);
it('scope: unreadable mainline is BLOCKED, not absent or a merge conflict', async () => {
  blocked(await fixture('unreadable'), /(?:main\s*(?:line)?.*(?:read|resolve)|(?:read|resolve).*main\s*(?:line)?)/i);
}, 540_000);
it(`${AC3} undefined preflight stays on the claim as BLOCKED and holds Closes`, async () => {
  blocked(await fixture('local-main', { undefinedCheck: true }), /(?:not|isn't|undefined|no|missing|unknown|cannot|can't).*(?:defin|check)|(?:check|preflight).*(?:not defined|undefined|missing|unknown)/i);
}, 540_000);

