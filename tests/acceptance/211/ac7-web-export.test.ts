// AC7 #211.0a8cf256: "A piece whose written_max is 512 MiB with web_max 256 MiB is refused at web export, naming
// written_max; and a planted export that checks only the init asset exports it, and in the web player its store runs
// out at a step where the app plays on, which fails the web comparison, naming the step"
//
// The export through `deep-show run`'s `export` with `video.codec: web` (#172's call): a figure whose logic item
// `world` (programs.ts: the flood, 16 fresh pages a step written as they land) declares pages {max 8,192, slots 128,
// moves 16, written_max 512, web_max 256}. The real export refuses it (outcome refused, a `refused` entry naming the
// item and `field: "written_max"`) and writes nothing; scenario `planted: "web_export_checks_init_only"` exports it.
// The play through `deep-logic`: the app's bake of the same item, and the web player's (the web runner in headless
// Chrome on web_plan's request), compared step by step. The flood writes pages 0 to 4,095 by step 258 and page 4,096,
// the 4,097th, alone at step 259, then 16 a step up to page 4,400: past 256 MiB from step 259 and never past 512 MiB.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, arr, arrayOf, bakeCall, bakeOf, figureDoc, filesIn, firstStepDiff, isObject, logic, pagesOf, piece, presented, runShow, scenario,
  show, showCall, useBuilds, useTemp, webBake, type ItemSpec, type JsonObject,
} from './helpers.ts';
import { flood, floodWrites } from './programs.ts';

const ID = AC(7);
useBuilds(['show', 'logic']);
const temp = useTemp();

const SEED = 211_07;
const STEPS = 300;
const PAGES = pagesOf({ max: 8192, slots: 128, moves: 16, lead: 4, written_max: 512, web_max: 256 });
const item = (): ItemSpec => ({
  program: flood({ name: 'flood512', moves: 16, last: STEPS - 4, limit: 4400, skip: [4097, 4111] }), writes: floodWrites, pages: PAGES,
  budget: { fuel: 2_000_000, memory: 9 }, checkpoint: { every: 60, budget: 1_073_741_824 },
});
/** The same item's fields as a document's logic item takes them. */
const params = (): JsonObject => {
  const { writes, pages, budget, checkpoint } = item();
  return { writes, pages, budget, checkpoint } as unknown as JsonObject;
};
/** The figure presented, then exported to the web, in one deep-show process. */
function exported(planted?: string): { reply: JsonObject; out: string } {
  const root = temp();
  const evidence = join(root, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const out = join(root, 'export', 'bundle');
  mkdirSync(join(root, 'export'), { recursive: true });
  const doc = DOC(7);
  const r = runShow(scenario(evidence, [doc], [
    showCall(doc, figureDoc(evidence, { title: 'A world past the web store', seed: SEED, id: 'world', program: item().program, params: params() })),
    { call: 'export', doc, out, video: { codec: 'web' } },
  ], planted), 'the world exported to the web');
  presented(r[0], 'the figure with a 512 MiB world');
  return { reply: r[1]!, out };
}
const worldPiece = (): JsonObject => piece({ seed: SEED, items: { world: item() } });

describe(`${ID} the web export refuses a world the browser's store can't hold, and a browser that runs out parts from the app`, () => {
  it(`${ID} a piece with written_max 512 MiB and web_max 256 MiB is refused at web export, naming written_max`, () => {
    const { reply, out } = exported();
    expect(reply['outcome'], `the web export refuses the piece: ${show(reply, 3000)}`).toBe('refused');
    const refused = arr(reply['refused'], 'the export\'s refused').filter(isObject);
    expect(refused.some((r) => r['item'] === 'world' && r['field'] === 'written_max'), `a refused entry names the item world and written_max: ${show(refused as unknown as JsonObject[])}`).toBe(true);
    expect([existsSync(out), filesIn(dirname(out))], 'nothing is written: no bundle and nothing in its folder').toEqual([false, []]);
  }, TIMEOUT);

  it(`${ID} (planted web_export_checks_init_only) exports it, and the web player's store runs out at a step where the app plays on, failing the web comparison, naming the step`, async () => {
    const { reply } = exported('web_export_checks_init_only');
    expect(reply['outcome'], `the planted export, which checks only the init asset, exports the piece: ${show(reply, 3000)}`).toBe('exported');
    const [baked] = logic([bakeCall(worldPiece(), STEPS)]);
    const app = bakeOf(baked!, STEPS, 'the world in the app');
    expect(app.traps, 'the app plays on: no trap in 300 steps').toEqual([]);
    expect(arrayOf(app.steps[STEPS - 1]!, 'world.written', 'the app')[0], 'the app writes past 4,096 pages, under its 512 MiB').toBeGreaterThan(4097);
    const web = await webBake(worldPiece(), STEPS, 'the world in the web player');
    const k = firstStepDiff(web.steps, app.steps, 'world');
    expect(k, `the web comparison fails, naming step 259, where the web player's 256 MiB store runs out (web traps: ${show(web.traps as unknown as JsonObject[])})`).toBe(259);
    expect(app.steps[259]!.items['world']!.failed, 'the app plays on at step 259').toBe(false);
  }, TIMEOUT);
});
