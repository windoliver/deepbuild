// AC1 #1828.65fe62dd, the right program: "On a hub started by `deep hub run`, a plug-in send with no standing rule
// raises one ask from the "action.send" source and goes out once on your yes." The hub is the shipped one, with
// acme/notify in its release (README, The packages). acme/notify makes one send to you through the local HTTPS
// stand-in, outside any action or schedule, and no standing rule of yours covers it; you answer its ask with
// `deep inbox answer <ask> approve`. Its wrong program is planted.test.ts.
import { afterAll, expect, test } from 'vitest';
import { AC1, built, cleanup, judgeSend, loadReading, said, sendScene, sendWorld, stopHub, verdict } from './helpers.ts';

afterAll(cleanup, 180_000);

test(`${AC1} a plug-in send with no standing rule raises one ask from action.send, nothing goes out before your yes, and it goes out once on it`, async (ctx) => verdict(ctx, async () => {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const { w, hub, p, trigger, log } = await sendWorld();
  try {
    const s = await sendScene(w, hub, p, trigger, log);
    console.log(`${AC1} the send ${s.key}: ${s.asks.length} ask(s) ${s.asks.map(said).join('; ')}; after it: ${s.after.map(said).join('; ') || 'nothing'}; reached the stand-in ${s.beforeYes} before the yes, ${s.reached} at the end; ${loadReading()}`);
    expect(judgeSend(s), `${AC1} the send's reading (hub stderr: ${hub.output().slice(-600)})`).toEqual([]);
  } finally {
    await stopHub(hub);
    await p.close();
  }
}), 600_000);
