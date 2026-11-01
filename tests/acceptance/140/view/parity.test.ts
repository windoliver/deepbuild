// Criterion 6 (#140.e2e712fe), parity/gpu/live-headless.scene: on the reference Mac, a settled live frame drawn
// at render scale 1 with no upscaling and a headless snapshot of the same document revision, view, size and t,
// taken with the app closed, agree on a 2D figure, a 3D scene with glow and shadows, and a film frame:
// evaluated data and the visible item table byte for byte, the GPU layer's pixels read back from its on-screen
// slot bit for bit, and each 2D writer layer drawn by GPUI against Vello CPU through the perceptual oracle
// (interior pixels, farther than 1.5 device px from every edge the layer draws, within one 8-bit code value on
// 99.9%; each glyph run's and stroke's summed coverage within 2% of Vello CPU's and its coverage centroid within
// 0.1 device px); a frame that reports settling is never compared, and a planted one-code shift in one GPU-layer
// pixel fails.
//
// The app is `deep-gpu run` (`live_frame`); the headless worker is a second process started after the first has
// exited, `deep-gpu run --headless` (`snapshot`), which opens no window (README: The live-headless calls). The
// oracle is this file's and helpers.ts's code, run on the files both sides write.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEEP_GPU, SCENE, SHA, answers, arr, colors, coverage, decodePng, firstDifference, inconclusive, interiorMask, interiorWithin, isBlank,
  isObject, num, obj, ok, referenceMacProblem, str, useBuilds, type Image, type JsonObject, type JsonValue, type Segment,
} from './helpers.ts';

const builds = useBuilds([DEEP_GPU]);
const made: string[] = [];
const folder = (): string => { const d = mkdtempSync(join(tmpdir(), 'deep-140-parity-')); made.push(d); return d; };
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** What each case must hold: whether it has a GPU layer, and the glyph runs and strokes its 2D layers draw. */
const CASES: { case: string; gpu: boolean; glyphs: string[]; strokes: string[] }[] = [
  { case: 'figure-2d', gpu: false, glyphs: ['caption', 'count'], strokes: ['rays'] },
  { case: 'scene3d-glow-shadows', gpu: true, glyphs: ['note'], strokes: ['rule'] },
  { case: 'film-frame', gpu: false, glyphs: ['title'], strokes: ['arc'] },
];

const file = (dir: string, hash: JsonValue | undefined, ext: string, what: string): Buffer => {
  const h = str(hash, what);
  expect(h, `${what} is a SHA-256`).toMatch(SHA);
  const path = join(dir, `${h}.${ext}`);
  expect(existsSync(path), `${what}: ${h}.${ext} is in the out folder`).toBe(true);
  return readFileSync(path);
};
const png = (dir: string, hash: JsonValue | undefined, what: string): Image => decodePng(file(dir, hash, 'png', what));

/** The app's settled live frame of a case, from its own process. */
function liveFrame(bin: string, c: string, args: string[] = []): { record: JsonObject; dir: string } {
  const dir = folder();
  const [answer] = answers(bin, ['run', ...args], [{ out: dir, calls: [{ call: 'live_frame', scene: SCENE, case: c }] }]);
  const reply = obj(arr(ok(answer!, 'deep-gpu run')['replies'], 'replies')[0], `${c}: the live_frame reply`);
  expect(reply['settled'], `${c}: the live frame settled: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
  return { record: obj(reply['record'], `${c}: the live record`), dir };
}
/** The headless worker's snapshot of a case, from a process started after the app's has exited. */
function snapshot(bin: string, c: string): { record: JsonObject; dir: string } {
  const dir = folder();
  const [answer] = answers(bin, ['run', '--headless'], [{ out: dir, calls: [{ call: 'snapshot', scene: SCENE, case: c }] }]);
  const reply = obj(arr(ok(answer!, 'deep-gpu run --headless')['replies'], 'replies')[0], `${c}: the snapshot reply`);
  return { record: obj(reply['record'], `${c}: the headless record`), dir };
}

/** Every way the live frame and the snapshot disagree, as sentences naming the case and what differs. */
function parityProblems(want: (typeof CASES)[number], live: { record: JsonObject; dir: string }, head: { record: JsonObject; dir: string }): string[] {
  const c = want.case;
  const p: string[] = [];
  const L = live.record; const H = head.record;
  if (L['settling'] !== false) p.push(`${c}: the live frame reports settling ${JSON.stringify(L['settling'])}; a settling frame is never compared`);
  if (L['scale'] !== 1) p.push(`${c}: the live frame was drawn at render scale ${JSON.stringify(L['scale'])}, not 1`);
  if (L['internal_scale'] !== 1) p.push(`${c}: the live frame's internal scale is ${JSON.stringify(L['internal_scale'])}, not 1`);
  if (L['upscale'] !== 'none') p.push(`${c}: the live frame was upscaled (${JSON.stringify(L['upscale'])})`);
  for (const k of ['doc', 'rev', 't', 'size', 'view']) {
    if (L[k] === undefined) p.push(`${c}: the live record has no ${k}`);
    else if (JSON.stringify(L[k]) !== JSON.stringify(H[k])) p.push(`${c}: ${k} is ${JSON.stringify(L[k])} live and ${JSON.stringify(H[k])} headless`);
  }
  const size = arr(L['size'], `${c}: size`).map((v) => num(v, 'size'));
  // Evaluated data and the visible item table, byte for byte.
  const ev = [file(live.dir, L['evaluated'], 'bin', `${c}: live evaluated`), file(head.dir, H['evaluated'], 'bin', `${c}: headless evaluated`)];
  if (ev[0]!.length === 0) p.push(`${c}: the evaluated data is empty`);
  if (!ev[0]!.equals(ev[1]!)) p.push(`${c}: the evaluated data differs (${ev[0]!.length} bytes live, ${ev[1]!.length} headless)`);
  const it = [file(live.dir, L['items'], 'json', `${c}: live items`), file(head.dir, H['items'], 'json', `${c}: headless items`)];
  if (!it[0]!.equals(it[1]!)) p.push(`${c}: the visible item table differs byte for byte`);
  const rows = JSON.parse(it[0]!.toString('utf8')) as JsonValue;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => isObject(r) && typeof r['id'] === 'string' && Array.isArray(r['box']))) {
    p.push(`${c}: the visible item table is not a non-empty list of {id, box}: ${it[0]!.toString('utf8').slice(0, 200)}`);
  }
  // The GPU layer, bit for bit.
  if (want.gpu) {
    if (L['gpu'] === null || L['gpu'] === undefined || H['gpu'] === null || H['gpu'] === undefined) p.push(`${c}: a side has no GPU layer read back (live ${JSON.stringify(L['gpu'])}, headless ${JSON.stringify(H['gpu'])})`);
    else {
      const a = png(live.dir, L['gpu'], `${c}: live GPU layer`); const b = png(head.dir, H['gpu'], `${c}: headless GPU layer`);
      if (a.width !== size[0] || a.height !== size[1]) p.push(`${c}: the GPU layer is ${a.width} × ${a.height}, not ${size.join(' × ')}`);
      if (isBlank(a)) p.push(`${c}: the live GPU layer is blank`);
      const d = firstDifference(a, b);
      if (d) p.push(`${c}: GPU layer pixel (${d.x}, ${d.y}) is ${JSON.stringify(d.a)} live and ${JSON.stringify(d.b)} headless`);
    }
  } else if ((L['gpu'] ?? null) !== null || (H['gpu'] ?? null) !== null) p.push(`${c}: a 2D document reports a GPU layer`);
  // Each 2D writer layer, GPUI against Vello CPU, through the oracle.
  const layers = (r: JsonObject, side: string) => new Map(arr(r['layers'], `${c}: ${side} layers`).map((v, i) => {
    const l = obj(v, `${c}: ${side} layers[${i}]`);
    return [str(l['layer'], `${c}: ${side} layers[${i}].layer`), l] as const;
  }));
  const ll = layers(L, 'live'); const hl = layers(H, 'headless');
  if (ll.size === 0) p.push(`${c}: no 2D writer layer was compared`);
  if (JSON.stringify([...ll.keys()].sort()) !== JSON.stringify([...hl.keys()].sort())) p.push(`${c}: layers ${JSON.stringify([...ll.keys()])} live and ${JSON.stringify([...hl.keys()])} headless`);
  const runsSeen = new Map<string, string>();
  for (const [name, a] of ll) {
    const b = hl.get(name);
    if (!b) continue;
    const ga = png(live.dir, a['png'], `${c}/${name}: GPUI layer`); const vb = png(head.dir, b['png'], `${c}/${name}: Vello CPU layer`);
    if (ga.width !== vb.width || ga.height !== vb.height) { p.push(`${c}/${name}: the layer is ${ga.width} × ${ga.height} by GPUI and ${vb.width} × ${vb.height} by Vello CPU`); continue; }
    if (colors(vb) < 2) p.push(`${c}/${name}: the Vello CPU layer draws nothing`);
    const edges = [a, b].flatMap((side, k) => JSON.parse(file(k ? head.dir : live.dir, side['edges'], 'json', `${c}/${name}: edges`).toString('utf8')) as Segment[]);
    if (edges.length === 0) p.push(`${c}/${name}: the layer lists no edges`);
    const reading = interiorWithin(ga, vb, interiorMask(ga.width, ga.height, edges, 1.5), 1);
    if (reading.interior === 0) p.push(`${c}/${name}: no interior pixel to compare`);
    else if (reading.share < 0.999) p.push(`${c}/${name}: ${(reading.share * 100).toFixed(3)}% of ${reading.interior} interior pixels within one code value, under 99.9%; worst at (${reading.worst?.x}, ${reading.worst?.y}), ${reading.worst?.diff} codes`);
    const runs = (l: JsonObject, side: string) => new Map(arr(l['runs'], `${c}/${name}: ${side} runs`).map((v, i) => {
      const r = obj(v, `${c}/${name}: ${side} runs[${i}]`);
      return [`${str(r['id'], 'run id')}:${str(r['kind'], 'run kind')}`, r] as const;
    }));
    const ra = runs(a, 'live'); const rb = runs(b, 'headless');
    for (const [k, x] of ra) {
      runsSeen.set(k, name);
      const y = rb.get(k);
      if (!y) { p.push(`${c}/${name}: ${k} is drawn by GPUI and not by Vello CPU`); continue; }
      const cg = coverage(png(live.dir, x['png'], `${c}/${name}/${k}: GPUI coverage`));
      const cv = coverage(png(head.dir, y['png'], `${c}/${name}/${k}: Vello CPU coverage`));
      if (!(cv.sum > 0)) { p.push(`${c}/${name}: ${k} covers nothing in Vello CPU`); continue; }
      if (Math.abs(cg.sum - cv.sum) > 0.02 * cv.sum) p.push(`${c}/${name}: ${k}'s summed coverage is ${cg.sum.toFixed(2)} by GPUI and ${cv.sum.toFixed(2)} by Vello CPU, more than 2% apart`);
      const off = Math.hypot(cg.cx - cv.cx, cg.cy - cv.cy);
      if (!(off <= 0.1)) p.push(`${c}/${name}: ${k}'s coverage centroid is (${cg.cx.toFixed(3)}, ${cg.cy.toFixed(3)}) by GPUI and (${cv.cx.toFixed(3)}, ${cv.cy.toFixed(3)}) by Vello CPU, ${off.toFixed(3)} px apart`);
    }
    for (const k of rb.keys()) if (!ra.has(k)) p.push(`${c}/${name}: ${k} is drawn by Vello CPU and not by GPUI`);
  }
  for (const id of want.glyphs) if (!runsSeen.has(`${id}:glyphs`)) p.push(`${c}: the glyph run of ${id} was not compared`);
  for (const id of want.strokes) if (!runsSeen.has(`${id}:stroke`)) p.push(`${c}: the stroke ${id} was not compared`);
  return p;
}

const SCENE_CASES = (): string[] => arr(obj(JSON.parse(readFileSync(SCENE, 'utf8')) as JsonValue, 'the scene')['cases'], 'cases').map((v) => str(obj(v, 'case')['case'], 'case'));

describe('#140.e2e712fe (C6) live against headless on the reference Mac (parity/gpu/live-headless.scene)', () => {
  // The scene file holds exactly these three cases (a fixture fact, read here so a case added there is not left untested).
  const listed = SCENE_CASES();
  if (JSON.stringify(listed) !== JSON.stringify(CASES.map((c) => c.case))) throw Error(`live-headless.scene lists ${JSON.stringify(listed)}`);

  for (const want of CASES) {
    it(`#140.e2e712fe (C6) ${want.case}: the settled live frame and the headless snapshot taken with the app closed agree, data byte for byte${want.gpu ? ', the GPU layer bit for bit' : ''}, each 2D writer layer through the perceptual oracle`, () => {
      const bin = builds.bin(DEEP_GPU);
      const why = referenceMacProblem();
      if (why) inconclusive(`the live-against-headless comparison counts on the reference Mac only (${why})`);
      const live = liveFrame(bin, want.case);
      const head = snapshot(bin, want.case);
      expect(parityProblems(want, live, head), `${want.case}: live against headless`).toEqual([]);
    }, 1_800_000);
  }

  it('#140.e2e712fe (C6) the planted one-code shift in one GPU-layer pixel (--planted shifts_gpu_pixel) fails, naming the pixel', () => {
    const bin = builds.bin(DEEP_GPU);
    const why = referenceMacProblem();
    if (why) inconclusive(`the live-against-headless comparison counts on the reference Mac only (${why})`);
    const want = CASES.find((c) => c.gpu)!;
    const live = liveFrame(bin, want.case, ['--planted', 'shifts_gpu_pixel']);
    const head = snapshot(bin, want.case);
    const problems = parityProblems(want, live, head);
    const pixel = problems.filter((s) => /GPU layer pixel \(\d+, \d+\)/.test(s));
    expect(pixel.length, `the shifted pixel fails the bit-for-bit comparison: ${JSON.stringify(problems)}`).toBe(1);
    const m = /is \[(\d+),(\d+),(\d+),(\d+)\] live and \[(\d+),(\d+),(\d+),(\d+)\] headless/.exec(pixel[0]!.replace(/ /g, ''));
    expect(m, `the failure gives both values: ${pixel[0]}`).not.toBeNull();
    const d = [1, 2, 3, 4].map((i) => Math.abs(Number(m![i]) - Number(m![i + 4])));
    expect(d.reduce((s, x) => s + x, 0), `one channel one code apart: ${pixel[0]}`).toBe(1);
  }, 1_800_000);

  it('#140.e2e712fe (C6) a frame that reports settling is never compared: with a pipeline held compiling, live_frame answers not settled and writes no record', () => {
    const bin = builds.bin(DEEP_GPU);
    const dir = folder();
    const [answer] = answers(bin, ['run'], [{ out: dir, calls: [{ call: 'live_frame', scene: SCENE, case: 'scene3d-glow-shadows', fault: { holds: 'fallback_pipeline', ms: 600_000 }, timeout_ms: 3000 }] }]);
    const reply = obj(arr(ok(answer!, 'deep-gpu run')['replies'], 'replies')[0], 'the live_frame reply');
    expect(reply['settled'], `the frame never settles: ${JSON.stringify(reply).slice(0, 400)}`).toBe(false);
    expect(typeof reply['reason'] === 'string' && (reply['reason'] as string).length > 0, 'it says why').toBe(true);
    expect(reply['record'] ?? null, 'no record of a settling frame').toBeNull();
    expect(readdirSync(dir).filter((f) => f.endsWith('.png') || f.endsWith('.bin')), 'nothing written to compare').toEqual([]);
  }, 600_000);
});
