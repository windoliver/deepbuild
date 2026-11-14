// AC1 #502.a6f3c068: "A 12-second film exports to MP4 with its narration and captions, and the export's raw frames
// equal the settled live frames by hash, frame for frame, on the same machine"
// AC4 #502.67480f9c: "A closed export of the 12 s fixture film has frame hashes equal to a render with the caption layer
// removed, and its `.srt` holds every cue of the open export; an export with `mode: closed` and `files: []` is
// refused, naming captions"
// AC5 #502.e18dfcba: "A caption-only line appears in the `.srt` at its time and runs no speech job"
// AC6 #502.65fdf864: "The 12 s fixture film's document, script, cue list and expected caption in- and out-times are
// checked in with this issue, and each criterion that names the film takes its expected values from that file"
//
// One `deep-show run` serves the four (README: The surface under test): the fixture film (fixtures/film.json, its
// sound made here, its words records written from the fixture's word times) is presented; exported open to MP4 with
// both sidecars; exported closed with its .srt; asked for closed with no file; the open MP4 is probed and its sound
// decoded by the decode worker; every frame's time is evaluated live (`eval` with pixels: the settled live frame, as
// #501's AC1 reads it); and the film without its script is exported as PNG frames, the render with the caption layer
// removed. Every expected caption, time and cue is the fixture file's. The criteria name no wrong program: AC1 holds
// the frames inside each caption apart from the captionless render's, AC4's refusal is the criterion's own, AC5 mixes
// the film with and without its caption-only line, and AC6 holds the receipt to the file exactly.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FILM, FIXTURE, FIXTURE_FILE, FLICKS, FPS24, FULL, NTSC, RATE, REPO, SAMPLE, TIMEOUT, arr, bgra, blake3, captionFailures, captionsOf, characters, clone,
  cueFailures, decodeCall, decodedSound, exportCall, filesUnder, filmRun, hex64, isObject, layout, literal, mono, msOf, narration, none, obj, parseSrt,
  part, present, presented, receiptOf, runShow, sidecar, sidecarText, snapshotPicture, stage, str, table, useFileTemp, useShow, withoutScript,
  type JsonObject, type Sound, type Staged,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('film');

interface Run { evidence: string; dir: string; staged: Staged; open: JsonObject; closed: JsonObject; refused: JsonObject; probe: JsonObject; sound: Sound; live: JsonObject[]; bare: JsonObject }
let ran: { run: Run } | { error: unknown } | undefined;
/** The one run, made by the first test that asks; a run that failed fails every test that reads it, the same way. */
function theRun(): Run {
  if (!ran) {
    try { ran = { run: make() }; } catch (error) { ran = { error }; }
  }
  if ('error' in ran) throw ran.error;
  return ran.run;
}
function make(): Run {
  const evidence = temp(); const dir = temp();
  const staged = stage(evidence);
  const av = { video: { codec: 'h264' }, audio: { codec: 'aac' } };
  const calls: JsonObject[] = [
    exportCall({ doc: DOC.a, out: join(dir, 'open', 'film.mp4'), ...av, captions: { mode: 'open', files: ['srt', 'vtt'] } }),
    exportCall({ doc: DOC.a, out: join(dir, 'closed', 'film.mp4'), ...av, captions: { mode: 'closed', files: ['srt'] } }),
    exportCall({ doc: DOC.a, out: join(dir, 'refused', 'film.mp4'), ...av, captions: { mode: 'closed', files: [] } }),
    { call: 'media_import', path: join(dir, 'open', 'film.mp4') },
    decodeCall(join(dir, 'open', 'film.mp4'), join(dir, 'sound')),
    ...Array.from({ length: FILM.frames }, (_, k): JsonObject => ({ call: 'eval', doc: DOC.a, t: k * FILM.frame, pixels: true })),
    present(DOC.b, withoutScript(staged.document)),
    exportCall({ doc: DOC.b, out: join(dir, 'bare'), video: { codec: 'png_seq' } }),
  ];
  const r = filmRun(shows.bin(FULL), evidence, staged.document, calls, 'the fixture film');
  receiptOf(r[0]!, 'the open export');
  presented(r[5 + FILM.frames]!, 'the film without its script');
  return {
    evidence, dir, staged, open: r[0]!, closed: r[1]!, refused: r[2]!, probe: r[3]!, sound: decodedSound(r[4]!, join(dir, 'sound'), 'the open export\'s MP4'),
    live: r.slice(5, 5 + FILM.frames), bare: r[6 + FILM.frames]!,
  };
}
/** The frames a caption shows on: those at or after its in-time and before its out-time, at 24 fps. */
const shown = (): Set<number> => new Set(table(FPS24).captions.flatMap((c) => Array.from({ length: c.out_frame - c.in_frame }, (_, i) => c.in_frame + i)));

describe(`${AC[1]} the 12 s film exports to MP4 with its narration and captions, each raw frame the settled live frame`, () => {
  it(`${AC[1]} the open export is an MP4 of 288 frames at 24 fps with the narration in its sound and each caption in its frames from its in-time to its out-time, and every raw frame's hash is the BLAKE3 of the live frame evaluated at its time`, () => {
    const r = theRun();
    const open = receiptOf(r.open, 'the open export');
    const closed = receiptOf(r.closed, 'the closed export');
    expect([open.size, open.frame_rate, open.duration, open.frame_hashes.length], 'the export records 480 × 270, 24/1, 12 s and 288 raw frames').toEqual([FILM.size, FILM.rate, FILM.span, FILM.frames]);

    const streams = arr(part(r.probe, 'asset', 'probe')['streams'], 'the MP4\'s probe: streams').filter(isObject);
    const video = streams.filter((s) => s['type'] === 'video');
    expect([video.length, streams.filter((s) => s['type'] === 'audio').length], 'the MP4 holds one video and one audio track').toEqual([1, 1]);
    expect(arr(video[0]!['pts'], 'the MP4\'s video track: pts').length, 'the MP4\'s video track holds 288 frames').toBe(FILM.frames);

    // The narration: each spoken line's recording is in the delivered sound where its line puts it.
    expect(r.sound.rate, 'the MP4\'s sound is at the transport\'s 48 kHz').toBe(RATE);
    const heard = mono(r.sound); const said = narration(r.staged.voices);
    const quiet = FIXTURE.speech.spans.flatMap((s) => {
      const [a, b] = [s.start / SAMPLE, s.end / SAMPLE];
      let dot = 0; let hh = 0; let ss = 0;
      for (let i = a; i < b; i++) { const h = heard[i] ?? 0; const v = said[i]!; dot += h * v; hh += h * h; ss += v * v; }
      const match = dot / Math.sqrt(hh * ss);
      return match >= 0.9 ? [] : [`line ${s.line}: over its speech, ${(a / RATE).toFixed(3)} to ${(b / RATE).toFixed(3)} s, the MP4's sound matches its recording at ${match.toFixed(3)} (at least 0.9 when the narration is there)`];
    });
    none(quiet, 'the narration in the MP4\'s sound');

    // The captions: drawn into the open export's frames from each in-time to each out-time, and nowhere else.
    const during = shown();
    const drawn = open.frame_hashes.flatMap((h, k) => {
      const differs = h !== closed.frame_hashes[k];
      return differs === during.has(k) ? [] : [`frame ${k}: ${during.has(k) ? 'a caption shows, and the frame equals the closed export\'s, which draws none' : 'no caption shows, and the frame differs from the closed export\'s'}`];
    });
    none(drawn, 'the captions in the open export\'s frames');
    none(captionFailures(captionsOf(open.raw, 'the open export').cues, FPS24), 'the open export\'s captions against the fixture file');

    // Raw frames against the settled live frames: BLAKE3, by this suite, of each live frame's BGRA8 rows.
    const off: string[] = [];
    for (let k = 0; k < FILM.frames && off.length < 8; k++) {
      const live = blake3(bgra(snapshotPicture(r.evidence, r.live[k]!, `the live frame at frame ${k}`)));
      if (live !== open.frame_hashes[k]) off.push(`frame ${k}: the export's raw frame hashes ${String(open.frame_hashes[k]).slice(0, 16)}…, the settled live frame at its time ${live.slice(0, 16)}…`);
    }
    none(off, 'the export\'s raw frames against the settled live frames');
    expect(new Set(open.frame_hashes).size, 'the film moves on every frame, so no two raw frames are one').toBe(FILM.frames);
  }, TIMEOUT);
});

describe(`${AC[4]} a closed export draws no caption and carries every cue in its .srt; closed with no file is refused`, () => {
  it(`${AC[4]} the closed export's frame hashes equal the film without its script, frame for frame; its .srt holds the open export's cues, the fixture's four; and mode closed with files [] is refused, naming captions, with nothing written`, () => {
    const r = theRun();
    const closed = receiptOf(r.closed, 'the closed export');
    const bare = receiptOf(r.bare, 'the film without its script');
    expect(bare.frame_hashes.length, 'the render with the caption layer removed holds 288 frames').toBe(FILM.frames);
    const k = closed.frame_hashes.findIndex((h, i) => h !== bare.frame_hashes[i]);
    expect([k, closed.frame_hashes.length], `the closed export's frames are the frames of the film without its script${k >= 0 ? `; frame ${k} differs` : ''}`).toEqual([-1, FILM.frames]);
    expect(captionsOf(closed.raw, 'the closed export').mode, 'the closed export\'s receipt records its mode').toBe('closed');

    const closedCues = parseSrt(sidecarText(sidecar(join(r.dir, 'closed', 'film.mp4'), 'srt'), 'the closed export'), 'the closed export\'s film.srt');
    const openCues = parseSrt(sidecarText(sidecar(join(r.dir, 'open', 'film.mp4'), 'srt'), 'the open export'), 'the open export\'s film.srt');
    none(cueFailures(openCues, FPS24, 'the open export\'s film.srt'), 'the open export\'s cues against the fixture file');
    expect(closedCues, 'the closed export\'s .srt holds every cue of the open export').toEqual(openCues);

    expect([r.refused['outcome'], r.refused['code']], `mode closed with files [] is refused, naming captions: ${JSON.stringify(r.refused).slice(0, 600)}`).toEqual(['refused', 'captions_not_carried']);
    expect(filesUnder(join(r.dir, 'refused')).map(([p]) => p), 'the refused export wrote nothing').toEqual([]);
  }, TIMEOUT);
});

describe(`${AC[5]} a caption-only line is in the .srt at its time and makes no sound`, () => {
  it(`${AC[5]} the line note, with no recording and no speech job run, is delivered as the .srt's cue 4 at its time with its text, and the film's sound is the same sample for sample with and without it`, () => {
    const r = theRun();
    const line = part(r.staged.document, 'script', 'lines', 'note');
    expect([line['kind'], line['recording']], 'the fixture\'s line note is caption-only and has no recording').toEqual(['caption', undefined]);
    receiptOf(r.open, 'the open export of the film, whose line note has no recording');

    const cues = parseSrt(sidecarText(sidecar(join(r.dir, 'open', 'film.mp4'), 'srt'), 'the open export'), 'the open export\'s film.srt');
    const want = table(FPS24).captions.find((c) => c.name === 'note.1')!;
    const at = table(FPS24).captions.indexOf(want);
    expect(cues[at], `cue ${at + 1} of the .srt is the caption-only line's: from ${want.in_ms} ms (its t, ${str(line['t'], 'note.t')}, on its frame) to ${want.out_ms} ms, reading ${JSON.stringify(FIXTURE.cues[at]!.lines)}`)
      .toEqual({ start: want.in_ms, end: want.out_ms, lines: FIXTURE.cues[at]!.lines });

    // It plays nothing: the film's sound, mixed as the export mixes it, with the line and without it.
    const without = clone(r.staged.document);
    delete part(without, 'script', 'lines')['note'];
    const whole = [{ from: 0, to: FILM.span }];
    const mixes = runShow(shows.bin(FULL), { evidence: r.evidence, calls: [{ call: 'media_mix', doc: r.staged.document, segments: whole }, { call: 'media_mix', doc: without, segments: whole }] }, 'the film\'s sound with and without its caption-only line');
    const [a, b] = mixes.map((m, i) => hex64(obj(arr(part(m, 'mix')['segments'], `mix ${i}: segments`)[0], `mix ${i}: segments[0]`)['sha256'], `mix ${i}: segments[0].sha256`));
    expect(a, 'the caption-only line adds no sample to the film\'s sound').toBe(b);
  }, TIMEOUT);
});

describe(`${AC[6]} the fixture film's document, script, cue list and expected caption times are checked in, and the film's captions are exactly the file's`, () => {
  it(`${AC[6]} ${FIXTURE_FILE} is tracked, holds the document with its script, the cue list and the in- and out-times at 24 and 24000/1001 fps, follows the caption layout rule on its own word times, and the export's receipt lists exactly its captions`, () => {
    const tracked = execFileSync('git', ['ls-files', '--', FIXTURE_FILE], { cwd: REPO, encoding: 'utf8' }).trim();
    expect(tracked, `${FIXTURE_FILE} is checked in`).toBe(FIXTURE_FILE);
    expect(FIXTURE.issue, 'the file is this issue\'s').toBe(502);
    const lines = part(FIXTURE.document, 'script', 'lines');
    expect(Object.keys(lines), 'the document\'s script holds the film\'s four lines').toEqual(['intro', 'listen', 'dips', 'note']);
    expect(FIXTURE.cues.map((c) => c.name), 'the cue list names each caption').toEqual(['intro.1', 'listen.1', 'dips.1', 'note.1']);

    // The file against itself: its times are the layout rule's on its own word times, at both rates.
    const failures: string[] = [];
    for (const rate of [FPS24, NTSC]) {
      const t = table(rate);
      const laid = layout(FIXTURE, t.frame_rate);
      expect(laid.map((c) => ({ name: c.name, line: c.line, lines: c.lines })), `the cue list is the script's words filled into lines of 42 characters, two lines a caption (${rate})`).toEqual(FIXTURE.cues);
      t.captions.forEach((c, i) => {
        const l = laid[i]!;
        if (c.in !== l.in || c.out !== l.out) failures.push(`${c.name} at ${rate}: the file says ${c.in} to ${c.out} flicks, the layout rule on its word times ${l.in} to ${l.out}`);
        if (c.in !== c.in_frame * t.frame || c.out !== c.out_frame * t.frame) failures.push(`${c.name} at ${rate}: its flicks are not its frames of ${t.frame} flicks`);
        if (c.in_ms !== msOf(c.in) || c.out_ms !== msOf(c.out)) failures.push(`${c.name} at ${rate}: its milliseconds are not its flicks rounded down`);
        if (characters(FIXTURE.cues[i]!.lines) * FLICKS > FIXTURE.profile.max_cps * (c.out - c.in)) failures.push(`${c.name} at ${rate}: over ${FIXTURE.profile.max_cps} characters a second`);
      });
    }
    for (const [asset, spec] of Object.entries(FIXTURE.recordings)) {
      const line = obj(lines[spec.line], `line ${spec.line}`);
      const rec = obj(line['recording'], `line ${spec.line}: recording`);
      if (rec['asset'] !== asset || literal(str(line['t'], `line ${spec.line}: t`)) !== BigInt(spec.at * SAMPLE)) failures.push(`line ${spec.line}: its recording or its t is not ${asset} at sample ${spec.at}`);
      if ((rec['in'] ?? 0) !== spec.in * SAMPLE || (rec['out'] ?? spec.samples * SAMPLE) !== spec.out * SAMPLE) failures.push(`line ${spec.line}: its recording's in and out are not samples ${spec.in} and ${spec.out}`);
      const span = FIXTURE.speech.spans.find((s) => s.line === spec.line);
      const [first, last] = [spec.words[0]!, spec.words[spec.words.length - 1]!];
      if (span?.start !== (spec.at + first.start - spec.in) * SAMPLE || span?.end !== (spec.at + last.end - spec.in) * SAMPLE) failures.push(`line ${spec.line}: its speech span is not its first word's start to its last word's end`);
    }
    none(failures, 'the fixture file against itself');

    // The film against the file: the export's receipt lists exactly these captions, at exactly these times.
    const captions = captionsOf(receiptOf(theRun().open, 'the open export').raw, 'the open export');
    none(captionFailures(captions.cues, FPS24), 'the receipt\'s captions against the fixture file');
    expect({ profile: captions.profile, mode: captions.mode, files: captions.files, violations: captions.violations }, 'the receipt\'s captions name the profile, the mode, the files written and no violation')
      .toEqual({ profile: FIXTURE.profile.name, mode: 'open', files: ['srt', 'vtt'], violations: [] });
  }, TIMEOUT);
});
