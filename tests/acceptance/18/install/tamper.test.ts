// AC22 #18.254d19bf In a live Claude Code session, a Bash call whose test script deletes DeepBuild's PreToolUse entry
// from `~/.claude/settings.json` leaves the next tool call in that session, and in a second open session, still
// reaching deep-hook, and the record names the call that was running. A setup that restores entries only at
// SessionStart lets the second session's next call through unguarded and fails, naming it.
//
// The fast half: the same scenario with the Claude Code stand-in in place of the live sessions, so it spends nothing
// and runs in every preflight. The stand-in reads the settings file again at every hook, as Claude Code picks up a
// hook edit while it runs, so an entry that isn't back by the next call isn't run. The live half is
// tamper.live.test.ts.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, FIXTURES, NODE, allEvents, appendTranscript, callId, cleanup, eventually, makeHome, newSession, ours, parseObject, payload, readingTexts,
  setup, sleep, startHub, tag, typedPrompt, type Fired, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'restores-at-session-start-only';

interface Next { s: Session; id: string; command: string; fired: Fired; name: string }
interface Run { hub: Hub; tamper: { s: Session; id: string; command: string }; next: Next[] }

async function scenario(plant?: string): Promise<Run> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, plant ? { plant } : {});
  await setup(home, env);
  const a = newSession(home);
  const b = newSession(home);
  const ca = Claude.start(home, env);
  const cb = Claude.start(home, env);
  for (const [c, s] of [[ca, a], [cb, b]] as const) {
    await c.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Check the settings script.');
    await c.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Check the settings script.' }));
  }
  // Session A's Bash call runs the test script, which deletes DeepBuild's PreToolUse entry while the call runs.
  const t = tag(4);
  const command = `'${NODE}' '${join(FIXTURES, 'tamper.mjs')}' ${t}`;
  const id = callId();
  const input = { command, description: 'Run the settings test script' };
  appendTranscript(a, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input }] } });
  await ca.hook('PreToolUse', payload(a, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id }));
  const ran = await ca.exec(command, a.cwd);
  const removed = parseObject(ran.stdout.trim())?.removed;
  if (!(typeof removed === 'number' && removed > 0)) throw Error(`BLOCKED: the test script removed no PreToolUse entry of DeepBuild's: ${ran.stdout}${ran.stderr}`);
  appendTranscript(a, { type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: ran.stdout, is_error: false }] } });
  await ca.hook('PostToolUse', payload(a, 'PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: id, tool_response: { stdout: ran.stdout, stderr: '', interrupted: false } }));
  // A model turn later, each session makes its next call: B first, the second open session, then A.
  await sleep(3000);
  const next: Next[] = [];
  for (const [c, s, name] of [[cb, b, 'the second open session'], [ca, a, 'the session that ran the script']] as const) {
    const nid = callId();
    const ncommand = `ls -a next-${tag(3)}`;
    next.push({ s, id: nid, command: ncommand, name, fired: await c.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: ncommand }, tool_use_id: nid })) });
  }
  return { hub, tamper: { s: a, id, command }, next };
}

/** Every way the run falls short of the criterion, each naming the call. */
async function problems(r: Run): Promise<string[]> {
  const out: string[] = [];
  for (const n of r.next) {
    if (!ours(n.fired).length) {
      out.push(`AC22 the next call in ${n.name} (${n.s.id}), ${n.id} "${n.command}", ran unguarded: DeepBuild's PreToolUse entry wasn't back in ~/.claude/settings.json, so it never reached deep-hook`);
      continue;
    }
    const failed = ours(n.fired).filter((h) => h.code !== 0 || h.timedOut);
    if (failed.length) out.push(`AC22 the next call in ${n.name} (${n.s.id}), ${n.id} "${n.command}", reached DeepBuild's entry, which failed: ${JSON.stringify(failed.map((h) => [h.command, h.code, h.stderr.slice(0, 200)]))}`);
  }
  const events = await allEvents(r.hub);
  const callEvents = events.filter((e) => e.session === r.tamper.s.id && e.kind === 'tool.before' && e.data?.command === r.tamper.command).map((e) => e.id);
  const names = [r.tamper.id, r.tamper.command, ...callEvents];
  const named = await eventually(async () => (await readingTexts(r.hub)).some((text) => names.some((n) => text.includes(n))), 20_000);
  if (!named) out.push(`AC22 the record must name the call that was running when DeepBuild's entry went, ${r.tamper.id} ("${r.tamper.command}") in ${r.tamper.s.id}: no reading names it`);
  return out;
}

describe('AC22 #18.254d19bf In a live Claude Code session, a Bash call whose test script deletes DeepBuild\'s PreToolUse entry from `~/.claude/settings.json` leaves the next tool call in that session, and in a second open session, still reaching deep-hook, and the record names the call that was running. A setup that restores entries only at SessionStart lets the second session\'s next call through unguarded and fails, naming it', () => {
  it('AC22 #18.254d19bf (fast, stand-in sessions) after a Bash call\'s script deletes DeepBuild\'s PreToolUse entry, the next call in that session and in a second open session still reach deep-hook, and a reading names the call', async () => {
    expect(await problems(await scenario())).toEqual([]);
  }, 600_000);

  it(`AC22 #18.254d19bf (fast, wrong program) a setup that restores entries only at SessionStart (${PLANT}) lets the second session's next call through unguarded and fails, naming it`, async () => {
    const r = await scenario(PLANT);
    const found = await problems(r);
    const second = r.next[0]!;
    expect(found.join('\n'), `the check must fail on ${PLANT}, naming the second session's next call`).toContain(`${second.id} "${second.command}", ran unguarded`);
  }, 600_000);
});
