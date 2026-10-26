// #380.32634ba0: a test plug-in draws a 3D scene of a box on the ground grid with glow and a shadow by
// describing it, matching that scene's golden, blessed by your decision, through the perceptual oracle; a
// part of its scene placed past the panel's edge is clipped there, and its call to open a GPU device is
// refused, naming the call; a planted host that lets the scene draw past the panel's bounds fails, naming
// the panel.
// fixtures/plugin/box-grid: the plug-in's panel script (main.js) and what it hands the canvas
// (documents.json): one scene document (a lamp box on a floor, a sun that casts, a red bar running past the
// right edge; no pixels, no shader) and one request on its writer connection, `gpu.request_device`. The
// `plugin` call (README) loads it as a plug-in in a 800 × 560 window, its panel at (80, 60) 480 × 384 with a
// 24 px header for the script's text and the canvas view below it, 480 × 360, under the plug-in's look: the
// suite's look with bloom, the ground grid and agx. Before your decision blesses the panel's drawing as the
// scene's golden, this test checks what it shows against the same document drawn by `view3d` with each
// effect taken out in turn (the lamp, the grid's lines, the glow's halo, the shadow), so the blessing isn't
// blind; then a fresh run's drawing matches the golden through the perceptual oracle, and the scene without
// its glow, its shadow or its grid doesn't. At the base `deep-gpu`'s plugin call takes no window, panel,
// look or capture, and has no golden or decide call.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOOM, GRID, arr, asSession, blessCall, bool, crop, diffs8, drawScene, expectNotBlank, fixture, goldenCall, goldenReply, isObject, look, luma, num, obj,
  project, readPng, run, run1, requireGpu, shown, str, strs, useBin, useOut, writePng, type Ids, type Image, type JsonObject, type Scene, type Startup, type V3,
} from './helpers.ts';

const bins = useBin();
const out = useOut();
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugin', 'box-grid');
const FIXTURE = fixture('plugin', 'box-grid', 'documents.json');
const DOC = obj(obj(arr(FIXTURE['documents'], 'the fixture\'s documents')[0], 'the fixture\'s document')['document'], 'the scene document');
const WINDOW: [number, number] = [800, 560];
const PAGE: [number, number, number] = [236, 240, 244];
const PANEL: [number, number, number, number] = [80, 60, 480, 384];
const HEADER = 24;
const CANVAS: [number, number, number, number] = [80, 84, 480, 360];
const SIZE: [number, number] = [480, 360];
const LOOK = look({ bloom: BLOOM, ground_3d: GRID, tone_map: 'agx' });
const GOLDEN = 'plugin-box-grid';
const CALL: JsonObject = { call: 'plugin', dir: DIR, look: LOOK, window: { size: WINDOW, page: PAGE }, panel: { rect: PANEL, header: HEADER }, capture: true };

interface Drawn { id: string; text: string[]; rect: number[]; canvas: number[]; documents: { outcome: string; errors: number }[]; requests: JsonObject[]; devices: number; window: Image; crop: Image }
function plugin(startup: Startup = {}): Drawn {
  const reply = run1(bins.bin(), out(), CALL, startup);
  const panel = obj(reply['panel'], 'plugin: panel');
  expect(bool(panel['loaded'], 'plugin: panel.loaded'), `the fixture's panel loaded as a plug-in panel: ${shown(panel)}`).toBe(true);
  const window = readPng(out(), str(reply['window'], 'plugin: window'), 'the window capture');
  expect([window.width, window.height], 'the capture is the whole window').toEqual(WINDOW);
  return {
    id: str(panel['id'], 'plugin: panel.id'), text: strs(panel['text'], 'plugin: panel.text'),
    rect: arr(panel['rect'], 'plugin: panel.rect').map((v) => num(v, 'a rect number')), canvas: arr(panel['canvas'], 'plugin: panel.canvas').map((v) => num(v, 'a rect number')),
    documents: arr(reply['documents'], 'plugin: documents').map((d, i) => {
      const o = obj(d, `plugin: documents[${i}]`);
      return { outcome: str(o['outcome'], `plugin: documents[${i}].outcome`), errors: arr(o['issues'] ?? [], 'issues').filter((x) => isObject(x) && x['severity'] === 'error').length };
    }),
    requests: arr(reply['requests'], 'plugin: requests').map((r, i) => obj(r, `plugin: requests[${i}]`)),
    devices: num(obj(reply['gpu'], 'plugin: gpu')['devices'], 'plugin: gpu.devices'), window, crop: crop(window, CANVAS),
  };
}

/** Outside the panel's rect the window is exactly the page; each problem names the panel. */
function clipProblems(window: Image, panelId: string): string[] {
  const [px, py, pw, ph] = PANEL;
  let off = 0; let first = '';
  for (let y = 0; y < window.height; y++) for (let x = 0; x < window.width; x++) {
    if (x >= px && x < px + pw && y >= py && y < py + ph) continue;
    const o = (y * window.width + x) * 4;
    if (window.rgba[o] !== PAGE[0] || window.rgba[o + 1] !== PAGE[1] || window.rgba[o + 2] !== PAGE[2]) { off++; if (!first) first = `(${x}, ${y}) holds ${window.rgba[o]},${window.rgba[o + 1]},${window.rgba[o + 2]}`; }
  }
  return off ? [`panel ${panelId}: ${off} window pixels outside its bounds [${PANEL.join(', ')}] are not the page (first ${first}): the scene drew past the panel's edge`] : [];
}
const red = (img: Image, x: number, y: number): boolean => { const o = (y * img.width + x) * 4; return img.rgba[o]! > 140 && img.rgba[o]! - Math.max(img.rgba[o + 1]!, img.rgba[o + 2]!) > 70; };

/** The plug-in's document drawn by view3d at the canvas's size, as is and with one effect taken out. */
function variants(): Record<'full' | 'noGlow' | 'noShadow' | 'noGrid', { final: Image; ids: Ids }> {
  const doc = asSession(DOC, 'plugin:test.box-grid');
  const noShadow = asSession(DOC, 'plugin:test.box-grid');
  obj(obj(obj(noShadow['items'], 'items')['sun'], 'the sun')['params'], 'the sun\'s params')['shadow'] = false;
  const scene = (d: JsonObject, l: JsonObject): Scene => ({ doc: { ...d, size: SIZE }, look: l, selection: [] });
  const draw = (s: Scene, name: string) => { const r = drawScene(bins.bin(), out(), s, name); return { final: r.final, ids: r.ids! }; };
  return {
    full: draw(scene(doc, LOOK), 'full'), noGlow: draw(scene(doc, { ...LOOK, bloom: 'none' }), 'no-glow'),
    noShadow: draw(scene(noShadow, LOOK), 'no-shadow'), noGrid: draw(scene(doc, { ...LOOK, ground_3d: { kind: 'none' } }), 'no-grid'),
  };
}
/** Chebyshev distance of every pixel to the nearest pixel of `id` in the ID target, capped at `cap`. */
function distanceTo(ids: Ids, id: string, cap: number): Uint16Array {
  const { width: w, height: h } = ids;
  const d = new Uint16Array(w * h).fill(cap);
  let frontier: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ids.at(x, y) === id) { d[y * w + x] = 0; frontier.push(y * w + x); }
  for (let k = 1; k < cap && frontier.length; k++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w; const y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (d[ny * w + nx]! > k) { d[ny * w + nx] = k; next.push(ny * w + nx); }
      }
    }
    frontier = next;
  }
  return d;
}
/** What the scene must show before it is blessed; each problem names the part missing. */
function sceneProblems(v: ReturnType<typeof variants>): string[] {
  const problems: string[] = [];
  const { full, noGlow, noShadow, noGrid } = v;
  const lamp = full.ids.count.get('lamp') ?? 0;
  if (lamp < 2000) problems.push(`the lamp box covers ${lamp} px, fewer than 2,000`);
  const floorPx: [number, number][] = [];
  let lampLuma = 0; let floorLuma = 0;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const id = full.ids.at(x, y);
    if (id === 'lamp') lampLuma += luma(full.final, x, y);
    if (id === 'floor') { floorPx.push([x, y]); floorLuma += luma(full.final, x, y); }
  }
  if (lamp && floorPx.length && !(lampLuma / lamp > floorLuma / floorPx.length + 0.1)) problems.push(`the lamp (mean luma ${(lampLuma / lamp).toFixed(3)}) isn't brighter than the floor (${(floorLuma / floorPx.length).toFixed(3)}) by 0.1`);
  // The grid: lines the grid adds to the floor, a share of it and not a fill.
  const lines = floorPx.filter(([x, y]) => luma(full.final, x, y) - luma(noGrid.final, x, y) >= 0.03).length;
  if (lines < 500 || lines > 0.5 * floorPx.length) problems.push(`the ground grid adds lines to ${lines} of ${floorPx.length} floor pixels, not between 500 and half of them`);
  // The glow: the floor in a ring 3 to 12 px around the lamp is brighter with bloom than without.
  const dist = distanceTo(full.ids, 'lamp', 64);
  let ringOn = 0; let ringOff = 0; let ring = 0;
  for (const [x, y] of floorPx) { const k = dist[y * SIZE[0] + x]!; if (k >= 3 && k <= 12) { ring++; ringOn += luma(full.final, x, y); ringOff += luma(noGlow.final, x, y); } }
  if (ring < 200 || !((ringOn - ringOff) / ring >= 0.02)) problems.push(`the glow: the floor ring around the lamp (${ring} px) is ${ring ? ((ringOn - ringOff) / ring).toFixed(4) : 'n/a'} brighter with bloom, not 0.02`);
  // The shadow: floor pixels at least 25% darker with the sun casting than without, near the lamp.
  const shaded = floorPx.filter(([x, y]) => { const off = luma(noShadow.final, x, y); return off > 0.05 && off - luma(full.final, x, y) >= 0.25 * off; });
  const nearLamp = shaded.filter(([x, y]) => dist[y * SIZE[0] + x]! < 64).length;
  if (shaded.length < 300) problems.push(`the shadow darkens ${shaded.length} floor pixels by 25%, fewer than 300`);
  else if (nearLamp < 0.8 * shaded.length) problems.push(`the shadow: only ${nearLamp} of its ${shaded.length} pixels lie within 64 px of the lamp that casts it`);
  // The part placed past the edge reaches the canvas's last column.
  const edge = Array.from({ length: SIZE[1] }, (_, y) => full.ids.at(SIZE[0] - 1, y)).filter((id) => id === 'spill').length;
  if (edge < 2) problems.push(`the bar placed past the edge has ${edge} px in the frame's last column`);
  return problems;
}
/** The panel's drawing is the GPU layer's own frame of the document at the canvas size: within 2 codes on 99.9% of pixels, none past 8. */
function sameDrawing(a: Image, b: Image, what: string): void {
  const d = diffs8(a, b);
  const off = d.filter((x) => x > 2).length;
  expect(off, `${what}: pixels more than 2 code values apart`).toBeLessThanOrEqual(Math.floor(0.001 * d.length));
  expect(d.reduce((m, x) => Math.max(m, x), 0), `${what}: the largest difference`).toBeLessThanOrEqual(8);
}

describe('#380.32634ba0 a test plug-in draws a 3D scene of a box on the ground grid with glow and a shadow by describing it, matching its golden blessed by your decision through the perceptual oracle; clipped at the panel\'s edge; its GPU-device call refused, naming it; a planted unclipped host fails, naming the panel', () => {
  it('#380.32634ba0 the plug-in\'s described scene draws in its panel, clipped at the panel\'s edge, and its call to open a GPU device is refused, naming the call', () => {
    requireGpu();
    // The fixture holds what the criterion asks: the bar starts inside the frame and runs past its right edge.
    const cam = { position: [3, 3.2, 5.5] as V3, target: [0, 0.4, 0] as V3, fov: 40, size: SIZE };
    const near = project(cam, [1.2, 0.15, -2.0]); const far = project(cam, [7.2, 0.15, -2.0]);
    expect(near[0] > 0 && near[0] < SIZE[0] && near[1] > 0 && near[1] < SIZE[1], `the bar's near end is inside the frame (${near.map((v) => v.toFixed(0)).join(', ')})`).toBe(true);
    expect(far[0], 'the bar\'s far end lies past the right edge').toBeGreaterThan(SIZE[0] + 100);
    const d = plugin();
    expect(d.rect, 'the panel sits where the call put it').toEqual(PANEL);
    expect(d.canvas, 'the canvas view fills the panel below its header').toEqual(CANVAS);
    expect(d.documents.map((x) => x.outcome), 'the plug-in\'s scene is presented').toEqual(['presented']);
    expect(d.documents[0]!.errors, 'with no error issue').toBe(0);
    // The device call: refused on the writer connection, naming it; from the panel's script there's no device.
    expect(d.requests.length, 'one reply per request the plug-in made').toBe(1);
    const req = d.requests[0]!;
    expect(req['call'], 'the reply is for the device call').toBe('gpu.request_device');
    expect(req['outcome'], `the call to open a GPU device is refused: ${shown(req)}`).toBe('refused');
    expect(`${req['reason'] ?? ''}`, 'the refusal names the call').toContain('gpu.request_device');
    const line = d.text.join(' ');
    expect(line, 'the panel\'s script ran to its end').toContain('probe:done');
    expect(line, 'the script\'s own try to reach a device failed').toContain('device-call:navigator.gpu.requestAdapter:failed');
    expect(d.devices, 'the app still has its one device').toBe(1);
    // Clipped at the panel's edge: drawn up to it, never past it.
    expectNotBlank(d.crop, 'the canvas view\'s drawing');
    expect(clipProblems(d.window, d.id), 'the window outside the panel').toEqual([]);
    const reds = Array.from({ length: SIZE[1] }, (_, y) => red(d.crop, SIZE[0] - 1, y)).filter(Boolean).length;
    expect(reds, 'the bar placed past the edge is drawn up to the canvas\'s last column').toBeGreaterThanOrEqual(2);
  }, 1_800_000);

  it('#380.32634ba0 the panel\'s drawing is the scene the plug-in described: the GPU layer\'s frame of its document, showing the lamp box, the ground grid\'s lines, the glow\'s halo and the box\'s shadow', () => {
    requireGpu();
    const v = variants();
    expect(sceneProblems(v), 'what the scene shows').toEqual([]);
    // The check's own twins: each variant fails it for the part it lacks.
    expect(sceneProblems({ ...v, full: v.noGlow }).join('\n'), 'the scene without its glow fails, named').toMatch(/the glow/);
    expect(sceneProblems({ ...v, full: v.noShadow }).join('\n'), 'the scene without its shadow fails, named').toMatch(/the shadow/);
    expect(sceneProblems({ ...v, full: v.noGrid }).join('\n'), 'the scene without its grid fails, named').toMatch(/ground grid/);
    sameDrawing(plugin().crop, v.full.final, 'the panel\'s drawing against the document drawn by view3d');
  }, 1_800_000);

  it('#380.32634ba0 the scene matches its golden, blessed by your decision, through the perceptual oracle: an agent\'s blessing is refused, a fresh run passes, the scene without its glow, shadow or grid fails, and a blank frame is BLOCKED', () => {
    requireGpu();
    const store = join(out(), 'goldens');
    const first = writePng(out(), 'first', plugin().crop);
    const v = variants();
    const [none, agent, still] = run(bins.bin(), out(), [goldenCall(store, GOLDEN, { png: first }), blessCall(store, GOLDEN, first, 'agent'), goldenCall(store, GOLDEN, { png: first })]);
    const g0 = goldenReply(none!, 'before any blessing');
    expect([g0.verdict, g0.reason], 'with no golden the scene is BLOCKED, no_golden').toEqual(['BLOCKED', 'no_golden']);
    expect(g0.ask?.['kind'], 'and asks you to bless one').toBe('bless');
    expect(agent!['outcome'], `an agent's blessing is refused: ${shown(agent)}`).toBe('refused');
    expect(agent!['code'], 'as not its decision').toBe('not_your_decision');
    expect(goldenReply(still!, 'after the agent\'s try').reason, 'so there is still no golden').toBe('no_golden');
    // Your decision, taken only once the scene shows what it describes.
    expect(sceneProblems(v), 'the scene shows what it describes before you bless it').toEqual([]);
    const [yours] = run(bins.bin(), out(), [blessCall(store, GOLDEN, first, 'you')]);
    expect(yours!['outcome'], `your blessing is decided: ${shown(yours)}`).toBe('decided');
    const second = writePng(out(), 'second', plugin().crop);
    const files = { noGlow: writePng(out(), 'no-glow', v.noGlow.final), noShadow: writePng(out(), 'no-shadow', v.noShadow.final), noGrid: writePng(out(), 'no-grid', v.noGrid.final) };
    const black = writePng(out(), 'black', { width: SIZE[0], height: SIZE[1], rgba: new Uint8Array(SIZE[0] * SIZE[1] * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) });
    const replies = run(bins.bin(), out(), [second, files.noGlow, files.noShadow, files.noGrid, black].map((png) => goldenCall(store, GOLDEN, { png })));
    const [fresh, noGlow, noShadow, noGrid, blank] = replies.map((r, i) => goldenReply(r, ['a fresh run', 'without glow', 'without shadow', 'without grid', 'a black frame'][i]!));
    expect(fresh!.verdict, `a fresh run's drawing matches the golden through the perceptual oracle: ${shown(fresh!.raw)}`).toBe('PASS');
    expect(fresh!.raw['oracle'], 'the comparison is the perceptual oracle\'s').toBe('perceptual');
    expect(fresh!.numbers, 'and reports its numbers').not.toBeNull();
    for (const [name, g] of [['glow', noGlow], ['shadow', noShadow], ['grid', noGrid]] as const) {
      expect(g!.verdict, `the scene without its ${name} fails the golden: ${shown(g!.raw)}`).toBe('FAIL');
      expect(g!.numbers, `with the oracle's numbers for the ${name}`).not.toBeNull();
    }
    expect(blank!.verdict, 'a black frame is BLOCKED by the blank guard, never compared').toBe('BLOCKED');
    expect(blank!.numbers, 'with no comparison numbers').toBeNull();
  }, 3_600_000);

  it('#380.32634ba0 a planted host that lets the scene draw past the panel\'s bounds (--planted host_unclipped) fails, naming the panel', () => {
    requireGpu();
    const d = plugin({ planted: 'host_unclipped' });
    const problems = clipProblems(d.window, d.id);
    expect(problems.length, 'the planted host draws past the panel\'s bounds and the check fails').toBe(1);
    expect(problems[0], 'the failure names the panel').toContain(`panel ${d.id}:`);
    expect(d.id, 'the panel is the plug-in\'s').toMatch(/test\.box-grid/);
  }, 1_800_000);
});
