// AC7 #204.4e815a43: "An export of the engine fixture holds its loudness profile and its PCM hash equals the live
// render's over the same span; a planted export that renders the synth with another block size changes the hash and
// fails, naming the first block"
//
// The engine fixture is criterion 1's: a preset that maps a car's speed channel, rising from 0 to 30 m/s over 4 s, to
// a sine oscillator at 60 Hz plus 4 Hz per m/s (README: Fixtures). The live render is what the film's panel's live
// transport hands the device gate after your click and Play (#499's `handed`, the film in its own panel as #1163 plays
// it). The exports are `deep-show run`'s `export` of the whole film as an MP4 with PCM sound: one naming the loudness
// profile r128, held to it on its receipt, on its receipt's delivery and by the loudness bake of its decoded file; and
// one naming none, which applies no gain, so its PCM can equal the live render's bit for bit (README: Readings). Each
// delivery is read back by the decode worker and checked against its receipt's per-frame PCM hashes before it is
// compared. Planted: `export_synth_block_64`, through the scenario's `planted`, in both the export's run and the live
// one.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC7, BLOCK, Driver, FILM, FLICKS, MS, PACKS, PLANTED, RISE, TIMEOUT, click, crossingsHz, decodeCall, decodedSound, engineFilm,
  exportCall, failsNaming, firstDiff, fl, getEvidence, handed, hex64, hzAt, int, interleaved, loudnessOf, meanSquare, meter, n,
  none, obj, play, present, presented, readWav, receiptOf, runShow, scenario, secondsOf, sha256, show, useRoot, useShow, writePack,
  type JsonObject, type Planted, type Sound,
} from './helpers.ts';

const shows = useShow();
const temp = useRoot();

// ---------------------------------------------------------------------------------------------------
// The runs: the exports in one process, the live render in another (the app world), each made once per program.

interface Delivered { reply: JsonObject; sound: Sound | string; evidence: string }
interface Exports { plain: Delivered; r128: Delivered | null }
/** One `deep-show run`: the engine film presented, then its whole span exported with no loudness profile named and,
 * for the clean program, again at r128; each delivery read back by the decode worker. */
function exportsRun(planted?: Planted): Exports {
  const evidence = temp(); const dir = temp();
  const pack = writePack(temp());
  const out = (name: string): string => join(dir, `${name}.mp4`);
  const calls: JsonObject[] = [present(engineFilm()), PACKS, exportCall(out('plain')), decodeCall(out('plain'), join(dir, 'plain-sound'))];
  if (!planted) calls.push(exportCall(out('r128'), 'r128'), decodeCall(out('r128'), join(dir, 'r128-sound')));
  const what = 'the engine film exported';
  const replies = runShow(shows.bin(), scenario(evidence, pack, calls, planted), what);
  presented(replies[0], replies[1], `${what}: the engine film`);
  const delivered = (k: number, name: string): Delivered => {
    const reply = replies[k]!;
    let sound: Sound | string;
    if (reply['outcome'] !== 'exported') sound = `the export wasn't delivered, so there is nothing to decode`;
    else {
      try { sound = decodedSound(replies[k + 1], join(dir, `${name}-sound`), `the ${name} export's MP4, decoded`); } catch (e) { sound = (e as Error).message; }
    }
    return { reply, sound, evidence };
  };
  return { plain: delivered(2, 'plain'), r128: planted ? null : delivered(4, 'r128') };
}

interface Live { sha256: string; pcm: Float32Array[] }
/** The live render: the film in its panel, your click there, Play with that click's serial, and what the transport
 * handed the device gate over the film's [0, 6 s), asked at 8 s. */
function liveRun(planted?: Planted): Live {
  const evidence = temp();
  const d = new Driver(shows.bin(), evidence, writePack(temp()), engineFilm(), planted);
  const [press] = d.step(click(FLICKS), 'your click in the engine film\'s panel');
  const serial = int(obj(press, 'your click')['serial'], 'your click\'s serial');
  const [pressed, got] = d.step([play(FLICKS + 100 * MS, serial), handed(fl(8), 0, FILM.duration)], 'Play pressed, the engine film played live through its 6 s');
  expect(obj(pressed, 'Play')['playing'], `your press of Play plays the engine film: ${show(pressed)}`).toBe(true);
  const h = obj(obj(got, 'handed')['handed'], `what the live transport handed the device gate (${show(got)})`);
  expect([h['sample_rate'], h['channels'], h['first'], h['frames']], 'the live transport handed the gate the film\'s [0, 6 s): 48 kHz stereo, samples [0, 288,000)')
    .toEqual([FILM.sampleRate, 2, 0, FILM.samples]);
  const wav = readWav(getEvidence(evidence, hex64(h['wav'], 'handed.wav'), 'the live PCM'), 'the live PCM');
  const digest = hex64(h['sha256'], 'handed.sha256');
  expect(sha256(interleaved(wav.channels, 0, FILM.samples)), 'handed.sha256 is the SHA-256 of its WAV\'s samples as interleaved f32le').toBe(digest);
  return { sha256: digest, pcm: wav.channels };
}

const memo = new Map<string, Exports | Live | Error>();
function once<T extends Exports | Live>(key: string, make: () => T): T {
  const m = memo.get(key);
  if (m instanceof Error) throw m;
  if (m) return m as T;
  try { const v = make(); memo.set(key, v); return v; } catch (e) { const err = e instanceof Error ? e : Error(String(e)); memo.set(key, err); throw err; }
}
const cleanExports = (): Exports => once('exports', () => exportsRun());
const cleanLive = (): Live => once('live', () => liveRun());

// ---------------------------------------------------------------------------------------------------
// The checks, each returning failures; the planted program's run must give one naming its first block.

/** A delivery read back: stereo at 48 kHz, at least the film's 288,000 samples, each frame's span hashing to the
 * receipt's PCM hash for that frame, so what this suite compares is the PCM the export hashed. */
function deliveredFailures(d: Delivered, pcmHashes: string[], what: string): string[] {
  if (typeof d.sound === 'string') return [`${what}: ${d.sound}`];
  const s = d.sound;
  if (s.rate !== FILM.sampleRate || s.channels.length !== 2) return [`${what}: the decoded sound is ${s.channels.length} channels at ${s.rate} Hz, not stereo at 48 kHz`];
  if ((s.channels[0]?.length ?? 0) < FILM.samples) return [`${what}: the decoded sound holds ${n(s.channels[0]?.length ?? 0)} samples a channel, not ${n(FILM.samples)}`];
  const off = pcmHashes.findIndex((h, k) => h !== sha256(interleaved(s.channels, k * FILM.samplesPerFrame, (k + 1) * FILM.samplesPerFrame)));
  return off < 0 ? [] : [`${what}: the decoded delivery's frame ${off} doesn't hash to the receipt's PCM hash for that frame, so the file isn't the PCM the export hashed`];
}

/** AC7's hash check: the export's PCM over the film's [0, 6 s) against the live render's, by the receipt's per-frame
 * hashes and by the SHA-256 of the whole span; where they differ, the failure names the first block, the 128-sample
 * block of the document's sample grid that holds the first sample that differs. */
function againstLive(d: Delivered, live: Live): string[] {
  if (d.reply['outcome'] !== 'exported') return [`the export wasn't delivered: ${show(d.reply, 1500)}`];
  const receipt = receiptOf(d.reply, 'the export');
  const f: string[] = [];
  if (receipt.pcm_hashes.length !== FILM.frames) f.push(`the receipt holds ${receipt.pcm_hashes.length} PCM hashes, not one for each of the film's ${FILM.frames} frames`);
  const read = deliveredFailures(d, receipt.pcm_hashes, 'the export\'s MP4');
  f.push(...read);
  const liveFrame = (k: number): string => sha256(interleaved(live.pcm, k * FILM.samplesPerFrame, (k + 1) * FILM.samplesPerFrame));
  const frames = receipt.pcm_hashes.flatMap((h, k) => (k < FILM.frames && h !== liveFrame(k) ? [k] : []));
  if (read.length === 0 && typeof d.sound !== 'string') {
    const exported = sha256(interleaved(d.sound.channels, 0, FILM.samples));
    if (exported !== live.sha256) {
      const at = firstDiff(d.sound.channels, live.pcm, FILM.samples)!;
      const k = Math.floor(at / BLOCK);
      f.unshift(`block ${k}: the export's PCM first differs from the live render's at sample ${n(at)} (${secondsOf(at)} s), in block ${k}'s samples [${n(k * BLOCK)}, ${n((k + 1) * BLOCK)}); over [0, ${n(FILM.samples)}) the export's PCM hashes ${exported}, the live render's ${live.sha256}`);
    }
  }
  if (frames.length > 0) f.push(`${frames.length} of the receipt's ${FILM.frames} PCM hashes differ from the live render's frame spans, the first frame ${frames[0]}`);
  return f;
}

/** The fixture is the engine: the live render is a tone on both channels, at 60 Hz while the car stands and at 180 Hz
 * once it holds 30 m/s, so an export equal to it has rendered the synth, not silence. */
function engineFailures(live: Live): string[] {
  const f: string[] = [];
  const at = (s: number): number => Math.round(s * FILM.sampleRate);
  const spans: [string, number, number, number, number][] = [
    ['standing, 0.2 s to 0.95 s', at(0.2), at(0.95), hzAt(0), 2],
    ['at 30 m/s, 5.05 s to 5.45 s', at(5.05), at(5.45), hzAt(RISE.top), 3],
  ];
  for (const [name, a, b, hz, band] of spans) {
    for (const [c, x] of live.pcm.entries()) {
      const rms = Math.sqrt(meanSquare(x, a, b));
      if (!(rms > 0.05)) f.push(`the live render's channel ${c} is nearly silent ${name} (RMS ${rms.toExponential(3)}), so equal PCM would prove nothing`);
    }
    const got = crossingsHz(live.pcm[0]!, a, b, FILM.sampleRate);
    if (!(Math.abs(got - hz) <= band)) f.push(`the live render's pitch ${name} is ${got.toFixed(2)} Hz, not the engine's ${hz} Hz (60 Hz plus 4 Hz per m/s) within ${band} Hz`);
  }
  return f;
}

/** R 128 (Loudness and caption profiles): −23.0 LUFS ± 0.2 LU, true peak at most −1 dBTP, and for a programme up to 2
 * minutes, as this 6 s film is, a short-term maximum at most −18.0 LUFS. Each failure names its measure. */
function r128Failures(r: { integrated: number; true_peak: number; max_s: number }, where: string): string[] {
  const f: string[] = [];
  if (!(Math.abs(r.integrated + 23) <= 0.2 + 1e-9)) f.push(`integrated: ${where} reads ${r.integrated.toFixed(3)} LUFS, not −23.0 ± 0.2`);
  if (!(r.true_peak <= -1 + 1e-9)) f.push(`true_peak: ${where} reads ${r.true_peak.toFixed(3)} dBTP, above −1`);
  if (!(r.max_s <= -18 + 1e-9)) f.push(`max_s: ${where} reads a short-term maximum of ${r.max_s.toFixed(3)} LUFS, above −18.0`);
  return f;
}

// ---------------------------------------------------------------------------------------------------

describe(`${AC7} an export of the engine fixture holds its loudness profile, and its PCM hash equals the live render's over the same span`, () => {
  it(`${AC7} the engine film exported with no loudness profile named applies no gain, and its PCM over [0, 6 s) hashes equal to what the live transport hands the device gate over [0, 6 s), frame span by frame span and whole`, () => {
    const live = cleanLive();
    const { plain } = cleanExports();
    const f = [...engineFailures(live), ...againstLive(plain, live)];
    if (plain.reply['outcome'] === 'exported') {
      const receipt = obj(plain.reply['receipt'], 'the export\'s receipt');
      if (receipt['loudness_profile'] !== 'none') f.push(`an export that names no loudness profile names none on its receipt, not ${show(receipt['loudness_profile'])}`);
      if (receipt['gain'] !== 0) f.push(`the profile none applies no gain, but the receipt reads gain ${show(receipt['gain'])}`);
    }
    none(f, 'the engine film exported with no loudness profile, against the live render');
  }, TIMEOUT);

  it(`${AC7} the engine film exported at r128 holds r128 on its receipt, on its receipt's delivery and by the loudness bake of its decoded MP4, and its PCM is the live render's at the one static gain the receipt names`, () => {
    const live = cleanLive();
    const { r128 } = cleanExports();
    const d = r128!;
    if (d.reply['outcome'] !== 'exported') expect.fail(`the r128 export of the engine film was not delivered (an export outside its profile FAILs, naming the measure): ${show(d.reply, 1500)}`);
    const receipt = receiptOf(d.reply, 'the r128 export');
    const loud = loudnessOf(receipt.raw, 'the r128 export');
    const f: string[] = [];
    if (loud.profile !== 'r128') f.push(`the receipt names the loudness profile ${loud.profile}, not r128`);
    f.push(...r128Failures(loud, 'the receipt, of the PCM it delivers,'), ...r128Failures(loud.delivery, 'the receipt\'s delivery'));
    const read = deliveredFailures(d, receipt.pcm_hashes, 'the r128 export\'s MP4');
    f.push(...read);
    if (read.length === 0 && typeof d.sound !== 'string') {
      const sound = d.sound;
      const heard = meter(shows.bin(), d.evidence, { rate: sound.rate, channels: sound.channels.map((c) => c.subarray(0, FILM.samples)) }, 'the loudness bake of the r128 export\'s decoded MP4');
      f.push(...r128Failures(heard, 'the loudness bake of the decoded MP4'));
      // One static gain ahead of the master's limiter, which a −23 LUFS sine never brings to its ceiling.
      if (loud.limiter_cut) f.push('limiter_cut: the limiter cut, and the engine at −23 LUFS peaks far under its ceiling');
      const a = 10 ** (loud.gain / 20);
      let worst = 0; let where = 0;
      for (let i = 0; i < FILM.samples; i++) {
        for (let c = 0; c < 2; c++) {
          const e = Math.abs(sound.channels[c]![i]! - live.pcm[c]![i]! * a);
          if (!(e <= worst)) { worst = e; where = i; }
        }
      }
      if (!(worst <= 1e-6)) f.push(`the r128 delivery isn't the live render at the receipt's gain of ${loud.gain.toFixed(4)} dB: at sample ${n(where)} (${secondsOf(where)} s) it is ${worst.toExponential(3)} away`);
    }
    none(f, 'the engine film at r128');
  }, TIMEOUT);
});

describe(`${AC7} a planted export that renders the synth with another block size`, () => {
  it(`${AC7} a planted export that renders the synth with 64-sample blocks while the live render keeps 128 (${PLANTED}) changes the hash and fails, naming the first block`, () => {
    const live = liveRun(PLANTED);
    const { plain } = exportsRun(PLANTED);
    const failures = againstLive(plain, live);
    expect(plain.reply['outcome'], `the planted export is delivered: ${show(plain.reply, 1500)}`).toBe('exported');
    const sound = plain.sound;
    expect(typeof sound === 'string' ? sound : '', 'the planted export\'s MP4 is read back').toBe('');
    const channels = (sound as Sound).channels;
    const exported = sha256(interleaved(channels, 0, FILM.samples));
    expect(exported === live.sha256, `the planted export changes the hash: its PCM over [0, ${n(FILM.samples)}) hashes ${exported}, the live render's ${live.sha256}`).toBe(false);
    const at = firstDiff(channels, live.pcm, FILM.samples);
    expect(at, 'the planted export\'s PCM differs from the live render\'s at some sample').not.toBeNull();
    const block = Math.floor(at! / BLOCK);
    failsNaming(failures, new RegExp(`^block ${block}: `), `the planted export (${PLANTED}), whose PCM first differs at sample ${n(at!)} in block ${block}`);
  }, TIMEOUT);
});
