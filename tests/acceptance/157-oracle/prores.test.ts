// AC8 #157.760918c9: "A ProRes 4444 export's probe decodes in the decode worker as limited-range color within ±2 code
// values, with its alpha at full range, and a planted ProRes encode fed full-range values fails the probe"
// AC10 #157.b9317df5: "FFmpeg's own FATE ProRes 4444 samples with alpha decode in the decode worker as limited-range
// color with full-range alpha, the samples fetched on first use and never committed"
//
// Upstream: FATE's prores.mak recipes `fate-prores-alpha`, `fate-prores-transparency` (framecrc of each sample decoded to
// yuva444p12le) and `fate-prores-probe` (ffprobe -show_frames, whose reference reads color_range=tv for ProRes), at
// FFmpeg 24e860f6d3, with their reference outputs vendored in fixtures/fate/. Run on our output (#136): AC8 runs the
// probe recipe and the alpha recipe's decode on our own ProRes 4444 delivery, and AC10 runs the decode worker
// (`media_import`, `media_decode` with `format: "bgra"`) on FATE's samples, held to FFmpeg's decode, which is first
// shown to be FATE's by its framecrc against the reference. Colour is compared where alpha is whole (255), so straight
// or premultiplied output reads the same there; alpha everywhere. Planted: `prores_fed_full_range`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, FATE, FULL, PRORES_PCM, REPO, TIMEOUT, decodedOf, exportCall, failsNaming, fateCache, fetchFate, ffmpegOut, ffprobeJson, filmDoc, filmRun, frameLines,
  getEvidence, hexes, inconclusive, isObject, issueLines, issuesOf, mediaDecode, mediaImport, none, obj, perFrame, probeRanges, receiptOf, rect,
  refField, refText, runShow, scenario, show, useShow, useTemp, yuva12ToBgra, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const W = 160; const H = 90;
/** Two halves over nothing: ramp_lo opaque on the left, ramp_hi at 50% on the right, and an accent block sliding over the
 * left so every frame differs. */
const alphaFilm = (evidence: string): JsonObject => filmDoc(evidence, {
  frames: 24, plain: true,
  items: [
    rect('opaque', [0, 0, 80, H], 'ramp_lo', 1),
    { ...rect('half', [80, 0, 80, H], 'ramp_hi', 2), adjust: { opacity: 0.5 } },
    rect('slider', [0, 60, 10, 10], 'accent', 3),
  ],
  channels: { slide: perFrame('items/slider/params/box/0', [24, 1], Array.from({ length: 24 }, (_, k) => 2 * k)) },
});

/** AC8's judge. Delivered: the receipt's probe reads limited range with full-range alpha within ±2 code values; the
 * decode worker probes the MOV so and decodes frame 0 within ±2 of the raw frame (alpha within ±1); FATE's probe recipe
 * reads the reference's color_range on every frame; FATE's alpha recipe decodes alpha at full range and luma at
 * limited range. Each failure starts `export.color:`. */
function proresFailures(replies: JsonObject[], evidence: string, out: string, dir: string): string[] {
  const [exported, imported, decoded] = replies;
  if (exported!['outcome'] !== 'exported') {
    const c = issuesOf(exported!, 'export.color').map((i) => `export.color: ${JSON.stringify(i)}`);
    return c.length ? c : [`export.color: the export wasn't delivered and export.color names nothing: ${issueLines(exported!).join(' | ').slice(0, 800)}`];
  }
  const f: string[] = [];
  const r = receiptOf(exported!, 'the ProRes 4444 export');
  const probe = r.raw['color_probe'];
  if (!isObject(probe) || !isObject(probe['tags']) || probe['tags']['range'] !== 'tv' || probe['tags']['alpha'] !== 'full') f.push(`export.color: the receipt's probe reads ${show(probe ?? null)}, not tags {range: tv, alpha: full}`);
  else if (typeof probe['max_error'] !== 'number' || probe['max_error'] > 2) f.push(`export.color: the probe decodes ${show(probe['max_error'] ?? null)} code values off, not within ±2`);
  const ranges = probeRanges(imported!, 'the decode worker\'s probe of the MOV');
  if (ranges.range !== 'limited' || ranges.alpha !== 'full') f.push(`export.color: the decode worker probes colour ${ranges.range} and alpha ${String(ranges.alpha)}, not limited and full`);
  const raw = hexes(obj(exported!['readback'], 'readback')['frames'], 'readback.frames').map((h, k) => getEvidence(evidence, h, `raw frame ${k}`));
  const frame = decodedOf(decoded!, join(dir, 'decoded'), 'the decode worker\'s decode of the MOV').video[0]?.frames[0];
  if (!frame) f.push('export.color: the decode worker decodes no frame of the MOV');
  else {
    const got = readFileSync(frame.file);
    let colour = 0; let alpha = 0;
    for (let i = 0; i < W * H; i++) {
      if (raw[0]![4 * i + 3] === 255) for (let c = 0; c < 3; c++) colour = Math.max(colour, Math.abs(got[4 * i + c]! - raw[0]![4 * i + c]!));
      alpha = Math.max(alpha, Math.abs(got[4 * i + 3]! - raw[0]![4 * i + 3]!));
    }
    if (colour > 2) f.push(`export.color: the decode worker decodes frame 0's opaque colour ${colour} code values from the raw frame, over ±2`);
    if (alpha > 1) f.push(`export.color: the decode worker decodes frame 0's alpha ${alpha} code values from the raw frame`);
  }
  // FATE's fate-prores-probe recipe on our file: every frame's color_range is the reference's.
  const want = refField('prores-probe', 'color_range');
  const frames = (ffprobeJson(['-show_frames', '-select_streams', 'v:0', '-show_entries', 'frame=color_range', out])['frames'] ?? []) as JsonObject[];
  const off = frames.findIndex((x) => x['color_range'] !== want);
  if (frames.length === 0 || off >= 0) f.push(`export.color: FFmpeg's probe reads frame ${off} as color_range ${String(frames[off]?.['color_range'])}, FATE's reference ${want}`);
  // FATE's fate-prores-alpha recipe's decode on our file: alpha codes at full range, luma at limited range.
  const planes = ffmpegOut(['-flags', '+bitexact', '-i', out, '-frames:v', '1', '-pix_fmt', 'yuva444p12le', '-f', 'rawvideo', '-']);
  let ay = 0; let aa = 0;
  for (let i = 0; i < W * H; i++) {
    const b = raw[0]!; const a = b[4 * i + 3]!;
    aa = Math.max(aa, Math.abs(planes.readUInt16LE(2 * (3 * W * H + i)) - (a * 4095) / 255));
    if (a === 255) ay = Math.max(ay, Math.abs(planes.readUInt16LE(2 * i) - (256 + 3504 * (0.2126 * b[4 * i + 2]! + 0.7152 * b[4 * i + 1]! + 0.0722 * b[4 * i]!) / 255)));
  }
  if (aa > 16) f.push(`export.color: FFmpeg decodes frame 0's alpha ${aa.toFixed(0)} 12-bit codes from full range (more than 1 of 255)`);
  if (ay > 32) f.push(`export.color: FFmpeg decodes frame 0's luma ${ay.toFixed(0)} 12-bit codes from limited range (more than 2 of 255)`);
  return f;
}
function proresRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'alpha.mov');
  const replies = filmRun(shows.bin(FULL), evidence, alphaFilm(evidence), [
    exportCall({ out, ...PRORES_PCM, readback: true }), mediaImport(out), mediaDecode(out, join(dir, 'decoded'), { format: 'bgra', video_frames: 1 }),
  ], 'the ProRes 4444 export', planted);
  return proresFailures(replies, evidence, out, dir);
}

describe(`${AC[8]} a ProRes 4444 delivery is limited-range colour with full-range alpha`, () => {
  it(`${AC[8]} the export's probe, the decode worker and FATE's probe and alpha recipes read limited-range colour within ±2 code values and full-range alpha`, () => {
    none(proresRun(), 'export.color on the ProRes 4444 export');
  }, TIMEOUT);

  it(`${AC[8]} a planted ProRes encode fed full-range values fails the probe`, () => {
    failsNaming(proresRun('prores_fed_full_range'), /^export\.color: /, 'the planted encode (prores_fed_full_range)');
  }, TIMEOUT);
});

let fetched: Awaited<ReturnType<typeof fetchFate>> = { paths: new Map(), problem: 'not fetched yet' };
beforeAll(async () => { fetched = await fetchFate(); }, 1_800_000);

describe(`${AC[10]} FFmpeg's FATE ProRes 4444 samples with alpha decode in the decode worker as limited-range colour with full-range alpha`, () => {
  it(`${AC[10]} each sample (fetched on first use, never committed) is probed limited with full-range alpha and decodes within ±2 code values of FATE's own decode, whose framecrc is FATE's reference`, () => {
    const tracked = execFileSync('git', ['ls-files', '--', relative(REPO, join(REPO, 'tests', 'acceptance', '157-oracle'))], { cwd: REPO, encoding: 'utf8' });
    expect(tracked.split('\n').filter((p) => /\.mov$/i.test(p)), 'no FATE sample is committed').toEqual([]);
    expect(relative(REPO, fateCache()).startsWith('..'), `the sample cache ${fateCache()} is outside the checkout`).toBe(true);
    if (fetched.problem) inconclusive(`the FATE samples are fetched on first use and one is unavailable: ${fetched.problem}. Unblock: run once with network access to ${FATE.suite}, or put the samples (paths as in fixtures/fate/samples.json) under ${fateCache()} or DEEP_FATE_SAMPLES`);
    const f: string[] = [];
    const dir = temp();
    const calls = FATE.samples.flatMap((s) => [mediaImport(fetched.paths.get(s.ref)!), mediaDecode(fetched.paths.get(s.ref)!, join(dir, s.ref), { format: 'bgra', video_frames: 1 })]);
    const replies = runShow(shows.bin(FULL), scenario(temp(), calls), 'the FATE ProRes 4444 samples');
    FATE.samples.forEach((s, n) => {
      const path = fetched.paths.get(s.ref)!;
      // FFmpeg's decode is FATE's: the recipe's framecrc equals the vendored reference.
      const crc = ffmpegOut(['-flags', '+bitexact', '-i', path, '-pix_fmt', 'yuva444p12le', '-vf', 'scale', '-flags', '+bitexact', '-fflags', '+bitexact', '-f', 'framecrc', '-']).toString('utf8');
      expect(frameLines(crc), `${s.ref}: FFmpeg's decode by FATE's recipe gives FATE's reference framecrc`).toEqual(frameLines(refText(s.ref)));
      const ranges = probeRanges(replies[2 * n]!, `${s.ref}: the decode worker's probe`);
      if (ranges.range !== 'limited') f.push(`${s.ref}: the decode worker probes its colour as ${ranges.range}, not limited`);
      if (ranges.alpha !== 'full') f.push(`${s.ref}: the decode worker probes its alpha as ${String(ranges.alpha)}, not full`);
      const v = decodedOf(replies[2 * n + 1]!, join(dir, s.ref), `${s.ref}: the decode worker's decode`).video[0];
      const frame = v?.frames[0];
      if (!v || !frame) { f.push(`${s.ref}: the decode worker decodes no frame`); return; }
      const [w, h] = v.size;
      const planes = ffmpegOut([...(w === 1920 && h === 1080 ? ['-apply_cropping', 'none'] : []), '-i', path, '-frames:v', '1', '-pix_fmt', 'yuva444p12le', '-f', 'rawvideo', '-']);
      if (planes.length !== w * h * 8) { f.push(`${s.ref}: the decode worker decodes ${w} × ${h}, which FFmpeg's decode isn't`); return; }
      const want = yuva12ToBgra(planes, w, h);
      const got = readFileSync(frame.file);
      let colour = 0; let alpha = 0;
      for (let i = 0; i < w * h; i++) {
        if (want[4 * i + 3] === 255) for (let c = 0; c < 3; c++) colour = Math.max(colour, Math.abs(got[4 * i + c]! - want[4 * i + c]!));
        alpha = Math.max(alpha, Math.abs(got[4 * i + 3]! - want[4 * i + 3]!));
      }
      if (colour > 2) f.push(`${s.ref}: the decode worker's opaque colour is ${colour} code values from FATE's decode read as BT.709 limited range, over ±2`);
      if (alpha > 1) f.push(`${s.ref}: the decode worker's alpha is ${alpha} code values from FATE's decode read at full range`);
    });
    none(f, 'the decode worker on FATE\'s ProRes 4444 samples');
  }, TIMEOUT);
});
