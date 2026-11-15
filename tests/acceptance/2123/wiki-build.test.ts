// #2123.6e6ae79d A wiki build run while a reading job waits hands none of that reading's later sessions to a second
// job. Given two sessions with 16 worth-reading messages each and the plan reserve held, when wiki.build is called
// twice and the window then clears, then job.list shows two read jobs.
//
// The world is #356's (tests/acceptance/356/helpers.ts and history.ts, imported): a temp HOME with a Claude Code
// sign-in, `deep setup` starting the real hub through the launchd stand-in, and the hub's socket as `deep` uses it
// (`wiki.build`, `job.list`, `job.output`, `windows.report`). Only the agent a reading job would launch stands in
// (#356's fake reader as `claude` on the login PATH) and the status line's window readings, which the test reports as
// #356's helpers do: 95% used holds the default 10% reserve, 5% clears it. Thirty-two worth-reading messages are two
// reading jobs' worth (at most 30 handles go to one job), one session to each.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ACCOUNT, REPO, cargoBuild, cleanup, control, deep, installFake, makeHome, onMac, shown, type Line } from '../356/helpers.ts';
import { T0, msg, sessionId, tagOf, writeSession, type Sess } from '../356/history.ts';
import { AC, sleep } from './helpers.ts';

afterAll(cleanup, 60_000);

const DAY = 86_400_000;
const ACTIVE = new Set(['running', 'waiting', 'queued']);
interface Job { job: string; kind: string; state: string; blocked?: unknown }

const report = (home: string, used: number): Promise<Line> => control(home, (c) => c.call('windows.report', {
  agent: 'claude-code', account: ACCOUNT,
  rate_limits: { five_hour: { used_percentage: used, resets_at: Math.floor((Date.now() + 3 * 3_600_000) / 1000) }, seven_day: { used_percentage: 20, resets_at: Math.floor((Date.now() + 5 * DAY) / 1000) } },
}));
const readJobs = (home: string): Promise<Job[]> => control(home, async (c) => ((await c.call('job.list')).jobs as Job[]).filter((j) => j.kind === 'read'));
/** Everything the fake reader reported in the read jobs: what each was sent and read. */
const delivered = (home: string): Promise<string> => control(home, async (c) => {
  let text = '';
  for (const j of ((await c.call('job.list')).jobs as Job[]).filter((x) => x.kind === 'read')) text += String((await c.call('job.output', { job: j.job })).stdout ?? '');
  return text;
});
const said = (jobs: readonly Job[]): string => JSON.stringify(jobs.map((j) => ({ job: j.job, state: j.state, ...(j.blocked ? { blocked: j.blocked } : {}) })));

describe(`${AC.wiki} A wiki build run while a reading job waits hands none of that reading's later sessions to a second job`, () => {
  it(`${AC.wiki} two sessions with 16 worth-reading messages each, the plan reserve held: wiki.build called twice, then the window clears, and job.list shows two read jobs`, async () => {
    onMac();
    const h = makeHome();
    installFake(h.bin);
    writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'a@example.invalid' } }));
    const repo = join(h.tmp, 'work', 'api');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    // The hub, started as `deep setup` starts it, with no history yet: its own wiki.build reads nothing.
    if (!['debug', 'release'].some((mode) => existsSync(join(REPO, 'target', mode, 'deep-hook')))) await cargoBuild();
    const ran = await deep(h.home, ['setup'], { timeoutMs: 600_000 });
    expect(ran.code, `deep setup exits 0 and leaves the hub running: ${shown(ran)}`).toBe(0);
    expect(await readJobs(h.home), 'read jobs before any session exists').toEqual([]);

    // Given: the plan reserve held, and two sessions with 16 worth-reading messages each, both from yesterday.
    await report(h.home, 95);
    const day = Math.floor((Date.now() - T0) / DAY) - 1;
    const sessions: Sess[] = [1, 2].map((n) => ({
      agent: 'claude', id: sessionId(2123_00 + n), cwd: repo, day,
      messages: Array.from({ length: 16 }, (_, i) => [msg('user', `remember: note ${i + 1} of session ${n} about the api repo.`), msg('assistant', `Noted ${i + 1}.`)]).flat(),
    }));
    for (const s of sessions) writeSession(h.home, s);
    const worth = sessions.flatMap((s) => s.messages.filter((m) => m.role === 'user').map(tagOf));

    // When: wiki.build is called twice while the reading waits on the reserve.
    const builds: Line[] = [];
    for (let n = 0; n < 2; n++) {
      await report(h.home, 95);
      builds.push(await control(h.home, (c) => c.call('wiki.build', {}, 600_000)));
    }
    const held = await readJobs(h.home);
    expect(held.filter((j) => j.state === 'waiting').length, `a reading job waits on the plan reserve after the two builds, which said ${JSON.stringify(builds.map((b) => b.reading))}: ${said(held)}`).toBeGreaterThan(0);

    // And the window then clears: every read job runs to its end, the reading's later job included. Done is no read
    // job active with every worth-reading message delivered, held for 20 s, so a job a build starts next is seen.
    let jobs = held;
    let quietSince: number | undefined;
    for (const end = Date.now() + 900_000; Date.now() < end; await sleep(500)) {
      await report(h.home, 5);
      jobs = await readJobs(h.home);
      if (jobs.length > 2) break;
      const text = jobs.some((j) => ACTIVE.has(j.state)) ? undefined : await delivered(h.home);
      if (text === undefined || !worth.every((tag) => text.includes(tag))) { quietSince = undefined; continue; }
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= 20_000) break;
    }
    const text = await delivered(h.home);
    expect(worth.filter((tag) => !text.includes(tag)), `worth-reading messages no read job was given once the window cleared: ${said(jobs)}`).toEqual([]);
    expect(jobs.map((j) => j.state), `the read jobs job.list shows, one for each session's 16 messages: ${said(jobs)}`).toHaveLength(2);
  }, 1_800_000);
});
