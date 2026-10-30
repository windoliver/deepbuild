// #34 AC2 and AC4: answers on the App API. An answer with authority counts only when a device you paired signs
// it, the app's own key first, or, from the CLI, once the OS confirms you, never on the control token or the
// peer check alone (design: Socket roles and contract versions, The trusted path is a device you paired;
// Decided: Answers from the terminal, Clicks on the question card). An answer posted here is recorded and
// handed on as a CLI answer is. The asks are raised through the asks core (#318) on the hub's ledger before the
// hub starts; the OS confirmation is the test's stand-in (helpers.ts, Confirmer), the one boundary mocked.
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, asCli, cleanup, clickToken, Confirmer, confirmEnv, eventsAbout, inboxRow, installedRoot, judgeNotCounted, makeHome, newDevice, pair,
  result, seedAsks, signed, startHub, tempDir, tokenOnlySigner, type Conn, type Device, type Hub, type Line, type Seeded,
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
/** Pairs a device's key with the OS stand-in confirming you, as setup does for the app's own key. */
async function paired(w: World, name = 'this Mac\'s app'): Promise<Device> {
  const device = newDevice(name);
  w.confirm.say(true);
  const reply = await pair(w.app, device);
  w.confirm.say(false);
  if (!device.id) throw Error(`BLOCKED: device.pair didn't pair the app's key with the OS confirming you: ${JSON.stringify(reply)}`);
  return device;
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
  it('AC2 the app\'s answer carrying only the control token is refused, recorded nothing and leaves the ask open, even with the OS ready to confirm', async () => {
    const w = await world(1);
    const app = await paired(w);
    const ask = w.asks[0]!;
    w.confirm.say(true);
    const reply = await w.app.call('ask.answer', approve(ask), 20_000);
    expect(await notCounted(w, ask, reply)).toBeNull();
    // The same ask, signed by the paired app, then counts: the refusal was the signature's, not a missing ask's.
    const data = await counted(w, ask, await w.app.call('ask.answer', signed(approve(ask), app)));
    expect(data.decision, 'the approve option\'s decision').toBe('allow');
  }, 120_000);

  it('AC2 a signature from a key never paired, or over other words than the answer sent, is refused', async () => {
    const w = await world(3);
    const app = await paired(w);
    const stranger = newDevice('never paired');
    const forged = signed(approve(w.asks[0]!), stranger, { id: app.id! });
    expect(await notCounted(w, w.asks[0]!, await w.app.call('ask.answer', forged))).toBeNull();
    const declined = signed({ ask: w.asks[1]!.handle, option: 'decline' }, app);
    const swapped = { ...declined, option: 'approve', token: clickToken() };
    expect(await notCounted(w, w.asks[1]!, await w.app.call('ask.answer', swapped))).toBeNull();
    const otherAsk = { ...signed(approve(w.asks[2]!), app), ask: w.asks[1]!.handle };
    expect(await notCounted(w, w.asks[1]!, await w.app.call('ask.answer', otherAsk))).toBeNull();
    expect((await counted(w, w.asks[2]!, await w.app.call('ask.answer', signed(approve(w.asks[2]!), app)))).decision).toBe('allow');
  }, 120_000);

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

  it('AC2 (wrong program) a hub that counts an answer carrying only the control token fails this test, naming the ask', async () => {
    // The planted hub: the real one behind a signer that holds a paired key and signs whatever comes unsigned.
    const w = await world(1);
    const plant = await tokenOnlySigner(tempDir(), w.hub.socket, await paired(w, 'the planted signer'));
    const through = await asApp({ socket: plant.path, root: w.hub.root });
    const ask = w.asks[0]!;
    const reply = await through.call('ask.answer', approve(ask), 20_000);
    const failure = await notCounted(w, ask, reply);
    expect(failure, 'the planted hub counts the unsigned answer, and the judge names its ask').toContain(ask.handle);
    await plant.close();
  }, 120_000);
});

describe('AC4 #34.fbf5f587 an answer posted here is delivered like a CLI answer', () => {
  /** What the record hands the agent's adapter for an answer: everything ask.answered says but where it came from. */
  const delivered = (data: Line) => ({ answer: data.answer, decision: data.decision, plan_hash: data.plan_hash, verified: data.verified, clicked: typeof data.token === 'string' });

  it('AC4 a taste call answered on the App API is recorded and handed on as its twin answered from the CLI is', async () => {
    const w = await world(0);
    const [app, cli] = [w.asks[0]!, w.asks[1]!];
    const device = await paired(w);
    w.confirm.say(true);
    const viaApp = await counted(w, app, await w.app.call('ask.answer', signed({ ask: app.handle, option: 'green' }, device)));
    const viaCli = await counted(w, cli, await w.cli.call('ask.answer', { ask: cli.handle, option: 'green' }, 20_000));
    expect(delivered(viaApp)).toEqual(delivered(viaCli));
    expect(viaApp.answer).toBe('green');
  }, 120_000);

  it('AC4 an authority ask approved on the App API is recorded and handed on as its twin approved from the CLI is', async () => {
    const w = await world(2);
    const [app, cli] = [w.asks[0]!, w.asks[1]!];
    const device = await paired(w);
    const viaApp = await counted(w, app, await w.app.call('ask.answer', signed(approve(app), device)));
    w.confirm.say(true);
    const viaCli = await counted(w, cli, await w.cli.call('ask.answer', approve(cli), 20_000));
    expect(delivered(viaApp)).toEqual(delivered(viaCli));
    expect(viaApp.decision).toBe('allow');
    // Both are on the stream as the same kind of event, for the app's views and the agent's delivery alike.
    const page = result(await w.app.call('events.read', { after: 0, limit: 1000 }));
    const kinds = (page.events as Line[]).filter((e) => e.subject === app.handle || e.subject === cli.handle).map((e) => `${e.subject === app.handle ? 'app' : 'cli'}:${e.kind}`).sort();
    expect(kinds.filter((k) => k.endsWith(':ask.answered'))).toEqual(['app:ask.answered', 'cli:ask.answered']);
  }, 120_000);
});
