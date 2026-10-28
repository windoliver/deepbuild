// The watch-only scenario every way in must pass (README: Criterion): straight after setup, in a repo whose drafted
// checks nobody approved, an agent's session claims its task done and runs the drafted check, which fails. Its Stop is
// not held (the hub's acknowledgement has `hold_until_ms: null`, read off a forwarded socket at the address setting)
// and no verdict blocks it (DeepBuild's foreground Stop entry answers at once, exit 0, with no `decision`); its next
// Edit and `ls` go through. Meanwhile the fast safety rules apply from the start: its `pkill -f vite` is denied, saying
// why, by the hub and, with the hub stopped by PID, by deep-hook alone. The probed stop has no open ask (README:
// Disputes). Adapted from tests/acceptance/19/setup/watchonly.test.ts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  Claude, alive, answers, callId, deepEntries, denied, firedShown, forwarder, hubJobs, installedHub, jsonLines, ours, payload,
  readSettings, setAddress, settingsFile, sleep, socketOf, toolCall, typedPrompt, waitFor, newSession, type Fired, type Forwarder, type Line, type Session,
} from './helpers.ts';

interface World { home: string; repo: string; commit: string; fwd: Forwarder; claude: Claude; s: Session; who: string }

/** The tool call's text, from its MCP reply. */
const replyText = (reply: Line) => JSON.stringify(reply.result ?? reply.error ?? reply);

/** The hooks are in place: DeepBuild's Stop and PreToolUse entries in ~/.claude/settings.json. */
export function hooksInPlace(home: string, who: string): void {
  if (!existsSync(settingsFile(home))) expect.fail(`#326 after ${who} the hooks must be in place: there is no ${settingsFile(home)}`);
  const events = new Set(deepEntries(readSettings(home)).map((e) => e.event));
  for (const event of ['Stop', 'PreToolUse']) {
    if (!events.has(event)) expect.fail(`#326 after ${who} the hooks must be in place: no ${event} entry of DeepBuild's in ${settingsFile(home)} (it has ${JSON.stringify([...events])})`);
  }
}

/** The session claims its task done and runs the drafted check, which fails: a verdict an enforcing gate would act on. */
async function claimAndFail(w: World): Promise<void> {
  const { claude, s } = w;
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Make the header green, then claim it done.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Make the header green, then claim it done.' }));
  await claude.initialize();
  const claim = await claude.deepTool(s, 'deep_claim', { task_ref: 'task:header1', attempt: 1, commit: w.commit, scope: 'session', predictions: [{ check: 'unit', expects: 'passed' }] });
  if (!/claim:/.test(replyText(claim)) || claim.result?.isError) throw Error(`BLOCKED: deep_claim wasn't recorded, so there is no verdict to probe: ${replyText(claim)}`);
  const ran = await claude.deepTool(s, 'deep_run', { check: 'unit', claim: null }, 180_000);
  if (!/fail/i.test(replyText(ran)) || ran.result?.isError) throw Error(`BLOCKED: the drafted check's run didn't come back failed, so there is no failed verdict to probe: ${replyText(ran)}`);
}

/** The hub's acknowledgement of the n-th Stop of `session` deep-hook sent through the forwarder, once it is there. */
function stopAck(fwd: Forwarder, session: string, nth: number): Line | undefined {
  const request = jsonLines(fwd.upText()).filter((l) => l.event === 'Stop' && l.payload?.session_id === session)[nth - 1];
  return request ? jsonLines(fwd.downText()).find((l) => l.ack === request.id) : undefined;
}

/** The session stops: not held, and no verdict in DeepBuild's reply. Fails naming the stop otherwise. */
async function stopGoesThrough(w: World): Promise<void> {
  const { claude, s } = w;
  const stopping = claude.hook('Stop', payload(s, 'Stop'));
  const ack = await waitFor(() => stopAck(w.fwd, s.id, 1), 30_000, `the hub's acknowledgement of session ${s.id}'s Stop`);
  if (ack.hold_until_ms !== null) {
    expect.fail(`#326 after ${w.who} the hub held the Stop of session ${s.id} (hold_until_ms ${ack.hold_until_ms}) in a repo whose checks nobody approved: the hooks must be watch-only, so no stop is held until a repo's checks are approved`);
  }
  const fired = await stopping;
  const foreground = ours(fired).filter((r) => !r.async);
  if (!foreground.length) expect.fail(`#326 after ${w.who} a foreground Stop entry of DeepBuild's must be in ~/.claude/settings.json: ${firedShown(fired)}`);
  for (const r of foreground) {
    if (/"decision"\s*:/.test(r.stdout) || r.code === 2) {
      expect.fail(`#326 after ${w.who} a verdict blocked the Stop of session ${s.id}, in a repo whose checks nobody approved: DeepBuild's Stop entry answered exit ${r.code}, ${JSON.stringify(r.stdout.slice(0, 400))} ${JSON.stringify(r.stderr.slice(0, 400))}`);
    }
    expect({ code: r.code, timedOut: r.timedOut }, `#326 after ${w.who} DeepBuild's Stop entry must answer at once, exit 0: ${firedShown(fired)}`).toEqual({ code: 0, timedOut: false });
  }
}

/** One Bash call of the session, as Claude Code fires its PreToolUse. */
async function bash(w: World, command: string): Promise<Fired> {
  const id = callId();
  toolCall(w.s, id, 'Bash', { command, description: command });
  return w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: command }, tool_use_id: id }));
}
const denialText = (f: Fired) => ours(f).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');

/**
 * The scenario, in a home where `who` just set DeepBuild up and the hub answers, in `repo` (drafted, unapproved).
 * Fails through expect, naming `who` and what went wrong.
 */
export async function watchOnlyFromTheStart(home: string, repo: string, commit: string, who: string): Promise<void> {
  hooksInPlace(home, who);
  await installedHub(home, `#326 ${who}`);
  const fwd = await forwarder(join(home, '..'), socketOf(home));
  setAddress(home, fwd.path);
  const w: World = { home, repo, commit, fwd, claude: Claude.start(home), s: newSession(home, repo), who };

  await claimAndFail(w);
  await stopGoesThrough(w);

  // The next turn: the failed verdict blocks nothing.
  typedPrompt(w.s, 'Now tidy up.');
  await w.claude.hook('UserPromptSubmit', payload(w.s, 'UserPromptSubmit', { prompt: 'Now tidy up.' }));
  const editId = callId();
  const edit = { file_path: join(repo, 'app.js'), old_string: '"blue"', new_string: '"green"', replace_all: false };
  toolCall(w.s, editId, 'Edit', edit);
  const edited = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Edit', tool_input: edit, tool_use_id: editId }));
  if (denied(edited)) expect.fail(`#326 after ${who} no verdict may block until a repo's checks are approved: the session's next Edit was denied: ${firedShown(edited)}`);
  const listed = await bash(w, 'ls');
  if (denied(listed)) expect.fail(`#326 after ${who} no verdict may block until a repo's checks are approved: the session's ls was denied: ${firedShown(listed)}`);

  // The fast safety rules apply from the start: with the hub up...
  const killed = await bash(w, 'pkill -f vite');
  if (!denied(killed)) expect.fail(`#326 after ${who} the fast safety rules must apply from the start: with the hub up DeepBuild let the agent's pkill -f vite through: ${firedShown(killed)}`);
  if (!/name or port/i.test(denialText(killed))) expect.fail(`#326 after ${who} the denial of pkill -f vite must say why (no killing by name or port): ${firedShown(killed)}`);

  // ...and with it down, from the rules deep-hook reads on its own.
  const pid = hubJobs(home)[0]?.pid;
  if (!pid) throw Error(`BLOCKED: no running hub job to stop: ${JSON.stringify(hubJobs(home))}`);
  process.kill(pid, 'SIGTERM');
  await waitFor(async () => !alive(pid) && !(await answers(socketOf(home), 500)), 20_000, `the hub (pid ${pid}) to stop`);
  await sleep(200);
  const downKill = await bash(w, 'pkill -f vite');
  if (!denied(downKill)) expect.fail(`#326 after ${who} the fast safety rules must apply from the start: with the hub down deep-hook let the agent's pkill -f vite through: ${firedShown(downKill)}`);
  if (!/name or port/i.test(denialText(downKill))) expect.fail(`#326 after ${who} the denial of pkill -f vite with the hub down must say why (no killing by name or port): ${firedShown(downKill)}`);
  await fwd.close();
}
