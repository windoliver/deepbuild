// AC7 #1217.a0c92377: Shown to you: screenshots of a measure in the app and in the web player, taken by the check run
// at the reference window, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it
//
// The check run (README: The taste call). The fixture is the column seen from outside (README: Fixtures, outside
// view), its frame the reference window's 1512 × 982: the eye at (12, 9, 0) looking at (0, 2.5, 0), fov 40°. The
// measure runs from the top cap's centre (0, 5, 0) to the base ring's vertex (1.25, 0, 0), both snap targets held to
// the built mesh as criterion 1's are, so the tool shows its line down the column with its two points and its readout.
//
// The app: one `deep-show run` makes the measure and the replies must show it made (A and B on the column, a distance
// of √(5² + 1.25²) m, "5.15 m"); this reads no picture. Then `deep-show screen` (#1162) draws the app's window after
// the same calls at the reference window, 1512 × 982 points at 2×. The web player: the same document's bundle in
// headless Chrome with WebGPU, in a 1512 × 982 page at device scale 2; the setting is turned on, the same two clicks are
// made on the canvas, `probe().measure` must show the same measure made, and the browser captures the page. The two
// PNGs are written as they came, to docs/evidence/1217/measure-app.png and measure-web.png, and their SHA-256s are
// printed. Then tests/acceptance/1217/TASTE.json is read: none, or a call on other pictures, fails `INCONCLUSIVE:`,
// never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, COLUMN, MS, REFERENCE_SCALE, REFERENCE_WINDOW, REPO, TASTE_CRITERION, TIMEOUT, Script, at, builtOf, cameraDiffers, clickProblem, columnOutside, dist, fmt,
  inconclusive, measureIn, metres, notPresented, outsideClicks, play, pngSize, readoutText, requireMetal, runScreen, runShow, scenario, sha256, show, sleep,
  useBrowsers, useShow, useTemp, type JsonValue,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
const browsers = useBrowsers();
const BOUND = 1e-5;
const EVIDENCE = join(REPO, 'docs', 'evidence', '1217');
const TASTE = join(REPO, 'tests', 'acceptance', '1217', 'TASTE.json');
const NAMES = ['measure-app.png', 'measure-web.png'] as const;
/** The reference window in device pixels: 1512 × 982 points at 2×. */
const PIXELS = [REFERENCE_WINDOW[0] * REFERENCE_SCALE, REFERENCE_WINDOW[1] * REFERENCE_SCALE];

describe(`${AC[7]} the check run's pictures of a measure in the app and in the web player, and the one taste call on them`, () => {
  it(`${AC[7]} the check run makes a measure in the app and in the web player, takes both screenshots at the reference window, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, async () => {
    requireMetal();
    const f = columnOutside(7);
    const clicks = outsideClicks(f);
    const out = join(temp(), 'bundle');
    const shots = temp();
    const expected = metres(Math.hypot(COLUMN.height, COLUMN.radius));

    // The app's measure, checked by the replies.
    const s = new Script();
    const shown = s.present(f.id, f.document);
    const before = s.scope();
    const geometry = s.geometry(f.id, ['column']);
    const on = s.measure(true);
    s.click(clicks.top);
    const [, second] = s.click(clicks.foot);
    const prefix = s.calls.length;
    const exported = s.exportWeb(f.id, out);
    const sc = scenario(temp(), f.id, f.size, s.calls, { window: REFERENCE_WINDOW });
    const answer = runShow(bin(), sc, 'AC7 the check run\'s scenario');
    expect(answer.ok, `deep-show run takes the scenario: ${show(answer.raw, 2000)}`).toBe(true);
    const r = answer.replies;
    expect(notPresented(r[shown]), 'the column, a document that offers the measure tool (viewer_tools: {measure: true}), is presented at the reference window').toBe('');
    expect(cameraDiffers(r[before], f.cam), 'the panel shows the column through the fixture\'s camera').toBe('');
    const { built, problem } = builtOf(r[geometry], { column: [0, 0, 0] });
    expect(problem, 'the fixture: geometry gives the column\'s built mesh').toBe('');
    expect(clickProblem(f.cam, built, clicks.top, 'column', COLUMN.top), 'the fixture: the first click snaps to the top cap\'s centre and to nothing else').toBe('');
    expect(clickProblem(f.cam, built, clicks.foot, 'column', COLUMN.foot), 'the fixture: the second click snaps to the base ring\'s vertex and to nothing else').toBe('');
    expect(measureIn(r[on]).on, `the viewer's setting turns the tool on in the app: state.measure is ${show(at(r[on], 'state', 'measure'))}`).toBe(true);
    const app = measureIn(r[second]);
    expect([app.a?.item, app.b?.item], `the app's two clicks place A and B on the column: ${show(app.raw)}`).toEqual(['column', 'column']);
    expect(Math.max(dist(app.a!.point, COLUMN.top), dist(app.b!.point, COLUMN.foot)), `the app's measure runs from the top cap's centre to the base ring's vertex: A ${fmt(app.a!.point)}, B ${fmt(app.b!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(app.readout?.distance, `the app's picture shows a measure of ${expected}: ${readoutText(app.readout)}`).toBe(expected);
    expect(at(r[exported], 'outcome'), `the column's web bundle is exported: ${show(r[exported], 1500)}`).toBe('exported');

    // The app's window after the measure, at the reference window at 2×.
    const appPng = join(shots, 'app.png');
    const screenAt = Number(s.calls[prefix - 1]!['at']) + 300 * MS;
    const drawn = runScreen(bin(), { ...sc, calls: s.calls.slice(0, prefix) }, appPng, screenAt, REFERENCE_SCALE, 'AC7 the app\'s window');
    expect(drawn['ok'], `deep-show screen draws the app's window: ${show(drawn, 1500)}`).toBe(true);
    expect(existsSync(appPng), 'the app\'s screenshot is written').toBe(true);
    const appBytes = readFileSync(appPng);
    expect(pngSize(appBytes), 'the app\'s screenshot is the reference window at 2×').toEqual(PIXELS);

    // The web player's measure, checked by probe(), then the page as the browser draws it.
    const p = browsers(await play(out, REFERENCE_WINDOW, REFERENCE_SCALE));
    const state = await p.tab.ready();
    expect(state.ready, `the bundle's player (<deep-player>) is ready; it shows ${state.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(state.notices)}, page errors ${JSON.stringify(p.tab.errors.slice(0, 5))}`).toBe(true);
    const backend = at(await p.tab.probe(), 'backend');
    expect(String(backend), `the player draws on WebGPU: probe().backend is ${show(backend)}`).toMatch(/webgpu/i);
    const canvas = await p.tab.canvas(f.size);
    expect(canvas.problem, 'the player\'s canvas shows the whole frame, so a frame point has one place on it').toBe('');
    expect(await p.tab.setMeasure(true), 'the player has the member `measure`, and it reads true once it is set').toEqual({ member: true, reads: true });
    await p.tab.click(canvas.rect, f.size, clicks.top);
    const one = await p.tab.measureUntil((m) => m.a !== null);
    expect(one.a?.item, `in the player the first click places A on the column: probe().measure is ${show(one.raw)}`).toBe('column');
    await p.tab.click(canvas.rect, f.size, clicks.foot);
    const web = await p.tab.measureUntil((m) => m.b !== null && m.readout !== null);
    expect([web.a?.item, web.b?.item], `the player's two clicks place A and B on the column: ${show(web.raw)}`).toEqual(['column', 'column']);
    expect(web.readout?.distance, `the player's picture shows a measure of ${expected}: ${readoutText(web.readout)}`).toBe(expected);
    await sleep(1_000);
    const webBytes = await p.tab.screenshot();
    expect(pngSize(webBytes), 'the web player\'s screenshot is the reference window at 2×').toEqual(PIXELS);

    // The pictures, as they came, and their hashes.
    const files: Record<(typeof NAMES)[number], Buffer> = { 'measure-app.png': appBytes, 'measure-web.png': webBytes };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/1217/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: the check run's pictures (the app: ${readoutText(app.readout)}; the web player: ${readoutText(web.readout)}):\n${listed}`);

    // The one taste call.
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/1217/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(1217);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(TASTE_CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = call['screenshots'];
    expect(typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded), 'TASTE.json: screenshots, by name').toBe(true);
    const names = recorded as Record<string, JsonValue>;
    expect(Object.keys(names).sort(), 'TASTE.json: screenshots names the two pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => names[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(names[n])}, taken ${hashes[n]}`).join('; ')}`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[7]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
