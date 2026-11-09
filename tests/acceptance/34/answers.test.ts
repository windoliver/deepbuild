// #34 AC2 and AC4: answers on the App API. An answer with authority counts only when a device you paired signs
// it, the app's own key first, or, from the CLI, once the OS confirms you, never on the control token or the
// peer check alone (design: Socket roles and contract versions, The trusted path is a device you paired;
// Decided: Answers from the terminal, Clicks on the question card). An answer posted here is recorded and
// handed on as a CLI answer is. The asks are raised through the asks core (#318) on the hub's ledger before the
// hub starts; the OS confirmation is the test's stand-in (helpers.ts, Confirmer), the one boundary mocked.
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, asCli, cleanup, clickToken, Confirmer, confirmEnv, eventsAbout, inboxRow, installedRoot, judgeNotCounted, makeHome, newDevice, pair,
  seedAsks, signed, startHub, type Conn, type Hub, type Line, type Seeded,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface World { hub: Hub; confirm: Confirmer; asks: Seeded[]; app: Conn; cli: Conn }
/** A hub whose record holds `n` open authority asks (effect.push, "Push it" approves) and two taste calls. */
async function world(n: number): Promise<World> {
  const home = makeHome();
  const confirm = new Confirmer();
  const asks = await seedAsks(installedRoot(home), [
    ...Array.from({ length: n }, (_, i) => ({ source: 'effect.push', question: `Push feature/a${i} to origin?` })),
    { source: 'deep_ask.taste', question: 'Which header colour on the login page?' },
    { source: 'deep_ask.taste', question: 'Which header colour on the signup page?' },
  ]);
  const hub = await startHub({ home, env: confirmEnv(confirm) });
  return { hub, confirm, asks, app: await asApp(hub), cli: await asCli(hub) };
}
const approve = (ask: Seeded): Line => ({ ask: ask.handle, option: 'approve', plan_hash: ask.plan_hash, token: clickToken() });
async function notCounted(w: World, ask: Seeded, reply: Line): Promise<string | null> {
  return judgeNotCounted(ask.handle, reply, await eventsAbout(w.app, ask.handle, 'ask.answered'), await inboxRow(w.app, ask.handle));
}
async function counted(w: World, ask: Seeded, reply: Line): Promise<Line> {
  expect('result' in reply, `${ask.handle}'s answer counts: ${JSON.stringify(reply)}`).toBe(true);
  const answered = await eventsAbout(w.app, ask.handle, 'ask.answered');
  expect(answered, `${ask.handle} is recorded answered once`).toHaveLength(1);
  expect((await inboxRow(w.app, ask.handle))?.outcome, `${ask.handle} leaves Needs you answered`).toBe('answered');
  return answered[0]!.data as Line;
}

describe('AC2 #34.0e31665e an authority answer without a paired device\'s signature is refused, unless it comes from the CLI and the OS has confirmed you', () => {
  // Three AC2 cases (the app's token-only answer, a stranger's key or other words, and the token-only hub as the
  // wrong program) and both AC4 cases are proven by the blind redraft redraft-1579/answers.test.ts, swapped in with
  // the owner's approval: #1579 changed what a paired device signs, so this draft's signer fails them on the format.

  it('AC2 a key paired without the OS confirming you is refused, and nothing it signs counts', async () => {
    const w = await world(1);
    const device = newDevice('paired without you');
    w.confirm.say(false);
    const reply = await pair(w.app, device);
    expect('error' in reply, `pairing without the OS confirming you is refused: ${JSON.stringify(reply)}`).toBe(true);
    expect(device.id).toBeUndefined();
    const ask = w.asks[0]!;
    for (const id of ['', 'device:unpaired']) expect(await notCounted(w, ask, await w.app.call('ask.answer', signed(approve(ask), device, { id })))).toBeNull();
  }, 120_000);

  it('AC2 from the CLI, an unsigned authority answer counts only once the OS confirms you, asked once, its prompt naming the question and the option', async () => {
    const w = await world(1);
    const ask = w.asks[0]!;
    w.confirm.say(false);
    const no = await w.cli.call('ask.answer', approve(ask), 20_000);
    expect(await notCounted(w, ask, no)).toBeNull();
    expect(w.confirm.prompts(), 'the hub asked the OS to confirm you once for that answer').toHaveLength(1);
    w.confirm.say(true);
    const data = await counted(w, ask, await w.cli.call('ask.answer', approve(ask), 20_000));
    expect(data.decision).toBe('allow');
    const prompts = w.confirm.prompts();
    expect(prompts, 'each answer is confirmed once, never from a cached confirmation').toHaveLength(2);
    expect(prompts[1], 'the prompt names the question').toContain(ask.question);
    expect(prompts[1], 'the prompt names the option chosen').toMatch(/approve|Push it/);
  }, 120_000);
});
