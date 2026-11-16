// AC7 #204.4e815a43: "An export of the engine fixture holds its loudness profile and its PCM hash equals the live
// render's over the same span; a planted export that renders the synth with another block size changes the hash and
// fails, naming the first block"
//
// The engine fixture as a film (README: Fixtures; 10 s at 24 fps, the speed channel bending at 4 s and at 6.001 s,
// sample 288,048, inside block 2,250), presented from your shell and exported as #501's and #502's delivery form
// (h264 with PCM sound), and played live in its panel on your press (#1163's live film, #499's `handed`).
//
// - "Holds its loudness profile": exported with `loudness_profile: "r128"`, it is delivered with the receipt's
//   readings inside R 128 (−23 ± 0.2 LUFS integrated, at most −1 dBTP), of its PCM and of the decoded delivery.
// - "Its PCM hash equals the live render's over the same span": exported with no profile (no delivery gain, which no
//   live render applies), the receipt's per-frame PCM hashes equal the hashes of what the live transport handed the
//   gate over the same frames, [0, 10 s), and the delivery's decoded sound is the receipt's PCM.
// - The planted `export_synth_block_64` renders the synth with 64-sample blocks in the export only: a frame's hash
//   differs, and the failure names the first 128-sample block in which the delivery's decoded samples leave the live
//   render's, which is at the latest the bend's block, 2,250.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  AC, BLOCK, CLICK_UP, Driver, ENGINE, FLICKS, MS, RATE, SEC, TIMEOUT, arr, click, decodeCall, engineFilm, exportCall, filmScenario, handed, handedOf, hashOf,
  installCall, installed, interleavedOf, isObject, num, obj, pcmOf, play, playing, present, presented, read, runShow, secs, serialOf, show, str, useShow,
  useTemp, writePack, type JsonObject, type PackFixture, type Planted,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

const FRAMES = 240;
const PER_FRAME = (FLICKS / 24) * RATE / FLICKS; // 2,000 samples
const BEND_BLOCK = Math.floor(Math.ceil(6.001 * RATE) / BLOCK); // 2,250

function receiptOf(reply: JsonObject | undefined, what: string): JsonObject {
  expect(obj(reply, what)['outcome'], `${what} is exported: ${show(reply, 1500)}`).toBe('exported');
  return obj(reply!['receipt'], `${what}: receipt`);
}
const hashesOf = (r: JsonObject, what: string): string[] => arr(r['pcm_hashes'], `${what}: receipt.pcm_hashes`).map((h, i) => str(h, `${what}: receipt.pcm_hashes[${i}]`));
/** Each frame's hash of interleaved f32le samples [2,000 k, 2,000 (k + 1)). */
const frameHashes = (channels: Float32Array[]): string[] =>
  Array.from({ length: FRAMES }, (_, k) => hashOf(interleavedOf(channels, k * PER_FRAME, (k + 1) * PER_FRAME)));

/** The delivery's sound, decoded by the decode worker. */
function decoded(reply: JsonObject | undefined, out: string, what: string): Float32Array[] {
  const d = obj(obj(reply, what)['decoded'], `${what}: decoded (${show(reply, 600)})`);
  const audio = arr(d['streams'], `${what}: decoded.streams`).filter((s): s is JsonObject => isObject(s) && s['type'] === 'audio');
  expect(audio.length, `${what}: the delivery holds one audio track`).toBe(1);
  const s = audio[0]!;
  expect(num(s['sample_rate'], `${what}: the audio track's sample_rate`), `${what}: the audio track is at 48 kHz`).toBe(RATE);
  const nch = num(s['channels'], `${what}: the audio track's channels`);
  const bytes = read(join(out, str(s['file'], `${what}: the audio track's file`)));
  const frames = Math.floor(bytes.length / (4 * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c]![i] = bytes.readFloatLE(4 * (i * nch + c));
  return channels;
}

interface Run { r128: JsonObject; plain: JsonObject; delivery: Float32Array[]; live: Float32Array[] }
function run(planted?: Planted): Run {
  const root = temp();
  const evidence = temp();
  const dir = temp();
  const pack: PackFixture = writePack(root, 'engines', { engine: ENGINE });
  const film = engineFilm(pack);
  const tag = planted ? ` (planted ${planted})` : '';
  const [inst, shown, r128, plain] = runShow(bin(), filmScenario(evidence, [installCall(pack), present(film), exportCall(join(dir, 'r128.mp4'), 'r128'), exportCall(join(dir, 'plain.mp4'))], planted), `the engine film exported${tag}`);
  installed(inst, 'the pack engines');
  presented(shown, 'the engine film');
  const out = temp();
  const [dec] = runShow(bin(), { evidence, calls: [decodeCall(join(dir, 'plain.mp4'), out)] }, `the plain delivery decoded${tag}`);
  // Live: the film in its panel; your click there gives the serial Play takes; the transport plays from 0.
  const d = new Driver(bin(), { evidence, film: true, ...(planted ? { planted } : {}) });
  const [i2, p2, press] = d.step([installCall(pack, MS), present(film, 2 * MS), ...click(SEC)], `the engine film in its panel${tag}`);
  installed(i2, 'the pack engines, live');
  presented(p2, 'the engine film, live');
  const [pressed, got] = d.step([play(SEC + CLICK_UP, { serial: serialOf(press, 'your click') }), handed(secs(12), 0, secs(10))], `Play pressed, the film played live through its 10 s${tag}`);
  expect(playing(pressed), `your press of Play plays the film: ${show(pressed, 400)}`).toBe(true);
  const live = pcmOf(evidence, handedOf(got, 0, secs(10), 'what the live transport handed the gate'), RATE, 'the live 10 s').channels;
  return { r128: receiptOf(r128, `the r128 export${tag}`), plain: receiptOf(plain, `the export with no profile${tag}`), delivery: decoded(dec, out, `the plain delivery${tag}`), live };
}

/** What is wrong with the export against the live render; a difference names the first frame and the first block. */
function problems(x: Run): string[] {
  const f: string[] = [];
  const reading = (o: JsonObject, w: string) => ({ i: num(o['integrated'], `${w}.integrated`), tp: num(o['true_peak'], `${w}.true_peak`) });
  if (x.r128['loudness_profile'] !== 'r128') f.push(`the r128 export's receipt names the profile ${show(x.r128['loudness_profile'] ?? null)}`);
  for (const [w, o] of [['its PCM', x.r128], ['the decoded delivery', obj(x.r128['delivery'], 'the r128 receipt\'s delivery')]] as const) {
    const r = reading(o, `the r128 receipt (${w})`);
    if (Math.abs(r.i + 23) > 0.2 || r.tp > -1) f.push(`the r128 export doesn't hold R 128: ${w} reads ${r.i.toFixed(2)} LUFS and ${r.tp.toFixed(2)} dBTP`);
  }
  const want = frameHashes(x.live);
  const got = hashesOf(x.plain, 'the export with no profile');
  if (got.length !== FRAMES) f.push(`the export with no profile hashes ${got.length} frames of PCM, not ${FRAMES}`);
  const mine = frameHashes(x.delivery);
  const tied = mine.every((h, k) => h === got[k]);
  if (!tied) f.push(`the plain delivery's decoded sound isn't its receipt's PCM (first at frame ${mine.findIndex((h, k) => h !== got[k])})`);
  const frame = got.findIndex((h, k) => h !== want[k]);
  if (frame >= 0) {
    let block: number | null = null;
    for (let n = 0; n < FRAMES * PER_FRAME && block === null; n++) for (let c = 0; c < x.live.length; c++) if (!Object.is(x.delivery[c]![n], x.live[c]![n])) { block = Math.floor(n / BLOCK); break; }
    f.push(`the export's PCM hash differs from the live render's from frame ${frame}; the first block that differs is block ${block === null ? 'none' : `${block}`}`);
  }
  return f;
}

describe(`${AC[7]} the export of the engine fixture holds its profile and is the live render`, () => {
  it(`${AC[7]} the engine film exported holds R 128, and exported with no delivery gain its per-frame PCM hashes equal the live render's over its 10 s`, () => {
    const f = problems(run());
    expect(f, 'the export holds its profile and equals the live render').toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} a planted export that renders the synth with 64-sample blocks changes the hash and fails, naming the first block`, () => {
    const f = problems(run('export_synth_block_64'));
    const named = f.map((x) => /the first block that differs is block (\d+)$/.exec(x)).find((m) => m !== null);
    expect(named, `planted export_synth_block_64 changes the export's hash and fails, naming the first block; got ${JSON.stringify(f)}`).toBeDefined();
    expect(Number(named![1]) <= BEND_BLOCK, `planted export_synth_block_64: the first block named, ${named![1]}, is at the latest the bend's block ${BEND_BLOCK}`).toBe(true);
  }, TIMEOUT);
});
