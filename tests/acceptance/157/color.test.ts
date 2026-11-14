// AC3 #157.aad32dbe: "An H.264 export's tags read nclx 1-1-1 and range tv, its probe decodes within ±2 code values, and a
// planted full-range encode tagged BT.601 fails"
// AC13 #157.89f63701: "A ProRes 4444 export of a color ramp at 50% alpha with straight alpha, decoded the same way through
// its own tags, meets the floor on luma and on alpha in every frame; a planted encode that premultiplies the color while
// declaring straight alpha, and an H.264 delivery that holds full-range values under limited-range tags, each fail
// export.fidelity, naming the first frame"
//
// Through `deep-show run`'s `export`. AC3's film is the 2 s fixture film (160 × 90, 24 fps) as H.264 with AAC; its tags
// are read three ways: the receipt's `color_probe` (export.color's own reading, with the probe's `max_error`), this
// suite's reader of the MP4's `colr` box, and FFmpeg's probe of the stream. AC13's film: 160 × 90 at 24 fps for 1 s
// with no ground, a full-frame ramp from `ramp_lo` to `ramp_hi` at `adjust.opacity: 0.5` and an opaque block sliding
// over it; exported as ProRes 4444 with straight alpha, with `readback: true`, its receipt's `fidelity` is read and the
// MOV is decoded again here by FFmpeg through its own tags and compared with the raw frames, luma and alpha, frame by
// frame. Planted: `encode_full_range_bt601`, `prores_premultiplies_straight`, `h264_full_range_under_limited_tags`.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, FULL, H264_AAC, H264_PCM, PRORES_PCM, TIMEOUT, bytesOf, exportCall, failsNaming, ffmpegOut, ffprobeJson, fidelityOf, filmDoc, filmRun, framesNamed,
  getEvidence, hexes, isObject, issueLines, issuesOf, meetsFloor, none, obj, order, perFrame, readMovie, receiptOf, rect, show, trackOf, useShow, useTemp,
  type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** AC3's judge: delivered, with the receipt's probe reading nclx 1-1-1 and range tv within ±2 code values, and the
 * MP4's colr box and FFmpeg's probe reading the same tags. Each failure starts `export.color:`. */
function colorFailures(reply: JsonObject, out: string): string[] {
  if (reply['outcome'] !== 'exported') {
    const named = issuesOf(reply, 'export.color').map((i) => `export.color: ${JSON.stringify(i)}`);
    return named.length ? named : [`export.color: the export wasn't delivered and export.color names nothing: ${issueLines(reply).join(' | ').slice(0, 800)}`];
  }
  const f: string[] = [];
  const probe = receiptOf(reply, 'the H.264 export').raw['color_probe'];
  if (!isObject(probe)) f.push(`export.color: the receipt has no color_probe: ${show(probe ?? null)}`);
  else {
    const tags = probe['tags'];
    if (!isObject(tags) || JSON.stringify(tags['nclx']) !== '[1,1,1]' || tags['range'] !== 'tv') f.push(`export.color: the receipt's probe reads tags ${show(tags ?? null)}, not nclx [1, 1, 1] and range tv`);
    const err = probe['max_error'];
    if (typeof err !== 'number' || !(err <= 2)) f.push(`export.color: the probe decodes ${show(err ?? null)} code values from the 75% bars and the grey ramp, not within ±2`);
  }
  const colr = trackOf(readMovie(bytesOf(out), 'the MP4'), 'vide', 'the MP4').colr;
  if (!colr || colr.kind !== 'nclx' || colr.primaries !== 1 || colr.transfer !== 1 || colr.matrix !== 1 || colr.fullRange !== false) f.push(`export.color: the MP4's colr box reads ${show(colr as unknown as JsonObject ?? null)}, not nclx 1-1-1 with full_range_flag 0`);
  const s = obj((ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream=color_primaries,color_transfer,color_space,color_range', out])['streams'] as JsonObject[])[0], 'ffprobe: the video stream');
  const ff = ['color_primaries', 'color_transfer', 'color_space', 'color_range'].map((k) => String(s[k]));
  if (ff.join() !== 'bt709,bt709,bt709,tv') f.push(`export.color: FFmpeg reads primaries, transfer, matrix and range ${ff.join(', ')}, not bt709, bt709, bt709, tv`);
  return f;
}

describe(`${AC[3]} an H.264 export is tagged BT.709 limited range and its probe decodes true`, () => {
  it(`${AC[3]} the export's tags read nclx 1-1-1 and range tv (its receipt, its colr box and FFmpeg) and its probe decodes within ±2 code values`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'film.mp4');
    const [reply] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }), [exportCall({ out, ...H264_AAC })], 'the H.264 export');
    none(colorFailures(reply!, out), 'export.color on the H.264 export');
  }, TIMEOUT);

  it(`${AC[3]} a planted full-range encode tagged BT.601 fails export.color`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'film.mp4');
    const [reply] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }), [exportCall({ out, ...H264_AAC })], 'the H.264 export', 'encode_full_range_bt601');
    failsNaming(colorFailures(reply!, out), /^export\.color: /, 'the planted encode (encode_full_range_bt601)');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC13

const W = 160; const H = 90; const FRAMES = 24;
/** The ramp at 50% alpha over nothing, and an opaque block sliding 4 px a frame over it. */
const rampFilm = (evidence: string): JsonObject => filmDoc(evidence, {
  frames: FRAMES, plain: true,
  items: [
    { id: 'ramp', kind: 'rect@1', name: 'Rect ramp', order: order(1), params: { box: [0, 0, W, H], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp_lo' }, { at: 1, role: 'ramp_hi' }] } } } }, adjust: { opacity: 0.5 } },
    rect('slider', [0, 30, 16, 16], 'accent', 2),
  ],
  channels: { slide: perFrame('items/slider/params/box/0', [24, 1], Array.from({ length: FRAMES }, (_, k) => 4 * k)) },
});
const psnr = (sq: number, n: number): number => (sq === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / sq));
const lumaRgb = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * AC13's judge, for a delivery at `out` of `kind`: delivered; the receipt's fidelity meets its floor on luma, and on
 * alpha for ProRes; and this suite's own reading, FFmpeg's decode of the file through its own tags as straight RGBA,
 * against each raw frame read back: luma (and alpha) PSNR at or over the floor in every frame. Each failure starts
 * `export.fidelity: frame <k>` (or `export.fidelity:` when no frame is known).
 */
function rampFailures(reply: JsonObject, evidence: string, out: string, kind: 'prores' | 'h264'): string[] {
  if (reply['outcome'] !== 'exported') {
    const issues = issuesOf(reply, 'export.fidelity');
    if (!issues.length) return [`export.fidelity: the export wasn't delivered and export.fidelity names nothing: ${issueLines(reply).join(' | ').slice(0, 800)}`];
    return issues.map((i) => `export.fidelity: frame ${Math.min(...framesNamed(i))}: ${JSON.stringify(i)}`);
  }
  const r = receiptOf(reply, 'the ramp export');
  const fid = fidelityOf(r.raw, 'the ramp export');
  const f: string[] = [];
  if (fid.frames !== FRAMES) f.push(`export.fidelity: the receipt's fidelity read ${fid.frames} frames, not ${FRAMES}`);
  if (!meetsFloor(fid.psnrY, fid.ssim, fid.floor)) f.push(`export.fidelity: frame ${fid.worst[0]?.frame ?? '?'}: the receipt's luma reading (PSNR-Y ${String(fid.psnrY)} dB, SSIM ${String(fid.ssim)}) is under the ${fid.floor} dB floor`);
  if (kind === 'prores' && (!fid.alpha || !meetsFloor(fid.alpha.psnr, fid.alpha.ssim, fid.floor))) f.push(`export.fidelity: the receipt's alpha reading ${show(fid.alpha as unknown as JsonObject ?? null)} is missing or under the ${fid.floor} dB floor`);
  const raw = hexes(obj(reply['readback'], 'the ramp export: readback')['frames'], 'readback.frames').map((h, k) => getEvidence(evidence, h, `raw frame ${k}`));
  const rgba = ffmpegOut(['-i', out, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const per = W * H * 4;
  const decoded = Math.floor(rgba.length / per);
  if (decoded !== raw.length) f.push(`export.fidelity: FFmpeg decodes ${decoded} frames, the export read back ${raw.length}`);
  for (let k = 0; k < Math.min(decoded, raw.length); k++) {
    let sy = 0; let sa = 0;
    for (let i = 0; i < W * H; i++) {
      const d = rgba.subarray(k * per + 4 * i, k * per + 4 * i + 4); const b = raw[k]!.subarray(4 * i, 4 * i + 4);
      const dy = lumaRgb(d[0]!, d[1]!, d[2]!) - lumaRgb(b[2]!, b[1]!, b[0]!); sy += dy * dy;
      const da = d[3]! - b[3]!; sa += da * da;
    }
    const py = psnr(sy, W * H); const pa = psnr(sa, W * H);
    if (py < fid.floor) f.push(`export.fidelity: frame ${k}: FFmpeg's decode through the file's tags reads luma ${py.toFixed(2)} dB from the raw frame, under the ${fid.floor} dB floor`);
    if (kind === 'prores' && pa < fid.floor) f.push(`export.fidelity: frame ${k}: FFmpeg's decode reads alpha ${pa.toFixed(2)} dB from the raw frame, under the ${fid.floor} dB floor`);
  }
  return f;
}
function rampRun(kind: 'prores' | 'h264', planted?: Planted): string[] {
  const evidence = temp(); const dir = temp();
  const out = join(dir, kind === 'prores' ? 'ramp.mov' : 'ramp.mp4');
  const [reply] = filmRun(shows.bin(FULL), evidence, rampFilm(evidence), [exportCall({ out, ...(kind === 'prores' ? PRORES_PCM : H264_PCM), readback: true })], `the ramp as ${kind}`, planted);
  return rampFailures(reply!, evidence, out, kind);
}

describe(`${AC[13]} a straight-alpha ProRes 4444 ramp is true to its frames on luma and alpha`, () => {
  it(`${AC[13]} the ramp at 50% alpha exported as ProRes 4444 with straight alpha meets the floor on luma and on alpha in every frame, by its receipt and by FFmpeg's decode through its own tags`, () => {
    none(rampRun('prores'), 'the ProRes 4444 ramp');
  }, TIMEOUT);

  it(`${AC[13]} a planted encode that premultiplies the colour while declaring straight alpha fails export.fidelity, naming the first frame`, () => {
    failsNaming(rampRun('prores', 'prores_premultiplies_straight'), /^export\.fidelity: frame 0\b/, 'the planted encode (prores_premultiplies_straight)');
  }, TIMEOUT);

  it(`${AC[13]} a planted H.264 delivery that holds full-range values under limited-range tags fails export.fidelity, naming the first frame`, () => {
    failsNaming(rampRun('h264', 'h264_full_range_under_limited_tags'), /^export\.fidelity: frame 0\b/, 'the planted delivery (h264_full_range_under_limited_tags)');
  }, TIMEOUT);
});
