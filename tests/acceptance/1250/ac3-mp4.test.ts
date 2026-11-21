// AC3 #1250.ba96e86c: "On a fixture piece with a non-indexed look, Save clip writes an MP4 with the piece's sound whose
// frames match the export of the same range from the same track by the export guard's comparison (#157)"
//
// Through `deep-show run` (full), in two runs. First the piece under #157's drawing look (README: Fixtures: the tone
// piece, 160 × 90, a tone that changes pitch each second) plays 13 s of the scripted play in panel `main`, ⌘⇧C saves
// the last 10 s, `clips` reads the card and `track` the input track the app kept. Then a fresh run exports the same
// range, [3 s, 13 s), from that track through #501's range export as a PNG sequence at the clip's size: its frames are
// the raw frames exactly (png's fidelity is exact). The export guard's comparison is export.fidelity's: every frame there
// once, in order, and each decoded frame's BT.709 luma within the floor of the delivery's quality, PSNR-Y 40 dB at
// `standard` (Export: `video.quality`), against the raw frame. The clip is decoded by FFmpeg, a reader the writer
// doesn't control (#157's helpers), and FFmpeg is BLOCKED when absent. Its sound: one track, 48 kHz, exactly 480,000
// sample frames a channel (every sample once, priming removed), and in each of its ten seconds the tone of the piece's
// second 3 + i, by a Goertzel reading of each candidate pitch. No wrong program is named.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, SR, TIMEOUT, TONE_SECONDS, arr, bgra, clipsCall, decodePng, exportsDir, ffPcm, ffLuma, ffprobeJson, filesIn, fl, goertzel, isObject,
  lumaOf, mse, none, obj, oneClip, pngFrames, presented, runApp, saveClipKey, scriptedPlay, show, showAt, toneDoc, toneHz, trackCall, useShow, useTemp,
  writtenFile, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const KEY = fl(13);
const RANGE: [number, number] = [fl(3), KEY];
const FLOOR_DB = 40;

describe(`${AC[3]} on a non-indexed look, Save clip writes an MP4 with the piece's sound, true to the range export by export.fidelity's comparison`, () => {
  it(`${AC[3]} the tone piece's clip of [3 s, 13 s) is an MP4 whose 600 frames each read at least 40 dB PSNR-Y against the range export's raw frames from the same track, with the piece's sound over that range`, () => {
    const evidence = temp(); const state = temp();
    const calls = [showAt(DOC.tone, toneDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY), trackCall(DOC.tone, KEY)];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.tone }, calls, 'the 13 s play and its clip');
    presented(replies[0]!, 'the tone piece');
    const card = oneClip(replies[calls.length - 2]!, 'save_clip', 'the clip');
    expect(card.range, `the card's range is [3 s, 13 s): ${show(card.raw)}`).toEqual(RANGE);
    writtenFile(card, state, DOC.tone, 'mp4', 'the clip');
    expect(filesIn(exportsDir(state, DOC.tone)), 'the exports folder holds the clip and nothing else').toEqual([card.file!.split('/').pop()]);
    const track = arr(obj(replies[calls.length - 1]!, 'track')['track'], 'track.track') as JsonObject[];
    expect(track.length, 'the app kept the scripted play\'s entries').toBeGreaterThan(10);

    const streams = arr(ffprobeJson(['-show_entries', 'stream=codec_type,width,height,sample_rate,channels', card.file!])['streams'], 'ffprobe streams').filter(isObject);
    const video = streams.filter((s) => s['codec_type'] === 'video'); const audio = streams.filter((s) => s['codec_type'] === 'audio');
    expect([video.length, audio.length], `the MP4 holds one video and one sound track: ${show(streams)}`).toEqual([1, 1]);
    const [w, h] = [Number(video[0]!['width']), Number(video[0]!['height'])];

    const out = join(temp(), 'range');
    const exported = runApp(shows.bin(FULL), { evidence, state: temp(), doc: DOC.tone }, [
      showAt(DOC.tone, toneDoc(evidence)),
      { call: 'export', at: 0, doc: DOC.tone, out, range: RANGE, track, size: [w, h], video: { codec: 'png_seq' } },
    ], 'the range export from the same track');
    expect(exported[1]!['outcome'], `the range exports: ${show(exported[1])}`).toBe('exported');
    const raw = pngFrames(out, 'the range export').map((p) => decodePng(p));
    expect(raw.length, 'the range export holds 10 s at 60 a second').toBe(600);
    expect(raw.every((r) => r.width === w && r.height === h), `the range export is at the clip's size, ${w} × ${h}`).toBe(true);

    const clipY = ffLuma(card.file!, w, h);
    const failures: string[] = [];
    if (clipY.length !== raw.length) failures.push(`frames: the clip decodes to ${clipY.length} frames, the range export holds ${raw.length}`);
    let worst = Infinity;
    for (let k = 0; k < Math.min(clipY.length, raw.length); k++) {
      const e = mse(new Uint8Array(clipY[k]!), lumaOf(bgra(raw[k]!)));
      const db = e === 0 ? Infinity : 10 * Math.log10((255 * 255) / e);
      worst = Math.min(worst, db);
      if (db < FLOOR_DB && failures.length < 12) failures.push(`frame ${k}: PSNR-Y ${db.toFixed(2)} dB against the range export's raw frame, under ${FLOOR_DB} dB`);
    }
    console.log(`${AC[3]}: ${clipY.length} frames at ${w} × ${h}, worst PSNR-Y ${worst.toFixed(2)} dB`);

    const a = audio[0]!;
    if (Number(a['sample_rate']) !== SR) failures.push(`sound: ${String(a['sample_rate'])} Hz, not ${SR}`);
    const pcm = ffPcm(card.file!, Number(a['channels']));
    if (pcm[0]!.length !== 10 * SR) failures.push(`sound: ${pcm[0]!.length} sample frames a channel, not the range's ${10 * SR}`);
    for (const [c, ch] of pcm.entries()) for (let i = 0; i < 10 && (i + 1) * SR <= ch.length; i++) {
      const power = Array.from({ length: TONE_SECONDS }, (_, s) => goertzel(ch, i * SR + SR / 4, i * SR + (3 * SR) / 4, toneHz(s)));
      const loudest = power.indexOf(Math.max(...power));
      if (loudest !== 3 + i) failures.push(`sound: channel ${c}, second ${i} of the clip plays ${toneHz(loudest)} Hz, not the piece's second ${3 + i} (${toneHz(3 + i)} Hz)`);
    }
    none(failures, 'the clip against the range export of the same track and the piece\'s sound');
  }, TIMEOUT);
});
