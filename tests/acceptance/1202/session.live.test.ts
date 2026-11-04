// AC3 #1202.cbf2a1cb, live: a live Claude Code 2.1.308 session on a dash machine records every hook event
// `verified: true`.
//
// The issue's Reproduce, as a test: real Claude Code 2.1.308 (the newest version adapters/claude-code.facts.json covers)
// on a machine whose /bin/sh is dash, with DeepBuild's entries as its hooks, against a hub in a throwaway HOME, and each
// event's `verified` read off the record. `deep setup` writes the entries into the throwaway HOME's user settings; the
// agent test harness's `bash-calls` scenario (#21) runs one interactive session in a pseudo-terminal (never `-p`) with
// exactly those entries as its `--hooks`, two Bash calls, then /exit. Claude Code runs under the throwaway HOME too (no
// CLAUDE_CONFIG_DIR), so its transcripts sit where the hub looks for them, and it signs in with
// CLAUDE_CODE_OAUTH_TOKEN, since your own sign-in lives outside that HOME. It spends plan usage, so it runs only by hand:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/1202 session.live.test.ts
// Without the opt-in, the token, dash as /bin/sh, or a `claude` on PATH that is 2.1.308, it fails with BLOCKED in its
// message; nothing skips. A harness run that is BLOCKED fails BLOCKED; one that didn't run to its end, or a session
// whose hooks didn't all reach the record, INCONCLUSIVE.

import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC3, allEvents, childEnv, cleanup, COVERED, dash, eventually, HOOK_KINDS, jsonLines, makeHome, NODE, readSettings, REPO, run, setUp, shown, startHub, type Ev,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const MINUTE = 60_000;
const HARNESS = join(REPO, 'scripts/agent-harness.mjs');

/** The opt-in, the token, a dash machine and Claude Code 2.1.308 on PATH, or a BLOCKED failure naming what's missing. */
function requireLive(): { token: string; claude: string } {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`${AC3} BLOCKED: this test starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Error(`${AC3} BLOCKED: the live session runs under a temporary HOME and signs in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
  dash();
  const sh = realpathSync('/bin/sh');
  if (basename(sh) !== 'dash') throw Error(`${AC3} BLOCKED: /bin/sh here is ${sh}, not dash, so Claude Code's \`/bin/sh -c\` doesn't run its hooks through dash; run this on a Debian or Ubuntu machine`);
  const claude = (process.env.PATH ?? '').split(':').map((dir) => join(dir, 'claude')).find((file) => file !== '/claude' && existsSync(file));
  if (!claude) throw Error(`${AC3} BLOCKED: no claude on PATH`);
  return { token, claude: realpathSync(claude) };
}

describe(`${AC3} A live Claude Code 2.1.308 session on a dash machine records every hook event verified: true`, () => {
  it(`${AC3} (live) a real interactive Claude Code ${COVERED} session, its hooks DeepBuild's entries as deep setup wrote them and run by Claude Code through /bin/sh, which is dash, against a hub in a throwaway HOME, has every hook event in the record verified: true`, async () => {
    const { token, claude } = requireLive();
    const h = await makeHome();
    const version = await run(claude, ['--version'], { env: childEnv(h), timeoutMs: 30_000 });
    const v = /\d+\.\d+\.\d+/.exec(version.stdout)?.[0];
    if (v !== COVERED) throw Error(`${AC3} BLOCKED: ${claude} is Claude Code ${v ?? '(no version)'}, not ${COVERED}, the version this criterion names: ${shown(version)}`);
    // Claude Code's own state in this home: its first-run screens are done (the person has used it before).
    writeFileSync(join(h.home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3 }, null, 2)}\n`);
    const hub = await startHub(h);
    await setUp(h);
    const hooksFile = join(h.tmp, 'hooks.json');
    writeFileSync(hooksFile, `${JSON.stringify({ hooks: readSettings(h).hooks }, null, 2)}\n`);

    const args = ['run', '--scenario', 'bash-calls', '--agent', 'claude', '--workdir', h.work, '--hooks', hooksFile, '--calls', '2', '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', claude, '--timeout-ms', '600000', '--out', join(h.tmp, 'out')];
    const ran = await run(NODE, [HARNESS, ...args], { env: childEnv(h, { CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 900_000 });
    const line = jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l);
    if (!line) throw Error(`${AC3} BLOCKED: the harness printed no run line for the bash-calls scenario: ${shown(ran)}`);
    if (line.verdict === 'BLOCKED') throw Error(`${AC3} BLOCKED: the harness's run was BLOCKED: ${line.reason}`);
    if (line.verdict !== 'PASS') throw Error(`${AC3} INCONCLUSIVE: the session didn't run to its end (${line.verdict}): ${line.reason}; ${JSON.stringify(line).slice(0, 2000)}`);
    const session = String(line.sessionId ?? '');
    if (!session) throw Error(`${AC3} INCONCLUSIVE: the harness's run line names no session: ${JSON.stringify(line).slice(0, 2000)}`);

    const kinds = ['session.start', 'user.ask', 'tool.before', 'tool.after', 'agent.stop', 'session.end'];
    let mine: Ev[] = [];
    await eventually(async () => {
      mine = (await allEvents(hub)).filter((e) => HOOK_KINDS.has(e.kind) && e.session === session);
      return kinds.every((k) => mine.some((e) => e.kind === k));
    }, 30_000);
    const missing = kinds.filter((k) => !mine.some((e) => e.kind === k));
    if (missing.length) throw Error(`${AC3} INCONCLUSIVE: the session's ${missing.join(', ')} never reached the record, so its hooks can't all be read; recorded: ${JSON.stringify(mine.map((e) => e.kind))}`);
    const unverified = mine.filter((e) => e.verified !== true).map((e) => `${e.kind} (${e.id}): verified ${String(e.verified)}`);
    expect(unverified, `${AC3} every hook event of the live session must be recorded verified: true, as session.start is; these weren't`).toEqual([]);
  }, 30 * MINUTE);
});
