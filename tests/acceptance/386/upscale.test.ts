// #386.2434f61e: At internal scale 0.5, a frame of 12 px text and thin diagonal lines upscaled to 1080p scores at
// least 2 dB higher PSNR against the same frame drawn at scale 1 than a bilinear stretch does, seeking equals playing
// by pixel hash, and an export is byte-identical with the upscale on or off.
//
// The frame is `typeDoc` (helpers.ts): 48 labels of 12 px text and 24 diagonal lines 2 device px wide, at 1920 × 1080,
// drawn by #378's `view3d` through the GPU surface fields this suite adds (`surface: {internal_scale, upscale,
// sharpen}`, README). The export is #379's canonical render of a `live` session's revision, purpose `export`, with the
// session's surface at internal scale 0.5 and edge-adaptive upscale (on) and at internal scale 1 (off).
// Wrong programs: the base (view3d reads no `surface` and reports none; a live session draws at scale 1); `--planted
// bilinear_only` (the edge-adaptive upscale draws a bilinear stretch); `--planted upscale_reads_previous_frame` (the
// upscale reads the view's previous frame: "It can never … read a frame from outside the live view's window");
// `--planted exports_live_surface` (a canonical render takes the live session's internal scale and upscale).
import { describe, expect, it } from 'vitest';
import {
  HD, LIVE_WRITER, PLAIN_LOOK, UPSCALE_PASS, SHARPEN_PASS, answered, canonicalOf, frameAt, framesOf, liveCall, liveOf, liveSurfaceProblems, lumaOf, passesOf, payload, psnr,
  readPng, requireMetal, run, run1, slotHashOf, surfaceOf, surfaceProblems, typeDoc, useBuilds, useOut, view3dCall, writeJson,
  type Image, type JsonObject, type Live, type LiveCanonical, type Planted, type SurfaceSpec,
} from './helpers.ts';

const ID = '#386.2434f61e';
const FRAME = 30;
const SCALE_1: SurfaceSpec = { internal_scale: 1 };
const EDGE: SurfaceSpec = { internal_scale: 0.5, upscale: 'edge_adaptive', sharpen: 0.2 };
const BILINEAR: SurfaceSpec = { internal_scale: 0.5, upscale: 'bilinear', sharpen: 0 };
const GAP_DB = 2;

const builds = useBuilds(['default']);
const out = useOut();

/** The frame at FRAME drawn through `surface`, its PNG read back and held to its pixel hash. */
function drawn(reply: JsonObject, surface: SurfaceSpec, what: string): Image {
  answered(reply, what);
  expect(surfaceProblems(surfaceOf(reply, what), surface, HD, what), `${what} drew through the surface it was given`).toEqual([]);
  const f = frameAt(framesOf(reply, what), FRAME, what);
  const image = readPng(out(), f.final, `${what}: frame ${FRAME}'s final target`);
  expect([image.width, image.height], `${what}: the frame is 1080p`).toEqual(HD);
  expect(slotHashOf(image), `${what}: the PNG holds the slot's bytes`).toBe(f.pixel_hash);
  return image;
}
const call = (doc: string, surface: SurfaceSpec | null, from = FRAME): JsonObject =>
  view3dCall({ doc, look: PLAIN_LOOK, size: HD, from, frames: 1, capture: [from], targets: ['final'], ...(surface ? { surface } : {}) });

/** PSNR of the edge-adaptive and the bilinear frames against scale 1, and the criterion's 2 dB: failures as sentences. */
function psnrOf(bin: string, planted?: Planted): { edge: number; bilinear: number; problems: string[] } {
  const doc = writeJson(out(), 'type', typeDoc());
  const [r1, re, rb] = run(bin, out(), [call(doc, SCALE_1), call(doc, EDGE), call(doc, BILINEAR)], planted ? { planted } : {});
  const ref = drawn(r1!, SCALE_1, 'scale 1');
  const edge = drawn(re!, EDGE, 'internal scale 0.5, edge-adaptive');
  const bilinear = drawn(rb!, BILINEAR, 'internal scale 0.5, bilinear');
  const names = passesOf(re!, 'internal scale 0.5, edge-adaptive').map((p) => p.name);
  expect(names, 'the edge-adaptive view runs the upscale\'s two passes').toEqual(expect.arrayContaining([UPSCALE_PASS, SHARPEN_PASS]));
  expect(names.indexOf(UPSCALE_PASS), 'the upscale runs before the sharpen').toBeLessThan(names.indexOf(SHARPEN_PASS));
  const pe = psnr(ref, edge);
  const pb = psnr(ref, bilinear);
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: PSNR against scale 1: edge-adaptive ${pe.toFixed(3)} dB, bilinear ${pb.toFixed(3)} dB`);
  const problems: string[] = [];
  if (!(pe - pb >= GAP_DB)) problems.push(`the edge-adaptive upscale scores ${pe.toFixed(3)} dB against scale 1, only ${(pe - pb).toFixed(3)} dB above the bilinear stretch's ${pb.toFixed(3)} dB, not ${GAP_DB} dB`);
  return { edge: pe, bilinear: pb, problems };
}

/** A played run's frames 20 and 45 against seeks to them, by pixel hash: failures as sentences naming the frame. */
function seekProblems(bin: string, planted?: Planted): string[] {
  const doc = writeJson(out(), 'type', typeDoc());
  const play = view3dCall({ doc, look: PLAIN_LOOK, size: HD, from: 0, frames: 46, surface: EDGE });
  const seeks = [20, 45].map((n) => view3dCall({ doc, look: PLAIN_LOOK, size: HD, from: n, frames: 1, surface: EDGE }));
  const [p, s20, s45] = run(bin, out(), [play, ...seeks], planted ? { planted } : {});
  answered(p!, 'the played run');
  expect(surfaceProblems(surfaceOf(p!, 'the played run'), EDGE, HD, 'the played run'), 'the played run drew at internal scale 0.5 through the edge-adaptive upscale').toEqual([]);
  const played = framesOf(p!, 'the played run');
  expect(played.map((f) => f.frame), 'the played run drew frames 0 … 45').toEqual(Array.from({ length: 46 }, (_, i) => i));
  const problems: string[] = [];
  for (const [n, reply] of [[20, s20!], [45, s45!]] as const) {
    answered(reply, `the seek to frame ${n}`);
    expect(surfaceProblems(surfaceOf(reply, `the seek to ${n}`), EDGE, HD, `the seek to ${n}`), `the seek to ${n} drew through the same surface`).toEqual([]);
    const seek = frameAt(framesOf(reply, `the seek to ${n}`), n, `the seek to ${n}`);
    const at = frameAt(played, n, 'the played run');
    expect(at.pixel_hash, `frame ${n} played has a pixel hash`).toMatch(/^[0-9a-f]{64}$/);
    if (seek.pixel_hash !== at.pixel_hash) problems.push(`frame ${n}: seeking draws ${seek.pixel_hash}, playing drew ${at.pixel_hash}`);
  }
  expect(frameAt(played, 20, 'played').pixel_hash, 'the frame moves between 20 and 45 (the channels), so a seek is a seek').not.toBe(frameAt(played, 45, 'played').pixel_hash);
  return problems;
}

/** The export of the same revision with the live session's upscale on and off, and in a fresh process: failures as sentences. */
const ON: SurfaceSpec = EDGE;
const OFF: SurfaceSpec = SCALE_1;
function liveExport(bin: string, doc: string, surface: SurfaceSpec, planted?: Planted): Live {
  const reply = run1(bin, out(), liveCall({
    look: PLAIN_LOOK, frames: 3, fps: 60, report: ['hashes'],
    sessions: [{ session: 's', writer: LIVE_WRITER, doc, size: HD, surface }],
    events: [{ frame: 2, canonical: { session: 's', purpose: 'export', frame: FRAME + 1, size: HD } }],
  }), planted ? { planted } : {});
  const live = liveOf(reply, `the live session (internal scale ${surface.internal_scale})`);
  expect(liveSurfaceProblems(live, 's', surface), `the live session drew at internal scale ${surface.internal_scale}`).toEqual([]);
  expect(live.canonicals.length, 'one export frame').toBe(1);
  return live;
}
function exportProblems(on: LiveCanonical, off: LiveCanonical, fresh: LiveCanonical): string[] {
  const problems: string[] = [];
  for (const [name, c] of [['with the upscale on', on], ['with the upscale off', off], ['in a fresh process', fresh]] as const) {
    if (c.purpose !== 'export') problems.push(`export ${name}: purpose ${c.purpose}`);
    if (c.internal_scale !== 1 || c.upscale !== 'none') problems.push(`export ${name}: drawn at internal scale ${c.internal_scale}, upscaled by ${c.upscale}, not at scale 1 with none`);
    if (c.pixel_hash === null || !/^[0-9a-f]{64}$/.test(c.pixel_hash)) problems.push(`export ${name}: no pixel hash`);
  }
  if (on.pixel_hash !== off.pixel_hash) problems.push(`export: ${on.pixel_hash} with the upscale on, ${off.pixel_hash} with it off`);
  if (off.pixel_hash !== fresh.pixel_hash) problems.push(`export: ${off.pixel_hash} with the upscale off, ${fresh.pixel_hash} in a fresh process`);
  return problems;
}
function freshExport(bin: string, doc: string): LiveCanonical {
  return canonicalOf(run1(bin, out(), { call: 'canonical', look: PLAIN_LOOK, writer: LIVE_WRITER, doc, size: HD, frame: FRAME + 1, fps: 60, purpose: 'export' }), 'the fresh export');
}

describe(`${ID} the fixture`, () => {
  it(`${ID} the fixture tries: its frame at scale 1 is mostly ground with at least 10,000 ink pixels of text and lines, and it moves (holds at the base)`, () => {
    requireMetal();
    const doc = writeJson(out(), 'type', typeDoc());
    const [a, b] = run(builds.bin(), out(), [call(doc, null, 0), call(doc, null, FRAME)]);
    const f0 = frameAt(framesOf(answered(a!, 'frame 0'), 'frame 0'), 0, 'frame 0');
    const f30 = frameAt(framesOf(answered(b!, `frame ${FRAME}`), `frame ${FRAME}`), FRAME, `frame ${FRAME}`);
    const image = readPng(out(), f30.final, `frame ${FRAME}`);
    const luma = lumaOf(image);
    let ink = 0;
    for (const y of luma) if (y < 0.5) ink++;
    console.log(`${ID}: the fixture's frame ${FRAME} at scale 1 has ${ink} ink pixels of ${luma.length}`);
    expect(ink, 'the text and lines draw: at least 10,000 ink pixels').toBeGreaterThanOrEqual(10_000);
    expect(ink, 'and the frame is mostly ground: under 25% ink').toBeLessThan(0.25 * luma.length);
    expect(f0.pixel_hash, 'the frame moves between 0 and 30').not.toBe(f30.pixel_hash);
  }, 1_800_000);
});

describe(`${ID} at internal scale 0.5, the edge-adaptive upscale and sharpen beat a bilinear stretch by at least 2 dB of PSNR against scale 1`, () => {
  it(`${ID} the 1080p frame of 12 px text and thin diagonals: edge-adaptive at least 2 dB higher PSNR against scale 1 than bilinear`, () => {
    requireMetal();
    const { problems } = psnrOf(builds.bin());
    expect(problems, 'the edge-adaptive upscale scores at least 2 dB above the bilinear stretch').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted upscale that draws a bilinear stretch for edge-adaptive fails the 2 dB`, () => {
    requireMetal();
    const { problems } = psnrOf(builds.bin(), 'bilinear_only');
    expect(problems.length, '--planted bilinear_only fails the PSNR check').toBeGreaterThan(0);
    expect(problems[0], 'naming the gap').toMatch(/only -?[\d.]+ dB above the bilinear stretch/);
  }, 1_800_000);
});

describe(`${ID} at internal scale 0.5, seeking equals playing by pixel hash`, () => {
  it(`${ID} frames 20 and 45 seeked equal frames 20 and 45 played, by pixel hash, through the edge-adaptive upscale`, () => {
    requireMetal();
    expect(seekProblems(builds.bin()), 'seeking equals playing').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted upscale that reads the view's previous frame fails, naming the frame`, () => {
    requireMetal();
    const problems = seekProblems(builds.bin(), 'upscale_reads_previous_frame');
    expect(problems.length, '--planted upscale_reads_previous_frame makes a seek differ from play').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the frame').toMatch(/^frame (20|45): seeking draws/m);
  }, 1_800_000);
});

describe(`${ID} an export is byte-identical with the upscale on or off`, () => {
  it(`${ID} the export frame of one revision is the same bytes with the live session at internal scale 0.5 (edge-adaptive) and at scale 1, and in a fresh process, drawn at scale 1 with no upscale`, () => {
    requireMetal();
    const doc = writeJson(out(), 'type-payload', payload(typeDoc(), 'showpiece'));
    const on = liveExport(builds.bin(), doc, ON);
    const off = liveExport(builds.bin(), doc, OFF);
    expect(exportProblems(on.canonicals[0]!, off.canonicals[0]!, freshExport(builds.bin(), doc)), 'the export is byte-identical with the upscale on or off').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted canonical render that takes the live session's surface fails, naming the export`, () => {
    requireMetal();
    const doc = writeJson(out(), 'type-payload', payload(typeDoc(), 'showpiece'));
    const on = liveExport(builds.bin(), doc, ON, 'exports_live_surface');
    const off = liveExport(builds.bin(), doc, OFF);
    const problems = exportProblems(on.canonicals[0]!, off.canonicals[0]!, freshExport(builds.bin(), doc));
    expect(problems.length, '--planted exports_live_surface changes the export with the upscale on').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the export').toMatch(/^export/m);
  }, 1_800_000);
});
