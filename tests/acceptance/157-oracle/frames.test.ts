// AC12 #157.98831309: "A 60 s film at 24 fps with 48 kHz stereo and a moving bar, so every frame differs, exported as
// H.264 with AAC and decoded from the delivered file's own bytes in a fresh decode worker, holds exactly 1,440 frames,
// each at its own frame time and closest to its own raw frame, and exactly 2,880,000 sample frames per channel once the
// edit list removes the encoder's priming and end padding; planted deliveries that drop frame 700, that repeat frame 701
// in place of frame 702, and whose edit list keeps the end padding each fail export.fidelity, naming the frame or the
// sample count"
//
// Upstream, run on our output (#136): FATE's mov.mak edit-list recipes (framemd5: every frame listed with its pts, so a
// reader that drops, repeats or shifts a frame under an edit list fails) and gapless.mak's `gaplessenc` probe (stream
// start_pts and duration_ts: the reference `gaplessenc-pcm-to-mov-aac` reads start_pts 0 and the source's whole sample
// count, the priming skipped and the end padding discarded), read by FFmpeg from our delivery. The film: the 60 s
// fixture film (helpers.ts `filmDoc`, 160 × 90 at 24 fps, bars moving a pixel a frame, a 48 kHz stereo tone), exported
// as H.264 with AAC with `readback: true`. Read three ways: the receipt's `fidelity` (export.fidelity's own reading),
// the decode worker (`media_import`'s presentation times, `media_decode`'s samples), and FFmpeg (every frame's pts, the
// gaplessenc fields, the decoded samples, and each frame's luma against the raw frames read back, for "closest to its
// own raw frame"). Planted: `writer_drops_frame_700`, `writer_repeats_frame_701`, `muxer_keeps_end_padding`.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, FULL, H264_AAC, TIMEOUT, assetOf, decodedOf, exportCall, failsNaming, ffAudioStream, ffLuma, ffPcm, ffVideoFrames, fidelityOf, filmDoc, filmRun,
  framesNamed, getEvidence, hexes, isObject, issueLines, lumaOf, mediaDecode, mediaImport, mse, none, obj, rat, ratEq, receiptOf, refField, showRat,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const FRAMES = 1440; const SAMPLES = 2_880_000;

/** The judge. Each failure starts `export.fidelity: frame <k>` or `export.fidelity: samples: <n> sample frames per
 * channel, not 2880000`. */
function frameFailures(replies: JsonObject[], evidence: string, out: string, dir: string): string[] {
  const [exported, imported, decoded] = replies;
  if (exported!['outcome'] !== 'exported') {
    const issues = (Array.isArray(exported!['issues']) ? exported!['issues'] : []).filter(isObject);
    const f = issues.map((i) => {
      const s = i['samples'];
      if (isObject(s)) return `export.fidelity: samples: ${String(s['got'])} sample frames per channel, not ${String(s['expected'])}: ${JSON.stringify(i)}`;
      return framesNamed(i).length ? `export.fidelity: frame ${Math.min(...framesNamed(i))}: ${JSON.stringify(i)}` : `${String(i['check'] ?? i['code'])}: ${JSON.stringify(i)}`;
    });
    return f.length ? f : [`export.fidelity: the export wasn't delivered: ${issueLines(exported!).join(' | ').slice(0, 800)}`];
  }
  const f: string[] = [];
  const fid = fidelityOf(receiptOf(exported!, 'the 60 s delivery').raw, 'the 60 s delivery');
  if (fid.frames !== FRAMES) f.push(`export.fidelity: frame ${Math.min(fid.frames, FRAMES)}: the receipt's fidelity read ${fid.frames} frames, not ${FRAMES}`);
  if (fid.samples !== SAMPLES) f.push(`export.fidelity: samples: ${String(fid.samples)} sample frames per channel, not ${SAMPLES} (the receipt)`);
  // The decode worker.
  const v = assetOf(imported!, 'the decode worker\'s probe').streams.filter((s) => s.type === 'video')[0];
  const pts = (v?.pts ?? []).map((p, k) => rat(p, `frame ${k}`));
  if (pts.length !== FRAMES) f.push(`export.fidelity: frame ${Math.min(pts.length, FRAMES)}: the decode worker presents ${pts.length} frames, not ${FRAMES}`);
  const late = pts.findIndex((p, k) => !ratEq(p, { n: BigInt(k), d: 24n }));
  if (late >= 0) f.push(`export.fidelity: frame ${late}: the decode worker presents it at ${showRat(pts[late]!)} s, not ${late}/24 s`);
  const a = decodedOf(decoded!, join(dir, 'decoded'), 'the decode worker\'s decode').audio[0];
  if (a?.samples !== SAMPLES) f.push(`export.fidelity: samples: ${String(a?.samples)} sample frames per channel, not ${SAMPLES} (the decode worker)`);
  // FFmpeg: FATE's framemd5 reading (every frame at its pts) and gaplessenc probe.
  const ff = ffVideoFrames(out);
  if (ff.frames.length !== FRAMES) f.push(`export.fidelity: frame ${Math.min(ff.frames.length, FRAMES)}: FFmpeg presents ${ff.frames.length} frames, not ${FRAMES}`);
  const off = ff.frames.findIndex((x, k) => x.pts * ff.tb.n * 24n !== BigInt(k) * ff.tb.d);
  if (off >= 0) f.push(`export.fidelity: frame ${off}: FFmpeg presents it at ${ff.frames[off]!.pts} × ${ff.tb.n}/${ff.tb.d} s, not ${off}/24 s`);
  const s = ffAudioStream(out);
  const startWant = BigInt(refField('gaplessenc-pcm-to-mov-aac', 'start_pts'));
  if (s.startPts !== startWant) f.push(`export.fidelity: samples: FFmpeg reads the sound's start_pts as ${s.startPts}, FATE's gaplessenc reference ${startWant}`);
  if (s.durationTs !== BigInt(SAMPLES)) f.push(`export.fidelity: samples: ${String(s.durationTs)} sample frames per channel, not ${SAMPLES} (FFmpeg's duration_ts, as FATE's gaplessenc probe reads it)`);
  const n = ffPcm(out, s.channels)[0]!.length;
  if (n !== SAMPLES) f.push(`export.fidelity: samples: ${n} sample frames per channel, not ${SAMPLES} (FFmpeg's decode)`);
  // Each decoded frame closest to its own raw frame, by luma, against its neighbours.
  const raw = hexes(obj(exported!['readback'], 'readback')['frames'], 'readback.frames').map((h, k) => lumaOf(getEvidence(evidence, h, `raw frame ${k}`)));
  const dec = ffLuma(out, 160, 90);
  for (let k = 0; k < Math.min(dec.length, raw.length); k++) {
    const own = mse(dec[k]!, raw[k]!);
    for (const j of [k - 1, k + 1]) if (j >= 0 && j < raw.length && mse(dec[k]!, raw[j]!) <= own) { f.push(`export.fidelity: frame ${k}: FFmpeg's frame ${k} is as close to raw frame ${j} (${mse(dec[k]!, raw[j]!).toFixed(2)}) as to its own (${own.toFixed(2)})`); break; }
    if (f.length > 12) break;
  }
  return f;
}
function frameRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'film.mp4');
  const replies = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: FRAMES }), [
    exportCall({ out, ...H264_AAC, readback: true }), mediaImport(out), mediaDecode(out, join(dir, 'decoded'), { video_frames: 0 }),
  ], 'the 60 s fixture film', planted);
  return frameFailures(replies, evidence, out, dir);
}

describe(`${AC[12]} a delivery holds exactly its frames, each at its time and closest to its raw frame, and exactly its samples`, () => {
  it(`${AC[12]} the 60 s film as H.264 with AAC holds 1,440 frames, each at k/24 s and closest to its own raw frame, and 2,880,000 sample frames per channel, by its receipt, the decode worker and FFmpeg`, () => {
    none(frameRun(), 'the 60 s delivery');
  }, TIMEOUT);

  it(`${AC[12]} a planted delivery that drops frame 700 fails export.fidelity, naming frame 700`, () => {
    failsNaming(frameRun('writer_drops_frame_700'), /^export\.fidelity: frame 700\b/, 'the planted writer (writer_drops_frame_700)');
  }, TIMEOUT);

  it(`${AC[12]} a planted delivery that repeats frame 701 in place of frame 702 fails export.fidelity, naming frame 702`, () => {
    failsNaming(frameRun('writer_repeats_frame_701'), /^export\.fidelity: frame 702\b/, 'the planted writer (writer_repeats_frame_701)');
  }, TIMEOUT);

  it(`${AC[12]} a planted delivery whose edit list keeps the end padding fails export.fidelity, naming the sample count`, () => {
    failsNaming(frameRun('muxer_keeps_end_padding'), /^export\.fidelity: samples: (?!2880000 )\d+ sample frames per channel, not 2880000/, 'the planted muxer (muxer_keeps_end_padding)');
  }, TIMEOUT);
});
