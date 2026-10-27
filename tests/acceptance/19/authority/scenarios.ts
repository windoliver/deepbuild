// The scenarios of this folder's criteria, shared with plants.test.ts: each runs against the real hub and CLI, or
// against the planted wrong program `plant` names (DEEP_HUB_PLANT on the hubs, setup, the stand-in and so on every
// `deep` it runs), and a wrong program fails it naming the command, the ask or the call (README: Wrong programs).

import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  CLI, Claude, NODE, STOPS_SERVICE, YOUR_GATE_COMMAND, ackOf, allEvents, alive, answers, callId, childEnv, confirmWith, deep, denied, doubleForked,
  expectCountedOnce, expectOpen, gateBy, gateProbe, makeHome, makeWorktree, newSession, payload, run, seedAuthorityAsk, serviceCalls, setup,
  setupSnapshot, shown, sleep, startHub, stopProbe, waitFor, world, type Forked, type Hub, type Line, type Probe, type World,
} from './helpers.ts';

/** How long a cancelled command gets to take effect anyway before the next hook reply is read: the criterion's second, and some. */
const SETTLE_MS = 1500;
const said = (r: { stdout: string; stderr: string }) => `${r.stdout}${r.stderr}`;
/** A command the OS didn't confirm: exit 3 ("not decided" in the exit table), saying the OS didn't confirm you. */
function expectRefusedForConfirmation(command: string, r: Forked): void {
  expect(r.code, `AC21 \`${command}\`, double-forked, with the OS confirmation cancelled, exits 3 (not decided): ${shown(r)}`).toBe(3);
  expect(said(r), `AC21 \`${command}\`, double-forked, with the OS confirmation cancelled, says why: that the OS didn't confirm you: ${shown(r)}`).toMatch(/confirm/i);
}
async function expectGated(w: World, why: string): Promise<Probe> {
  const probe = await gateProbe(w);
  if (probe.reading !== 'gated') throw Error(why.replace('{probe}', probe.text));
  return probe;
}

/** AC1 #19.a897085d: `deep off`, run by you and confirmed, makes the next hook reply watch-only within a second. */
export async function offWithinASecond(): Promise<void> {
  const w = await world({ ask: true });
  // Before: your gate denies the call and the hub holds the stop of a session with an open ask.
  await expectGated(w, 'BLOCKED: before deep off your gate must deny `make release` through the hub, or this test reads nothing: {probe}');
  const held = await stopProbe(w);
  if (held.reading !== 'gated') throw Error(`BLOCKED: before deep off the hub must hold the stop of a session with an open ask (#18), or this test reads nothing: ${held.text}`);

  confirmWith(w.h, 'confirmed');
  const off = await deep(w.h.home, ['off'], { cwd: w.worktree });
  const ended = Date.now();
  expect(off.code, `AC1 deep off, run by you with the OS confirming you, exits 0: ${shown(off)}`).toBe(0);
  const gate = await gateBy(w, 'watch-only', ended + 1000);
  expect(gate.reading, `AC1 within a second of deep off, the next hook reply is watch-only: your gate's block on \`${YOUR_GATE_COMMAND}\` is let through, acknowledged by the hub with no deny: ${gate.text}`).toBe('watch-only');
  expect(gate.started - ended, `AC1 the first watch-only reply came from a hook started ${gate.started - ended} ms after deep off exited, past the second`).toBeLessThanOrEqual(1000);
  const stop = await stopProbe(w);
  expect(stop.ack.hold_until_ms, `AC1 after deep off, the hub holds no stop: the Stop of the session with an open ask is acknowledged with hold_until_ms null: ${stop.text}`).toBeNull();
}

/**
 * AC2 #19.2c46147f: `deep inbox answer`, run inside an agent's process tree (the stand-in's Bash tool), is refused and
 * says why, with the OS confirming you throughout, so only the peer check can refuse it; you then answer it, once.
 */
export async function agentAnswerRefused(plant?: string): Promise<void> {
  let handle = '';
  const w = await world({ plant, seed: async (h, s) => { handle = await seedAuthorityAsk(h.home, s, 'feature/login'); } });
  confirmWith(w.h, 'confirmed');
  const command = `'${NODE}' '${CLI}' inbox answer '${handle}' decline`;
  const typed = await w.claude.exec(command, w.worktree);
  await expectOpen(w.hub, handle, `answered decline by deep inbox answer, run inside agent session ${w.s.id}'s process tree, with the OS confirming you`);
  expect(typed.code, `AC2 deep inbox answer ${handle}, run inside the agent's process tree, is refused, exit 3 (not decided): ${shown(typed)}`).toBe(3);
  expect(said(typed), `AC2 the refusal says why: the command runs inside agent session ${w.s.id}'s process tree: ${shown(typed)}`).toContain(w.s.id);
  expect(said(typed), `AC2 the refusal says why, naming the agent: ${shown(typed)}`).toMatch(/agent/i);
  expect(said(typed), `AC2 the refusal names the ask that stays open: ${shown(typed)}`).toContain(handle);
  // The same answer, typed by you, counts: what refused it was the peer check.
  const yours = await deep(w.h.home, ['inbox', 'answer', handle, 'decline'], { env: plant ? { DEEP_HUB_PLANT: plant } : {} });
  expect(yours.code, `AC2 the same answer typed by you, the OS confirming you, exits 0: ${shown(yours)}`).toBe(0);
  await expectCountedOnce(w.hub, handle, 'decline', 'typed by you');
}

/**
 * AC19 #19.1a7ba6d9: an authority answer typed into `deep` by a process the agent double-forked (launchd adopted it, the
 * peer check finds no agent above it) never counts with the OS confirmation cancelled, and counts once confirmed.
 */
export async function doubleForkedAnswer(plant?: string): Promise<void> {
  let handle = '';
  const w = await world({ plant, seed: async (h, s) => { handle = await seedAuthorityAsk(h.home, s, 'feature/signup'); } });
  const forked = await doubleForked(w.claude, ['inbox', 'answer', handle, 'decline'], w.worktree, w.h.tmp);
  await expectOpen(w.hub, handle, `answered decline by deep inbox answer, typed by a process agent session ${w.s.id} double-forked (launchd adopted it: ${forked.chain}), the OS confirmation cancelled`);
  expect(forked.code, `AC19 deep inbox answer ${handle}, double-forked, the OS confirmation cancelled, exits 3 (not decided): ${shown(forked)}`).toBe(3);
  expect(said(forked), `AC19 deep inbox answer says which ask stays open: ${shown(forked)}`).toContain(handle);

  confirmWith(w.h, 'confirmed');
  const confirmed = await doubleForked(w.claude, ['inbox', 'answer', handle, 'decline'], w.worktree, w.h.tmp);
  expect(confirmed.code, `AC19 deep inbox answer ${handle}, double-forked, once the OS confirms you, exits 0: ${shown(confirmed)}`).toBe(0);
  await expectCountedOnce(w.hub, handle, 'decline', 'typed by a double-forked process, the OS confirming you');
}

/**
 * AC21 #19.0694d419: `deep off`, `deep hub stop`, `deep setup --undo` and (after a confirmed `deep off`) `deep on`, each
 * run by a process the agent double-forked, change nothing with the OS confirmation cancelled, each saying why; a
 * confirmed, double-forked `deep off` makes the next hook reply watch-only within a second.
 */
export async function authorityCommandsWaitForYou(plant?: string): Promise<void> {
  const w = await world({ plant });
  await expectGated(w, 'BLOCKED: before any command your gate must deny `make release` through the hub, or this test reads nothing: {probe}');
  const why = (command: string, what: string, detail: string) =>
    `AC21 \`${command}\`, run by a process agent session ${w.s.id} double-forked so launchd adopted it, ${what} with the OS confirmation cancelled: a deep that acts because the peer check found no agent fails this test. ${detail}`;

  // deep off, cancelled: the next hook reply is still gated.
  const off = await doubleForked(w.claude, ['off'], w.worktree, w.h.tmp);
  await sleep(SETTLE_MS);
  await expectGated(w, why('deep off', 'turned the next hook reply watch-only', 'The next PreToolUse: {probe}'));
  expectRefusedForConfirmation('deep off', off);

  // deep hub stop, cancelled: the hub still runs, and nothing asked the login service to stop it.
  const callsBefore = serviceCalls(w.h).length;
  const stop = await doubleForked(w.claude, ['hub', 'stop'], w.worktree, w.h.tmp);
  await sleep(SETTLE_MS);
  const stopCalls = serviceCalls(w.h).slice(callsBefore).filter((l) => STOPS_SERVICE.test(l));
  if (!alive(w.hub.pid) || !(await answers(w.hub.socket)) || stopCalls.length) {
    throw Error(why('deep hub stop', 'stopped the hub', `Hub ${w.hub.pid} alive: ${alive(w.hub.pid)}; its socket answers: ${await answers(w.hub.socket)}; login-service calls: ${JSON.stringify(stopCalls)}. ${shown(stop)}`));
  }
  expectRefusedForConfirmation('deep hub stop', stop);

  // deep setup --undo, cancelled: every file setup put in place is as it was, and the hooks still reach the hub.
  const before = setupSnapshot(w.h.home);
  const undoCallsBefore = serviceCalls(w.h).length;
  const undo = await doubleForked(w.claude, ['setup', '--undo'], w.worktree, w.h.tmp);
  await sleep(SETTLE_MS);
  const after = setupSnapshot(w.h.home);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
  const undoCalls = serviceCalls(w.h).slice(undoCallsBefore).filter((l) => STOPS_SERVICE.test(l));
  if (changed.length || undoCalls.length) throw Error(why('deep setup --undo', 'removed what setup put in place', `Changed under HOME: ${JSON.stringify(changed)}; login-service calls: ${JSON.stringify(undoCalls)}. ${shown(undo)}`));
  await expectGated(w, why('deep setup --undo', 'left the next hook reply ungated', 'The next PreToolUse: {probe}'));
  expectRefusedForConfirmation('deep setup --undo', undo);

  // deep off, confirmed: watch-only within a second of the command's end.
  confirmWith(w.h, 'confirmed');
  const offNow = await doubleForked(w.claude, ['off'], w.worktree, w.h.tmp);
  expect(offNow.code, `AC21 \`deep off\`, double-forked, once the OS confirms you, exits 0: ${shown(offNow)}`).toBe(0);
  const gate = await gateBy(w, 'watch-only', offNow.ended + 1000);
  expect(gate.reading, `AC21 within a second of a confirmed \`deep off\`, the next hook reply is watch-only: ${gate.text}`).toBe('watch-only');
  expect(gate.started - offNow.ended, `AC21 the first watch-only reply came from a hook started ${gate.started - offNow.ended} ms after deep off ended, past the second`).toBeLessThanOrEqual(1000);

  // deep on, cancelled: the next hook reply stays watch-only.
  confirmWith(w.h, 'cancelled');
  const on = await doubleForked(w.claude, ['on'], w.worktree, w.h.tmp);
  await sleep(SETTLE_MS);
  const still = await gateProbe(w);
  if (still.reading !== 'watch-only') throw Error(why('deep on', 'turned the gates back on after a confirmed deep off', `The next PreToolUse: ${still.text}`));
  expectRefusedForConfirmation('deep on', on);
}

/**
 * AC22 #19.a4f7c68a: `deep hub use --root <a dev hub's folder>`, run in a worktree by a process the agent double-forked,
 * leaves the worktree's next session on the installed hub with the OS confirmation cancelled; confirmed, the next one
 * reaches the dev hub.
 */
export async function hubUseWaitsForYou(plant?: string): Promise<void> {
  const h = makeHome();
  const worktree = makeWorktree(h.tmp);
  const plantEnv = plant ? { DEEP_HUB_PLANT: plant } : {};
  const installed = await startHub(h.home, { plant });
  await setup(h, plantEnv);
  const devRoot = join(h.tmp, 'dev');
  const dev = await startHub(h.home, { root: devRoot, plant });
  /** A new session of the worktree: its own Claude Code, its SessionStart through setup's entries. */
  const session = async () => {
    const s = newSession(h.home, worktree);
    const claude = Claude.start(h.home, plantEnv);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    return { s, claude };
  };
  const startedIn = async (hub: Hub, id: string) => (await allEvents(hub)).some((e) => e.kind === 'session.start' && e.session === id);
  /** Which hub recorded the session's start: waits up to 20 s for one of them. */
  const reached = (id: string) => waitFor(async () => {
    const [i, d] = [await startedIn(installed, id), await startedIn(dev, id)];
    return i || d ? { installed: i, dev: d } : undefined;
  }, 20_000, `session ${id}'s start in the installed hub or the dev hub`);

  const agent = await session();
  const base = await reached(agent.s.id);
  if (!base.installed || base.dev) throw Error(`BLOCKED: before deep hub use, the worktree's session must reach the installed hub only: ${JSON.stringify(base)}`);

  const use = ['hub', 'use', '--root', devRoot];
  const command = `deep hub use --root ${devRoot}`;
  const cancelled = await doubleForked(agent.claude, use, worktree, h.tmp);
  await sleep(SETTLE_MS);
  const next = await session();
  const got = await reached(next.s.id);
  if (got.dev || !got.installed) {
    throw Error(`AC22 \`${command}\`, run in ${worktree} by a process agent session ${agent.s.id} double-forked so launchd adopted it, sent the worktree's next session ${next.s.id} to the dev hub with the OS confirmation cancelled (installed hub: ${got.installed}, dev hub: ${got.dev}): a deep that opts the worktree in because the peer check found no agent fails this test. ${shown(cancelled)}`);
  }
  expect(cancelled.code, `AC22 \`${command}\`, double-forked, the OS confirmation cancelled, exits 3 (not decided): ${shown(cancelled)}`).toBe(3);
  expect(said(cancelled), `AC22 \`${command}\` says why: that the OS didn't confirm you: ${shown(cancelled)}`).toMatch(/confirm/i);

  confirmWith(h, 'confirmed');
  const confirmed = await doubleForked(agent.claude, use, worktree, h.tmp);
  expect(confirmed.code, `AC22 \`${command}\`, double-forked, once the OS confirms you, exits 0: ${shown(confirmed)}`).toBe(0);
  const last = await session();
  const now = await reached(last.s.id);
  expect(now, `AC22 once the OS confirmed you, the worktree's next session ${last.s.id} reaches the dev hub at ${devRoot}, not the installed hub`).toEqual({ installed: false, dev: true });
}

/** The three calls AC24 names, each as the agent makes it; each must still be denied by a fail_closed guard, named. */
interface Call { label: string; id: string; fire(): Promise<{ ran: { code: number | null; stdout: string; stderr: string }[]; ack: Line | undefined }> }
function agentCalls(w: World): Call[] {
  const bash = (label: string, command: string): Call => {
    const id = callId();
    return {
      label, id, fire: async () => {
        const fired = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: label }, tool_use_id: id }));
        return { ran: fired.ran.filter((r) => /deep-hook/.test(r.command)), ack: ackOf(w.fwd, (l) => l.payload?.tool_use_id === id)?.ack };
      },
    };
  };
  const doneYaml = join(w.worktree, '.deepbuild', 'done.yaml');
  mkdirSync(join(w.worktree, '.deepbuild'), { recursive: true });
  writeFileSync(doneYaml, 'checks:\n  - npm test\n');
  const editId = callId();
  const codexConfig = join(w.h.home, '.codex', 'config.toml');
  mkdirSync(join(w.h.home, '.codex'), { recursive: true });
  writeFileSync(codexConfig, '[features]\n');
  const patchId = `exec-${randomUUID()}`;
  const codexSession = randomUUID();
  return [
    bash('the agent\'s Bash call `pkill -f vite`', 'pkill -f vite'),
    {
      label: `its Edit of ${doneYaml} (.deepbuild/done.yaml)`, id: editId, fire: async () => {
        const fired = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: doneYaml, old_string: '  - npm test\n', new_string: '' }, tool_use_id: editId }));
        return { ran: fired.ran.filter((r) => /deep-hook/.test(r.command)), ack: ackOf(w.fwd, (l) => l.payload?.tool_use_id === editId)?.ack };
      },
    },
    {
      // Codex's own config, written by a Codex session's apply_patch, deep-hook run as Codex's hooks.json entry runs it.
      label: `its write of \`hooks = false\` into its own config ${codexConfig} (a Codex session's apply_patch)`, id: patchId, fire: async () => {
        const body = {
          session_id: codexSession, turn_id: randomUUID(), transcript_path: join(w.h.home, '.codex', 'sessions', `rollout-${codexSession}.jsonl`), cwd: w.worktree,
          hook_event_name: 'PreToolUse', model: 'gpt-reserve', permission_mode: 'default', tool_name: 'apply_patch',
          tool_input: { command: `*** Begin Patch\n*** Update File: ${codexConfig}\n@@\n [features]\n+hooks = false\n*** End Patch` }, tool_use_id: patchId,
        };
        const r = await run(w.hookBinary, ['codex', 'PreToolUse'], { env: childEnv(w.h.home, w.plant ? { DEEP_HUB_PLANT: w.plant } : {}), cwd: w.worktree, input: JSON.stringify(body), timeoutMs: 120_000 });
        return { ran: [r], ack: ackOf(w.fwd, (l) => l.payload?.tool_use_id === patchId)?.ack };
      },
    },
  ];
}

/**
 * AC24 #19.44419f7e: after a confirmed `deep off`, the next stop isn't held, while the agent's `pkill -f vite`, its Edit
 * of `.deepbuild/done.yaml` and its write of `hooks = false` into its own config are each still denied, naming the guard.
 */
export async function offKeepsTheGuards(plant?: string): Promise<void> {
  const w = await world({ ask: true, plant });
  const held = await stopProbe(w);
  if (held.reading !== 'gated') throw Error(`BLOCKED: before deep off the hub must hold the stop of a session with an open ask (#18), or "isn't held" reads nothing: ${held.text}`);

  confirmWith(w.h, 'confirmed');
  const off = await deep(w.h.home, ['off'], { cwd: w.worktree, env: plant ? { DEEP_HUB_PLANT: plant } : {} });
  expect(off.code, `AC24 deep off, run by you with the OS confirming you, exits 0: ${shown(off)}`).toBe(0);
  await sleep(1000);
  const stop = await stopProbe(w);
  expect(stop.ack.hold_until_ms, `AC24 after a confirmed deep off the next stop isn't held: the hub acknowledges it with hold_until_ms null: ${stop.text}`).toBeNull();

  const failures: string[] = [];
  for (const call of agentCalls(w)) {
    let got = await call.fire();
    // A call deep-hook decided without the hub (late under load) shows deep-hook's floor, not what deep off left on.
    for (let i = 0; i < 7 && !got.ack; i++) got = await call.fire();
    if (!got.ack) throw Error(`INCONCLUSIVE: ${call.label} never reached the hub within deep-hook's 20 ms in 8 tries, so the hub's reply after deep off can't be read`);
    const text = got.ran.map((r) => `exit ${r.code} ${r.stdout} ${r.stderr}`).join(' | ');
    const guard = w.failClosed.find((name) => text.includes(name));
    if (!got.ran.length || !got.ran.every(denied)) failures.push(`${call.label} (tool_use_id ${call.id}) was let through: ${text.slice(0, 600)}`);
    else if (!guard) failures.push(`${call.label} (tool_use_id ${call.id}) was denied without naming its guard (one of ${w.failClosed.join(', ')}): ${text.slice(0, 600)}`);
  }
  if (failures.length) throw Error(`AC24 after a confirmed deep off, the fail-closed guards must still deny each call, naming the guard: ${failures.join('; ')}`);
}
