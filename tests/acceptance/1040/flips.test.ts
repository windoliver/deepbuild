// AC2 #1040.082d5019: "A piece whose logic counts a toggle's flips, past the page's caps, with a tour that flips the
// toggle five times, exports to the web. With WebGPU the player runs it live, and a scripted input track of 100 flips
// reaches every count from 0 to 100 with logic full-state hashes equal to the app's; with WebGPU switched off the bundle
// opens a page of its tour, which plays its six states and five clips in the tour's order, each still decoding to the
// raw frame hash the app's export recorded, its receipt's fallback reads tour_only, and the player is never started;
// exported as a page alone, the same piece is refused, naming the logic item"
//
// The flip counter (helpers.ts `flipsDoc`): a toggle `lever` whose lamp fades over 0.5 s, the logic item `tally`
// counting its entries in `count`, a bar the count moves, and a tour that flips the lever five times.
// asserts:
//   - its web export, carrying the scripted track of 100 flips (one every 6 steps), reads `fallback: "tour_only"`; every
//     file the receipt names is in the bundle by hash; the receipt marks the fallback page, every file it names is
//     there by hash, and its manifest is the tour's chain: 6 states, each joined to the next by one edge on `lever` with
//     the tour's value (on, off, on, off, on) and a clip;
//   - each of the six states' stills, decoded, hashes (BLAKE3 of BGRA8) to the app's own still after that many flips (a
//     png_seq still on an input track of k flips, at 0 s for none, where the app's own tour hasn't begun; the fixture:
//     six stills apart);
//   - with WebGPU switched off in headless Chrome, the index page opens that page in its start state, the page plays its
//     six states in the tour's order with an edge (its clip) between each two, and the player never starts;
//   - with WebGPU on, the player is ready and a seek to 3 steps past each flip k reads `tally.count` k, for every k
//     from 0 to 100; played to its end, every checkpoint's full-state hash of `tally` is the app's (deep-show's `logic`);
//   - exported as a page alone (#169's), it is refused past the page's 64 states, naming `tally`, with nothing written
//     (that test is criterion 7's second half too).
// Wrong program: the merge base (its receipt reads page, its bundle holds no tour page, its page refusal names the
// logic module's carried state, not the item).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FLIPS, FLIP_STEP, FULL, TIMEOUT, appLogic, appStills, bundleFailures, checkpointFailures, closeBundle, exportPage, exportWeb, fallbackFailures,
  fallbackFileFailures, fallbackOf, fallbackStill, flipsDoc, flipsTrack, isObject, mentions, neverStartedFailures, none, needsReal, openBundle, scalar,
  scriptedFlips, show, tourChain, unwritten, useBrowsers, useShow, useTemp, webReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const STEPS = FLIPS.span * 60;

describe(`${AC[2]} the flip counter: live in the player with WebGPU, a page of its tour without, refused as a page alone`, () => {
  it(`${AC[2]} exported to the web it reads tour_only; with WebGPU off its bundle opens a page of its tour, which plays its six states and five clips in the tour's order, each still the app's; the player never starts`, async () => {
    const evidence = temp();
    const doc = flipsDoc(evidence);
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the flip counter exported to the web', { track: scriptedFlips() }), 'the flip counter exported to the web');
    expect(receipt.fallback, "past the page's caps, the receipt's fallback reads tour_only").toBe('tour_only');
    none(bundleFailures(out, receipt, "the flip counter's bundle"), 'the bundle holds every file its receipt names, each by its hash');
    const fb = fallbackOf(out, receipt, "the flip counter's bundle");
    none(fallbackFileFailures(out, receipt, fb, 'the tour page'), 'every file the tour page names is in the bundle, by its hash');
    const chain = tourChain(fb.manifest, 'the tour page');
    none(chain.failures, "the tour page holds the tour's chain of states");
    expect(chain.states.length, 'the tour page holds six states: the start and one per flip').toBe(FLIPS.tourFlips + 1);
    none(chain.edges.flatMap((e, i) => [
      ...(e.control === FLIPS.control && e.value === (i % 2 === 0) ? [] : [`edge ${e.id} sets ${e.control} to ${show(e.value)}, not the tour's flip ${i + 1}, lever = ${i % 2 === 0}`]),
      ...(e.clip === null ? [`edge ${e.id} (flip ${i + 1}) has no clip`] : []),
    ]), "the tour page's five edges are the tour's flips in its order, each with its clip");

    const app = appStills(shows(FULL), evidence, doc, chain.states.map((_, k) => ({ name: `${k} flips`, track: flipsTrack(k), range: { still: { t: k === 0 ? '0s' : '4s' } } })),
      { size: FLIPS.size, rate: FLIPS.rate }, temp(), 'the flip counter');
    expect(new Set(app.values()).size, 'the fixture: the app draws the six counts apart').toBe(chain.states.length);
    none(chain.states.flatMap((s, k) => {
      const got = fallbackStill(out, fb, s, `the tour page's state ${s.id}`);
      return got === app.get(`${k} flips`) ? [] : [`the tour page's state ${s.id}, after ${k} flips, shows ${got}, the app ${String(app.get(`${k} flips`))}`];
    }), "each of the tour page's stills decodes to the raw frame hash of the app's still after that many flips");

    const o = browsers(await openBundle(out, { webgpu: false }));
    none(await fallbackFailures(o, receipt, fb, 'WebGPU switched off', 'the flip counter'), 'with WebGPU off, the index page opens the tour page and never starts the player');
    const played = await o.tab.watch(chain.states[chain.states.length - 1]!.id, 120_000);
    expect(played.states, "the tour page plays its six states in the tour's order").toEqual(chain.states.map((s) => s.id));
    expect(played.edges, 'with a clip (an edge) between each two').toBe(FLIPS.tourFlips);
    none(await neverStartedFailures(o, receipt, 'WebGPU switched off', 'the flip counter, after its tour'), 'the player never started');
    await closeBundle(o);
  }, TIMEOUT);

  it(`${AC[2]} with WebGPU the player runs it live: a scripted track of 100 flips reaches every count from 0 to 100, with the logic item's full-state hashes equal to the app's`, async () => {
    const evidence = temp();
    const doc = flipsDoc(evidence);
    const app = appLogic(shows(FULL), evidence, doc, FLIPS.logic, scriptedFlips(), STEPS, 'the flip counter');
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the flip counter exported to the web', { track: scriptedFlips() }), 'the flip counter exported to the web');
    expect(receipt.fallback, "past the page's caps, the receipt's fallback reads tour_only").toBe('tour_only');
    const o = browsers(await openBundle(out, { webgpu: true }));
    const s = await o.tab.ready(120_000);
    if (!s.ready) await needsReal(o.tab, []);
    expect(s.ready, `with WebGPU, the player is ready within 120 s; notices ${JSON.stringify(s.notices)}, page errors ${JSON.stringify(o.tab.errors.slice(0, 3))}`).toBe(true);
    const failures: string[] = [];
    for (let k = 0; k <= FLIPS.scripted; k++) {
      const step = FLIP_STEP * k + 3;
      const p = await o.tab.seekStep(step);
      if (!p || p['step'] !== step) { failures.push(`a seek to step ${step} reads step ${show(p?.['step'] ?? null)}`); continue; }
      const count = scalar(isObject(p['values']) ? p['values'][`${FLIPS.logic}.count`] : undefined);
      if (count !== k) failures.push(`at step ${step}, after ${k} flips, probe() reads ${FLIPS.logic}.count ${show(isObject(p['values']) ? p['values'][`${FLIPS.logic}.count`] ?? null : null)}, not ${k}`);
    }
    none(failures, 'every count from 0 to 100 is reached');
    expect(await o.tab.playToEnd(), 'the player plays the scripted track to its end').toBe(true);
    const end = await o.tab.probe();
    expect(end, 'probe() answers at the end').not.toBeNull();
    none(checkpointFailures(end!, FLIPS.logic, app.checkpoints, 'played to its end'), `every checkpoint's full-state hash of ${FLIPS.logic} is the app's`);
    await closeBundle(o);
  }, TIMEOUT);

  it(`${AC[2]} ${AC[7]} the flip counter exported as a page alone is refused past the page's 64 states, naming the logic item ${FLIPS.logic}, and nothing is written`, () => {
    const evidence = temp();
    const out = join(temp(), 'page');
    const reply = exportPage(shows(FULL), evidence, flipsDoc(evidence), out, { size: FLIPS.size, rate: FLIPS.rate }, 'the flip counter as a page alone');
    unwritten(reply, out, 'the flip counter as a page alone');
    expect(reply['outcome'], `the page export refuses it: ${show(reply)}`).toBe('refused');
    expect(mentions(reply, FLIPS.logic), `the refusal names the logic item ${FLIPS.logic}: ${show(reply)}`).toBe(true);
    expect(mentions(reply, '64'), `the refusal is the page's cap of 64 states: ${show(reply)}`).toBe(true);
  }, TIMEOUT);
});
