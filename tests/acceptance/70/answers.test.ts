// AC2 #70.eb5a58a0: an answer typed from inside an agent's process tree is refused.
// AC7 #70.b6da6dea: an authority answer typed into `deep` from a process an agent started with `systemd-run --user`,
// or double-forked so PID 1 adopted it, counts only once polkit confirms you; with the polkit prompt cancelled the
// answer never counts and the ask stays open; a CLI that counts it because the peer check found no agent above it
// fails, naming the ask.
//
// The hub is the real systemd user service. The agent is the Claude Code stand-in whose hooks ran setup's entries, so
// the hub knows its process. The ask is an authority ask seeded through the asks core. The polkit prompt is stubbed at
// that boundary (README: the polkit boundary): the hub's Linux path runs up to the program it asks polkit with.

import { afterEach, describe, expect, it } from 'vitest';
import {
  AC2, AC7, CLI, NODE, cleanup, confirmWith, deep, doubleForked, expectCountedOnce, expectOpen, failure, installPolkitActions, notBlocked, polkitAnswers,
  polkitCalls, requireLinux, said, seedAuthorityAsk, shown, viaSystemdRun, world, type Left, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A world with an authority ask open for the session; returns its handle. */
async function asked(subject: string, o: { plant?: string | undefined; polkit?: 'stub' | 'real' | undefined } = {}): Promise<{ w: World; handle: string }> {
  requireLinux();
  let handle = '';
  const w = await world({ ...o, seed: async (h, s) => { handle = await seedAuthorityAsk(h, s, subject); } });
  return { w, handle };
}

/**
 * The agent's Bash tool types `deep inbox answer`, polkit confirming throughout, so only the peer check can refuse it;
 * then you type the same answer, and it counts, once.
 */
async function insideTheTree(plant?: string): Promise<void> {
  const { w, handle } = await asked('feature/login', { plant });
  confirmWith(w.h, 'confirmed');
  const typed = await w.claude.exec(`'${NODE}' '${CLI}' inbox answer '${handle}' decline`, w.worktree);
  await expectOpen(w.hub, handle, `answered decline by deep inbox answer, run inside agent session ${w.s.id}'s process tree, with polkit confirming you`);
  expect(typed.code, `${AC2} deep inbox answer ${handle}, run inside the agent's process tree, is refused, exit 3 (not decided): ${shown(typed)}`).toBe(3);
  expect(said(typed), `${AC2} the refusal names the agent's session: ${shown(typed)}`).toContain(w.s.id);
  expect(said(typed), `${AC2} the refusal names the ask that stays open: ${shown(typed)}`).toContain(handle);
  // The same answer, typed by you, counts: what refused it was the peer check.
  const yours = await deep(w.h, ['inbox', 'answer', handle, 'decline']);
  expect(yours.code, `${AC2} the same answer typed by you, polkit confirming you, exits 0: ${shown(yours)}`).toBe(0);
  await expectCountedOnce(w.hub, handle, 'decline', 'typed by you');
}

type Leave = (w: World, args: readonly string[]) => Promise<Left>;
const ORIGINS: [string, Leave][] = [['systemd-run --user', viaSystemdRun], ['a double fork PID 1 adopted', doubleForked]];

/**
 * The agent starts `deep inbox answer` so it leaves the agent's tree. With the prompt cancelled the ask stays open and
 * the CLI says so; once polkit confirms you the same answer counts, once.
 */
async function outsideTheTree(origin: string, leave: Leave, plant?: string): Promise<void> {
  const { w, handle } = await asked('feature/signup', { plant });
  const answer = ['inbox', 'answer', handle, 'decline'];
  const cancelled = await leave(w, answer);
  await expectOpen(w.hub, handle, `answered decline by deep inbox answer, typed by a process agent session ${w.s.id} started through ${origin} (its ancestors: ${cancelled.chain}), the polkit prompt cancelled`);
  expect(polkitCalls(w.h).length, `${AC7} an answer the peer check finds no agent above must reach polkit, the only thing that can make it count; the boundary saw no ask: ${shown(cancelled)}`).toBeGreaterThan(0);
  expect(polkitCalls(w.h)[0], `${AC7} the prompt asks for your password, so polkit must be asked with user interaction allowed`).toMatch(/--allow-user-interaction/);
  expect(cancelled.code, `${AC7} deep inbox answer ${handle}, through ${origin}, the prompt cancelled, exits 3 (not decided): ${shown(cancelled)}`).toBe(3);
  expect(said(cancelled), `${AC7} deep inbox answer says which ask stays open: ${shown(cancelled)}`).toContain(handle);

  confirmWith(w.h, 'confirmed');
  const confirmed = await leave(w, answer);
  expect(confirmed.code, `${AC7} deep inbox answer ${handle}, through ${origin}, once polkit confirms you, exits 0: ${shown(confirmed)}`).toBe(0);
  await expectCountedOnce(w.hub, handle, 'decline', `typed through ${origin}`);
}

describe(`${AC2} An answer typed from inside an agent's process tree is refused`, () => {
  it(`${AC2} \`deep inbox answer\`, run by the agent's Bash tool on Linux, is refused with exit 3 naming the session and the ask, even with polkit confirming you, and the same answer typed by you counts once`, () => insideTheTree(), 600_000);

  it(`${AC2} (wrong program) a hub that lets a deep command inside an agent's process tree answer as you (answer-inside-session) fails, naming the ask`, async () => {
    const message = await failure(() => insideTheTree('answer-inside-session'));
    notBlocked(message);
    expect(message).toMatch(/ask ask:[0-9A-Za-z]+ \(answered decline by deep inbox answer, run inside agent session/);
  }, 600_000);
});

describe(`${AC7} An authority answer from a process that left the agent's tree counts only once polkit confirms you`, () => {
  it.each(ORIGINS)(`${AC7} typed from %s, with the polkit prompt cancelled the ask stays open and exits 3; once polkit confirms you it counts once`, (origin, leave) => outsideTheTree(origin, leave), 600_000);

  it.each(ORIGINS)(`${AC7} (wrong program) a CLI that counts the answer from %s because the peer check found no agent above it (answer-on-peer-check) fails, naming the ask`, async (origin, leave) => {
    const message = await failure(() => outsideTheTree(origin, leave, 'answer-on-peer-check'));
    notBlocked(message);
    expect(message).toMatch(/ask ask:[0-9A-Za-z]+ \(answered decline by deep inbox answer, typed by a process agent session .* the polkit prompt cancelled\)/);
  }, 600_000);

  it(`${AC7} on the real polkitd, nothing stubbed but the prompt, which a rule answers: a no leaves the ask open and a yes counts it once`, async () => {
    installPolkitActions();
    const { w, handle } = await asked('feature/real-polkit', { polkit: 'real' });
    const answer = ['inbox', 'answer', handle, 'decline'];
    await polkitAnswers('NO');
    const no = await doubleForked(w, answer);
    await expectOpen(w.hub, handle, `answered decline by a double-forked deep inbox answer, the real polkitd saying no`);
    expect(no.code, `${AC7} the real polkitd saying no exits 3 (not decided): ${shown(no)}`).toBe(3);
    await polkitAnswers('YES');
    const yes = await doubleForked(w, answer);
    expect(yes.code, `${AC7} the real polkitd saying yes exits 0: the hub must reach it, with an action it knows and this process as the subject: ${shown(yes)}`).toBe(0);
    await expectCountedOnce(w.hub, handle, 'decline', 'through the real polkitd');
  }, 600_000);
});
