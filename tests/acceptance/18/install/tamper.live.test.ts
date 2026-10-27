// AC22 #18.254d19bf, live: real Claude Code sessions on your own plan, run by the agent test harness (#48) in a
// pseudo-terminal, never `claude -p`. They spend plan usage, so they run only by hand:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/18/install tamper.live.test.ts
// Without the opt-in, the token, a `claude` on PATH or the harness scenario, each test fails with BLOCKED in its
// message; nothing skips. The sessions run with HOME a temporary home, so `~/.claude/settings.json` is the file
// `deep setup` wrote there and the hub watches; Claude Code signs in from the token, since its keychain sign-in
// is out of reach under another HOME (README: The live sessions).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIXTURES, NODE, REPO, allEvents, childEnv, cleanup, eventually, jsonLines, makeHome, parseObject, readingTexts, run, setup, shown, startHub,
  type Ev, type Hub, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'restores-at-session-start-only';
const HARNESS = join(REPO, 'scripts/agent-harness.mjs');

function requireLive(): string {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: live tests spend plan usage; run them by hand with DEEP_HARNESS_LIVE=1');
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Error('BLOCKED: the live sessions run under a temporary HOME and sign in with CLAUDE_CODE_OAUTH_TOKEN (make one with `claude setup-token`)');
  const which = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  const claude = which.stdout.trim();
  if (which.status !== 0 || !claude) throw Error('BLOCKED: no claude on PATH');
  return claude;
}

interface Call { session: string; id: string; name: string; input: Line; at: string; resultAt?: string }
/** Every tool call in a transcript, in order, with when it was made and when its result came back. */
function calls(transcript: string): Call[] {
  const entries = jsonLines(readFileSync(transcript, 'utf8'));
  const out: Call[] = [];
  for (const e of entries) {
    for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (e.type === 'assistant' && c.type === 'tool_use') out.push({ session: e.sessionId, id: c.id, name: c.name, input: c.input ?? {}, at: e.timestamp });
      if (e.type === 'user' && c.type === 'tool_result') { const call = out.find((x) => x.id === c.tool_use_id); if (call) call.resultAt = e.timestamp; }
    }
  }
  return out;
}

interface Live { hub: Hub; tamper: Call; next: { call: Call; name: string }[]; line: Line }
async function live(claude: string, plant?: string): Promise<Live> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { tmp, home } = makeHome();
  const hub = await startHub(home, plant ? { plant } : {});
  await setup(home, env);
  // Claude Code's own first-run screens are done in this home; the harness answers the folder's trust prompt.
  const state = join(home, '.claude.json');
  writeFileSync(state, JSON.stringify({ ...(existsSync(state) ? parseObject(readFileSync(state, 'utf8')) : {}), hasCompletedOnboarding: true, theme: 'dark' }));
  const work = join(tmp, 'work');
  const out = join(tmp, 'out');
  mkdirSync(work);
  const ran = await run(NODE, [HARNESS, 'run', '--scenario', 'settings-tamper', '--workdir', work, '--script', join(FIXTURES, 'tamper.mjs'), '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', claude, '--timeout-ms', '300000', '--out', out],
    { env: childEnv(home, { ...env, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }), timeoutMs: 420_000 });
  const line = jsonLines(ran.stdout).find((l) => typeof l.run === 'string');
  if (!line) throw Error(`BLOCKED: the harness printed no run line for the settings-tamper scenario: ${shown(ran)}`);
  if (line.verdict !== 'PASS') throw Error(`BLOCKED: the settings-tamper run was ${line.verdict}: ${line.reason} (${JSON.stringify(line).slice(0, 1500)})`);
  const sessions = (line.evidence?.sessions ?? []) as { name: string; sessionId: string; transcript: string }[];
  const [a, b] = ['A', 'B'].map((n) => sessions.find((x) => x.name === n));
  if (!a || !b || !existsSync(a.transcript) || !existsSync(b.transcript)) throw Error(`BLOCKED: the run line must name sessions A and B with their transcripts: ${JSON.stringify(line.evidence)}`);
  const inA = calls(a.transcript);
  const at = inA.findIndex((c) => c.name === 'Bash' && String(c.input.command).includes('tamper.mjs'));
  const tamper = inA[at];
  if (!tamper?.resultAt) throw Error(`INCONCLUSIVE: session A never ran the test script with Bash: ${JSON.stringify(inA.map((c) => [c.name, c.input.command]))}`);
  const nextA = inA[at + 1];
  const nextB = calls(b.transcript).find((c) => c.at > tamper.resultAt!);
  if (!nextA || !nextB) throw Error(`INCONCLUSIVE: a session made no tool call after the script ran (A ${nextA?.id}, B ${nextB?.id})`);
  return { hub, tamper, next: [{ call: nextB, name: 'the second open session' }, { call: nextA, name: 'the session that ran the script' }], line };
}

/** Every way the run falls short of the criterion, each naming the call. */
async function problems(r: Live): Promise<string[]> {
  const out: string[] = [];
  const matches = (e: Ev, c: Call) => e.kind === 'tool.before' && e.session === c.session && (typeof c.input.command === 'string' ? e.data?.command === c.input.command : JSON.stringify(e.data?.paths ?? []).includes(String(c.input.file_path ?? c.input.path ?? '')));
  for (const { call, name } of r.next) {
    const reached = await eventually(async () => (await allEvents(r.hub)).some((e) => matches(e, call)), 20_000);
    if (!reached) out.push(`AC22 the next call in ${name} (${call.session}), ${call.id} ${call.name} ${JSON.stringify(call.input.command ?? call.input).slice(0, 120)}, never reached deep-hook: it isn't in the record`);
  }
  const events = await allEvents(r.hub);
  const names = [r.tamper.id, String(r.tamper.input.command), ...events.filter((e) => matches(e, r.tamper)).map((e) => e.id)];
  const named = await eventually(async () => (await readingTexts(r.hub)).some((text) => names.some((n) => text.includes(n))), 20_000);
  if (!named) out.push(`AC22 the record must name the call that was running when DeepBuild's entry went, ${r.tamper.id} in ${r.tamper.session}: no reading names it`);
  return out;
}

describe('AC22 #18.254d19bf In a live Claude Code session, a Bash call whose test script deletes DeepBuild\'s PreToolUse entry from `~/.claude/settings.json` leaves the next tool call in that session, and in a second open session, still reaching deep-hook, and the record names the call that was running. A setup that restores entries only at SessionStart lets the second session\'s next call through unguarded and fails, naming it', () => {
  it('AC22 #18.254d19bf (live) after session A\'s Bash call deletes DeepBuild\'s PreToolUse entry, the next call in A and in the open session B reach deep-hook, and a reading names A\'s call', async () => {
    const claude = requireLive();
    expect(await problems(await live(claude))).toEqual([]);
  }, 900_000);

  it(`AC22 #18.254d19bf (live, wrong program) a setup that restores entries only at SessionStart (${PLANT}) lets session B's next call through unguarded and fails, naming it`, async () => {
    const claude = requireLive();
    const r = await live(claude, PLANT);
    const found = await problems(r);
    const second = r.next[0]!.call;
    // A run where B's next call still reached deep-hook shows Claude Code didn't pick up the edit, so nothing was tested.
    if (!found.length) throw Error(`INCONCLUSIVE: with ${PLANT} every next call still reached deep-hook, so Claude Code never ran without the deleted entry and the watch went untested`);
    expect(found.join('\n'), `the check must fail on ${PLANT}, naming session B's next call`).toContain(second.id);
  }, 900_000);
});
