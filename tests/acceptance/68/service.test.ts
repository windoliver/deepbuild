// AC4: a service check run from where its users are fails when the endpoint answers outside its floor. The endpoint
// is a real HTTP server the test starts: its fault answers its users (requests from 127.0.0.1, the check's `from`)
// after 300 ms against a 100 ms floor, and answers ::1, where `localhost` reaches first, at once. So a check that
// doesn't leave from its users' address meets a fast endpoint and passes. Also the Proof line for the service kind:
// it fails on its planted fault and passes on the fix, through the core's verdict.
import { describe, expect, it } from 'vitest';
import { judge, piece, runOn, shown, USERS } from './helpers.ts';

describe('AC4 a service check run from where its users are fails when the endpoint answers outside its floor', () => {
  it('AC4 the endpoint answering its users after 300 ms against a 100 ms latency floor fails, every request from 127.0.0.1; the fast endpoint passes', async () => {
    const fault = await piece('service', 'fault');
    const r = await runOn(fault);
    const seen = await fault.seen();
    expect(seen.length, 'the check sent requests to the endpoint').toBeGreaterThan(0);
    expect(seen.filter((a) => a !== USERS), `every request left from where its users are, ${USERS} (seen: ${seen.join(', ')})`).toEqual([]);
    expect(r.outcome, shown(r)).toBe('failed');
    expect(r.failures.some((f) => f.assertion && /latency/i.test(f.message)), `a failure at the check's assertion names the latency floor (${shown(r)})`).toBe(true);
    expect(judge(r, fault.spec).outcome).toBe('FAIL');

    const fix = await piece('service', 'fix');
    const ok = await runOn(fix);
    const fixSeen = await fix.seen();
    expect(fixSeen.length).toBeGreaterThan(0);
    expect(fixSeen.filter((a) => a !== USERS)).toEqual([]);
    expect(ok.outcome, shown(ok)).toBe('passed');
    expect(judge(ok, fix.spec).outcome).toBe('PASS');
  }, 60_000);
});
