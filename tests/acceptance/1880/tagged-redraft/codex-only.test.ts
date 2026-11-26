// #1880.28966ae3 With Codex the only signed-in agent, a wiki build's reading either ends with a recorded result, or
// reads BLOCKED naming the reason before any process starts. On the merge base the job fails with
// `a Codex job takes no sub-agents`.
//
// A real hub (`deep hub run` from the built CLI) on a temp HOME whose only sign-in is Codex's (`~/.codex/auth.json`,
// made-up values, no account ID) and whose history holds one Codex session with a message worth reading. `codex` on
// the runner's login PATH is the fake in fixtures/fake-codex.pl; there is no `claude` anywhere on it. `wiki.build` on
// the hub's socket starts the reading; the record's events (`events.read`) and the runner's jobs (`job.list`,
// `job.output`) are read afterwards. README says how each outcome is read.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, blockedWithReason, codexSession, events, hubCall, installFake, makeHome, readJobs, removeHomes, repo, startHub, writeLoginPath, type Hub,
} from './helpers.ts';

const BASE_ERROR = 'a Codex job takes no sub-agents';
let hub: Hub | undefined;
afterEach(async () => { await hub?.stop(); hub = undefined; removeHomes(); }, 90_000);

describe(`${AC.codexOnly} a wiki build's reading with Codex the only signed-in agent`, () => {
  it(`${AC.codexOnly} a wiki build with only Codex signed in ends its reading with a recorded result, or reads BLOCKED naming the reason before any process starts, and never fails with "${BASE_ERROR}"`, async () => {
    const h = makeHome();
    expect(['/usr/bin/claude', '/bin/claude'].filter((f) => existsSync(f)), 'BLOCKED: a claude outside the test home is on the login PATH').toEqual([]);
    installFake(h, 'codex');
    writeLoginPath(h);
    // Codex's sign-in only: no ~/.claude.json and no ~/.claude/.credentials.json.
    mkdirSync(join(h.home, '.codex'), { recursive: true });
    writeFileSync(join(h.home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'fake-1880', access_token: 'fake-1880', refresh_token: 'fake-1880' } }));
    const app = repo(join(h.home, 'work', 'api1880'));
    codexSession(h.home, app, '019a0000-0000-7000-8000-000000018801', 'the api always needs a token in the X-Api header');

    hub = await startHub(h);
    const built = await hubCall(h, 'wiki.build', {}, 600_000);

    const jobs = await readJobs(h);
    const all = await events(h);
    const finished = all.filter((e) => e.kind === 'reading.finished');
    const said = JSON.stringify({ built, jobs, readings: finished.map((e) => e.data) });

    // The base fails here: its one read job is refused with "it couldn't start: a Codex job takes no sub-agents".
    const launchError = [...jobs.map((j) => JSON.stringify(j)), ...finished.map((e) => JSON.stringify(e.data))].filter((t) => t.includes(BASE_ERROR));
    expect(launchError, `the reading fails at launch with "${BASE_ERROR}": ${said}`).toEqual([]);

    // Either the reading ends with a recorded result: a reading.finished, state finished, whose run is a finished Codex job...
    const byId = new Map(jobs.map((j) => [j.job, j]));
    const result = finished.some((e) => e.data.state === 'finished' && (e.data.runs as string[] | undefined)?.some((r) => byId.get(r)?.agent === 'codex' && byId.get(r)?.state === 'finished'));
    // ...or it reads BLOCKED naming why, and no read job's process ever started.
    const readRuns = new Set(jobs.map((j) => j.job));
    const started = all.filter((e) => e.kind === 'process.starting' && readRuns.has(String(e.data.run)));
    const about = all.filter((e) => /^(reading|job|wiki)\./.test(e.kind)).map((e) => e.data);
    const blocked = started.length === 0 && (jobs.some((j) => blockedWithReason(j)) || about.some((d) => blockedWithReason(d)));
    expect(
      { endsWithRecordedResult: result, blockedBeforeAnyProcess: blocked },
      `neither a recorded result nor BLOCKED naming the reason before any process starts (read-job processes started: ${started.length}): ${said}`,
    ).not.toEqual({ endsWithRecordedResult: false, blockedBeforeAnyProcess: false });
    // A reading that ran did so on Codex, the one agent signed in.
    expect(jobs.filter((j) => j.agent !== 'codex').map((j) => `${j.job} ${j.agent}`), `a read job on an agent that isn't signed in: ${said}`).toEqual([]);
  }, 900_000);
});
