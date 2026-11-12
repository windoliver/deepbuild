// AC24 #157.1201423e: "In the preflight, each export kind's fixture delivery is also read by FFmpeg's own demuxer and
// decoders, and both readers give the same frame count, frame times and sample count, or the case fails, naming the
// field; a planted reader that pads the last audio packet to a whole frame reports a sample count FFmpeg's reader
// doesn't, and the case fails, naming the sample count"
//
// Upstream, run on our output (#136): FATE's gapless.mak `gaplessenc` recipes read AAC in MP4 or MOV back through
// FFmpeg's own demuxer and decoder, and their reference (`gaplessenc-pcm-to-mov-aac`: start_pts 0, duration_ts the
// source's whole sample count, the last packet's padding discarded) is what FFmpeg's reader gives here. The case is
// this file: the fixture film (helpers.ts `filmDoc`, 2 s, 160 × 90 at 24 fps, 48 kHz stereo) exported once as each
// export kind this build delivers with sound, H.264 with AAC in MP4 and ProRes 4444 with PCM in MOV; then each delivery
// read by the decode worker (`media_import`'s presentation times, `media_decode`'s samples) and by FFmpeg (ffprobe's
// frames, the gaplessenc stream fields, ffmpeg's decoded samples), field by field. The planted reader runs in the
// reading scenario only, so the deliveries are the same. Planted: `reader_pads_last_packet` (the decode worker's AAC
// reader pads the last packet to a whole 1,024-sample frame).
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, PRORES_PCM, TIMEOUT, assetOf, decodedOf, exportCall, failsNaming, ffAudioStream, ffPcm, ffVideoFrames, filmDoc, filmRun, mediaDecode,
  mediaImport, none, rat, receiptOf, refField, runShow, scenario, showRat, useFileTemp, useShow, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const keep = useFileTemp('readers');
const KINDS = [{ file: 'film.mp4', ask: H264_AAC }, { file: 'film.mov', ask: PRORES_PCM }];
let dir = '';

beforeAll(() => {
  const evidence = keep(); dir = keep();
  const replies = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }), KINDS.map((k) => exportCall({ out: join(dir, k.file), ...k.ask })), 'the export kinds\' fixture deliveries');
  replies.forEach((r, i) => receiptOf(r, `the ${KINDS[i]!.file} delivery`));
}, TIMEOUT);

/** Both readers on each delivery: frame count, frame times (exact rationals) and sample count per channel, and FATE's
 * gaplessenc fields. Each failure starts `<file>: <field>:`. */
function readerFailures(planted?: Planted): string[] {
  const out = keep();
  const calls = KINDS.flatMap((k) => [mediaImport(join(dir, k.file)), mediaDecode(join(dir, k.file), join(out, k.file), { video_frames: 0 })]);
  const replies = runShow(shows.bin(FULL), scenario(keep(), calls, planted ? { planted } : {}), planted ? `the decode worker reading the deliveries (planted ${planted})` : 'the decode worker reading the deliveries');
  const f: string[] = [];
  KINDS.forEach((k, i) => {
    const path = join(dir, k.file);
    const v = assetOf(replies[2 * i]!, `${k.file}: the decode worker's probe`).streams.filter((s) => s.type === 'video')[0];
    const ours = (v?.pts ?? []).map((p, n) => rat(p, `${k.file}: frame ${n}`));
    const ff = ffVideoFrames(path);
    if (ours.length !== ff.frames.length) f.push(`${k.file}: frame count: the decode worker reads ${ours.length} frames, FFmpeg ${ff.frames.length}`);
    const at = ours.findIndex((p, n) => ff.frames[n] === undefined || p.n * ff.tb.d !== ff.frames[n]!.pts * ff.tb.n * p.d);
    if (at >= 0) f.push(`${k.file}: frame times: frame ${at} is at ${showRat(ours[at]!)} s to the decode worker, ${String(ff.frames[at]?.pts)} × ${ff.tb.n}/${ff.tb.d} s to FFmpeg`);
    const a = decodedOf(replies[2 * i + 1]!, join(out, k.file), `${k.file}: the decode worker's decode`).audio[0];
    const s = ffAudioStream(path);
    const theirs = ffPcm(path, s.channels)[0]!.length;
    if (a?.samples !== theirs) f.push(`${k.file}: sample count: the decode worker reads ${String(a?.samples)} sample frames per channel, FFmpeg ${theirs}`);
    if (s.durationTs !== BigInt(theirs) || s.startPts !== BigInt(refField('gaplessenc-pcm-to-mov-aac', 'start_pts'))) f.push(`${k.file}: sample count: FFmpeg's gaplessenc probe reads start_pts ${s.startPts} and duration_ts ${String(s.durationTs)}, against its decode's ${theirs} and FATE's reference start_pts ${refField('gaplessenc-pcm-to-mov-aac', 'start_pts')}`);
  });
  return f;
}

describe(`${AC[24]} each export kind's delivery reads the same to the decode worker and to FFmpeg`, () => {
  it(`${AC[24]} the MP4 (H.264, AAC) and the MOV (ProRes 4444, PCM) give the same frame count, frame times and sample count to both readers`, () => {
    expect(dir, 'the deliveries were made').not.toBe('');
    none(readerFailures(), 'the two readers on each delivery');
  }, TIMEOUT);

  it(`${AC[24]} a planted reader that pads the last audio packet to a whole frame reports a sample count FFmpeg's reader doesn't, and the case fails, naming the sample count`, () => {
    failsNaming(readerFailures('reader_pads_last_packet'), /^film\.mp4: sample count:/, 'the planted reader (reader_pads_last_packet)');
  }, TIMEOUT);
});
