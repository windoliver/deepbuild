// AC3: the decode worker gives FFmpeg's own FATE samples for MOV edit lists and AAC priming the first video and audio
// times FATE's reference outputs give, the samples fetched on first use and never committed. The reference outputs
// are vendored under fixtures/fate at the oracle's pinned commit; the samples are fetched from the FATE suite into a
// cache outside the checkout and checked against their pinned SHA-256.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FATE, R, assetOf, decodedOf, f32, ffmpeg, fateCache, fetchFate, md5, mediaDecode, mediaImport, rat, ratEq, readFrameMd5,
  readPriming, readStartTime, runShow, showRat, useShow, useTemp, videoStream,
  type JsonObject, type Planted, type Rat,
} from './helpers.ts';

const show = useShow();
const temp = useTemp('fate');

let fetched: Awaited<ReturnType<typeof fetchFate>> = { paths: new Map(), problem: 'not fetched yet' };
beforeAll(async () => { fetched = await fetchFate(); }, 1_800_000);

function samples(): Map<string, string> {
  if (fetched.problem) {
    expect.fail(`INCONCLUSIVE: the FATE samples are fetched on first use and one is unavailable: ${fetched.problem}. Unblock: run once with network access to ${FATE.suite}, or put the samples (paths as in fixtures/fate/samples.json) under ${fateCache()} or DEEP_FATE_SAMPLES`);
  }
  return fetched.paths;
}

/** What one sample's decode gives against its reference, as sentences naming the sample. */
function sampleProblems(ref: string, check: string, replies: { decode?: JsonObject; import?: JsonObject }, out: string): string[] {
  const f: string[] = [];
  const fmd5 = check === 'first_frame' || check === 'first_time' || check === 'first_video_and_audio_times' ? readFrameMd5(ref) : null;
  const refVideo = fmd5 ? [...fmd5.streams.values()].find((s) => s.type === 'video') ?? null : null;
  const timeAt = (s: { tb: Rat }, pts: bigint): Rat => ({ n: pts * s.tb.n, d: s.tb.d });
  if (check === 'first_frame' || check === 'first_time') {
    const d = decodedOf(replies.decode!, out, `${ref}: media_decode`);
    expect(d.video.length, `${ref}: one decoded video stream`).toBe(1);
    const v = d.video[0]!;
    const first = v.frames[0];
    if (!first) return [`${ref}: no video frame decoded`];
    const want = timeAt(refVideo!, refVideo!.first!.pts);
    if (!ratEq(first.pts, want)) f.push(`${ref}: the first video frame is at ${showRat(first.pts)} s, FATE's reference gives ${showRat(want)} s`);
    if (refVideo!.dims && (v.size[0] !== refVideo!.dims[0] || v.size[1] !== refVideo!.dims[1])) f.push(`${ref}: decoded ${v.size.join('x')}, FATE's reference gives ${refVideo!.dims.join('x')}`);
    if (check === 'first_frame') {
      const bytes = readFileSync(first.file);
      if (bytes.length !== refVideo!.first!.size) f.push(`${ref}: the first frame's planes are ${bytes.length} bytes, FATE's reference gives ${refVideo!.first!.size}`);
      else if (md5(bytes) !== refVideo!.first!.hash) f.push(`${ref}: the first video frame's planes hash to MD5 ${md5(bytes)}, FATE's reference gives ${refVideo!.first!.hash} (another frame is first)`);
    }
  } else if (check === 'first_video_and_audio_times') {
    const a = assetOf(replies.import!, `${ref}: media_import`);
    const vs = videoStream(a, `${ref}: media_import`);
    const pts0 = vs.pts![0];
    if (pts0 === undefined) f.push(`${ref}: the probe lists no video frame`);
    else {
      const got = rat(pts0, `${ref}: probe pts[0]`);
      const want = timeAt(refVideo!, refVideo!.first!.pts);
      if (!ratEq(got, want)) f.push(`${ref}: the first video frame is at ${showRat(got)} s, FATE's reference gives ${showRat(want)} s`);
    }
    const refAudio = [...fmd5!.streams.values()].find((s) => s.type === 'audio')!;
    const d = decodedOf(replies.decode!, out, `${ref}: media_decode`);
    expect(d.audio.length, `${ref}: one decoded audio stream`).toBe(1);
    const want = timeAt(refAudio, refAudio.first!.pts);
    if (!ratEq(d.audio[0]!.first, want)) f.push(`${ref}: the first audio sample is at ${showRat(d.audio[0]!.first)} s, FATE's reference gives ${showRat(want)} s`);
  } else if (check === 'start_time') {
    const d = decodedOf(replies.decode!, out, `${ref}: media_decode`);
    const first = d.video[0]?.frames[0];
    const want = readStartTime(ref);
    if (!first) f.push(`${ref}: no video frame decoded`);
    else if (!ratEq(first.pts, want)) f.push(`${ref}: the first video frame is at ${showRat(first.pts)} s, FATE's reference start_time is ${showRat(want)} s`);
  }
  return f;
}

describe('AC3 FATE\'s MOV edit-list samples: the first video and audio times FATE\'s reference outputs give', () => {
  it('AC3 each edit-list sample\'s first decoded frame is at FATE\'s first time, and for H.264 and HEVC it is FATE\'s first frame by the MD5 of its planes; twofields_packet\'s first video and audio are both at FATE\'s first times; mov_neg_first_pts_discard starts at FATE\'s start_time', () => {
    const paths = samples();
    const out = temp();
    const list = FATE.samples.filter((s) => s.check !== 'priming');
    const calls: JsonObject[] = [];
    const index: { ref: string; check: string; decode?: number; import?: number }[] = [];
    for (const s of list) {
      const entry: { ref: string; check: string; decode?: number; import?: number } = { ref: s.ref, check: s.check };
      const p = paths.get(s.ref)!;
      if (s.check === 'first_video_and_audio_times') {
        entry.import = calls.push(mediaImport(p)) - 1;
        entry.decode = calls.push(mediaDecode(p, join(out, s.ref), { video_frames: 0 })) - 1;
      } else {
        entry.decode = calls.push(mediaDecode(p, join(out, s.ref), { video_frames: 1 })) - 1;
      }
      index.push(entry);
    }
    const check = (planted?: Planted): string[] => {
      const { replies } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, calls, planted ? `planted ${planted}` : 'the FATE edit-list samples');
      return index.flatMap((e) => sampleProblems(e.ref, e.check, {
        ...(e.decode !== undefined ? { decode: replies[e.decode]! } : {}),
        ...(e.import !== undefined ? { import: replies[e.import]! } : {}),
      }, join(out, e.ref)));
    };
    expect(check(), 'every edit-list sample starts where FATE\'s reference says, on FATE\'s first frame').toEqual([]);
    // The wrong program: a demuxer that ignores edit lists starts mov-1elist-1ctts two frames late and HEVC's I-B-I
    // sample on another frame; this check names the samples.
    const wrong = check('ignores_edit_lists');
    expect(wrong.some((s) => s.startsWith('mov-1elist-1ctts:')), `planted ignores_edit_lists fails naming mov-1elist-1ctts; got ${JSON.stringify(wrong)}`).toBe(true);
    expect(wrong.some((s) => s.startsWith('mov-ibi-elst-starts-b:')), `planted ignores_edit_lists fails naming mov-ibi-elst-starts-b; got ${JSON.stringify(wrong)}`).toBe(true);
  }, 1_800_000);
});

describe('AC3 FATE\'s AAC priming sample: the first audio time FATE\'s reference output gives', () => {
  it('AC3 aac-2048-priming.mov decodes with its first kept sample at FATE\'s first packet time plus its skipped samples (0 s), at FATE\'s rate, and those samples are FFmpeg\'s own decode from there', () => {
    const paths = samples();
    const s = FATE.samples.find((x) => x.check === 'priming')!;
    const p = paths.get(s.ref)!;
    const pr = readPriming(s.ref);
    const wantFirst: Rat = { n: (pr.firstPts + pr.skip) * pr.tb.n, d: pr.tb.d };
    // FFmpeg's own decode, which drops the skipped samples the reference names: the samples that start at that time.
    const reference = ffmpeg(['-i', p, '-f', 'f32le', '-']);
    const out = temp();
    const check = (planted?: Planted): string[] => {
      const { replies } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, [mediaDecode(p, out)], planted ? `planted ${planted}` : 'the AAC priming sample');
      const d = decodedOf(replies[0]!, out, `${s.ref}: media_decode`);
      expect(d.audio.length, `${s.ref}: one decoded audio stream`).toBe(1);
      const a = d.audio[0]!;
      const f: string[] = [];
      if (!ratEq(a.first, wantFirst)) f.push(`${s.ref}: the first audio sample is at ${showRat(a.first)} s, FATE's reference gives ${showRat(wantFirst)} s (packet pts ${pr.firstPts} + ${pr.skip} skipped, time base ${showRat(pr.tb)})`);
      if (!ratEq(R(1, a.sample_rate), pr.tb)) f.push(`${s.ref}: decoded at ${a.sample_rate} Hz, FATE's reference time base is ${showRat(pr.tb)}`);
      const ours = f32(readFileSync(a.file));
      const theirs = f32(reference);
      const n = 4096 * a.channels;
      if (ours.length < n) f.push(`${s.ref}: ${ours.length / a.channels} samples decoded, fewer than the 4,096 compared`);
      else {
        let worst = 0; let at = 0;
        for (let i = 0; i < n; i++) { const e = Math.abs(ours[i]! - theirs[i]!); if (!(e <= worst)) { worst = e; at = i; } }
        if (!(worst <= 1e-3)) f.push(`${s.ref}: the samples from the first kept one differ from FFmpeg's decode by ${worst.toExponential(2)} at sample ${Math.floor(at / a.channels)} (over 1e-3: the priming isn't removed where FATE says)`);
      }
      return f;
    };
    expect(check(), 'the priming sample\'s audio starts where FATE\'s reference says').toEqual([]);
    // The wrong program: a decoder that keeps the 2,048 priming samples; this check names the sample.
    const wrong = check('keeps_priming');
    expect(wrong.some((x) => x.startsWith(`${s.ref}:`)), `planted keeps_priming fails naming ${s.ref}; got ${JSON.stringify(wrong)}`).toBe(true);
  }, 1_800_000);
});
