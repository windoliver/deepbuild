// AC4 #19.04d6e57d A token that expires before a planned run ends is reported before the run starts.
//
// The planned run is a DeepBuild job with its deadline (#159's `job.submit`, `deadline_ms`): the runner hands the job
// your sign-in's access token from the Keychain, never its refresh token, so a token that expires before the job's
// deadline would cut the job off in the middle. Here the token expires 20 minutes from now and the job may run for an
// hour: the job must not start (no process, no launch of `claude`), and its record must say why, naming the token's
// expiry, before anything of it runs. The twin, a token good for 3 hours, starts the same job, which shows the
// stand-in world can launch a job at all. `deep doctor` shows the token's lifetime among its sign-in items
// (README: AC4, Seams: the Keychain).

import { afterAll, describe, expect, it } from 'vitest';
import { ACCOUNT, HOUR, MINUTE, cleanup, control, doctor, itemText, setKeychain, shown, sleep, waitFor, world, type Hub, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const limits = (resetsAt: number) => ({
  five_hour: { used_percentage: 5, resets_at: Math.floor(resetsAt / 1000) },
  seven_day: { used_percentage: 20, resets_at: Math.floor((resetsAt + 5 * 24 * HOUR) / 1000) },
});
const spec = (prompt: string) => ({ kind: 'read', agent: 'claude-code', prompt, deadline_ms: HOUR });
const status = (hub: Hub, job: string): Promise<Line> => control(hub, (c) => c.call('job.status', { job }));
const started = (rec: Line) => rec.pid !== undefined || ['running', 'stopping', 'stopped', 'finished'].includes(String(rec.state));
const namesExpiry = (text: string) => /token/i.test(text) && /expir/i.test(text);

describe('AC4 #19.04d6e57d A token that expires before a planned run ends is reported before the run starts', () => {
  it('AC4 #19.04d6e57d a job with an hour\'s deadline and a sign-in token that expires in 20 minutes never starts, and its record names the token\'s expiry; with a token good for 3 hours the same job starts', async () => {
    const w = await world({ noSession: true });
    const hub = w.hub!;
    // Room in the plan window for your account, so no window keeps the job waiting (#159).
    await control(hub, (c) => c.call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: limits(Date.now() + 3 * HOUR) }));

    // The twin first: a token good for 3 hours outlives the hour's run, and the job starts, so this world can start one.
    setKeychain(w.h, Date.now() + 3 * HOUR);
    const twin = await control(hub, (c) => c.call('job.submit', { spec: spec('Reply with OK, again.') }));
    let seen: Line = twin;
    await waitFor(async () => { seen = await status(hub, String(twin.job)); return started(seen) || seen.state === 'refused' ? seen : undefined; }, 60_000, `job ${twin.job} to start`);
    expect(started(seen), `AC4 (twin) with a token good for 3 hours, the job with an hour's deadline must start: ${JSON.stringify(seen)}`).toBe(true);

    const expiresAt = Date.now() + 20 * MINUTE;
    setKeychain(w.h, expiresAt);
    const rec = await control(hub, (c) => c.call('job.submit', { spec: spec('Reply with OK.') }));
    const job = String(rec.job);
    let last: Line = rec;
    const reported = await waitFor(async () => {
      last = await status(hub, job);
      if (started(last)) throw Error(`AC4 job ${job} started (state ${last.state}, pid ${last.pid}) with a sign-in token that expires at ${new Date(expiresAt).toISOString()}, 20 minutes from now, before its one-hour run would end: ${JSON.stringify(last)}`);
      return namesExpiry(JSON.stringify(last)) ? last : undefined;
    }, 20_000, `job ${job}'s record to say its sign-in token expires before the run would end (last: ${JSON.stringify(last)})`);
    expect(['refused', 'waiting'], `AC4 the job is refused, or waits, before it starts: ${JSON.stringify(reported)}`).toContain(reported.state);
    // Still not started a few seconds on.
    await sleep(3000);
    const after = await status(hub, job);
    expect(started(after), `AC4 job ${job} must not start with a token that expires before its run would end: ${JSON.stringify(after)}`).toBe(false);

    const d = await doctor(w.h);
    // deep doctor, run before any run starts, shows the token's lifetime among its sign-in items.
    const lifetime = d.items.filter((i) => namesExpiry(itemText(i)));
    expect(lifetime.length, `AC4 deep doctor must show the sign-in token's lifetime, naming when it expires: ${shown(d.ran)}`).toBeGreaterThan(0);
  }, 600_000);
});
