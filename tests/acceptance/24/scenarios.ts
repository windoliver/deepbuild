// The scenarios of criteria 4 and 5, shared with plants.test.ts: each runs against the real hub, or against
// the planted wrong program `plant` names (DEEP_HUB_PLANT), and fails naming the ask that counted.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { AskKind } from '../../../packages/asks/src/index.ts';
import { Agent, confirmWith, control, deep, expectCountedOnce, expectOpen, seed, startHub, tempDir, typedIntoYourShell } from './helpers.ts';

const home = (): string => {
  const dir = join(tempDir(), 'h');
  mkdirSync(dir);
  return dir;
};

/**
 * #24.71112e3b: an authority answer typed by the agent into your shell through `tmux send-keys`, and one written
 * straight to the hub's socket with the control token, don't count with the OS confirmation cancelled; each
 * counts once the OS confirms you.
 */
export async function authorityTypedAndWritten(plant?: string): Promise<void> {
  const h = home();
  const agent = Agent.start(h);
  let typedAsk = '';
  let writtenAsk = '';
  await seed(h, async (s) => {
    await s.start(agent.session);
    typedAsk = await s.raise(agent.session, 'authority', 'feature/login');
    writtenAsk = await s.raise(agent.session, 'authority', 'feature/signup');
  });
  const hub = await startHub(h, { confirm: 'cancelled', ...(plant ? { plant } : {}) });
  await agent.establish(hub);

  // The agent types `deep inbox answer` into your shell, so the peer check finds no agent above the command.
  const typed = await typedIntoYourShell(agent, ['inbox', 'answer', typedAsk, 'decline']);
  await expectOpen(hub, typedAsk, `an authority ask answered by deep inbox answer, typed by the agent through ${typed.via}`);
  expect(typed.code, `deep inbox answer ${typedAsk}, with the OS confirmation cancelled, exits 3 (not decided): ${typed.stdout}${typed.stderr}`).toBe(3);
  expect(`${typed.stdout}${typed.stderr}`, `deep inbox answer says which ask stays open`).toContain(typedAsk);

  // The same answer written straight to the socket with the control token alone.
  const conn = await control(hub);
  const written = await conn.call('ask.answer', { ask: writtenAsk, option: 'decline' });
  await expectOpen(hub, writtenAsk, 'an authority ask answered straight on the hub socket with the control token');
  expect(written.error?.code, `ask ${writtenAsk}: the hub refuses the answer as unconfirmed: ${JSON.stringify(written)}`).toBe('unconfirmed');

  // Once the OS confirms you, each counts, once.
  confirmWith(hub, 'confirmed');
  const confirmed = await typedIntoYourShell(agent, ['inbox', 'answer', typedAsk, 'decline']);
  expect(confirmed.code, `deep inbox answer ${typedAsk}, typed through ${confirmed.via}, once the OS confirms you, exits 0: ${confirmed.stdout}${confirmed.stderr}`).toBe(0);
  await expectCountedOnce(hub, typedAsk, 'decline', `typed through ${confirmed.via}`);
  const accepted = await conn.call('ask.answer', { ask: writtenAsk, option: 'decline' });
  expect(accepted.result, `ask ${writtenAsk}: once the OS confirms you, the socket answer is taken: ${JSON.stringify(accepted)}`).toBeDefined();
  await expectCountedOnce(hub, writtenAsk, 'decline', 'written straight to the socket');
  conn.close();
}

/**
 * #24.b58ac6a6: an answer to an exception ask, a definition ask and a taste ask, each written straight to the hub's
 * socket with the control token, with the OS confirmation cancelled, saves no decision and leaves each ask open.
 */
export async function eachKindWrittenWithTheToken(plant?: string): Promise<void> {
  const h = home();
  const asks: { kind: AskKind; option: string; handle: string }[] = [
    { kind: 'exception', option: 'waive', handle: '' },
    { kind: 'definition', option: 'drop', handle: '' },
    { kind: 'taste', option: 'green', handle: '' },
  ];
  await seed(h, async (s) => {
    await s.start('S5');
    for (const a of asks) a.handle = await s.raise('S5', a.kind, `the ${a.kind} ask`);
  });
  const hub = await startHub(h, { confirm: 'cancelled', ...(plant ? { plant } : {}) });
  const conn = await control(hub);
  const replies = [];
  for (const a of asks) replies.push(await conn.call('ask.answer', { ask: a.handle, option: a.option }));
  for (const [i, a] of asks.entries()) {
    await expectOpen(hub, a.handle, `the ${a.kind} ask, answered ${a.option} straight on the hub socket with the control token`);
    expect(replies[i]!.error?.code, `ask ${a.handle} (${a.kind}): the hub refuses the answer as unconfirmed: ${JSON.stringify(replies[i])}`).toBe('unconfirmed');
  }
  const inbox = await deep(h, ['inbox']);
  for (const a of asks) expect(inbox.stdout, `deep inbox still lists the ${a.kind} ask ${a.handle}`).toContain(a.handle);

  // Once the OS confirms you, each counts, once.
  confirmWith(hub, 'confirmed');
  for (const a of asks) {
    const accepted = await conn.call('ask.answer', { ask: a.handle, option: a.option });
    expect(accepted.result, `ask ${a.handle} (${a.kind}): once the OS confirms you, the socket answer is taken: ${JSON.stringify(accepted)}`).toBeDefined();
    await expectCountedOnce(hub, a.handle, a.option, `the ${a.kind} ask`);
  }
  conn.close();
}
