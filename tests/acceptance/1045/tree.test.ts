// AC1 #1045.ccb3fe36: "The accessibility fixture figure (#376) in the web player in headless Chrome gives an
// accessibility tree that equals the app's as data, one node per part and control with the same names and roles; Tab
// reaches every control in the app's order; a changed readout updates the live region once; and a player with no tree,
// or one that announces every frame, fails this test, naming the node"
//
// The figure is helpers.ts `playedFigure`: #376's fixture figure, its readout `count` changing from 3 to 4 at 2 s of play.
//
// asserts:
//   - the app's side (`appTree`): the same document on the app's panel on the virtual clock, and #376's `see` at 3.5 s,
//     whose tree holds each part and control and whose one announcement is the readout `count` changing, at 2 s;
//   - the figure's bundle (#172's export, `video.codec: web`) is ready in headless Chrome with WebGPU (#172's harness);
//   - over seeks to 1 s and 1.5 s (the readout unchanged), 2.5 s (changed) and 3 s (unchanged), the page's polite live
//     region updates exactly once, from the changing seek on, holding the app's announcement (`liveFailures`);
//   - at 3 s, the page's accessibility tree (its elements marked `data-deep-id`, read through the browser's computed
//     tree) equals the app's node for node by id, role and name, in order, and the document's node carries the
//     document's description (`treeFailures`);
//   - real Tab presses give focus to every control of the app's tree, in the app's order (`tabFailures`);
//   - the planted `web_no_tree` fails this judgement, naming each part and control; the planted
//     `web_announces_every_frame` fails it, naming the readout `count`.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { FULL, TIMEOUT, done, exportOnce, none, play, useBrowsers, useFileTemp, useShow, useTemp, webReceiptOf } from '../172/helpers.ts';
import { failsNaming } from '../376/helpers.ts';
import { AC, READOUT, appTree, playedFigure, playerFailures, type AppTree } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const keep = useFileTemp();
const browsers = useBrowsers();

let app: AppTree | null = null;
/** The app's tree and announcement of the figure, made once for the file. */
const appSide = (): AppTree => (app ??= appTree(shows(FULL), keep()));

/** The figure exported to the web (`planted`: the scenario's wrong player), opened in headless Chrome until ready, and
 * judged against the app: AC1's failures, each naming its node. */
async function judged(planted?: string): Promise<string[]> {
  const want = appSide();
  const what = `the figure's player${planted ? ` (planted ${planted})` : ''}`;
  const out = join(temp(), 'bundle');
  const reply = exportOnce(shows(FULL), temp(), playedFigure(), out, `the figure's web export${planted ? ` (planted ${planted})` : ''}`, planted ? { planted } : {});
  webReceiptOf(reply, "the figure's web export");
  const page = browsers(await play(out));
  try {
    await page.tab.mustBeReady(what);
    return await playerFailures(page.tab, want, what);
  } finally {
    await done(page);
  }
}

describe(`${AC[1]} the accessibility fixture figure in the web player keeps the app's accessibility tree as DOM beside its canvas`, () => {
  it(`${AC[1]} in headless Chrome the figure's tree equals the app's as data, Tab reaches every control in the app's order, and the changed readout updates the live region once`, async () => {
    none(await judged(), 'the figure in the web player, against the app');
  }, TIMEOUT);

  it(`${AC[1]} wrong program: a player with no tree (web_no_tree) fails this test, naming each part and control`, async () => {
    const want = appSide();
    failsNaming(await judged('web_no_tree'), [...want.parts, ...want.controls].map((n) => n.id), 'the player with no tree');
  }, TIMEOUT);

  it(`${AC[1]} wrong program: a player that announces every frame (web_announces_every_frame) fails this test, naming the readout ${READOUT}`, async () => {
    failsNaming(await judged('web_announces_every_frame'), [READOUT], 'the player that announces every frame');
  }, TIMEOUT);
});
