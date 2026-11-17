// AC4 #1040.d641d88e: "A game piece past the page's caps, exported to the web and opened with WebGPU off, plays its tour
// page, whose receipt reads tour_only, and the player is never started; with WebGPU on, the player runs it live. The
// check that fails a tour page, a video or a still as live play, playtest.not_live, is #1046's and runs on this page"
//
// The game (helpers.ts `gameDoc`): a tapping game, the press `tap` read by the logic item `rules`, which counts the taps
// in `score`; a runner the score moves toward a line, and a win lamp from the third tap; its tour taps three times.
// asserts:
//   - its web export, carrying a recorded track of four taps, reads `fallback: "tour_only"`, the mark a check that
//     requires live play reads to fail it (README: Readings, the last sentence); the receipt marks the fallback page,
//     every file it names is in the bundle by hash, and its manifest is the tour's chain: 4 states, each joined to the
//     next by one edge on `tap`;
//   - opened in headless Chrome with WebGPU switched off, the index page opens that tour page in its start state, the
//     page plays its four states in the tour's order, and the player never starts;
//   - opened with WebGPU on, the player is ready, draws on WebGPU, plays the recorded track to `ended`, and its logic
//     item's step hash at the last step is the app's (deep-show's `logic` on the same track).
// The last sentence is not run here: playtest.not_live is #1046's check, which isn't built at the base and isn't this
// issue's to build (README: Readings).
// Wrong program: the merge base (its receipt reads page; its bundle holds no tour page; its index page starts the
// player whatever the browser has).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, GAME, TIMEOUT, appLogic, closeBundle, exportWeb, fallbackFailures, fallbackFileFailures, fallbackOf, gameDoc, gameTrack, isObject, liveFailures,
  neverStartedFailures, none, openBundle, show, tourChain, useBrowsers, useShow, useTemp, webReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const STEPS = GAME.span * 60;

describe(`${AC[4]} the game past the page's caps: its tour page with WebGPU off, live in the player with it on`, () => {
  it(`${AC[4]} the game exported to the web reads tour_only, plays its tour page with WebGPU off without starting the player, and runs live in the player with WebGPU on`, async () => {
    const evidence = temp();
    const doc = gameDoc(evidence);
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the game exported to the web', { track: gameTrack() }), 'the game exported to the web');
    expect(receipt.fallback, "past the page's caps, the game's receipt reads tour_only: no live play").toBe('tour_only');
    const fb = fallbackOf(out, receipt, "the game's bundle");
    none(fallbackFileFailures(out, receipt, fb, "the game's tour page"), 'every file the tour page names is in the bundle, by its hash');
    const chain = tourChain(fb.manifest, "the game's tour page");
    none(chain.failures, "the tour page holds the tour's chain of states");
    expect(chain.states.length, 'the tour page holds four states: the start and one per tap').toBe(GAME.tourTaps + 1);
    none(chain.edges.filter((e) => e.control !== GAME.control).map((e) => `edge ${e.id} sets ${e.control}, not the tour's ${GAME.control}`), "the tour page's edges are the tour's taps");

    const off = browsers(await openBundle(out, { webgpu: false }));
    none(await fallbackFailures(off, receipt, fb, 'WebGPU switched off', 'the game'), 'with WebGPU off, the index page opens the tour page and never starts the player');
    const played = await off.tab.watch(chain.states[chain.states.length - 1]!.id, 120_000);
    expect(played.states, "the tour page plays its states in the tour's order").toEqual(chain.states.map((s) => s.id));
    none(await neverStartedFailures(off, receipt, 'WebGPU switched off', 'the game, after its tour'), 'the player never started');
    await closeBundle(off);

    const app = appLogic(shows(FULL), evidence, doc, GAME.logic, gameTrack(), STEPS, 'the game');
    const on = browsers(await openBundle(out, { webgpu: true }));
    const live = await liveFailures(on, receipt, fb, null, 'the game with WebGPU on');
    const hash = live.end && isObject(live.end['step_hash']) ? live.end['step_hash'][GAME.logic] : null;
    if (live.end && hash !== app.hashes[STEPS - 1]) live.failures.push(`played to its end (step ${show(live.end['step'] ?? null)}), ${GAME.logic}'s step hash is ${show(hash ?? null)} in the player, ${app.hashes[STEPS - 1]!} in the app at step ${STEPS}`);
    none(live.failures, 'with WebGPU on, the player runs the game live, as the app runs it');
    await closeBundle(on);
  }, TIMEOUT);
});
