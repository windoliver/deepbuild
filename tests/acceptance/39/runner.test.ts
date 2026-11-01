// AC6, AC26, AC28: the runner's Codex launch, through @deepbuild/runner and a hub, with fixtures/fake-codex.pl as `codex`.
// These tests use tests/acceptance/159's world (the runner's own suite): same repo, same license.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT, Client, cleanup, contentsOf, git, home, makeRepo, seqNow, startHub, stopHub, sub, tempDir, ulid, uuid, waitFor, writeHubConfig, type Line } from '../159/helpers.ts';
import { job, openWorld, room, runJob } from '../159/world.ts';
import type { JobRecord, JobSpec } from '../../../packages/runner/src/index.ts';
import { AC, FIXTURES, parseObject } from './helpers.ts';

afterEach(cleanup, 30_000);
const VERSION = '0.160.0';
function fakeCodex(): string {
  const bin = sub(tempDir(), 'bin');
  copyFileSync(join(FIXTURES, 'fake-codex.pl'), join(bin, 'codex'));
  chmodSync(join(bin, 'codex'), 0o755);
  writeFileSync(join(bin, 'fake-codex.json'), JSON.stringify({ version: VERSION, loginExit: 0 }));
  mkdirSync(join(home(), '.codex'), { recursive: true });
  return bin;
}
const codexJob = (kind: JobSpec['kind'], prompt: string, over: Partial<JobSpec> = {}): JobSpec => ({ ...job(kind, prompt, over), agent: 'codex' });
const started = (stdout: string): Line => {
  for (const l of stdout.split('\n')) {
    const text = parseObject(l)?.item?.text;
    if (typeof text === 'string' && text.startsWith('fake:')) return JSON.parse(text.slice(5)) as Line;
  }
  throw Error(`the fake never reported its start: ${stdout.slice(0, 500)}`);
};
const stdinOf = (stdout: string) => Buffer.from(String(started(stdout).stdin), 'base64').toString('utf8');
const rollout = (session: string | undefined) => { const f = join(home(), '.codex/sessions', `rollout-${session}.jsonl`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

/** deep-hook's part, carried by the test as #159's sendHook does, for Codex: one hook.request@1 line, then the hub's reply or its close. */
const sendHook = (socket: string, event: string, payload: Line) => new Promise<void>((resolve) => {
  const sock = net.connect(socket);
  const done = () => { sock.destroy(); resolve(); };
  setTimeout(done, 10_000);
  sock.on('error', done).on('close', done).on('data', done);
  sock.write(`${JSON.stringify({ v: 1, agent: 'codex', event, seq: seqNow(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload: { ...payload, hook_event_name: event } })}\n`);
});

describe(`${AC[6]} A Codex job the runner started with codex exec leaves no session row, claim or task spend`, () => {
  it(`${AC[6]} through the hub's runner a Codex job's hooks read as the job's events, with no session row, claim or spend under its thread ID`, async () => {
    const bin = fakeCodex();
    const root = sub(tempDir(), 'root');
    writeHubConfig(root, { loginPath: `${bin}:/usr/bin:/bin` });
    const hub = await startHub(root);
    const c = await Client.open(hub);
    try {
      await c.call('windows.report', { agent: 'codex', account: ACCOUNT, rate_limits: { limit_id: 'codex', primary: { used_percent: 5, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 }, secondary: { used_percent: 5, window_minutes: 10080, resets_at: Math.floor(Date.now() / 1000) + 86_400 } } }).catch(() => undefined); // Refused while the hub reads no Codex windows; the job's own state says the rest.
      const session = uuid();
      const rec = (await c.call('job.submit', { spec: codexJob('draft', `Work.\n@session ${session}\n@sleep 3000`) })) as unknown as JobRecord;
      expect(rec.state, `${AC[6]} the runner starts a Codex job: ${JSON.stringify(rec)}`).not.toBe('refused');
      await waitFor(async () => ((await c.call('job.status', { job: rec.job })) as unknown as JobRecord).session === session, 20_000, 'the runner to read the thread ID from the job\'s output');
      const base = { session_id: session, cwd: rec.folder, transcript_path: join(rec.folder, `${session}.jsonl`), permission_mode: 'default', model: 'gpt-reserve', turn_id: uuid() };
      for (const [event, extra] of [['SessionStart', { source: 'startup' }], ['UserPromptSubmit', { prompt: 'Work.' }], ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_a' }], ['Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }]] as const) {
        await sendHook(hub.socket, event, { ...base, ...extra });
      }
      const events = await c.events();
      expect(events.filter((e) => e.session === session).map((e) => e.kind), `${AC[6]} no events as a session`).toEqual([]);
      expect(events.filter((e) => e.kind === 'job.event' && e.data?.job === rec.job).map((e) => String(e.data.event)), `${AC[6]} its hooks as its events`).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']));
      expect(events.filter((e) => e.kind === 'claim.made').length, `${AC[6]} no claim`).toBe(0);
      const rows = ((await c.call('status.read')).rows ?? []) as Line[];
      expect(rows.filter((r) => r.id === session), `${AC[6]} no session row`).toEqual([]);
    } finally {
      c.close();
      await stopHub(hub);
    }
  }, 120_000);
});

describe(`${AC[26]} A job asked to write a file is refused by its read-only mode in Codex, and the refusal is its recorded stop cause`, () => {
  it(`${AC[26]} launched with exec --json, -s read-only and the prompt on stdin; the write is refused, nothing is written, and the job's stop cause is refusal`, async () => {
    const bin = fakeCodex();
    const w = await openWorld({ loginPath: `${dirname(join(bin, 'codex'))}:/usr/bin:/bin` });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, codexJob('draft', 'Write a file.\n@write out.txt hello'));
      expect(rec.state, `${AC[26]} the runner launches a Codex job: ${JSON.stringify(rec)}`).toBe('finished');
      const argv = started(stdout).argv as string[];
      expect(argv.slice(0, 2), `${AC[26]} exec --json`).toEqual(['exec', '--json']);
      expect(argv[argv.indexOf('-s') + 1], `${AC[26]} -s read-only`).toBe('read-only');
      expect(argv.at(-1), `${AC[26]} the prompt on stdin`).toBe('-');
      expect(stdinOf(stdout), `${AC[26]} the prompt on stdin`).toContain('Write a file.');
      expect(existsSync(join(rec.folder, 'out.txt')), `${AC[26]} nothing written`).toBe(false);
      expect(rec.stop?.cause, `${AC[26]} the refusal is its stop cause: ${JSON.stringify(rec)}`).toBe('refusal');
    } finally {
      await w.close();
    }
  }, 120_000);
});

describe(`${AC[28]} In Codex, #159's end-to-end marker test passes: the drafting job's stdin, its folder and its own transcript hold none of the three markers, and the review's hold the diff's marker and neither of the others; a runner that passes the PR body to the review, or the diff to the drafting job, fails it, naming the marker`, () => {
  it(`${AC[28]} a session's transcript, diff and PR body carry distinct markers; a Codex drafting job and review through the runner hold what the criterion says, by marker`, async () => {
    const bin = fakeCodex();
    const markers = { transcript: `TRANSCRIPT-MARK-${ulid()}`, diff: `DIFF-MARK-${ulid()}`, claim: `CLAIM-MARK-${ulid()}` };
    const repo = makeRepo({ 'README.md': 'A widget.\n' });
    const worktree = sub(tempDir(), 'wt');
    git(repo.dir, 'worktree', 'add', '-q', '-b', 'feature', worktree);
    writeFileSync(join(worktree, 'feature.txt'), `the change ${markers.diff}\n`);
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'feature');
    writeFileSync(join(worktree, 'PR_BODY.md'), `Done. ${markers.claim}\n`);
    const session = uuid();
    const transcript = join(home(), '.codex/sessions', `rollout-${session}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'response_item', payload: { role: 'user', content: `make the widget blue ${markers.transcript}` } })}\n`);
    const diff = git(worktree, 'diff', `${repo.base}..HEAD`);
    const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin` });
    try {
      await room(w);
      const draft = await runJob(w, codexJob('draft', 'Draft the checks for the issue: make the widget blue.', { checkout: { repo: worktree, commit: repo.base } }));
      const review = await runJob(w, codexJob('review', `Review this diff against the issue.\n\n${diff}`, { checkout: { repo: worktree, commit: repo.base } }));
      expect(draft.rec.state, `${AC[28]} the runner runs Codex's drafting job: ${JSON.stringify(draft.rec)}`).toBe('finished');
      expect(review.rec.state, `${AC[28]} and its review: ${JSON.stringify(review.rec)}`).toBe('finished');
      const holds = (what: string, text: string, name: keyof typeof markers, expected: boolean) => expect(text.includes(markers[name]), `${AC[28]} ${what} ${expected ? 'must hold' : 'holds'} the ${name} marker ${markers[name]}`).toBe(expected);
      for (const [what, text] of [['the drafting job\'s stdin', stdinOf(draft.stdout)], ['the drafting job\'s folder', contentsOf(draft.rec.folder).text], ['the drafting job\'s own transcript', rollout(draft.rec.session)]] as const) {
        for (const name of ['transcript', 'diff', 'claim'] as const) holds(what, text, name, false);
      }
      holds('the review\'s stdin', stdinOf(review.stdout), 'diff', true);
      for (const [what, text] of [['the review\'s stdin', stdinOf(review.stdout)], ['the review\'s folder', contentsOf(review.rec.folder).text], ['the review\'s own transcript', rollout(review.rec.session)]] as const) {
        for (const name of ['transcript', 'claim'] as const) holds(what, text, name, false);
      }
    } finally {
      await w.close();
    }
  }, 120_000);
});
