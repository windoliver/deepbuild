// AC10 #502.60b58438 (Oracle lane, run on our code and port): FFmpeg 24e860f6d3c4f2ebae65ed7649e2a8860d512879,
// tests/fate/subtitles.mak with tests/fate-run.sh's `fmtstdout` (`ffmpeg -bitexact "$@" -bitexact -f <fmt> -`). Three
// FATE recipes are run by the installed ffmpeg with our sidecars in place of FATE's samples:
//   fate-sub-srt                    fmtstdout ass -i <SubRip file>                         → our film.srt
//   fate-sub-webvtt                 fmtstdout ass -i <WebVTT file>                         → our film.vtt
//   fate-sub-srt-madness-timeshift  fmtstdout srt -itsoffset 3.14 -i <SubRip file> -c:s copy → our film.srt
// FATE compares each recipe's output with a reference of its own sample (tests/ref/fate/sub-srt, sub-webvtt,
// sub-srt-madness-timeshift); ours is another file, so the comparison is ported, not the reference: every cue FFmpeg
// reads must be the fixture's caption, with its lines and its times. As ASS (centiseconds, as FATE's sub-srt and
// sub-webvtt references print them) each time is within one centisecond of the cue's millisecond time; remuxed to SRT
// with the 3.14 s offset (milliseconds, as sub-srt-madness-timeshift's reference keeps them) each time is the cue's
// plus 3,140 ms exactly. The sidecars are the fixture film's, exported at 24000/1001 as criterion 10 says
// (tests/acceptance/502/sidecars.test.ts); the expected times are the fixture file's. No FFmpeg file is copied here.
// fate-run.sh's cpu, thread and hwaccel flags are left out: they don't reach a subtitle demuxer.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FIXTURE, FULL, NTSC, TIMEOUT, cueFailures, exportCall, ffmpegTools, filmRun, parseSrt, receiptOf, sidecar, sidecarText, stage, table, useFileTemp, useShow,
} from '../502/helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('oracle-sub');

let files: { srt: string; vtt: string } | { error: unknown } | undefined;
/** Our sidecars: the fixture film exported at 24000/1001 over its 287 whole frames, once for the file. */
function sidecars(): { srt: string; vtt: string } {
  if (!files) {
    try {
      const evidence = temp(); const dir = temp();
      const out = join(dir, 'film.mp4');
      const [reply] = filmRun(shows.bin(FULL), evidence, stage(evidence).document, [
        exportCall({ doc: DOC.a, out, frame_rate: [24000, 1001], range: [0, 287 * table(NTSC).frame], video: { codec: 'h264' }, audio: { codec: 'aac' }, captions: { mode: 'open', files: ['srt', 'vtt'] } }),
      ], 'the fixture film at 24000/1001');
      receiptOf(reply!, 'the export at 24000/1001');
      const [srt, vtt] = [sidecar(out, 'srt'), sidecar(out, 'vtt')];
      sidecarText(srt, 'the export at 24000/1001'); sidecarText(vtt, 'the export at 24000/1001');
      files = { srt, vtt };
    } catch (error) { files = { error }; }
  }
  if ('error' in files) throw files.error;
  return files;
}
/** `fmtstdout <fmt> <args>` by the installed ffmpeg; without one the lane is BLOCKED, never passed. */
function fmtstdout(fmt: string, args: string[]): string {
  const tools = ffmpegTools();
  if (typeof tools === 'string') expect.fail(`BLOCKED: ${tools}; this is not a pass`);
  return execFileSync(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-nostats', '-bitexact', ...args, '-bitexact', '-f', fmt, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
}
/** The events of an ASS script as FFmpeg writes it: each Dialogue's start and end in centiseconds, and its text. */
function dialogues(ass: string): { start: number; end: number; text: string }[] {
  const cs = (t: string): number => {
    const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(t);
    if (!m) throw Error(`${t} is not an ASS time`);
    return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 100 + Number(m[4]);
  };
  return ass.split('\n').filter((l) => l.startsWith('Dialogue: ')).map((l) => {
    const f = l.slice('Dialogue: '.length).split(',');
    return { start: cs(f[1]!), end: cs(f[2]!), text: f.slice(9).join(',') };
  });
}
/** A recipe's ASS output against the fixture's captions at 24000/1001; each failure names its cue. */
function assFailures(ass: string, file: string): string[] {
  const got = dialogues(ass);
  const want = table(NTSC).captions;
  const f = got.length === want.length ? [] : [`${file}: FFmpeg reads ${got.length} cues, the film has ${want.length} captions`];
  want.forEach((w, i) => {
    const g = got[i];
    const at = `${file}: cue ${i + 1} (${w.name})`;
    if (!g) { f.push(`${at} is missing`); return; }
    if (Math.abs(g.start * 10 - w.in_ms) > 10) f.push(`${at} starts at ${g.start} cs, not within a centisecond of ${w.in_ms} ms`);
    if (Math.abs(g.end * 10 - w.out_ms) > 10) f.push(`${at} ends at ${g.end} cs, not within a centisecond of ${w.out_ms} ms`);
    const text = FIXTURE.cues[i]!.lines.join('\\N');
    if (g.text !== text) f.push(`${at} reads ${JSON.stringify(g.text)}, not ${JSON.stringify(text)}`);
  });
  return f;
}

describe('FFmpeg FATE tests/fate/subtitles.mak (24e860f6d3) on our sidecars', () => {
  it(`${AC[10]} fate-sub-srt: FFmpeg's SubRip demuxer and decoder read our film.srt as the film's four captions, each at its frame time`, () => {
    expect(assFailures(fmtstdout('ass', ['-i', sidecars().srt]), 'film.srt')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[10]} fate-sub-webvtt: FFmpeg's WebVTT demuxer and decoder read our film.vtt as the film's four captions, each at its frame time`, () => {
    expect(assFailures(fmtstdout('ass', ['-i', sidecars().vtt]), 'film.vtt')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[10]} fate-sub-srt-madness-timeshift: our film.srt remuxed with a 3.14 s offset keeps every cue's millisecond time, 3,140 ms later`, () => {
    const shifted = parseSrt(fmtstdout('srt', ['-itsoffset', '3.14', '-i', sidecars().srt, '-c:s', 'copy']), 'film.srt remuxed by FFmpeg');
    expect(cueFailures(shifted.map((c) => ({ start: c.start - 3140, end: c.end - 3140, lines: c.lines })), NTSC, 'film.srt, remuxed 3.14 s later')).toEqual([]);
  }, TIMEOUT);
});
