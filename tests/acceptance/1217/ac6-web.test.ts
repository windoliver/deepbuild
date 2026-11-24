// AC6 #1217.628255fc: In the web player, driven in headless Chrome with WebGPU, the same two clicks on the column read
// the same three numbers as the app.
//
// The fixture is criterion 1's (README: Fixtures, the column, inside view): the 5.000 m `lathe@1` column seen from
// inside on an 800 × 800 frame, and the same two clicks, 4.5 px off the projections of the bottom and the top caps'
// centres.
//
// The app's side, made again here in one `deep-show run`: the document shown, the tool turned on, the two clicks, and
// the readout (`state.measure`). It must have placed A and B on the column and read the issue's three numbers, so the
// comparison has something to hold the player to. The same run then exports the document's web bundle (#172's
// `video.codec: web`). The bundle is served over HTTP from a child process and opened in headless Chrome with WebGPU
// in an 800 × 800 page; once the player is ready and `probe()` names WebGPU as its backend, the viewer's setting is
// turned on (`<deep-player>.measure = true`) and the two clicks are real mouse presses and releases on the player's
// canvas, at the same frame points. `probe().measure` must then hold A and B on the column at the app's points
// within 1e-5 m, and its readout must be the app's distance, run and rise, text for text: 5.00 m, 0.00 m, 5.00 m.
//
// Wrong programs this fails on: the base (no tool in the app; a player that takes no input from the viewer); a player
// with no `measure`; a player that places another point (no snap, a ray through another pixel) or reads another
// number than the app.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, COLUMN, TIMEOUT, Script, at, cameraDiffers, columnInside, dist, fmt, insideClicks, measureIn, notPresented, play, readoutText, requireMetal, runShow, scenario,
  show, useBrowsers, useShow, useTemp,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
const browsers = useBrowsers();
const BOUND = 1e-5;

describe(`${AC[6]} the measure tool in the web player`, () => {
  it(`${AC[6]} in headless Chrome with WebGPU, the same two clicks on the column's caps read the app's distance, run and rise: 5.00 m, 0.00 m and 5.00 m`, async () => {
    requireMetal();
    const f = columnInside(6);
    const clicks = insideClicks(f);
    const out = join(temp(), 'bundle');

    // The app.
    const s = new Script();
    const shown = s.present(f.id, f.document);
    const before = s.scope();
    const on = s.measure(true);
    s.click(clicks.bottom);
    const [, second] = s.click(clicks.top);
    const exported = s.exportWeb(f.id, out);
    const answer = runShow(bin(), scenario(temp(), f.id, f.size, s.calls), 'AC6 the app\'s side');
    expect(answer.ok, `deep-show run takes the scenario: ${show(answer.raw, 2000)}`).toBe(true);
    const r = answer.replies;
    expect(notPresented(r[shown]), 'the column, a document that offers the measure tool (viewer_tools: {measure: true}), is presented').toBe('');
    expect(cameraDiffers(r[before], f.cam), 'the panel shows the column through the fixture\'s camera').toBe('');
    expect(measureIn(r[on]).on, `the viewer's setting turns the tool on in the app: state.measure is ${show(at(r[on], 'state', 'measure'))}`).toBe(true);
    const app = measureIn(r[second]);
    expect([app.a?.item, app.b?.item], `in the app the two clicks place A and B on the column: ${show(app.raw)}`).toEqual(['column', 'column']);
    expect([app.readout?.distance, app.readout?.run, app.readout?.rise], `the app reads the column's three numbers: ${readoutText(app.readout)}`).toEqual(['5.00 m', '0.00 m', '5.00 m']);
    expect(at(r[exported], 'outcome'), `the column's web bundle is exported: ${show(r[exported], 1500)}`).toBe('exported');

    // The player.
    const p = browsers(await play(out, f.size));
    const state = await p.tab.ready();
    expect(state.ready, `the bundle's player (<deep-player>) is ready; it shows ${state.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(state.notices)}, page errors ${JSON.stringify(p.tab.errors.slice(0, 5))}`).toBe(true);
    const backend = at(await p.tab.probe(), 'backend');
    expect(String(backend), `the player draws on WebGPU: probe().backend is ${show(backend)}`).toMatch(/webgpu/i);
    const canvas = await p.tab.canvas(f.size);
    expect(canvas.problem, 'the player\'s canvas shows the whole frame, so a frame point has one place on it').toBe('');

    expect(await p.tab.setMeasure(true), 'the player has the member `measure`, and it reads true once it is set').toEqual({ member: true, reads: true });
    const turned = await p.tab.measureUntil((m) => m.on === true, 10_000);
    expect(turned.on, `the viewer's setting turns the tool on in the player: probe().measure is ${show(turned.raw)}`).toBe(true);

    await p.tab.click(canvas.rect, f.size, clicks.bottom);
    const one = await p.tab.measureUntil((m) => m.a !== null);
    expect(one.a?.item, `in the player the first click places A on the column: probe().measure is ${show(one.raw)}`).toBe('column');
    expect(dist(one.a!.point, app.a!.point), `the player's A is the app's ${fmt(app.a!.point)} within ${BOUND} m: got ${fmt(one.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(dist(one.a!.point, COLUMN.bottom), `the player's A is the bottom cap's centre: got ${fmt(one.a!.point)}`).toBeLessThanOrEqual(BOUND);

    await p.tab.click(canvas.rect, f.size, clicks.top);
    const two = await p.tab.measureUntil((m) => m.b !== null && m.readout !== null);
    expect(two.b?.item, `in the player the second click places B on the column: probe().measure is ${show(two.raw)}`).toBe('column');
    expect(dist(two.b!.point, app.b!.point), `the player's B is the app's ${fmt(app.b!.point)} within ${BOUND} m: got ${fmt(two.b!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(dist(two.b!.point, COLUMN.top), `the player's B is the top cap's centre: got ${fmt(two.b!.point)}`).toBeLessThanOrEqual(BOUND);
    console.log(`${AC[6]}: the app: ${readoutText(app.readout)}; the web player (${String(backend)}): ${readoutText(two.readout)}`);
    expect([two.readout?.distance, two.readout?.run, two.readout?.rise], `the web player reads the same three numbers as the app (${readoutText(app.readout)}): ${readoutText(two.readout)}`)
      .toEqual([app.readout!.distance, app.readout!.run, app.readout!.rise]);
    expect([two.readout?.distance, two.readout?.run, two.readout?.rise], `the web player reads distance 5.00 m, run 0.00 m and rise 5.00 m: ${readoutText(two.readout)}`).toEqual(['5.00 m', '0.00 m', '5.00 m']);
  }, TIMEOUT);
});
