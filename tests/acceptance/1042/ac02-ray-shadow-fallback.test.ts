// AC2 #1042.8f1f57d3: "A piece whose scene names ray-traced shadows exports without a refusal, plays in the web
// player with today's light, and its receipt lists the fallback for that item"
//
// The yard (helpers.ts: The pieces) is a 3D scene whose light policy names ray-traced shadows as the design spells it
// (`rays: auto`, `effects: [shadows]`) and whose one shadowed light is the key sun `sun`. One test, one run:
//   - its web export is delivered, with no refusal, and the bundle is written;
//   - the bundle's index page plays it live in headless Chrome on WebGPU: the player is ready there (the index page,
//     not the fallback page), and played from its start it draws frames and reaches its `ended` event at step 240
//     without stopping;
//   - the export's receipt lists the fallback for the light: one `stand_in` entry for `sun` on the web path that
//     names today's light, `light: "without_history"`, with the answer's words.
// Wrong programs this fails: the merge base (its export reads no `rays` and its receipt lists nothing for the
// light); an export that refuses a piece for naming rays; a player that stops on one; a receipt that says nothing,
// or names the fallback for no item.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, SUN, TIMEOUT, YARD_SECONDS, YARD_STEPS, exportWeb, none, obj, receiptOf, show as shown, useShow, useTemp, useWeb, yardDoc } from './helpers.ts';
import { fallbackFailures } from './judges.ts';

const show = useShow();
const temp = useTemp();
const web = useWeb();

describe(`${AC[2]} a scene that names ray-traced shadows is exported with no refusal, plays live with today's light, and its receipt lists that fallback for the light`, () => {
  it(`${AC[2]} the yard, whose light policy names ray-traced shadows, exports without a refusal, plays in the web player to its end, and its receipt lists today's light as the fallback for its shadowed light`, async () => {
    const root = temp();
    const out = join(root, 'yard');
    const reply = exportWeb(show(), temp(), yardDoc(), out, 'the yard exported to the web');
    const { receipt } = receiptOf(reply, out, 'the yard exported to the web');

    const bundle = await web.serve(root);
    const browser = await web.browser();
    const url = `${bundle.origin}/yard/index.html`;
    const page = await browser.page(url);
    await page.ready('the yard');
    const start = await page.state();
    expect(start.href, "the index page's player plays the piece, not its fallback page").toBe(url);
    expect(start.duration, 'the yard is 4 s long in the player').toBe(YARD_SECONDS);
    const before = obj(await page.probe(), 'the yard, once ready: probe()');
    expect(/webgpu/i.test(String(before['backend'])), `the player runs on WebGPU: probe().backend is ${shown(before['backend'])}`).toBe(true);

    const over = page.ended('the yard', YARD_SECONDS * 1000 + 600_000);
    await page.play();
    expect(await over, `the yard plays from its start to its end without stopping; notices: ${JSON.stringify(await page.notices())}`).toEqual({ ended: true, stopped: '' });
    const after = obj(await page.probe(), 'the yard, played: probe()');
    expect(after['step'], 'the play ran every step of the 4 s').toBe(YARD_STEPS);
    expect(Number(after['frames']) > Number(before['frames']), `the player drew frames as it played: ${shown(before['frames'])} before, ${shown(after['frames'])} after`).toBe(true);
    expect(after['stopped'] ?? null, 'the play met no failure').toBe(null);

    none(fallbackFailures(receipt, SUN), `the receipt lists today's light as the fallback for the shadowed light ${SUN}`);
  }, TIMEOUT);
});
