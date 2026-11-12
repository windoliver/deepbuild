// AC2 #1163.5c7e06ab: "The whole export's receipt records 1920 × 1080, 30 fps, 20 s and 600 frame hashes; decoded by the
// test's own reader, the MP4 holds 600 frames and 960,000 samples per channel, frame k's audio starting at sample
// k × 1,600, and the bed ends on a 5 ms equal-power fade whose 240 samples follow the curve within 1e-6. A planted
// video writer that drops frame 300 delivers 599 frames and fails, naming frame 300"
// AC3 #1163.86d53f4f: "The 30 PNGs of [300, 330), decoded, hash equal to their raw frames and to the whole export's
// frame hashes 300 to 329; the still at `title` equals the settled live frame at that marker by hash. A planted range
// that starts one frame late fails, naming frame 300"
// AC4 #1163.dd932548: "Seeking equals playing in the exports: [450, 480) exported from a fresh process, a cold jump to
// 15 s with the reverb's tail pre-rolled, equals frames 450 to 479 and their PCM spans in the whole export by hash. A
// planted reverb checkpoint without its tail differs at the first sample after 15 s and fails, naming the processor"
// AC5 #1163.57ed0658: "Exporting the whole film again in a fresh process, and with 3 shards, gives the same frame
// hashes and PCM hash; the PCM the live transport hands the device gate over the 20 s equals the export's by hash. A
// planted renderer that seeds noise from the clock fails, naming the first frame that differs"
// AC6 #1163.715560ce: "In the film viewer, `.` while paused at frame 100 shows the frame whose hash equals export frame
// 101, and ⌥→ from frame 0 lands on the marker `title`'s first frame; after every export the document's revision hash
// and the session state are unchanged"
//
// One file, because these criteria all compare against the same whole export, a 600-frame 1080p film: run A, one
// `deep-show run` made once for the file, presents the film, sets a session state, makes the issue's three exports
// (the whole film as MP4 with its sound, frames [300, 330) as png_seq, the still at marker `title`), reading the
// revisions and the session state after each, reads the live frame at the marker and steps the film viewer. Every
// other comparison runs in its own fresh process. Hashes compared are raw frames' BLAKE3 (receipts, the viewer, this
// suite's BLAKE3 of decoded PNGs) and PCM as interleaved f32le, never encoded bytes. The MP4 is read by this suite's
// own box reader (helpers.ts: frames are video samples placed by presentation time, sound is decoded PCM). Planted:
// `video_drops_frame_300`, `range_starts_one_frame_late`, `reverb_restores_without_tail` (#499's),
// `seeds_noise_from_clock` (#670's), each through the scenario's `planted`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BED_PROCESSORS, Driver, FILM, FLICKS, IMPULSE_HEIGHT, MS, REVISIONS, SAMPLE, TIMEOUT, VIEWER, arr, bedAt, bedWav, click, exportPngRange,
  exportSeek, exportStill, exportWhole, film, filmSound, firstDiff, fl, getEvidence, handed, hex64, impulseSound, impulseWav, int,
  interleaved, isObject, key, liveFrame, mixCall, mixed, n, none, obj, play, pngFiles, pngHash, present, presented, putEvidence, readMp4, readWav,
  receiptOf, runShow, scenario, session, sha256, show, str, useRoot, useShow, currentOf, failsNaming,
  type JsonObject, type Mp4, type Planted, type Receipt,
} from './helpers.ts';

const shows = useShow();
const temp = useRoot();

// ---------------------------------------------------------------------------------------------------
// Run A, made once for the file (README: Run them, run A)

/** The session state set before the exports: the dot selected (#501's `session` call). */
const SESSION_STATE: JsonObject = { selection: ['dot'], view: {} };
interface RunA {
  evidence: string; dir: string; bed: string; replies: JsonObject[];
  whole: number; range: number; still: number; live: number;
  checks: { after: string; revisions: number; session: number }[];
  viewer: { at100: number; at101: number; at0: number; atTitle: number };
}
let memoA: RunA | Error | undefined;
function runA(): RunA {
  if (memoA instanceof Error) throw memoA;
  if (memoA) return memoA;
  try { memoA = makeA(); return memoA; } catch (e) { memoA = e instanceof Error ? e : Error(String(e)); throw memoA; }
}
function makeA(): RunA {
  const evidence = temp(); const dir = temp();
  const bed = putEvidence(evidence, bedWav());
  const doc = film(bed);
  // The viewer opens paused or playing: ask it first, as #501's viewer test does, and pause it only if it plays.
  const [p0, v0] = runShow(shows.bin(), scenario(evidence, [present(doc), VIEWER]), 'the film viewer as it opens');
  presented(p0, 'the film');
  const paused = obj(obj(v0, 'the viewer as it opens')['viewer'], 'the viewer as it opens: viewer')['paused'] === true;
  const calls: JsonObject[] = [];
  const add = (c: JsonObject): number => calls.push(c) - 1;
  add(present(doc));
  add(session(SESSION_STATE));
  const checks: RunA['checks'] = [];
  const check = (after: string): void => { checks.push({ after, revisions: add(REVISIONS), session: add(session()) }); };
  check('the film was presented and the session state set');
  const whole = add(exportWhole(join(dir, 'film.mp4'))); check('the whole export');
  const range = add(exportPngRange(join(dir, 'range'))); check('the PNG range');
  const still = add(exportStill(join(dir, 'still'))); check('the still at title');
  const live = add(liveFrame(FILM.title));
  if (!paused) add(key('k'));
  add(key('2')); // two tenths of the span: 4 s, frame 120
  for (let i = 0; i < 20; i++) add(key(','));
  const at100 = add(VIEWER);
  add(key('.'));
  const at101 = add(VIEWER);
  add(key('Home'));
  const at0 = add(VIEWER);
  add(key('ArrowRight', ['alt']));
  const atTitle = add(VIEWER);
  const replies = runShow(shows.bin(), scenario(evidence, calls), 'run A: the film presented, exported three ways and stepped in the viewer');
  presented(replies[0], 'the film');
  return { evidence, dir, bed, replies, whole, range, still, live, checks, viewer: { at100, at101, at0, atTitle } };
}
const wholeOf = (a: RunA): Receipt => receiptOf(a.replies[a.whole], 'the whole export');
let memoMp4: Mp4 | undefined;
/** Run A's MP4, read once. */
function wholeMp4(a: RunA): Mp4 {
  if (!memoMp4) {
    const file = join(a.dir, 'film.mp4');
    expect(existsSync(file), `the whole export wrote ${file}`).toBe(true);
    memoMp4 = readMp4(readFileSync(file), 'the whole export\'s MP4');
  }
  return memoMp4;
}
function wholePcm(a: RunA): Float32Array[] {
  const pcm = wholeMp4(a).audio?.pcm;
  expect(pcm, 'the whole export\'s MP4 holds PCM sound').toBeTruthy();
  return pcm!;
}
/** A fresh process: the film presented, then `calls` (each given the output folder). */
function fresh(calls: (dir: string) => JsonObject[], what: string, planted?: Planted): { replies: JsonObject[]; dir: string } {
  const evidence = temp(); const dir = temp();
  const bed = putEvidence(evidence, bedWav());
  const replies = runShow(shows.bin(), scenario(evidence, [present(film(bed)), ...calls(dir)], planted), what);
  presented(replies[0], `${what}: the film`);
  return { replies: replies.slice(1), dir };
}

// ---------------------------------------------------------------------------------------------------
// Checks, each returning failures; a planted program's run must give one naming what its criterion names.

/** The MP4's video: `frames` samples, one presented at each frame time k/30 s. */
function videoFailures(mp4: Mp4, frames: number): string[] {
  const v = mp4.video;
  if (!v) return ['the MP4 has no video track'];
  const out: string[] = [];
  if (v.samples !== frames) out.push(`the MP4 holds ${v.samples} video frames, not ${frames}`);
  const seen = new Map<number, number>();
  for (const p of v.pts) {
    const k = (p * FILM.rate[0]) / (v.timescale * FILM.rate[1]);
    if (!Number.isInteger(k)) { if (out.length < 8) out.push(`a video sample presents at ${p}/${v.timescale} s, between frames`); } else seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (let k = 0; k < frames; k++) {
    const c = seen.get(k) ?? 0;
    if (c === 0) out.push(`frame ${k}: no video sample presents it at ${k}/30 s`);
    else if (c > 1) out.push(`frame ${k}: ${c} video samples present it`);
  }
  for (const k of seen.keys()) if (k < 0 || k >= frames) out.push(`a video sample presents frame ${k}, outside [0, ${frames})`);
  return out;
}
/** The MP4's sound: stereo PCM at 48 kHz from time 0, `samples` per channel, frame k's span [k × 1,600, (k + 1) × 1,600)
 * hashing to the receipt's PCM hash k. */
function audioFailures(mp4: Mp4, samples: number, receipt: Receipt | null): string[] {
  const a = mp4.audio;
  if (!a || !a.pcm) return ['the MP4 has no PCM sound track'];
  const out: string[] = [];
  if (a.channels !== 2) out.push(`the MP4's sound has ${a.channels} channels, not 2`);
  if (a.rate !== FILM.sampleRate) out.push(`the MP4's sound runs at ${a.rate} Hz, not 48,000`);
  if (a.presentedFrom !== 0) out.push(`the MP4's sound presents its sample ${a.presentedFrom} at time 0, so frame k's audio doesn't start at sample k × 1,600`);
  const len = a.pcm[0]?.length ?? 0;
  if (len !== samples) out.push(`the MP4 holds ${n(len)} samples per channel, not ${n(samples)}`);
  if (receipt) {
    const frames = Math.min(receipt.pcm_hashes.length, Math.floor(len / FILM.samplesPerFrame));
    if (receipt.pcm_hashes.length !== samples / FILM.samplesPerFrame) out.push(`the receipt holds ${receipt.pcm_hashes.length} PCM spans, not ${samples / FILM.samplesPerFrame}`);
    let wrong = 0; let first = -1;
    for (let k = 0; k < frames; k++) {
      if (sha256(interleaved(a.pcm, k * FILM.samplesPerFrame, (k + 1) * FILM.samplesPerFrame)) !== receipt.pcm_hashes[k]) { wrong++; if (first < 0) first = k; }
    }
    if (wrong) out.push(`frame ${first}: the MP4's samples [${n(first * FILM.samplesPerFrame)}, ${n((first + 1) * FILM.samplesPerFrame)}) don't hash to the receipt's PCM span ${first} (${wrong} spans differ)`);
  }
  return out;
}
/** A whole export's delivery, read back by this suite: 600 frames and 960,000 samples a channel. */
function deliveryFailures(reply: JsonObject | undefined, file: string): string[] {
  if (obj(reply, 'the whole export')['outcome'] !== 'exported') return [`the whole export didn't deliver: ${show(reply, 2000)}`];
  if (!existsSync(file)) return [`the export answers exported but wrote no file at ${file}`];
  let mp4: Mp4;
  try { mp4 = readMp4(readFileSync(file), 'the MP4'); } catch (e) { return [`the MP4 can't be read: ${(e as Error).message}`]; }
  return [...videoFailures(mp4, FILM.frames), ...audioFailures(mp4, FILM.samples, receiptOf(reply, 'the whole export'))];
}

/** The bed's end fade, read in the MP4's PCM y: against the twin z whose bed runs on past 20 s, y − z over the last 240
 * samples must be the fade's change to the bed, (cos(π/2 · i/240) − 1) × the bed's sample, carried through the bed's
 * bus as its impulse response h carries any input (README: Readings, the fade through the reverb). */
function fadeFailures(a: RunA, y: Float32Array[]): string[] {
  const imp = putEvidence(a.evidence, impulseWav());
  const [twin, response] = runShow(shows.bin(), scenario(a.evidence, [
    mixCall(filmSound(a.bed, '21s'), 0, FILM.duration),
    mixCall(impulseSound(imp), 0, 240 * SAMPLE),
  ]), 'the film\'s sound without its end fade, and the bed\'s bus\'s impulse response');
  const z = mixed(a.evidence, twin, FILM.samples, 'the twin\'s sound');
  const h = mixed(a.evidence, response, 240, 'the impulse response').map((c) => Array.from(c, (x) => x / IMPULSE_HEIGHT));
  const n0 = FILM.samples - 240;
  const out: string[] = [];
  const before = firstDiff(y, n0 - 4_800, z, n0 - 4_800, 4_800);
  if (before !== null) out.push(`sample ${n(n0 - 4_800 + before)}, before the fade: the film's PCM differs from its twin's, so the twin isn't the film's sound without its end fade`);
  const change = Array.from({ length: 240 }, (_, i) => (Math.cos((Math.PI / 2) * (i / 240)) - 1) * bedAt(n0 + i));
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 240; i++) {
      let want = 0;
      for (let j = 0; j <= i; j++) want += h[c]![j]! * change[i - j]!;
      peak = Math.max(peak, Math.abs(want));
      const got = y[c]![n0 + i]! - z[c]![n0 + i]!;
      if (!(Math.abs(got - want) <= 1e-6)) { out.push(`sample ${n(n0 + i)} (channel ${c}), fade sample ${i} of 240: the bed's end changes the PCM by ${got}, the 5 ms equal-power fade through its bus by ${want}`); break; }
    }
  }
  if (!(peak > 1e-3)) out.push(`the fade changes the film's last 240 samples by at most ${peak}, so following the curve proves nothing`);
  return out;
}

/** The PNG range against its raw frames and the whole export's frames 300 to 329, naming the first frame that differs. */
function rangeFailures(reply: JsonObject | undefined, out: string, whole: string[]): string[] {
  const [lo, hi] = FILM.range;
  if (obj(reply, 'the PNG range')['outcome'] !== 'exported') return [`the PNG range [${lo}, ${hi}) wasn't exported: ${show(reply)}`];
  const r = receiptOf(reply, 'the PNG range');
  const f: string[] = [];
  if (r.frame_hashes.length !== hi - lo) f.push(`the range's receipt holds ${r.frame_hashes.length} frames, not ${hi - lo}`);
  const raw = r.frame_hashes.findIndex((h, k) => h !== whole[lo + k]);
  if (raw >= 0) f.push(`frame ${lo + raw}: the range's raw frame hashes ${r.frame_hashes[raw]}, the whole export's frame ${lo + raw} ${whole[lo + raw]}`);
  const pngs = pngFiles(out);
  if (pngs.length !== hi - lo) f.push(`the range wrote ${pngs.length} PNGs, not ${hi - lo}`);
  let toRaw = -1; let toWhole = -1;
  pngs.forEach((file, k) => {
    const p = pngHash(file);
    if (p.width !== FILM.size[0] || p.height !== FILM.size[1]) f.push(`frame ${lo + k}: its PNG is ${p.width} × ${p.height}, not 1920 × 1080`);
    if (toRaw < 0 && p.hash !== r.frame_hashes[k]) { toRaw = k; f.push(`frame ${lo + k}: its PNG decodes to ${p.hash}, its raw frame is ${r.frame_hashes[k]}`); }
    if (toWhole < 0 && p.hash !== whole[lo + k]) { toWhole = k; f.push(`frame ${lo + k}: its PNG decodes to ${p.hash}, the whole export's frame ${lo + k} is ${whole[lo + k]}`); }
  });
  return f;
}

/** The seek range [450, 480) from a fresh process against the whole export: frames, PCM spans and decoded samples. */
function seekFailures(reply: JsonObject | undefined, file: string, whole: Receipt, pcm: Float32Array[]): string[] {
  const [lo, hi] = FILM.seek;
  if (obj(reply, 'the seek range')['outcome'] !== 'exported') return [`the range [${lo}, ${hi}) wasn't exported: ${show(reply)}`];
  const r = receiptOf(reply, 'the seek range');
  const f: string[] = [];
  const named = `the processor${BED_PROCESSORS.length > 1 ? 's' : ''} ${BED_PROCESSORS.map((p) => `\`${p}\``).join(', ')} on the bed's bus`;
  if (r.frame_hashes.length !== hi - lo) f.push(`the range's receipt holds ${r.frame_hashes.length} frames, not ${hi - lo}`);
  const fk = r.frame_hashes.findIndex((h, k) => h !== whole.frame_hashes[lo + k]);
  if (fk >= 0) f.push(`frame ${lo + fk}: the range's frame hashes ${r.frame_hashes[fk]}, the whole export's ${whole.frame_hashes[lo + fk]}`);
  const pk = r.pcm_hashes.length === hi - lo ? r.pcm_hashes.findIndex((h, k) => h !== whole.pcm_hashes[lo + k]) : 0;
  if (pk >= 0) f.push(`${named}: frame ${lo + pk}'s PCM span hashes ${String(r.pcm_hashes[pk])}, the whole export's ${String(whole.pcm_hashes[lo + pk])}`);
  let mp4: Mp4;
  try { mp4 = readMp4(readFileSync(file), 'the range\'s MP4'); } catch (e) { return [...f, `the range's MP4 can't be read: ${(e as Error).message}`]; }
  f.push(...videoFailures(mp4, hi - lo).map((x) => `the range's MP4: ${x}`));
  const got = mp4.audio?.pcm;
  const span = (hi - lo) * FILM.samplesPerFrame; const from = lo * FILM.samplesPerFrame;
  if (!got || (got[0]?.length ?? 0) !== span || mp4.audio?.presentedFrom !== 0) f.push(`the range's MP4 doesn't hold ${n(span)} samples a channel of PCM from time 0`);
  else {
    const d = firstDiff(got, 0, pcm, from, span);
    if (d !== null) f.push(`${named}: the range's PCM first differs from the whole export's at sample ${n(from + d)} (${((from + d) / FILM.sampleRate).toFixed(6)} s), so the cold jump to 15 s didn't pre-roll the tail`);
  }
  return f;
}

/** Another whole export against the reference: the first frame that differs, and the PCM hash. */
function sameExport(ref: Receipt, reply: JsonObject | undefined, what: string): string[] {
  if (obj(reply, what)['outcome'] !== 'exported') return [`${what}: not exported: ${show(reply)}`];
  const r = receiptOf(reply, what);
  const f: string[] = [];
  if (r.frame_hashes.length !== ref.frame_hashes.length) f.push(`${what}: ${r.frame_hashes.length} frame hashes, not ${ref.frame_hashes.length}`);
  const k = ref.frame_hashes.findIndex((h, i) => h !== r.frame_hashes[i]);
  if (k >= 0) f.push(`${what}: the first frame that differs is frame ${k}: ${r.frame_hashes[k]} against ${ref.frame_hashes[k]}`);
  if (r.pcm_hashes.length === 0 || r.pcm_hashes.join() !== ref.pcm_hashes.join()) {
    const s = ref.pcm_hashes.findIndex((h, i) => h !== r.pcm_hashes[i]);
    f.push(`${what}: its PCM hash differs from the reference's${s >= 0 ? `, first at frame ${s}'s span` : ''}`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------

describe(`${AC[2]} the whole export: its receipt, its frames and samples read back, and the bed's end fade`, () => {
  it(`${AC[2]} the receipt records 1920 × 1080, 30 fps, 20 s and 600 frame hashes; the MP4 read by this suite holds 600 frames and 960,000 samples a channel, frame k's audio from sample k × 1,600, and the bed's last 240 samples follow the 5 ms equal-power fade within 1e-6`, () => {
    const a = runA();
    const whole = wholeOf(a);
    const f: string[] = [];
    if (show(whole.size) !== show(FILM.size)) f.push(`the receipt records ${show(whole.size)}, not 1920 × 1080`);
    if (show(whole.frame_rate) !== show(FILM.rate)) f.push(`the receipt records ${show(whole.frame_rate)}, not 30 fps`);
    if (whole.duration !== FILM.duration) f.push(`the receipt records ${n(whole.duration)} flicks, not 20 s (${n(FILM.duration)})`);
    if (whole.frame_hashes.length !== FILM.frames) f.push(`the receipt records ${whole.frame_hashes.length} frame hashes, not 600`);
    f.push(...deliveryFailures(a.replies[a.whole], join(a.dir, 'film.mp4')));
    const y = wholeMp4(a).audio?.pcm;
    if (y && (y[0]?.length ?? 0) === FILM.samples) f.push(...fadeFailures(a, y));
    none(f, 'the whole export');
  }, TIMEOUT);

  it(`${AC[2]} a planted video writer that drops frame 300 delivers 599 frames and fails, naming frame 300`, () => {
    const { replies: [reply], dir } = fresh((d) => [exportWhole(join(d, 'film.mp4'))], 'the whole film', 'video_drops_frame_300');
    failsNaming(deliveryFailures(reply, join(dir, 'film.mp4')), /\bframe 300\b|"frame":\s*300\b/, 'the planted video writer (video_drops_frame_300)');
  }, TIMEOUT);
});

describe(`${AC[3]} the PNG range and the still at title are the whole export's frames and the live frame`, () => {
  it(`${AC[3]} the 30 PNGs of [300, 330), decoded, hash equal to their raw frames and to the whole export's frames 300 to 329, and the still at title equals the settled live frame at the marker by hash`, () => {
    const a = runA();
    const whole = wholeOf(a).frame_hashes;
    const f = rangeFailures(a.replies[a.range], join(a.dir, 'range'), whole);
    const still = receiptOf(a.replies[a.still], 'the still at title');
    const stills = pngFiles(join(a.dir, 'still'));
    const live = obj(a.replies[a.live], 'the live frame at title');
    if (live['outcome'] !== 'evaluated') f.push(`the live frame at title isn't evaluated: ${show(live)}`);
    const snap = obj(arr(live['snapshots'], 'the live frame: snapshots')[0], 'the live frame: snapshots[0]');
    const shown = pngHash(getEvidence(a.evidence, hex64(snap['sha256'], 'the live frame: sha256'), 'the live frame'));
    if (stills.length !== 1 || still.frame_hashes.length !== 1) f.push(`the still is ${stills.length} PNGs and ${still.frame_hashes.length} frame hashes, not one`);
    else {
      const s = pngHash(stills[0]!);
      if (s.hash !== still.frame_hashes[0]) f.push(`the still's PNG decodes to ${s.hash}, its raw frame is ${still.frame_hashes[0]}`);
      if (s.hash !== shown.hash) f.push(`the still at title decodes to ${s.hash}, the settled live frame at the marker to ${shown.hash} (${shown.width} × ${shown.height})`);
      if (s.hash !== whole[FILM.titleFrame]) f.push(`the still at title decodes to ${s.hash}, the whole export's frame ${FILM.titleFrame} is ${whole[FILM.titleFrame]}`);
    }
    none(f, 'the PNG range and the still');
  }, TIMEOUT);

  it(`${AC[3]} a planted range that starts one frame late fails, naming frame 300`, () => {
    const whole = wholeOf(runA()).frame_hashes;
    const { replies: [reply], dir } = fresh((d) => [exportPngRange(join(d, 'range'))], 'frames [300, 330) as png_seq', 'range_starts_one_frame_late');
    failsNaming(rangeFailures(reply, join(dir, 'range'), whole), /^frame 300:/, 'the planted range (range_starts_one_frame_late)');
  }, TIMEOUT);
});

describe(`${AC[4]} seeking equals playing in the exports: a cold jump to 15 s`, () => {
  it(`${AC[4]} [450, 480) exported from a fresh process equals frames 450 to 479 and their PCM spans in the whole export by hash, sample for sample from 15 s`, () => {
    const a = runA();
    const whole = wholeOf(a); const pcm = wholePcm(a);
    const { replies: [reply], dir } = fresh((d) => [exportSeek(join(d, 'seek.mp4'))], 'frames [450, 480) from a fresh process');
    none(seekFailures(reply, join(dir, 'seek.mp4'), whole, pcm), 'the cold jump to 15 s');
  }, TIMEOUT);

  it(`${AC[4]} a planted reverb checkpoint without its tail differs at the first sample after 15 s and fails, naming the processor`, () => {
    const a = runA();
    const whole = wholeOf(a); const pcm = wholePcm(a);
    const { replies: [reply], dir } = fresh((d) => [exportSeek(join(d, 'seek.mp4'))], 'frames [450, 480) from a fresh process', 'reverb_restores_without_tail');
    failsNaming(seekFailures(reply, join(dir, 'seek.mp4'), whole, pcm), /processor `verb`.* at sample 720,000 /, 'the planted reverb checkpoint (reverb_restores_without_tail)');
  }, TIMEOUT);
});

describe(`${AC[5]} the export again, with 3 shards and live: the same frames and sound`, () => {
  it(`${AC[5]} the whole film exported again in a fresh process and with 3 shards gives the same frame hashes and PCM hash, and the PCM the live transport hands the device gate over the 20 s equals the export's by hash`, () => {
    const a = runA();
    const ref = wholeOf(a);
    const exported = sha256(interleaved(wholePcm(a), 0, FILM.samples));
    const again = fresh((d) => [exportWhole(join(d, 'again.mp4'))], 'the whole film again in a fresh process').replies[0];
    const sharded = fresh((d) => [exportWhole(join(d, 'shards.mp4'), 3)], 'the whole film with 3 shards in a fresh process').replies[0];
    const f = [...sameExport(ref, again, 'again in a fresh process'), ...sameExport(ref, sharded, 'with 3 shards')];
    // Live: the film in its panel; your click there gives the serial Play takes; the transport plays from 0.
    const evidence = temp();
    const d = new Driver(shows.bin(), evidence, film(putEvidence(evidence, bedWav())));
    const [press] = d.step(click(FLICKS), 'your click in the film\'s panel');
    const serial = int(obj(press, 'your click')['serial'], 'your click\'s serial');
    const [pressed, got] = d.step([play(FLICKS + 100 * MS, serial), handed(fl(23), 0, FILM.duration)], 'Play pressed, the film played live through its 20 s');
    if (obj(pressed, 'Play')['playing'] !== true) f.push(`your press of Play doesn't play the film: ${show(pressed)}`);
    const h = obj(got, 'handed')['handed'];
    if (!isObject(h)) f.push(`the live transport hands the device gate nothing to read over the 20 s: ${show(got)}`);
    else if (h['first'] !== 0 || h['frames'] !== FILM.samples) f.push(`the live transport handed samples [${show(h['first'])}, +${show(h['frames'])}), not [0, 960,000)`);
    else if (str(h['sha256'], 'handed.sha256') !== exported) {
      const live = readWav(getEvidence(evidence, hex64(h['wav'], 'handed.wav'), 'the live PCM'), 'the live PCM').channels;
      const at = firstDiff(live, 0, wholePcm(a), 0, Math.min(live[0]?.length ?? 0, FILM.samples));
      f.push(`the PCM the live transport handed the device gate hashes ${String(h['sha256'])}, the export's ${exported}${at !== null ? `; first different at sample ${n(at)}` : ''}`);
    }
    none(f, 'the export again, with 3 shards and live');
  }, TIMEOUT);

  it(`${AC[5]} a planted renderer that seeds noise from the clock fails, naming the first frame that differs`, () => {
    const once = fresh((d) => [exportWhole(join(d, 'once.mp4'))], 'the whole film', 'seeds_noise_from_clock').replies[0];
    const twice = fresh((d) => [exportWhole(join(d, 'twice.mp4'), 3)], 'the whole film again with 3 shards', 'seeds_noise_from_clock').replies[0];
    const f = sameExport(receiptOf(once, 'the planted export'), twice, 'the planted export again with 3 shards');
    failsNaming(f, /the first frame that differs is frame \d+:/, 'the planted renderer (seeds_noise_from_clock)');
  }, TIMEOUT);
});

describe(`${AC[6]} the film viewer moves only the transport, and no export changes the document or the session`, () => {
  it(`${AC[6]} . while paused at frame 100 shows export frame 101 by hash, ⌥→ from frame 0 lands on the marker title's first frame, and after each of the three exports the revision hash and the session state are unchanged`, () => {
    const a = runA();
    const whole = wholeOf(a).frame_hashes;
    const f: string[] = [];
    const [first, ...later] = a.checks;
    const was = currentOf(a.replies[first!.revisions], `revisions: ${first!.after}`);
    const state = obj(a.replies[first!.session], `session: ${first!.after}`)['session'];
    if (show(state) !== show(SESSION_STATE)) f.push(`the session state reads ${show(state)}, not the one set, ${show(SESSION_STATE)}`);
    for (const c of later) {
      const now = currentOf(a.replies[c.revisions], `revisions after ${c.after}`);
      if (now.hash !== was.hash || now.rev !== was.rev) f.push(`after ${c.after}: the current revision is ${now.rev} (${now.hash}), not ${was.rev} (${was.hash})`);
      const s = obj(a.replies[c.session], `session after ${c.after}`)['session'];
      if (show(s) !== show(state)) f.push(`after ${c.after}: the session state is ${show(s)}, not ${show(state)}`);
    }
    if (whole[100] === whole[101] || whole[0] === whole[FILM.titleFrame]) f.push('the export\'s frames 100 and 101, or 0 and 120, hash equal, so a step proves nothing');
    const viewer = (i: number, what: string): { paused: boolean; frame: number; t: number; hash: string } => {
      const v = obj(obj(a.replies[i], what)['viewer'], `${what}: viewer`);
      return { paused: v['paused'] === true, frame: int(v['frame'], `${what}: viewer.frame`), t: int(v['t'], `${what}: viewer.t`), hash: hex64(v['hash'], `${what}: viewer.hash`) };
    };
    const v100 = viewer(a.viewer.at100, 'the viewer after 2 and twenty ,');
    if (!v100.paused || v100.frame !== 100) f.push(`the viewer isn't paused at frame 100: ${show(v100 as unknown as JsonObject)}`);
    const v101 = viewer(a.viewer.at101, 'the viewer after .');
    if (v101.frame !== 101 || v101.hash !== whole[101]) f.push(`. while paused at frame 100 shows frame ${v101.frame} hashing ${v101.hash}, not export frame 101's ${whole[101]}`);
    const v0 = viewer(a.viewer.at0, 'the viewer after Home');
    if (v0.frame !== 0) f.push(`Home shows frame ${v0.frame}, not frame 0`);
    const vt = viewer(a.viewer.atTitle, 'the viewer after ⌥→');
    if (vt.frame !== FILM.titleFrame || vt.t !== FILM.title || vt.hash !== whole[FILM.titleFrame]) {
      f.push(`⌥→ from frame 0 lands on frame ${vt.frame} at ${n(vt.t)} flicks hashing ${vt.hash}, not the marker title's first frame ${FILM.titleFrame} at ${n(FILM.title)} (export frame ${FILM.titleFrame}: ${whole[FILM.titleFrame]})`);
    }
    none(f, 'the film viewer and the exports\' effect on the document');
  }, TIMEOUT);
});
