// #159 AC5, AC16 (the runner's half), AC19, and #236 AC4's runner half: what a job can reach. Its folder holds the
// base commit's checkout and no credential; it runs on your own sign-in without touching it; its stdin and its
// folder carry only what its spec gives it; it can't read the working session's worktree, transcript or the hub's
// socket; and a write its MCP server makes outside what it declared is refused by the sandbox and recorded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, closeListeners, contentsOf, git, home, install, makeRepo, REFRESH, reported, reportsOf, signIn, stdinOf, sub, tempDir, TOKEN, ulid, unixListener,
  uuid, waitFor,
} from './helpers.ts';
import { dataOf, job, openWorld, room, runJob } from './world.ts';
import type { Plant } from '../../../packages/runner/src/index.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('AC5 #159.f8c5a2e9 no credential reaches a job\'s folder, and your sign-in is untouched', () => {
  it('AC5 after a job, a search of its folder finds no credential file or token, and your own sign-in files are byte-identical to before', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const s = signIn();
    mkdirSync(join(s.home, '.codex'), { recursive: true });
    const codexAuth = join(s.home, '.codex', 'auth.json');
    writeFileSync(codexAuth, `${JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: TOKEN, refresh_token: REFRESH } })}\n`, { mode: 0o600 });
    const signInFiles = [s.claudeJson, s.credentials, s.settings, codexAuth];
    const before = signInFiles.map(digest);
    const repo = makeRepo();
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, job('draft', 'Draft the checks.\n@env', { checkout: { repo: repo.dir, commit: repo.base } }));
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      expect(reported(stdout, 'env').env.HOME, 'the job runs on your own sign-in home').toBe(home());
      expect(rec.folder.startsWith(join(w.root, 'jobs') + '/'), `the job's folder ${rec.folder} is under ${join(w.root, 'jobs')}/`).toBe(true);
      expect(existsSync(rec.folder), 'the job\'s folder is still there to search').toBe(true);
      const found = contentsOf(rec.folder);
      const credentialNames = /(^|\/)(\.credentials\.json|auth\.json|\.claude\.json|\.netrc|credentials|.*\.pem|.*\.key)$/;
      expect(found.files.filter((f) => credentialNames.test(f)), 'credential files in the job\'s folder').toEqual([]);
      expect(found.text.includes(TOKEN), 'the sign-in\'s access token is in the job\'s folder').toBe(false);
      expect(found.text.includes(REFRESH), 'the sign-in\'s refresh token is in the job\'s folder').toBe(false);
      expect(signInFiles.map(digest), `your sign-in files changed: ${signInFiles.join(', ')}`).toEqual(before);
    } finally {
      await w.close();
    }
  }, 120_000);
});

/** A session's work: its worktree on a branch with the diff, its transcript, and its claim and PR body. */
interface Session { repo: ReturnType<typeof makeRepo>; worktree: string; transcript: string; diff: string; markers: { transcript: string; diff: string; claim: string } }
function workingSession(): Session {
  const markers = { transcript: `TRANSCRIPT-MARK-${ulid()}`, diff: `DIFF-MARK-${ulid()}`, claim: `CLAIM-MARK-${ulid()}` };
  const repo = makeRepo();
  // The hub's mirror holds the working branch too; the session works in a worktree of it.
  const worktree = join(dirname(repo.dir), 'work');
  git(repo.dir, 'worktree', 'add', '-q', '-b', 'work', worktree, repo.base);
  writeFileSync(join(worktree, 'feature.txt'), `the change ${markers.diff}\n`);
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'the change');
  writeFileSync(join(worktree, 'PR_BODY.md'), `Done: the widget is blue. ${markers.claim}\n`);
  writeFileSync(join(worktree, 'CLAIM.md'), `I'm done. ${markers.claim}\n`);
  const session = uuid();
  const projects = sub(home(), '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'));
  const transcript = join(projects, `${session}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: session, message: { role: 'user', content: `make the widget blue ${markers.transcript}` } })}\n`);
  const diff = git(worktree, 'diff', `${repo.base}..HEAD`);
  return { repo, worktree, transcript, diff, markers };
}
/** The transcript Claude Code kept for a job's session, if it kept one. */
function jobTranscript(session: string | undefined): string {
  if (!session) return '';
  const projects = join(home(), '.claude', 'projects');
  if (!existsSync(projects)) return '';
  let text = '';
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${session}.jsonl`);
    if (existsSync(file)) text += readFileSync(file, 'utf8');
  }
  return text;
}

async function markersScenario(plant?: Plant): Promise<void> {
  const bin = install(sub(tempDir(), 'bin'));
  const s = workingSession();
  const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, ...(plant ? { plant } : {}) });
  try {
    await room(w);
    const draft = await runJob(w, job('draft', 'Draft the checks for the issue: make the widget blue.', { checkout: { repo: s.worktree, commit: s.repo.base } }));
    const review = await runJob(w, job('review', `Review this diff against the issue: make the widget blue.\n\n${s.diff}`, { checkout: { repo: s.worktree, commit: s.repo.base } }));
    expect(draft.rec.state, JSON.stringify(draft.rec)).toBe('finished');
    expect(review.rec.state, JSON.stringify(review.rec)).toBe('finished');
    const holds = (what: string, text: string, name: keyof Session['markers'], expected: boolean) => {
      const has = text.includes(s.markers[name]);
      if (has !== expected) throw Error(`${what} ${has ? 'holds' : 'lacks'} the ${name}'s marker ${s.markers[name]}`);
    };
    const places = (rec: typeof draft, who: string): [string, string][] => [
      [`the ${who}'s stdin`, stdinOf(rec.stdout)],
      [`the ${who}'s folder`, contentsOf(rec.rec.folder).text],
      [`the ${who}'s own transcript`, jobTranscript(rec.rec.session)],
    ];
    for (const [what, text] of places(draft, 'drafting job')) for (const name of ['transcript', 'diff', 'claim'] as const) holds(what, text, name, false);
    holds('the review\'s stdin', stdinOf(review.stdout), 'diff', true);
    for (const [what, text] of places(review, 'review')) for (const name of ['transcript', 'claim'] as const) holds(what, text, name, false);
  } finally {
    await w.close();
  }
}

describe('AC16 #159.df0e6721 a drafting job sees none of the session\'s work; a review sees only the diff', () => {
  it('AC16 (the runner\'s half) a session\'s transcript, diff and claim and PR body carry distinct markers; a drafting job and a review run through the runner: the drafting job\'s stdin, folder and transcript hold none, the review\'s hold the diff\'s and neither other', async () => {
    await markersScenario();
  }, 180_000);

  it('AC16 (wrong program) a runner that passes the diff to the drafting job, by checking out the session\'s branch instead of the base commit, fails, naming the diff\'s marker', async () => {
    await expect(markersScenario('checkout-of-session-head')).rejects.toThrow(/drafting job's folder holds the diff's marker DIFF-MARK-/);
  }, 180_000);
});

async function reachScenario(plant?: Plant): Promise<void> {
  const bin = install(sub(tempDir(), 'bin'));
  const s = workingSession();
  const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, ...(plant ? { plant } : {}) });
  mkdirSync(w.root, { recursive: true });
  const hubSock = join(w.root, 'hub.sock');
  const hub = await unixListener(hubSock);
  try {
    await room(w);
    const prompt = ['Draft the checks.', `@read ${join(s.worktree, 'feature.txt')}`, `@read ${s.transcript}`, `@read ${hubSock}`].join('\n');
    const { rec, stdout } = await runJob(w, job('draft', prompt, { checkout: { repo: s.worktree, commit: s.repo.base } }));
    expect(rec.state, JSON.stringify(rec)).toBe('finished');
    for (const [path, what] of [[join(s.worktree, 'feature.txt'), 'the working session\'s worktree'], [s.transcript, 'its transcript file'], [hubSock, '~/.deepbuild/hub.sock']] as const) {
      const r = reportsOf(stdout).find((x) => x.cmd === 'read' && x.path === path);
      if (!r) throw Error(`the fake never reported reading ${path}: ${stdout.slice(0, 2000)}`);
      expect(r.ok, `from inside the drafting job, reading ${what} (${path}) worked`).toBe(false);
    }
    expect(hub.connections, 'the hub\'s socket got a connection from the job').toBe(0);
    const log = git(rec.folder, 'log', '--all', '--format=%H').trim().split('\n').sort();
    const extra = log.filter((c) => !s.repo.history.includes(c));
    if (extra.length) {
      const refs = git(rec.folder, 'for-each-ref', '--format=%(refname) %(objectname)').trim().split('\n').filter((l) => extra.some((c) => l.endsWith(c)));
      throw Error(`git log --all in the job's base checkout lists more than the base commit's history: ${refs.join(', ') || extra.join(', ')}`);
    }
    expect(log, 'git log --all in the job\'s base checkout').toEqual([...s.repo.history].sort());
    expect(basename(dirname(rec.folder)), 'the checkout is the job\'s own folder under jobs/').toBe('jobs');
  } finally {
    await w.close();
  }
}

describe('AC19 #159.d02d2b08 from inside a drafting job, the session\'s work and the hub are out of reach', () => {
  it('AC19 from inside a drafting job, reading the working session\'s worktree path, its transcript file and ~/.deepbuild/hub.sock each fail, and git log --all in its base checkout lists only the base commit\'s history', async () => {
    await reachScenario();
  }, 120_000);

  it('AC19 (wrong program) a runner that gives the job a worktree of the hub\'s mirror shows the working branch and fails, naming the ref', async () => {
    await expect(reachScenario('worktree-of-mirror')).rejects.toThrow(/refs\/heads\/work/);
  }, 120_000);
});

describe('#236 AC4 #236.cc0de139 a read-only job\'s undeclared write, through its MCP server, is refused by the sandbox and recorded', () => {
  it('#236 AC4 a read-only job run by the runner whose MCP server writes outside what the job declared is refused by the sandbox, and the refusal is recorded as sandbox.denied naming the job\'s run and the path', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      const server = { command: '/bin/sh', args: ['-c', 'echo written > notes.md'] };
      const { rec } = await runJob(w, job('read', 'Read the notes.', { mcp: { notes: server } }));
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      const target = join(rec.folder, 'notes.md');
      expect(existsSync(target), 'the MCP server\'s write left a file in the read-only job\'s folder').toBe(false);
      const denial = await waitFor(async () => (await w.events('sandbox.denied')).find((e) => dataOf(e).run === rec.job && dataOf(e).target === target), 15_000,
        `a sandbox.denied event naming ${rec.job} and ${target}`);
      expect(String(dataOf(denial).operation), 'the refusal names a write').toMatch(/write/);
    } finally {
      await w.close();
    }
  }, 120_000);
});
