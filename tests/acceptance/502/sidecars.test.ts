// AC10 #502.60b58438: "The 12 s film exported at 24000/1001 writes an .srt and a .vtt that FFmpeg's subtitle demuxer
// reads with every cue at its caption's frame time rounded down to the millisecond; a planted writer that times cues
// at 24 fps fails at the last cue"
//
// Through `deep-show run`'s `export` (README: `export`): the fixture film at `frame_rate: [24000, 1001]` over its
// first 287 frames at that rate (11.97 s: 12 s is not a whole number of them; README: Readings), with `captions.files:
// [srt, vtt]`. The captions are laid out on that rate's frames, so the expected times are the fixture file's table for
// 24000/1001. The sidecars are read twice: by this suite's own readers of the forms the Export row gives (numbered
// from 1, `HH:MM:SS,mmm`; `WEBVTT`, `HH:MM:SS.mmm`; the caption's lines as the text), and by FFmpeg's SubRip and WebVTT
// demuxers through ffprobe, whose packets give each cue's start and end in whole milliseconds. Planted:
// `sidecar_times_at_24fps`, a writer that times each cue's frame count at 1/24 s a frame.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, NTSC, TIMEOUT, blocked, captionFailures, captionsOf, cueFailures, demuxed, exportCall, failsNaming, ffmpegTools, filmRun, none, parseSrt,
  parseVtt, receiptOf, sidecar, sidecarText, stage, table, useFileTemp, useShow, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('sidecars');
/** 287 frames of 29,429,400 flicks: the whole frames at 24000/1001 that the 12 s film holds. */
const FRAMES = 287;

/** The film exported at 24000/1001 with both sidecars: what is wrong with them, by this suite's readers and by
 * FFmpeg's demuxer (left out, and named in `blocked`, when FFmpeg isn't here). Each failure names its file and cue. */
function sidecarRun(planted?: Planted): { failures: string[]; blocked: string | null } {
  const evidence = temp(); const dir = temp();
  const out = join(dir, 'film.mp4');
  const frame = table(NTSC).frame;
  const [reply] = filmRun(shows.bin(FULL), evidence, stage(evidence).document, [
    exportCall({ doc: DOC.a, out, frame_rate: [24000, 1001], range: [0, FRAMES * frame], video: { codec: 'h264' }, audio: { codec: 'aac' }, captions: { mode: 'open', files: ['srt', 'vtt'] } }),
  ], 'the fixture film at 24000/1001', planted);
  const receipt = receiptOf(reply!, 'the export at 24000/1001');
  expect([receipt.frame_rate, receipt.frame_hashes.length, receipt.duration], 'the export records 24000/1001, 287 frames and their length').toEqual([[24000, 1001], FRAMES, FRAMES * frame]);
  const captions = captionsOf(receipt.raw, 'the export at 24000/1001');
  expect(captions.files, 'the receipt lists the files written').toEqual(['srt', 'vtt']);
  // The captions are laid out on the export's frames; the planted writer changes only what it writes.
  none(captionFailures(captions.cues, NTSC), 'the receipt\'s captions against the fixture file at 24000/1001');

  const [srt, vtt] = [sidecar(out, 'srt'), sidecar(out, 'vtt')];
  const failures = [
    ...cueFailures(parseSrt(sidecarText(srt, 'the export at 24000/1001'), 'film.srt'), NTSC, 'film.srt'),
    ...cueFailures(parseVtt(sidecarText(vtt, 'the export at 24000/1001'), 'film.vtt'), NTSC, 'film.vtt'),
  ];
  const tools = ffmpegTools();
  if (typeof tools === 'string') return { failures, blocked: tools };
  failures.push(...cueFailures(demuxed(tools.ffprobe, srt), NTSC, 'film.srt, read by FFmpeg\'s demuxer'), ...cueFailures(demuxed(tools.ffprobe, vtt), NTSC, 'film.vtt, read by FFmpeg\'s demuxer'));
  return { failures, blocked: null };
}

describe(`${AC[10]} the sidecars at 24000/1001 hold every cue at its caption's frame time, rounded down to the millisecond`, () => {
  it(`${AC[10]} the 12 s film exported at 24000/1001 writes film.srt and film.vtt whose four cues start and end at the fixture's frames of 1001/24000 s, rounded down to the millisecond, by this suite's readers and by FFmpeg's subtitle demuxer`, () => {
    const last = table(NTSC).captions[3]!;
    expect([last.in_ms, last.out_ms], 'the fixture\'s last cue: frames 258 and 280 at 24000/1001 are 10,760.75 and 11,678.33 ms, rounded down').toEqual([10760, 11678]);
    const r = sidecarRun();
    none(r.failures, 'the sidecars at 24000/1001');
    if (r.blocked) blocked(r.blocked);
  }, TIMEOUT);

  it(`${AC[10]} a planted writer that times cues at 24 fps fails at the last cue`, () => {
    const r = sidecarRun('sidecar_times_at_24fps');
    failsNaming(r.failures, /^film\.srt: cue 4 \(note\.1\) starts at 10750 ms, not 10760 ms/, 'the planted writer (sidecar_times_at_24fps), film.srt');
    failsNaming(r.failures, /^film\.vtt: cue 4 \(note\.1\) ends at 11666 ms, not 11678 ms/, 'the planted writer (sidecar_times_at_24fps), film.vtt');
    if (r.blocked) blocked(r.blocked);
    failsNaming(r.failures, /^film\.srt, read by FFmpeg's demuxer: cue 4 \(note\.1\) /, 'the planted writer (sidecar_times_at_24fps), read by FFmpeg');
  }, TIMEOUT);
});
