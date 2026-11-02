// Criterion 4, the agent: a capture an agent's tool call requests is refused, naming the caller; with the Capture
// line "It can never: … record for an agent". The request is the panel's camera and microphone request made by
// alpha's agent through a tool call; a hold afterwards keeps nothing for it, and the same hold keeps a panel's own
// request (the control, so a gate that never records fails). Through `deep-show run` on the virtual clock (README:
// The surface under test). At the base `deep-show` has no device capture and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DEVICES, Driver, SEC, agentRequest, at, capturesOf, hid, holdProblems, indicatorOf, itemsIn, newFeeds,
  obj, openedOf, request, storeFiles, useFolders, useShow, type Planted, type Source,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();
const SOURCES: Source[] = ['camera', 'microphone'];

describe('criterion 4: a capture an agent\'s tool call requests is refused, naming the caller', () => {
  function run(planted?: Planted): string[] {
    const feeds = newFeeds();
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const tag = planted ? ` (planted ${planted})` : '';
    const f: string[] = [];

    // Alpha's agent asks, by a tool call, for the panel's camera and microphone; then the chord is held 4–6 s.
    const r1 = d.step([
      agentRequest(2 * SEC, 'camera', ALPHA.id), agentRequest(2 * SEC, 'microphone', ALPHA.id),
      hid(4 * SEC, 'down'), at('indicator', 5 * SEC), hid(6 * SEC, 'up'), at('captures', 7 * SEC),
    ], `the agent's tool calls, then a hold${tag}`);
    SOURCES.forEach((s, i) => {
      const reply = obj(r1[i], `the reply to the agent's ${s} request`);
      const code = reply['code'];
      if (typeof code !== 'string' || code === '') f.push(`the agent's tool call from ${ALPHA.id} for the ${s} was not refused: the reply has no code (${JSON.stringify(reply).slice(0, 300)})`);
      if ('capture' in reply) f.push(`the agent's tool call from ${ALPHA.id} for the ${s} opened a capture ${JSON.stringify(reply['capture'])}`);
      if (reply['caller'] !== ALPHA.id) f.push(`the refusal of the agent's ${s} request names the caller ${JSON.stringify(reply['caller'])}, not ${ALPHA.id}`);
    });
    const lit = indicatorOf(r1[3], 'the indicator during the hold after the agent\'s requests');
    if (lit.system || lit.app) f.push(`the agent's tool calls: a hold after them lit the indicator (${JSON.stringify(lit)}): something records for the agent`);
    const listed = capturesOf(r1[5], 'captures after the agent\'s requests and a hold');
    if (listed.length > 0) f.push(`the agent's tool calls: ${listed.length} device capture(s) listed after them, the first ${listed[0]!.capture} ${listed[0]!.state} with ${listed[0]!.frames} kept`);
    const files = storeFiles(dir.evidence);
    if (files.length > 0) f.push(`the agent's tool calls: a hold after them left ${files.length} file(s) in the evidence store`);

    // The control: the panel's own requests, then a hold 10–11 s, keep that hold.
    const r2 = d.step([
      request(8 * SEC, 'camera'), request(8 * SEC, 'microphone'), hid(10 * SEC, 'down'), hid(11 * SEC, 'up'), at('captures', 11.5 * SEC),
    ], `the panel's requests and a hold${tag}`);
    const ids = { camera: openedOf(r2[0], 'the panel\'s camera request'), microphone: openedOf(r2[1], 'the panel\'s microphone request') };
    const caps = capturesOf(r2[4], 'captures after the panel\'s hold');
    for (const s of SOURCES) {
      const c = caps.find((x) => x.capture === ids[s]);
      if (!c?.asset) { f.push(`the control: the panel's ${s} capture is ${c?.state ?? 'missing'} with no asset after its hold`); continue; }
      const file = storeFiles(dir.evidence).find((e) => e.sha === c.asset!.sha256);
      if (!file) { f.push(`the control: the panel's ${s} asset is not in the evidence store`); continue; }
      f.push(...holdProblems(itemsIn(file.bytes, `the panel's ${s} recording`), DEVICES[s], feeds[s], 10 * SEC, 11 * SEC, `the control: the panel's ${s} asset`));
    }
    return f;
  }

  it('criterion 4 alpha\'s agent asking for the camera and microphone by a tool call is refused, the refusal naming sess-alpha; a hold after it keeps nothing, while the panel\'s own request then keeps its hold', () => {
    expect(run(), 'nothing records for an agent').toEqual([]);
  }, 900_000);

  it('criterion 4 a planted capture service that takes an agent\'s tool call as a panel\'s request fails, naming the caller', () => {
    const twin = run('records_for_agent');
    expect(twin.some((m) => m.startsWith('the agent\'s tool call') && m.includes(ALPHA.id)), `the planted records_for_agent fails, naming ${ALPHA.id}: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
  }, 900_000);
});
