// AC12 #501.b80fff7d: "At 30000/1001 fps with `drop_frame: true` and the default start, frame 1,799 is labelled
// 00:00:59;29, frame 1,800 is 00:01:00;02 and frame 17,982 is 00:10:00;00; at 60000/1001 fps frame 35,964 is
// 00:10:00;00; a planted labeller that also drops at every tenth minute labels frame 17,982 as 00:10:00;02 and fails,
// naming the frame"
// AC13 #501.65512eef: "At 24 fps with start 01:00:00:00, a 240-frame film's MP4 and ProRes exports carry a timecode
// track that the decode worker's probe reads as starting at frame number 86,400, and the receipt's last label is
// 01:00:09:23; `drop_frame: true` at 24000/1001 is refused at check, naming the rate; a planted writer that leaves the
// track at zero fails, naming the track"
// AC14 #501.dfbf3d0b: "A range export of frames [48, 168) of that film starts at 01:00:02:00; a planted range export
// that restarts at 01:00:00:00 fails, naming the first label"
//
// Through `deep-show run`. Labels: `export`'s plan form with `timecode` answers each asked frame's label, checked
// against SMPTE's drop-frame rule in closed form here (helpers.ts `label`) at the issue's frames and at every minute
// boundary of the first 21 minutes and 200 seeded frames. Files: the 240-frame film (README: Fixtures) exported to MP4
// (h264) and, on macOS, ProRes 4444 with `timecode: {start: "01:00:00:00"}`, and frames [48, 168) to MP4; each file is
// probed by the decode worker (`media_import`), whose probe lists the timecode track as a stream (README: `media_import`).
// Planted: `drop_frame_every_tenth_minute`, `timecode_track_zero`, `range_restarts_timecode`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, TIMEOUT, arr, blocked, exportCall, failsNaming, film, int, isObject, label, n, none, obj, plannedFrames, present,
  presented, putEvidence, receiptOf, runShow, scenario, seeded, show, toneWav, useShow, useTemp, type JsonObject, type Rate,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const NTSC: Rate = [30000, 1001];
const NTSC60: Rate = [60000, 1001];
const START = '01:00:00:00';

function labels(rate: Rate, frames: number[], planted?: string): ReturnType<typeof plannedFrames> {
  const evidence = temp();
  const replies = runShow(shows.bin(FULL), scenario(evidence, [
    present(DOC.a, film(putEvidence(evidence, toneWav()))),
    exportCall({ doc: DOC.a, frame_rate: rate, timecode: { drop_frame: true }, frames }),
  ]), `the drop-frame labels at ${rate.join('/')} fps`, planted);
  presented(replies[0]!, 'the film');
  return plannedFrames(replies[1]!, frames, `the plan's labels at ${rate.join('/')} fps`);
}
function labelFailures(rate: Rate, got: ReturnType<typeof plannedFrames>): string[] {
  return got.flatMap((f) => {
    const want = label(f.frame, rate, '00:00:00:00', true);
    return f.timecode === want ? [] : [`at ${rate.join('/')} fps frame ${n(f.frame)} is labelled ${String(f.timecode)}, not ${want}`];
  });
}

/** The receipt's labels and the probed timecode track of one export, against what they should be. */
function timecodeFailures(exported: JsonObject, probed: JsonObject, want: { first: number; start: string; last: string }, what: string): string[] {
  const failures: string[] = [];
  const tc = receiptOf(exported, what).timecode;
  if (!tc) failures.push(`${what}: the receipt records no timecode`);
  else {
    if (tc.start !== want.start) failures.push(`${what}: the first label is ${tc.start}, not ${want.start}`);
    if (tc.last !== want.last) failures.push(`${what}: the last label is ${tc.last}, not ${want.last}`);
  }
  const streams = arr(obj(obj(obj(probed, `${what}: the probe`)['asset'], `${what}: probe asset`)['probe'], `${what}: probe`)['streams'], `${what}: probe streams`);
  const i = streams.findIndex((s) => isObject(s) && s['type'] === 'timecode');
  if (i < 0) failures.push(`${what}: the decode worker's probe finds no timecode track among ${streams.length} streams: ${show(streams, 600)}`);
  else {
    const first = int(obj(streams[i], `${what}: the timecode stream`)['start_frame'], `${what}: the timecode track's start_frame`);
    if (first !== want.first) failures.push(`${what}: the timecode track (stream ${i}) starts at frame ${n(first)}, not ${n(want.first)}`);
  }
  return failures;
}

interface FileRun { exported: JsonObject; probed: JsonObject; out: string }
/** Exports of the film, each followed by the decode worker's probe of the file it wrote. */
function exportsOf(asks: { name: string; codec: string; range?: [string, string] }[], planted?: string, extra: JsonObject[] = []): { files: Map<string, FileRun>; extra: JsonObject[] } {
  const evidence = temp(); const dir = temp();
  const calls: JsonObject[] = [present(DOC.a, film(putEvidence(evidence, toneWav())))];
  for (const a of asks) {
    const out = join(dir, a.name);
    calls.push(exportCall({ doc: DOC.a, out, video: { codec: a.codec }, timecode: { start: START }, ...(a.range ? { range: a.range } : {}) }), { call: 'media_import', path: out });
  }
  calls.push(...extra);
  const replies = runShow(shows.bin(FULL), scenario(evidence, calls), `the film's exports with start ${START}`, planted);
  presented(replies[0]!, 'the film');
  const files = new Map(asks.map((a, i) => [a.name, { exported: replies[1 + 2 * i]!, probed: replies[2 + 2 * i]!, out: join(dir, a.name) }]));
  return { files, extra: replies.slice(1 + 2 * asks.length) };
}

describe(`${AC[12]} drop-frame labels are a closed form of the frame, the start and the rate`, () => {
  it(`${AC[12]} at 30000/1001 fps frames 1,799, 1,800 and 17,982 are 00:00:59;29, 00:01:00;02 and 00:10:00;00, and at 60000/1001 fps frame 35,964 is 00:10:00;00`, () => {
    const random = seeded(501_012);
    // Frames within 2 of each minute's start, counted in frames of 1,798 and of 1,800, so every dropped and every kept
    // minute boundary of the first 21 minutes is crossed.
    const around = Array.from({ length: 21 }, (_, m) => [-2, -1, 0, 1, 2].flatMap((d) => [1798 * m + d, 1800 * m + d])).flat().filter((x) => x >= 0);
    const sweep = [...new Set([1799, 1800, 17_982, ...around, ...Array.from({ length: 200 }, () => Math.floor(random() * 2_000_000))])].sort((a, b) => a - b);
    const ntsc = labels(NTSC, sweep);
    expect(Object.fromEntries([1799, 1800, 17_982].map((k) => [k, ntsc.find((f) => f.frame === k)?.timecode])), 'the three labels the criterion names')
      .toEqual({ 1799: '00:00:59;29', 1800: '00:01:00;02', 17982: '00:10:00;00' });
    none(labelFailures(NTSC, ntsc), 'drop-frame labels at 30000/1001 fps');
    const ntsc60 = labels(NTSC60, [35_963, 35_964, 35_965, 3599, 3600]);
    expect(ntsc60.find((f) => f.frame === 35_964)?.timecode, 'at 60000/1001 fps frame 35,964 is 00:10:00;00').toBe('00:10:00;00');
    none(labelFailures(NTSC60, ntsc60), 'drop-frame labels at 60000/1001 fps');
  }, TIMEOUT);

  it(`${AC[12]} a planted labeller that also drops at every tenth minute labels frame 17,982 as 00:10:00;02 and fails, naming the frame`, () => {
    const got = labels(NTSC, [1799, 1800, 17_982], 'drop_frame_every_tenth_minute');
    expect(got.find((f) => f.frame === 17_982)?.timecode, 'the planted labeller gives 00:10:00;02').toBe('00:10:00;02');
    failsNaming(labelFailures(NTSC, got), /frame 17,982 is labelled 00:10:00;02, not 00:10:00;00/, 'the planted labeller');
  }, TIMEOUT);
});

describe(`${AC[13]} a video target writes the start as the file's timecode track`, () => {
  it(`${AC[13]} the 240-frame film's MP4 and ProRes exports at 24 fps from 01:00:00:00 carry a timecode track the probe reads as frame 86,400, the receipt's last label is 01:00:09:23, and drop_frame at 24000/1001 is refused at check, naming the rate`, () => {
    const dir = temp();
    const refusedOut = join(dir, 'refused.mp4');
    const prores = process.platform === 'darwin';
    const { files, extra } = exportsOf([{ name: 'film.mp4', codec: 'h264' }, ...(prores ? [{ name: 'film.mov', codec: 'prores_4444' }] : [])], undefined,
      [exportCall({ doc: DOC.a, out: refusedOut, frame_rate: [24000, 1001], video: { codec: 'h264' }, timecode: { start: '00:00:00:00', drop_frame: true } })]);
    const want = { first: 86_400, start: START, last: '01:00:09:23' };
    none([...files.entries()].flatMap(([name, f]) => timecodeFailures(f.exported, f.probed, want, name)), 'the timecode of the whole film\'s exports');
    for (const [name, f] of files) expect(receiptOf(f.exported, name).frame_hashes.length, `${name}: 240 frames`).toBe(240);
    const refused = extra[0]!;
    expect(refused['outcome'], `drop_frame: true at 24000/1001 is refused at check: ${show(refused)}`).toBe('refused');
    expect(JSON.stringify(refused), 'the refusal names drop_frame and the rate 24000/1001').toMatch(/drop_frame[\s\S]*24000\/1001|24000\/1001[\s\S]*drop_frame/);
    expect(existsSync(refusedOut), 'the refused export wrote no file').toBe(false);
    if (!prores) blocked(`ProRes 4444 is written on macOS only (VideoToolbox); this is ${process.platform}, so the ProRes leg is unrun`);
  }, TIMEOUT);

  it(`${AC[13]} a planted writer that leaves the timecode track at zero fails, naming the track`, () => {
    const { files } = exportsOf([{ name: 'film.mp4', codec: 'h264' }], 'timecode_track_zero');
    const f = files.get('film.mp4')!;
    failsNaming(timecodeFailures(f.exported, f.probed, { first: 86_400, start: START, last: '01:00:09:23' }, 'film.mp4'), /timecode track \(stream \d+\) starts at frame 0, not 86,400/, 'the planted writer (timecode_track_zero)');
  }, TIMEOUT);
});

describe(`${AC[14]} a range export keeps the label of its first frame`, () => {
  it(`${AC[14]} frames [48, 168) of the film start at 01:00:02:00, in the receipt and in the file's timecode track`, () => {
    const { files } = exportsOf([{ name: 'range.mp4', codec: 'h264', range: ['48f', '168f'] }]);
    const f = files.get('range.mp4')!;
    none(timecodeFailures(f.exported, f.probed, { first: 86_448, start: '01:00:02:00', last: '01:00:06:23' }, 'range.mp4'), 'the range export\'s timecode');
    expect(receiptOf(f.exported, 'range.mp4').frame_hashes.length, 'the range holds 120 frames').toBe(120);
  }, TIMEOUT);

  it(`${AC[14]} a planted range export that restarts at 01:00:00:00 fails, naming the first label`, () => {
    const { files } = exportsOf([{ name: 'range.mp4', codec: 'h264', range: ['48f', '168f'] }], 'range_restarts_timecode');
    const f = files.get('range.mp4')!;
    failsNaming(timecodeFailures(f.exported, f.probed, { first: 86_448, start: '01:00:02:00', last: '01:00:06:23' }, 'range.mp4'), /first label is 01:00:00:00, not 01:00:02:00/, 'the planted range export (range_restarts_timecode)');
  }, TIMEOUT);
});
