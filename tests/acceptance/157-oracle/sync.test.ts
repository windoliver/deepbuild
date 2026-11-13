// AC9 #157.72589e8f: "An MP4 delivery's av_offset is 0 within one audio sample once its edit list is applied, and a
// planted delivery with the edit list stripped fails, naming the offset as the encoder's priming in samples; a delivery
// whose edit list says 1,024 while the encoder primed 2,112 fails, naming 1,088 samples, and one with its channels
// swapped fails, naming them"
// AC23 #157.dd0134eb: "On the export.sync fixture at each listed rate pair, each delivery's measured lag is 0 samples with
// PCM; a planted master limiter whose 5 ms lookahead isn't compensated is 240 samples late at 48 kHz and fails, naming
// the first second; a planted delivery whose video edit list is removed while its first composition time is above 0
// fails, naming frame 0"
//
// Upstream, run on our output (#136): FATE's gapless.mak audiomatch recipes (tests/audiomatch.c, ported in helpers.ts,
// whose afconvert reference reads presig 0 and lenerr 0: no offset, no length error, once priming and padding are
// removed) on AC9's AAC delivery decoded by FFmpeg against the PCM the film plays; and FATE's mov.mak edit-list recipe
// `fate-mov-1elist-1ctts`, whose reference starts at pts 0 (the edit list cancels the composition delay), against our
// deliveries' first frame as FFmpeg presents it. The export.sync fixture (helpers.ts `syncFilm`): black, a white frame
// and a 2 ms 4 kHz burst at the frame that shows each whole second from 1 (full scale for AC23, half for AC9), its
// master ending in a limiter with 5 ms of lookahead (AC23); this suite measures each burst's lag itself from the white
// frame's presentation time FFmpeg reads, as export.sync does. The receipt's `av_offset` is `{samples, priming,
// edit_list}`. Planted: `muxer_strips_audio_edit_list`, `muxer_edit_list_1024`, `muxer_swaps_channels`,
// `limiter_lookahead_uncompensated`, `muxer_drops_video_edit_list`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, H264_PCM, TIMEOUT, audiomatch, burst, bytesOf, exportCall, failsNaming, ffAudioStream, ffLuma, ffPcm, ffVideoFrames, filmRun, firstPts,
  framesNamed, isObject, issueLines, lagAt, none, readMovie, receiptOf, refAudiomatch, s16, show, syncFilm, trackOf, useShow, useTemp, type JsonObject,
  type Planted, type Rate, type SyncFilm,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** A FAIL's issues as this suite's failure lines: an offset as `av_offset: <n> samples, the encoder's priming <p>`,
 * channels as `pcm: channels <a> and <b>`, a burst as `second <s>: the burst is <n> samples late`, a frame as
 * `frame <k>:`. */
function issueFailures(reply: JsonObject): string[] {
  const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
  const f = issues.map((i) => {
    if (typeof i['lag'] === 'number' && typeof i['priming'] === 'number') return `av_offset: ${i['lag']} samples, the encoder's priming ${i['priming']}: ${JSON.stringify(i)}`;
    if (Array.isArray(i['channels'])) return `pcm: channels ${i['channels'].join(' and ')}: ${JSON.stringify(i)}`;
    if (typeof i['second'] === 'number' && typeof i['lag'] === 'number') return `second ${i['second']}: the burst is ${i['lag']} samples late: ${JSON.stringify(i)}`;
    if (framesNamed(i).length) return `frame ${Math.min(...framesNamed(i))}: ${JSON.stringify(i)}`;
    return `${String(i['check'] ?? i['code'])}: ${JSON.stringify(i)}`;
  });
  return f.length ? f : [`the export wasn't delivered: ${issueLines(reply).join(' | ').slice(0, 800)}`];
}

// ---------------------------------------------------------------------------------------------------
// AC9

/** AC9's judge on the AAC delivery: the receipt's av_offset within one sample, the audio edit list starting at the
 * encoder's priming, audiomatch's offset and length error FATE's reference's, and each channel its own raw channel. */
function avFailures(reply: JsonObject, film: SyncFilm, out: string): string[] {
  if (reply['outcome'] !== 'exported') return issueFailures(reply);
  const f: string[] = [];
  const av = receiptOf(reply, 'the AAC delivery').raw['av_offset'];
  if (!isObject(av) || typeof av['samples'] !== 'number' || typeof av['priming'] !== 'number') return [`av_offset: the receipt's av_offset is ${show(av ?? null)}, not {samples, priming, edit_list}`];
  const priming = av['priming'];
  if (Math.abs(av['samples']) > 1) f.push(`av_offset: ${av['samples']} samples, the encoder's priming ${priming}: the receipt's offset is over one sample`);
  const edits = trackOf(readMovie(bytesOf(out), 'the MP4'), 'soun', 'the MP4').edits;
  const start = edits?.find((e) => e.mediaTime >= 0n)?.mediaTime;
  if (start === undefined || start !== BigInt(priming) || av['edit_list'] !== priming) f.push(`av_offset: ${Number(BigInt(priming) - (start ?? 0n))} samples, the encoder's priming ${priming}: the audio edit list starts at ${String(start)} (receipt: ${show(av['edit_list'] ?? null)})`);
  const a = ffAudioStream(out);
  const decoded = ffPcm(out, a.channels);
  const m = audiomatch(s16(decoded), s16(film.channels));
  const ref = refAudiomatch('audiomatch-afconvert-44100-stereo-lc-m4a');
  const offset = m.presig / a.channels;
  if (Math.abs(offset - ref.presig) > 1 || !m.ok) f.push(`av_offset: ${offset} samples, the encoder's priming ${priming}: audiomatch on FFmpeg's decode reads presig ${m.presig} (FATE's reference ${ref.presig}), match ${m.c.toFixed(3)}`);
  if (m.lenerr / a.channels !== ref.lenerr) f.push(`samples: audiomatch reads a length error of ${m.lenerr / a.channels} sample frames, FATE's reference ${ref.lenerr}`);
  const bad = film.channels.map((raw, c) => {
    const d = decoded[c] ?? new Float32Array(0);
    let xy = 0; let xx = 0; let yy = 0;
    for (let i = 0; i < Math.min(d.length, raw.length); i++) { xy += d[i]! * raw[i]!; xx += d[i]! * d[i]!; yy += raw[i]! * raw[i]!; }
    return { c, r: xy / Math.sqrt(xx * yy) };
  }).filter((x) => !(x.r >= 0.99));
  if (bad.length) f.push(`pcm: channels ${bad.map((x) => x.c).join(' and ')} match their raw channels at lag 0 only ${bad.map((x) => x.r.toFixed(3)).join(' and ')}, under 0.99`);
  return f;
}
function avRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'sync.mp4');
  const film = syncFilm(evidence, [24, 1], 48_000, 4, { rightLag: 12_000, level: 0.5 });
  const [reply] = filmRun(shows.bin(FULL), evidence, film.document, [exportCall({ out, ...H264_AAC })], 'the AAC sync delivery', planted);
  return avFailures(reply!, film, out);
}

describe(`${AC[9]} an MP4's sound meets its picture once its edit list removes the encoder's priming`, () => {
  it(`${AC[9]} the AAC delivery's av_offset is 0 within one sample, its audio edit list starts at the encoder's priming, and FATE's audiomatch reads its reference's offset and length error on FFmpeg's decode`, () => {
    none(avRun(), 'the AAC delivery\'s sync');
  }, TIMEOUT);

  it(`${AC[9]} a planted delivery with its audio edit list stripped fails, naming the offset as the encoder's priming in samples`, () => {
    failsNaming(avRun('muxer_strips_audio_edit_list'), /^av_offset: (\d+) samples, the encoder's priming \1\b/, 'the planted muxer (muxer_strips_audio_edit_list)');
  }, TIMEOUT);

  it(`${AC[9]} a planted delivery whose edit list says 1,024 while the encoder primed 2,112 fails, naming 1,088 samples`, () => {
    failsNaming(avRun('muxer_edit_list_1024'), /^av_offset: 1088 samples\b/, 'the planted muxer (muxer_edit_list_1024)');
  }, TIMEOUT);

  it(`${AC[9]} a planted delivery with its channels swapped fails, naming them`, () => {
    failsNaming(avRun('muxer_swaps_channels'), /^pcm: channels 0 and 1\b/, 'the planted muxer (muxer_swaps_channels)');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC23

const RATES: Rate[] = [[24000, 1001], [25, 1], [30000, 1001], [60, 1]];
const HZ = [44_100, 48_000];
/** AC23's judge on a PCM delivery of the sync fixture: frame 0 presented at FATE's reference's first time, a white frame
 * for each second, and each burst at its white frame's first sample, 0 samples late. */
function syncFailures(reply: JsonObject, film: SyncFilm, out: string): string[] {
  if (reply['outcome'] !== 'exported') return issueFailures(reply);
  const f: string[] = [];
  const v = ffVideoFrames(out);
  const want = firstPts('mov-1elist-1ctts');
  if (v.frames.length === 0 || v.frames[0]!.pts !== want) f.push(`frame 0: FFmpeg presents it at ${String(v.frames[0]?.pts)} × ${v.tb.n}/${v.tb.d} s; FATE's mov-1elist-1ctts reference reads its first frame at ${want}`);
  const luma = ffLuma(out, 160, 90);
  const white = luma.map((y, k) => ({ k, mean: y.reduce((s, x) => s + x, 0) / y.length })).filter((x) => x.mean > 128).map((x) => x.k);
  if (white.length !== film.seconds.length) f.push(`seconds: FFmpeg shows ${white.length} white frames, not ${film.seconds.length}`);
  const a = ffAudioStream(out);
  const pcm = ffPcm(out, a.channels)[0]!;
  const b = burst(film.sr);
  white.slice(0, film.seconds.length).forEach((k, j) => {
    const pts = v.frames[k]!.pts;
    const num = (pts * v.tb.n * a.tb.d - a.startPts * a.tb.n * v.tb.d) * BigInt(film.sr);
    const expected = Number(num / (v.tb.d * a.tb.d));
    const lag = lagAt(pcm, b, expected, Math.round(film.sr / 10));
    if (lag !== 0) f.push(`second ${film.seconds[j]}: the burst is ${lag} samples late against the white frame FFmpeg presents at ${pts} × ${v.tb.n}/${v.tb.d} s`);
  });
  const av = receiptOf(reply, 'the PCM sync delivery').raw['av_offset'];
  if (!isObject(av) || av['samples'] !== 0) f.push(`av_offset: the receipt reads ${show(av ?? null)}, not 0 samples with PCM`);
  return f;
}
function syncRun(rate: Rate, sr: number, planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'sync.mp4');
  const film = syncFilm(evidence, rate, sr, 4, { limiter: true });
  const [reply] = filmRun(shows.bin(FULL), evidence, film.document, [exportCall({ out, ...H264_PCM })], `the sync fixture at ${rate.join('/')} fps and ${sr} Hz`, planted);
  return syncFailures(reply!, film, out);
}

describe(`${AC[23]} the sync fixture's sound meets its picture to the sample at every rate pair`, () => {
  it(`${AC[23]} at 24000/1001, 25, 30000/1001 and 60 fps with 44.1 and 48 kHz, each PCM delivery's measured lag is 0 samples at every second, its frame 0 at FATE's first time`, () => {
    const f = RATES.flatMap((rate) => HZ.flatMap((sr) => syncRun(rate, sr).map((x) => `${rate.join('/')} fps, ${sr} Hz: ${x}`)));
    none(f, 'the sync fixture at the eight rate pairs');
  }, TIMEOUT);

  it(`${AC[23]} a planted master limiter whose 5 ms lookahead isn't compensated is 240 samples late at 48 kHz and fails, naming the first second`, () => {
    failsNaming(syncRun([25, 1], 48_000, 'limiter_lookahead_uncompensated'), /^second 1: the burst is 240 samples late/, 'the planted limiter (limiter_lookahead_uncompensated)');
  }, TIMEOUT);

  it(`${AC[23]} a planted delivery whose video edit list is removed while its first composition time is above 0 fails, naming frame 0`, () => {
    expect(firstPts('mov-1elist-1ctts'), 'FATE\'s reference presents the first frame at pts 0 once the edit list cancels the composition delay').toBe(0n);
    failsNaming(syncRun([25, 1], 48_000, 'muxer_drops_video_edit_list'), /^frame 0:/, 'the planted muxer (muxer_drops_video_edit_list)');
  }, TIMEOUT);
});
