// AC1, live: a real Claude Code session shows up in the record with its tool calls and commits. It spends plan
// usage, so it runs only by hand, on your own sign-in:
//   DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/18/mapping record.live.test.ts
// Without the opt-in it fails with BLOCKED in its message; nothing skips. The session is the agent test harness's
// (#48) `add-readme-line` scenario, interactive in a pseudo-terminal, never `claude -p`: in a fresh git repo, "Read
// the README and add one line to it." with Read and Edit. The settings the harness gives the session (`--hooks`) run
// `deep-hook claude-code <Event>` for each of the nine hooks with HOME the test's home, where `deep hub run` listens,
// and keep one hook of yours beside them: after the Edit, it commits the change (`git commit -qam`), so the session
// makes a commit while it runs. Claude Code keeps the real HOME, since its sign-in is in your keychain (as #666's live
// tests found), so the transcript lies outside the test's home and the test doesn't ask for verified events.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, cleanEnv, cleanup, deepHook, forCall, git, kindOf, makeHome, NODE, ofSession, own, parseObject, REPO, repo, settle, shown, startHub, tempDir, type Ev, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const NINE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

function requireLive(): void {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: this test starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1');
}

/** The harness's run line, or a failure naming why there is none. */
function harness(args: string[], home: string): Promise<{ run: Line | undefined; text: string }> {
  return new Promise((resolve) => {
    // The harness keeps your HOME for Claude Code's sign-in; only DeepBuild's side lives in the test's home.
    const env = { ...cleanEnv(process.env.HOME ?? home), HOME: process.env.HOME ?? home };
    const child = spawn(NODE, [join(REPO, 'scripts/agent-harness.mjs'), ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.on('close', () => resolve({ run: out.split('\n').map(parseObject).find((l) => typeof l?.run === 'string'), text: out.slice(-3000) }));
  });
}

describe(`${AC1} a real session shows up in the record with its tool calls and commits`, () => {
  it(`${AC1} a live Claude Code session's Read and Edit calls and the commit made during it are in the record under the session, as Claude Code's`, async () => {
    requireLive();
    const home = makeHome();
    const work = repo(home);
    const hub = await startHub(home);
    const hook = await deepHook();
    const commit = `cd ${quote(work)} && git -c user.name=You -c user.email=you@example.invalid -c commit.gpgsign=false commit -qam 'Add a README line'`;
    const hooks: Line = Object.fromEntries(NINE.map((event) => [event, [{ hooks: [{ type: 'command', command: `HOME=${quote(home)} ${quote(hook)} claude-code ${event}` }] }]]));
    hooks.PostToolUse.push({ matcher: 'Edit', hooks: [{ type: 'command', command: commit }] });
    const settings = join(tempDir(), 'settings.json');
    writeFileSync(settings, JSON.stringify({ hooks }, null, 2));
    const before = git(home, work, 'rev-parse', 'HEAD');

    const { run, text } = await harness(['run', '--scenario', 'add-readme-line', '--workdir', work, '--hooks', settings, '--out', join(tempDir(), 'out'), '--timeout-ms', '240000'], home);
    if (!run) throw Error(`BLOCKED: the harness printed no run line: ${text}`);
    if (run.verdict === 'BLOCKED') throw Error(`BLOCKED: the harness run was BLOCKED: ${run.reason}`);
    expect(run.verdict, `the harness ran the session to its end: ${JSON.stringify(run)}`).toBe('PASS');
    const session = String(run.sessionId);
    const sha = git(home, work, 'rev-parse', 'HEAD');
    expect(sha, 'the session made a commit while it ran').not.toBe(before);

    const events = await settle(hub, (all) => kindOf(all, session, 'session.end').length > 0 && ofSession(all, session).some((e) => e.kind.startsWith('commit.') && e.data.sha === sha), { timeoutMs: 60_000 });
    const mine = ofSession(events, session);
    const story = () => mine.map(shown).join('; ');
    expect(kindOf(events, session, 'session.start')[0]?.agent, `the session is recorded as Claude Code's: ${story()}`).toBe('claude-code');
    const transcript = readFileSync(String(run.transcript), 'utf8').split('\n').map(parseObject).filter((l): l is Line => l !== undefined);
    const uses = transcript.flatMap((entry) => (Array.isArray(entry.message?.content) ? entry.message.content : [])).filter((block: Line) => block.type === 'tool_use') as Line[];
    expect(uses.map((u) => u.name), 'the agent read and edited the README').toEqual(expect.arrayContaining(['Read', 'Edit']));
    for (const use of uses) {
      const before = forCall(mine, 'tool.before', String(use.id));
      const after = forCall(mine, 'tool.after', String(use.id));
      expect(before.length, `the ${use.name} call ${use.id} the transcript shows has its tool.before in the record: ${story()}`).toBe(1);
      expect(after.length, `the ${use.name} call ${use.id} has its tool.after in the record: ${story()}`).toBe(1);
      if (use.name === 'Read' || use.name === 'Edit') expect(before[0]!.data.paths, `the ${use.name} names the README: ${shown(before[0])}`).toEqual([join(work, 'README.md')]);
    }
    const commits = mine.filter((e: Ev) => e.kind.startsWith('commit.') && e.data.sha === sha);
    expect(commits.length, `the commit ${sha} made during the session is recorded under it: ${story()}`).toBe(1);
  }, 600_000);
});
