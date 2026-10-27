// AC1 and AC13: a session's tool calls and commits in the record, and no commit DeepBuild touched.
// A made-up session in a real git repo runs through deep-hook into `deep hub run`; its Bash call runs the real
// `git commit` between its PreToolUse and its PostToolUse, as the command the PreToolUse reply leaves it (a reply
// with `updatedInput` changes the command, as Claude Code applies it). The record is read through `events.read`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC13, cleanup, git, gitEnv, kindOf, makeHome, ofSession, forCall, repo, run, Session, sessionsRead, settle, shown, startHub, type Ev, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** The commit events of a session that name `sha`: the record's commit kind is `commit.<…>` with the full SHA in `data.sha`. */
const commitsOf = (events: readonly Ev[], session: string, sha: string) => ofSession(events, session).filter((e) => e.kind.startsWith('commit.') && e.data?.sha === sha);

/** The agent's Bash call runs the command as given, in the session's repo; Claude Code's Bash result is its output. */
async function bash(home: string, cwd: string, input: Line): Promise<Line> {
  const r = await run('/bin/sh', ['-c', String(input.command)], { cwd, env: gitEnv(home) });
  if (r.code !== 0) throw Error(`the agent's command failed: ${input.command}: ${r.stderr}`);
  return { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false };
}

describe(`${AC1} a session shows up in the record with its tool calls and commits`, () => {
  it(`${AC1} a recorded-shape session's Write and Bash calls, and the commit its Bash call made, are in the record under the session`, async () => {
    const home = makeHome();
    const work = repo(home);
    const hub = await startHub(home);
    const s = new Session(home, { cwd: work });
    await s.start();
    await s.prompt('Add a notes file with the word one, and commit it.');
    const write = await s.call('Write', { file_path: join(work, 'notes.md'), content: 'one\n' }, {
      during: (input) => { writeFileSync(String(input.file_path), String(input.content)); return { type: 'create', filePath: input.file_path, content: input.content }; },
    });
    const commit = await s.call('Bash', { command: 'git add notes.md && git commit -q -m "Add notes"', description: 'Commit the notes file' }, { during: (input) => bash(home, work, input) });
    await s.stop('I added notes.md and committed it.');
    await s.end();
    const sha = git(home, work, 'rev-parse', 'HEAD');
    expect(sha, 'the agent\'s commit landed in the repo').toMatch(/^[0-9a-f]{40}$/);

    const events = await settle(hub, (all) => commitsOf(all, s.id, sha).length > 0 && kindOf(all, s.id, 'session.end').length > 0);
    const mine = ofSession(events, s.id);
    const start = kindOf(events, s.id, 'session.start')[0];
    expect(start, `the session's start is recorded: ${mine.map(shown).join('; ')}`).toBeDefined();
    expect(start!.agent, 'recorded as a Claude Code session').toBe('claude-code');
    expect(start!.data.worktree, 'keyed by its worktree').toBe(work);

    for (const [call, kind] of [[write, 'write'], [commit, 'shell']] as const) {
      const before = forCall(mine, 'tool.before', call.id);
      const after = forCall(mine, 'tool.after', call.id);
      expect(before.map((e) => e.data.kind), `${call.tool} call ${call.id}: one tool.before naming the call (data.call) with kind ${kind}; the session's events: ${mine.map(shown).join('; ')}`).toEqual([kind]);
      expect(after.map((e) => e.data.outcome), `${call.tool} call ${call.id}: one tool.after naming the call, outcome ok`).toEqual(['ok']);
    }
    expect(forCall(mine, 'tool.before', write.id)[0]!.data.paths, 'the Write names its file').toEqual([join(work, 'notes.md')]);
    expect(forCall(mine, 'tool.before', commit.id)[0]!.data.command, 'the Bash call names its command').toBe(commit.input.command);

    const commits = commitsOf(events, s.id, sha);
    expect(commits.length, `the commit ${sha} the session made is recorded once under the session (a commit.* event with data.sha); the session's events: ${mine.map(shown).join('; ')}`).toBe(1);
    const row = (await sessionsRead(hub)).find((r) => r.id === s.id);
    expect(row?.worktree, `the session registry holds the session by its ID and worktree: ${JSON.stringify(row)}`).toBe(work);
  }, 180_000);
});

describe(`${AC13} no commit gets a trailer or an attribution line from DeepBuild`, () => {
  it(`${AC13} a commit an agent makes in a watched session is recorded, and its message is the agent's, with no trailer, no attribution line and no git hook or trailer setting of DeepBuild's`, async () => {
    const home = makeHome();
    const work = repo(home);
    const hub = await startHub(home);
    const s = new Session(home, { cwd: work });
    await s.start();
    await s.prompt('Fix the typo in the README and commit it.');
    await s.call('Edit', { file_path: join(work, 'README.md'), old_string: '# shop', new_string: '# Shop', replace_all: false }, {
      during: (input) => { writeFileSync(String(input.file_path), '# Shop\n'); return { filePath: input.file_path, oldString: '# shop', newString: '# Shop' }; },
    });
    const message = 'Fix the README title';
    const commit = await s.call('Bash', { command: `git commit -q -am "${message}"`, description: 'Commit the fix' }, { during: (input) => bash(home, work, input) });
    await s.stop('Committed the fix.');
    await s.end();
    const sha = git(home, work, 'rev-parse', 'HEAD');

    // What Claude Code ran is what the agent wrote: the PreToolUse reply changed nothing in the command.
    expect(commit.input.command, `the PreToolUse reply left the agent's git commit as it was: ${commit.before.ran.stdout}`).toBe(`git commit -q -am "${message}"`);
    const body = git(home, work, 'log', '-1', '--format=%B');
    expect(body, `the commit message is the agent's own, nothing added: ${JSON.stringify(body)}`).toBe(message);
    const trailers = execTrailers(home, work);
    expect(trailers, `no trailer on the commit: ${trailers}`).toBe('');
    expect(body).not.toMatch(/co-authored-by|generated with|deepbuild|deep build|signed-off-by/i);
    // Nothing DeepBuild installed or set would add one to a later commit either.
    const hooks = readdirSync(join(work, '.git/hooks')).filter((name) => !name.endsWith('.sample'));
    expect(hooks, 'no git hook in the repo').toEqual([]);
    const config = [join(work, '.git/config'), join(home, '.gitconfig'), join(home, '.config/git/config')].filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(config, 'no hooks path, commit template or trailer setting in the repo or the home').not.toMatch(/hooksPath|template|\[trailer/i);

    // The test watched a commit DeepBuild saw: it is in the record under the session.
    const events = await settle(hub, (all) => commitsOf(all, s.id, sha).length > 0 && kindOf(all, s.id, 'session.end').length > 0);
    expect(commitsOf(events, s.id, sha).length, `the commit ${sha} is recorded under the session from its hooks; the session's events: ${ofSession(events, s.id).map(shown).join('; ')}`).toBe(1);
  }, 180_000);
});

function execTrailers(home: string, work: string): string {
  return git(home, work, 'log', '-1', '--format=%(trailers)');
}
