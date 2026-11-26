// #1880.964d40e3 With Claude Code signed in, the reading still runs with its reader sub-agent: #63's suites pass
// unchanged.
//
// Two tests. The first runs a wiki build on a real hub (`deep hub run` from the built CLI) on a temp HOME signed in to
// Claude Code only (`~/.claude.json`, a made-up account), with one Claude Code session worth reading in its history,
// the plan window reported clear on the hub's socket, and the fake in fixtures/fake-claude.pl as `claude` on the
// runner's login PATH. The fake prints the argv it was launched with; the test reads it back through `job.output` and
// checks the reader sub-agent went with it (`--agents` naming `reader`, and the Task tool it hands work to). The second
// checks "#63's suites unchanged": no file under tests/acceptance/63 differs from the base commit. #63's suites
// themselves run on macOS (their README); README here says how.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, BASE, REPO, claudeSession, events, fakeArgv, hubCall, installFake, jobOutput, makeHome, readJobs, removeHomes, repo, startHub, writeLoginPath, type Hub,
} from './helpers.ts';

const ACCOUNT = '18800000-1111-4222-8333-444444444444';
let hub: Hub | undefined;
afterEach(async () => { await hub?.stop(); hub = undefined; removeHomes(); }, 90_000);

/** The value after `flag` in `argv`, or undefined. */
const after = (argv: string[], flag: string): string | undefined => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };

describe(`${AC.claudeReader} the reading with Claude Code signed in`, () => {
  it(`${AC.claudeReader} a wiki build with Claude Code signed in runs its reading job on Claude Code with the reader sub-agent and the Task tool, and the job ends finished`, async () => {
    const h = makeHome();
    installFake(h, 'claude');
    writeLoginPath(h);
    writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'reader@example.invalid' } }));
    const app = repo(join(h.home, 'work', 'web1880'));
    claudeSession(h.home, app, '00000000-0000-4000-8000-000000018802', 'the web app always needs a token in the X-Api header');

    hub = await startHub(h);
    const resets = Math.floor((Date.now() + 3 * 3_600_000) / 1000);
    await hubCall(h, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 5, resets_at: resets } } });
    await hubCall(h, 'wiki.build', {}, 600_000);

    const jobs = await readJobs(h);
    const said = JSON.stringify(jobs);
    expect(jobs.length, `the wiki build started a reading job: ${said}`).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.agent, `the reading's agent: ${said}`).toBe('claude-code');
      const launches = fakeArgv(await jobOutput(h, job.job));
      expect(launches.length, `${job.job} launched the fake claude headless: ${said}`).toBe(1);
      const argv = launches[0]!;
      const agents = after(argv, '--agents');
      expect(agents, `${job.job} was launched with --agents: ${JSON.stringify(argv)}`).toBeDefined();
      const subagents = JSON.parse(agents!) as Record<string, { model?: string; prompt?: string }>;
      expect(Object.keys(subagents), `${job.job}'s sub-agents: ${agents}`).toContain('reader');
      expect(subagents.reader!.prompt, "the reader sub-agent's prompt").toEqual(expect.any(String));
      expect((after(argv, '--tools') ?? '').split(','), `${job.job}'s tools hand work to a sub-agent: ${JSON.stringify(argv)}`).toContain('Task');
      expect(job.state, `${job.job} ended: ${said}`).toBe('finished');
    }
    const finished = (await events(h)).filter((e) => e.kind === 'reading.finished');
    expect(finished.map((e) => e.data.state), 'each reading.finished').toEqual(jobs.map(() => 'finished'));
  }, 900_000);

  it(`${AC.claudeReader} #63's suites are unchanged from the base commit`, () => {
    const diff = spawnSync('git', ['-C', REPO, 'diff', '--name-only', BASE, '--', 'tests/acceptance/63'], { encoding: 'utf8' });
    expect(diff.status, `git diff against ${BASE} ran: ${diff.stderr}`).toBe(0);
    const untracked = spawnSync('git', ['-C', REPO, 'ls-files', '--others', '--exclude-standard', '--', 'tests/acceptance/63'], { encoding: 'utf8' });
    expect([...diff.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(Boolean), "files of #63's suites changed since the base").toEqual([]);
  });
});
