// AC5 #120.4494c783: in a Claude Code or Codex session that can ask you about commands, a `tail -f` call is asked about
// exactly as it would be without DeepBuild, with no deadline attached and its overrun recorded; in a session that
// bypasses approvals, the same call gets its deadline, and a Claude Code rewrite carries no permission decision.
//
// "Can ask you about commands" is the agent's default permission mode; "bypasses approvals" is bypassPermissions
// (README: Permission modes). "Asked about exactly as without DeepBuild" is read at the agent's side: the PreToolUse
// reply carries no permission decision and no updatedInput, and Claude Code's PermissionRequest for the call gets no
// decision either. The overrun is read from the record after the call has run 30 minutes (README: Time, Overrun).
// Where Codex can change a command is its adapter's flags (adapter.caps@1 through `shipped()`), not its name.
import { shipped } from '@deepbuild/adapters';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC5, allEvents, awaitEvent, bash, begin, cleanup, codexBegin, codexHook, codexShown, decisionsIn, firedShown, hubWithSetup, makeHome, MINUTE, moveOn, newSession, ran, replyOf, TAIL,
  updatedInputOf, type Ev, type Hub, type Mode, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** The record's overrun for a call (README: Overrun): an event about the session whose JSON says overrun and names the call or its command. */
const overrunOf = (events: Ev[], s: Session, call: string): Ev[] =>
  events.filter((e) => e.session === s.id && /overrun/i.test(`${e.kind} ${JSON.stringify(e.data)}`) && (JSON.stringify(e.data).includes(call) || JSON.stringify(e.data).includes('tail -f')));
const codexCaps = () => shipped().get('codex').caps;

async function claudeTail(mode: Mode): Promise<{ hub: Hub; s: Session; pre: Ev[]; reply: Record<string, unknown> | undefined; fired: ReturnType<typeof firedShown>; permission: Record<string, unknown> | undefined; overrun: Ev[] }> {
  const h = makeHome();
  let hub = await hubWithSetup(h);
  const s = newSession(h, { mode });
  const { claude } = await begin(h, s, 'Watch the app log for the error, then stop.');
  const { call, fired } = await claude.open(s, 'Bash', bash(TAIL));
  const reply = replyOf(fired);
  // In a session that asks, Claude Code's own prompt follows: its PermissionRequest hook.
  const asked = mode === 'default' ? await claude.hook('PermissionRequest', { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, permission_mode: mode, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: bash(TAIL), tool_use_id: call, permission_suggestions: [] }) : undefined;
  await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === call, 'the call\'s tool.before');
  const pre = await allEvents(hub);
  hub = await moveOn(hub, 30 * MINUTE);
  await claude.close(s, call, 'Bash', bash(TAIL), { stdout: '', stderr: 'Terminated', interrupted: true, isImage: false });
  await claude.tool(s, 'Bash', bash('ls'), ran());
  await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === call, 'the call\'s tool.after');
  const overrun = overrunOf(await allEvents(hub), s, call);
  await claude.end();
  return { hub, s, pre, reply, fired: firedShown(fired), permission: asked ? replyOf(asked) : undefined, overrun };
}

describe(`${AC5} In a Claude Code or Codex session that can ask you about commands, a \`tail -f\` call is asked about exactly as it would be without DeepBuild, with no deadline attached and its overrun recorded; in a session that bypasses approvals, the same call gets its deadline, and a Claude Code rewrite carries no permission decision`, () => {
  it(`${AC5} Claude Code, default mode: the PreToolUse and PermissionRequest replies decide nothing and change nothing; 30 minutes on, the call's overrun is in the record`, async () => {
    const { reply, fired, permission, overrun } = await claudeTail('default');
    expect(decisionsIn(reply), `${AC5} the PreToolUse reply carries no permission decision: ${fired}`).toEqual([]);
    expect(updatedInputOf(reply), `${AC5} no deadline is attached in a session that can ask you: ${fired}`).toBeUndefined();
    expect(decisionsIn(permission), `${AC5} the PermissionRequest for the call gets no decision, so Claude Code asks you as it would without DeepBuild: ${JSON.stringify(permission)}`).toEqual([]);
    expect(overrun.length, `${AC5} the overrun of \`${TAIL}\` is recorded (an event naming the call or its command and saying overrun)`).toBeGreaterThan(0);
  }, 90_000);

  it(`${AC5} Claude Code, approvals bypassed: the same call is rewritten with its deadline (updatedInput) and the rewrite carries no permission decision`, async () => {
    const { reply, fired } = await claudeTail('bypassPermissions');
    const updated = updatedInputOf(reply);
    expect(updated, `${AC5} the deadline is attached as updatedInput: ${fired}`).toBeDefined();
    expect(String(updated!.command), `${AC5} the rewritten command still runs \`${TAIL}\` and differs from it: ${JSON.stringify(updated)}`).toContain(TAIL);
    expect(String(updated!.command)).not.toBe(TAIL);
    expect(decisionsIn(reply), `${AC5} a Claude Code rewrite carries no permission decision (\`allow\` there would approve the call): ${JSON.stringify(reply)}`).toEqual([]);
  }, 90_000);

  it(`${AC5} Codex, default mode: the PreToolUse reply decides nothing and attaches nothing; 30 minutes on, the overrun is recorded. Bypassed: a deadline only where its flags say it can change a command (rewrite), never by its name`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h, { agent: 'codex', mode: 'default' });
    await codexBegin(h, s, 'Watch the app log for the error, then stop.');
    const call = `call_${Date.now()}`;
    const pre = await codexHook(h, s, 'PreToolUse', { tool_name: 'Bash', tool_input: bash(TAIL), tool_use_id: call });
    expect(pre.ran.code, `${AC5} Codex's PreToolUse for \`${TAIL}\` is let through to Codex's own prompt: ${codexShown(pre)}`).toBe(0);
    expect(decisionsIn(pre.reply), `${AC5} Codex's reply carries no decision: ${codexShown(pre)}`).toEqual([]);
    expect(updatedInputOf(pre.reply), `${AC5} no deadline is attached in a Codex session that can ask you: ${codexShown(pre)}`).toBeUndefined();
    await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === call, 'the call\'s tool.before');
    hub = await moveOn(hub, 30 * MINUTE);
    await codexHook(h, s, 'PostToolUse', { tool_name: 'Bash', tool_input: bash(TAIL), tool_use_id: call, tool_response: { stdout: '', stderr: 'Terminated', exit_code: 143 } });
    await awaitEvent(hub, s, (e) => e.kind === 'tool.after' && e.data.call === call, 'the call\'s tool.after');
    const overrun = overrunOf(await allEvents(hub), s, call);
    expect(overrun.length, `${AC5} the Codex call's overrun is recorded`).toBeGreaterThan(0);

    // Bypassed: the route comes from the adapter's flags.
    const b = newSession(h, { agent: 'codex', mode: 'bypassPermissions' });
    await codexBegin(h, b, 'Watch the app log for the error, then stop.');
    const bypassed = await codexHook(h, b, 'PreToolUse', { tool_name: 'Bash', tool_input: bash(TAIL), tool_use_id: `call_${Date.now()}` });
    const caps = codexCaps();
    const updated = updatedInputOf(bypassed.reply);
    if (caps.rewrite) {
      expect(updated, `${AC5} Codex's flags say it can rewrite, so the bypassed call gets its deadline: ${codexShown(bypassed)}`).toBeDefined();
      expect(String(updated!.command)).toContain(TAIL);
    } else {
      expect(updated, `${AC5} Codex's flags say it cannot rewrite (adapter.caps@1 rewrite: false), so no deadline is attached by its name: ${codexShown(bypassed)}`).toBeUndefined();
    }
  }, 120_000);
});
