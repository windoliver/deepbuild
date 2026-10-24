// #159 AC1, AC4, AC9 and AC10's hub half: the runner inside the hub (`deep hub run --root`, #16), reached on its
// socket. A job's hooks are the job's events and never a session, a claim, a verdict or task spend; a hub started
// from a Claude Code terminal still launches `claude`; a hub killed mid-start finds its job on restart and never
// runs it twice; and a session that only looks like a job is still judged as itself.
// Every hook is carried to the hub's socket by the test, as deep-hook would (helpers.ts, sendHook): the job's
// fake CLI runs in the sandbox, which never lets it reach the hub's socket (#236).
import { join, dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  ACCOUNT, Client, NESTING, cleanup, alive, install, launches, reported, sendHook, sleep, startHub, stopHub, sub, tempDir, uuid, waitFor,
  writeHubConfig, type Hub, type Line,
} from './helpers.ts';
import { claudeLimits, job } from './world.ts';
import type { JobRecord, JobSpec } from '../../../packages/runner/src/index.ts';

afterEach(cleanup, 30_000);

interface HubWorld { bin: string; root: string; hub: Hub; client: Client }
async function openHub(o: { startup?: number; env?: Record<string, string> } = {}): Promise<HubWorld> {
  const bin = install(sub(tempDir(), 'bin'), o.startup ? { startup: o.startup } : {});
  const root = sub(tempDir(), 'root');
  writeHubConfig(root, { loginPath: `${dirname(bin)}:/usr/bin:/bin` });
  const hub = await startHub(root, { ...NESTING, SECRET_NOT_ALLOWLISTED: 'dh159-hub-only', ...(o.env ?? {}) });
  const client = await Client.open(hub);
  return { bin, root, hub, client };
}
/** A window reading with room for the fake sign-in's account, as the status line forwarder sends it. */
async function reportRoom(client: Client): Promise<void> {
  await client.call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(5, Date.now() + 3 * 3_600_000) });
}
const submit = async (c: Client, spec: JobSpec): Promise<JobRecord> => (await c.call('job.submit', { spec })) as unknown as JobRecord;
const status = async (c: Client, id: string): Promise<JobRecord> => (await c.call('job.status', { job: id })) as unknown as JobRecord;
const output = async (c: Client, id: string): Promise<string> => String((await c.call('job.output', { job: id })).stdout);
async function ended(c: Client, id: string, timeoutMs = 60_000): Promise<JobRecord> {
  return waitFor(async () => {
    const rec = await status(c, id);
    return ['finished', 'stopped', 'refused', 'lost'].includes(rec.state) ? rec : undefined;
  }, timeoutMs, `${id} to end`);
}
/** The record, opened once the hub has stopped (one writer at a time). */
async function recordOf(root: string) {
  return openRecord({ path: join(root, 'ledger.db'), now: Date.now });
}
const hookPayload = (session: string, cwd: string): Line => ({ session_id: session, cwd, transcript_path: join(cwd, `${session}.jsonl`), permission_mode: 'default' });

describe('AC1 #159.bbb96a19 a drafting job and a review check leave no session, claim, verdict or spend; their hooks are the job\'s events', () => {
  it('AC1 (the runner\'s half) a job of kind draft and one of kind review run through the hub\'s runner in Claude Code leave no session row, claim, verdict or task spend, while their hooks show in the record as the job\'s events', async () => {
    const h = await openHub();
    const jobs: { rec: JobRecord; session: string }[] = [];
    try {
      await reportRoom(h.client);
      for (const kind of ['draft', 'review'] as const) {
        const session = uuid();
        const rec = await submit(h.client, job(kind, `Work.\n@session ${session}\n@sleep 4000`));
        await waitFor(async () => (await status(h.client, rec.job)).session === session, 20_000, `the runner to read ${rec.job}'s session ID from its output`);
        const base = hookPayload(session, rec.folder);
        await sendHook(h.hub.socket, 'SessionStart', { ...base, source: 'startup', model: 'claude-haiku-4-5' });
        await sendHook(h.hub.socket, 'UserPromptSubmit', { ...base, prompt_id: uuid(), prompt: 'Work.' });
        await sendHook(h.hub.socket, 'PreToolUse', { ...base, tool_name: 'Read', tool_use_id: `toolu_${uuid().slice(0, 8)}`, tool_input: { file_path: join(rec.folder, 'README.md') } });
        await sendHook(h.hub.socket, 'Stop', { ...base, stop_hook_active: false });
        expect((await ended(h.client, rec.job)).state).toBe('finished');
        jobs.push({ rec, session });
      }
      const events = await h.client.events();
      for (const { rec, session } of jobs) {
        const mine = events.filter((e) => e.kind === 'job.event' && e.data?.job === rec.job).map((e) => String(e.data.event));
        expect(mine, `${rec.kind} job ${rec.job}: its hooks as its events`).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']));
        const asSession = events.filter((e) => e.session === session).map((e) => e.kind);
        expect(asSession, `${rec.kind} job: events recorded as a session ${session}`).toEqual([]);
      }
    } finally {
      h.client.close();
      await stopHub(h.hub);
    }
    const record = await recordOf(h.root);
    try {
      const sessions = (await record.table('sessions')).rows.map((r) => String(r.id));
      const claims = (await record.table('claims')).rows.map((r) => String(r.session_id));
      const events = await record.read({ after: 0, limit: 100_000 });
      for (const { rec, session } of jobs) {
        expect(sessions, `a session row for ${rec.kind} job ${rec.job}`).not.toContain(session);
        expect(claims, `a claim for ${rec.kind} job ${rec.job}`).not.toContain(session);
        const judged = events.filter((e) => ['verdict.made', 'claim.made', 'turn.usage', 'spend.reserved', 'spend.charged'].includes(e.kind)
          && (e.session === session || JSON.stringify(e.data).includes(session) || JSON.stringify(e.data).includes(rec.job)));
        expect(judged.map((e) => e.kind), `a verdict, claim or task spend from ${rec.kind} job ${rec.job}`).toEqual([]);
      }
    } finally {
      await record.close();
    }
  }, 180_000);
});

describe('AC4 #159.5c468614 a hub started inside a Claude Code session still launches claude, with none of the nesting variables', () => {
  it('AC4 a hub started from inside a Claude Code session launches a claude job that runs, and none of the four nesting variables reaches it, by a test that prints the job\'s environment', async () => {
    const h = await openHub();
    try {
      await reportRoom(h.client);
      const rec = await submit(h.client, job('read', 'Print your environment.\n@env'));
      const end = await ended(h.client, rec.job);
      const stdout = await output(h.client, rec.job);
      expect(end.state, `the job ran: ${JSON.stringify(end)} ${stdout.slice(0, 1000)}`).toBe('finished');
      const env = reported(stdout, 'env').env as Record<string, string>;
      console.log(`AC4 the job's environment: ${Object.keys(env).sort().join(' ')}`);
      for (const name of Object.keys(NESTING)) expect(env[name], `${name} reached the job`).toBeUndefined();
      expect(env.SECRET_NOT_ALLOWLISTED, 'a variable outside the allowlist reached the job').toBeUndefined();
    } finally {
      h.client.close();
      await stopHub(h.hub);
    }
  }, 120_000);
});

describe('AC9 #159.3aa5fd4e a hub killed while starting a job finds it on restart, and never runs it twice', () => {
  it('AC9 a hub killed between recording a job and starting it, or between starting it and writing the prompt, finds the job on restart and reaps or reports it, and never runs it twice', async () => {
    for (const point of ['job.recorded', 'job.started'] as const) {
      const h = await openHub({ startup: 2, env: { DEEP_HUB_TEST_CRASH: point } });
      const seen = new Set<number>();
      const watch = setInterval(() => { for (const p of launches(h.bin)) seen.add(p.pid); }, 50);
      try {
        await reportRoom(h.client);
        await submit(h.client, job('draft', 'Draft.\n@sleep 3000')).catch(() => undefined);
        const crashed = await Promise.race([h.hub.exit.then(() => true), sleep(15_000).then(() => false)]);
        if (!crashed) throw Error(`the hub didn't stop at its test crash point ${point} (DEEP_HUB_TEST_CRASH)`);
        h.client.close();
        const again = await startHub(h.root, { ...NESTING });
        const c = await Client.open(again);
        try {
          await reportRoom(c);
          const found = await waitFor(async () => {
            const jobs = (await c.call('job.list', {})).jobs as JobRecord[];
            return jobs.length === 1 && ['lost', 'stopped'].includes(jobs[0]!.state) ? jobs[0] : undefined;
          }, 20_000, `the restarted hub to find the job killed at ${point} and reap or report it`);
          await waitFor(() => [...seen].every((pid) => !alive(pid)), 15_000, `the job's CLI from before the crash at ${point} to be gone`);
          await sleep(5000);
          expect(seen.size, `${point}: the job ${found.job} ran ${seen.size} times (pids ${[...seen].join(', ')})`).toBeLessThanOrEqual(1);
          expect(((await c.call('job.list', {})).jobs as JobRecord[]).length, `${point}: the restarted hub recorded the job again`).toBe(1);
        } finally {
          c.close();
          await stopHub(again);
        }
      } finally {
        clearInterval(watch);
        await stopHub(h.hub);
      }
    }
  }, 240_000);
});

describe('AC10 #159.fe8b9734 a session that cds into a job\'s folder or resumes a job\'s session ID is judged as itself; a job\'s early hook is the job\'s', () => {
  it('AC10 (the hub\'s half) a session that cds into a job\'s folder, or resumes a finished job\'s session ID, is recorded as its own session with a reading naming it; a job\'s own hook that reaches the hub before the runner has read the job\'s session ID still reads as the job\'s event', async () => {
    const h = await openHub();
    const visitor = uuid();
    let finished: JobRecord;
    let resumed: string;
    let early: JobRecord;
    const earlySession = uuid();
    try {
      await reportRoom(h.client);
      // A finished job, with a session ID of its own.
      resumed = uuid();
      finished = await submit(h.client, job('read', `Read.\n@session ${resumed}`));
      finished = await ended(h.client, finished.job);
      expect(finished.state, JSON.stringify(finished)).toBe('finished');
      // A session of yours that cds into the job's folder.
      const there = hookPayload(visitor, finished.folder);
      await sendHook(h.hub.socket, 'SessionStart', { ...there, source: 'startup', model: 'claude-haiku-4-5' });
      await sendHook(h.hub.socket, 'UserPromptSubmit', { ...there, prompt_id: uuid(), prompt: 'look around' });
      await sendHook(h.hub.socket, 'Stop', { ...there, stop_hook_active: false });
      // A session of yours that resumes the finished job's session ID.
      const back = hookPayload(resumed, sub(tempDir(), 'elsewhere'));
      await sendHook(h.hub.socket, 'SessionStart', { ...back, source: 'resume', model: 'claude-haiku-4-5' });
      await sendHook(h.hub.socket, 'UserPromptSubmit', { ...back, prompt_id: uuid(), prompt: 'carry on' });
      await sendHook(h.hub.socket, 'Stop', { ...back, stop_hook_active: false });
      // A job whose own hook arrives before the runner has read its session ID from its output.
      early = await submit(h.client, job('read', `Read.\n@session ${earlySession}\n@delay-init 4000\n@sleep 1000`));
      await waitFor(async () => (await status(h.client, early.job)).pid, 20_000, `${early.job}'s process`);
      expect((await status(h.client, early.job)).session, 'the scenario formed: the runner has not read the session ID yet').toBeUndefined();
      await sendHook(h.hub.socket, 'SessionStart', { ...hookPayload(earlySession, early.folder), source: 'startup', model: 'claude-haiku-4-5' });
      early = await ended(h.client, early.job);
      expect(early.session, 'the runner read the session ID from the job\'s output').toBe(earlySession);
      await sleep(1000);
      const events = await h.client.events();
      const jobEvents = (id: string) => events.filter((e) => e.kind === 'job.event' && e.data?.job === id).map((e) => String(e.data.event));
      expect(jobEvents(early.job), 'the early hook reads as the job\'s event').toContain('SessionStart');
      expect(events.filter((e) => e.session === earlySession).map((e) => e.kind), 'the early hook was recorded as a session').toEqual([]);
      expect(jobEvents(finished.job), 'the resumed session\'s hooks were recorded as the finished job\'s events').toEqual([]);
      expect(events.filter((e) => e.kind === 'job.event' && JSON.stringify(e.data).includes(visitor)), 'the visiting session\'s hooks were recorded as a job\'s').toEqual([]);
      for (const s of [visitor, resumed]) {
        expect(events.filter((e) => e.session === s).map((e) => e.kind), `session ${s}'s own events`).toEqual(expect.arrayContaining(['session.start', 'agent.stop']));
      }
    } finally {
      h.client.close();
      await stopHub(h.hub);
    }
    const record = await recordOf(h.root);
    try {
      const sessions = (await record.table('sessions')).rows.map((r) => String(r.id));
      expect(sessions, 'the session that cds into a job\'s folder has its own row').toContain(visitor);
      expect(sessions, 'the session that resumes a finished job\'s session ID has its own row').toContain(resumed);
      expect(sessions, 'the early-hook job has a session row').not.toContain(earlySession);
      const named = (s: string, rec: JobRecord) => (async () => ((await record.session(s))?.readings ?? []).some((r) => r.includes(rec.job) || r.includes(rec.folder)))();
      expect(await named(visitor, finished), `a reading on session ${visitor} names the job whose folder it entered`).toBe(true);
      expect(await named(resumed, finished), `a reading on session ${resumed} names the job whose session ID it resumed`).toBe(true);
    } finally {
      await record.close();
    }
  }, 180_000);
});
