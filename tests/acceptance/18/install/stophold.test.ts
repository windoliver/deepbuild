// AC14 #18.cfd217f8 A Claude Code Stop hook entry whose timeout is at or below the hold, 60 s against the 60 s hold,
// shows the stop-hold relation broken at hub start and in `deep doctor`, naming both values, and Claude Code's stop
// holds turn watch-only with that reading; at 65 s the relation holds and stops are held again. A hub that holds
// anyway is cut off at 60 s and lets the stop through with no verdict, and that version fails this test.
//
// The stop probed is one the hub holds while the relation holds: a stop of a session whose own `deep_ask` is open,
// since a held stop is the route an answer takes back in the same turn (README: The stop the hub holds). Whether
// the hub held it is read off the wire: the hub's acknowledgement of the Stop hook carries `hold_until_ms`, a time
// when the hold ends, or null (#16's hook protocol). deep-hook reaches the hub through a forwarded socket at the
// address setting, which keeps every acknowledgement.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, allEvents, cleanup, count, doctor, eventually, firedShown, forwarder, itemText, jsonLines, makeHome, newSession, ours, payload, readingTexts,
  rootOf, setAddress, setTimeoutOf, setup, startHub, stopHoldEntry, stopHub, tag, typedPrompt, waitFor, type Claude as ClaudeT, type Forwarder, type Hub,
  type Line, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'holds-stop-anyway';
/** A reading or doctor text that shows the stop-hold relation broken at 60 s against 60 s: it names the relation and both values. */
const brokenAt60 = (text: string) => /stop[- ]hold/i.test(text) && count(text, '60 s') >= 2;

/** The hub's acknowledgement of the n-th Stop hook of `session` deep-hook sent through the forwarder, once it is there. */
function stopAck(fwd: Forwarder, session: string, nth: number): Line | undefined {
  const requests = jsonLines(fwd.upText()).filter((l) => l.event === 'Stop' && l.payload?.session_id === session);
  const request = requests[nth - 1];
  if (!request) return undefined;
  return jsonLines(fwd.downText()).find((l) => l.ack === request.id);
}

interface World { home: string; hub: Hub; fwd: Forwarder; claude: ClaudeT; s: Session }
/** A home whose DeepBuild Stop entry has `seconds` as its timeout, a hub started on it, and a session with an open deep_ask of its own. */
async function world(seconds: number, plant?: string): Promise<World> {
  const { tmp, home } = makeHome();
  const first = await startHub(home);
  await setup(home, plant ? { DEEP_HUB_PLANT: plant } : {});
  await stopHub(first);
  setTimeoutOf(home, stopHoldEntry, seconds);
  const fwd = await forwarder(tmp, join(rootOf(home), 'hub.sock'));
  setAddress(home, fwd.path);
  const hub = await startHub(home, plant ? { plant } : {});
  return { home, hub, fwd, claude: Claude.start(home, plant ? { DEEP_HUB_PLANT: plant } : {}), s: newSession(home) };
}
async function openAsk(w: World): Promise<void> {
  const { claude, s, hub } = w;
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Pick a header colour, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour, then stop.' }));
  await claude.initialize();
  const question = `Which header colour for ${tag(3)}?`;
  // The agent asks and doesn't wait for the answer: deep_ask answers "still waiting" in time, and the ask stays open.
  void claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }], recommended: 'blue' }).catch(() => undefined);
  await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`);
}
/** The session stops at 60 s against the 60 s hold: the hub must not hold it, and DeepBuild's Stop entry must answer at once with no verdict. */
async function stopAt60(w: World): Promise<void> {
  const stopping = w.claude.hook('Stop', payload(w.s, 'Stop'));
  const ack = await waitFor(() => stopAck(w.fwd, w.s.id, 1), 30_000, `the hub's acknowledgement of ${w.s.id}'s Stop`);
  if (ack.hold_until_ms !== null) {
    throw Error(`AC14 the hub held Claude Code's Stop (hold_until_ms ${ack.hold_until_ms}) with the stop-hold relation broken, the 60 s hold against the Stop hook's 60 s timeout: Claude Code cuts the hook off at 60 s and the stop goes through with no verdict`);
  }
  const fired = await stopping;
  for (const r of ours(fired).filter((x) => !x.async)) {
    expect({ timedOut: r.timedOut, code: r.code }, `AC14 with stop holds watch-only, DeepBuild's Stop entry must answer before Claude Code's timeout: ${firedShown(fired)}`).toEqual({ timedOut: false, code: 0 });
    expect(r.stdout, `AC14 a watch-only stop gets no verdict: no decision in DeepBuild's Stop reply: ${firedShown(fired)}`).not.toMatch(/"decision"\s*:/);
  }
}

describe('AC14 #18.cfd217f8 A Claude Code Stop hook entry whose timeout is at or below the hold, 60 s against the 60 s hold, shows the stop-hold relation broken at hub start and in `deep doctor`, naming both values, and Claude Code\'s stop holds turn watch-only with that reading; at 65 s the relation holds and stops are held again. A hub that holds anyway is cut off at 60 s and lets the stop through with no verdict, and that version fails this test', () => {
  it('AC14 #18.cfd217f8 at 60 s the relation reads broken at hub start and in deep doctor, naming both values, and the stop isn\'t held; at 65 s it holds and the stop is held, ending at least 5 s before the timeout', async () => {
    const w = await world(60);
    // At hub start, before any session: the reading names the relation and both values.
    const atStart = await eventually(async () => (await readingTexts(w.hub)).some(brokenAt60), 20_000);
    expect(atStart, 'AC14 the hub must show the stop-hold relation broken at its start, naming the 60 s hold and the Stop hook\'s 60 s timeout').toBe(true);
    const at60 = await doctor(w.home);
    const broken = at60.items.find((i) => i.code === 'timing_relation_broken' && brokenAt60(itemText(i)));
    expect(broken, `AC14 deep doctor must show the stop-hold relation broken as timing_relation_broken, naming the 60 s hold and the 60 s timeout: ${at60.ran.stdout}`).toBeDefined();
    expect(at60.ran.code, `AC14 deep doctor exits 1 with the broken relation: ${at60.ran.stderr}`).toBe(1);
    await openAsk(w);
    await stopAt60(w);

    // 65 s: the relation holds, and the same session's next stop is held.
    await stopHub(w.hub);
    setTimeoutOf(w.home, stopHoldEntry, 65);
    const hub = await startHub(w.home);
    const at65 = await doctor(w.home);
    expect(at65.items.filter((i) => i.code === 'timing_relation_broken' && /stop[- ]hold/i.test(itemText(i))), `AC14 at 65 s the stop-hold relation must not read broken: ${at65.ran.stdout}`).toEqual([]);
    expect(at65.items.some((i) => i.level === 'ok' && /stop[- ]hold/i.test(itemText(i)) && itemText(i).includes('65 s')), `AC14 at 65 s deep doctor must show the stop-hold relation as an ok item naming the 65 s timeout: ${at65.ran.stdout}`).toBe(true);
    typedPrompt(w.s, 'Go on.');
    await w.claude.hook('UserPromptSubmit', payload(w.s, 'UserPromptSubmit', { prompt: 'Go on.' }));
    const t0 = Date.now();
    void w.claude.hook('Stop', payload(w.s, 'Stop'));
    const ack = await waitFor(() => stopAck(w.fwd, w.s.id, 2), 30_000, `the hub's acknowledgement of ${w.s.id}'s second Stop`);
    expect(typeof ack.hold_until_ms, `AC14 at 65 s the hub must hold the stop of a session with an open ask again: ${JSON.stringify(ack)}`).toBe('number');
    expect(ack.hold_until_ms, `AC14 the hold must end at least 5 s before the Stop hook's 65 s timeout, so by 60 s after the hook started (1 s slack): ${JSON.stringify(ack)}`).toBeLessThanOrEqual(t0 + 61_000);
    expect(ack.hold_until_ms).toBeGreaterThan(t0);
    await stopHub(hub);
  }, 900_000);

  it(`AC14 #18.cfd217f8 (wrong program) a hub that holds the stop anyway (${PLANT}) fails this test, naming the hold and the 60 s timeout that cuts it off`, async () => {
    const w = await world(60, PLANT);
    await openAsk(w);
    let failure = '';
    try { await stopAt60(w); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the stop-hold check must fail on ${PLANT}`).toMatch(/held Claude Code's Stop \(hold_until_ms \d+\)/);
    expect(failure).toContain('cuts the hook off at 60 s');
  }, 900_000);
});
