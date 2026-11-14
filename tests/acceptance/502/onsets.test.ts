// AC9 #502.ec7abd09: "Each caption's in-time lies within 2 frames of the activity bake's speech onset in the decoded
// delivery; a planted words bake 200 ms late keeps captions and markers in agreement and fails, naming the first
// caption"
//
// The one criterion whose words and activity records come from the pinned analyzers, through #1819's harness (a real
// hub, deepbuild/bakes installed, its model host on port 8719; README: Legs that read BLOCKED). The fixture film's
// recordings are made as everywhere in this suite; here each one's words record is the real `bake.words` job's, on
// charsiu-aligner@1.0.0, of the recording's PCM and its line's text, attached to its asset. The film is exported open
// to MP4; the MP4's sound is decoded by the decode worker, its channels' mean put in the store, and the real
// `bake.activity` job, on silero-vad@6.2.3, run on it; `media_bake` reads its spans, whose starts are the speech
// onsets. This suite is the judge: each spoken line's caption must start within 2 frames (83.3 ms) of the nearest
// onset. The word markers are read through `time` on `@<line>.word:<first word>#1`. The aligner's times are a model's:
// the captions are held to the fixture file's in-times within the same 2 frames, never to the flick.
// Planted: `words_bake_200ms_late`, which reads every word of a line's record 200 ms late.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOB, VAD, bakes, mustBlockForPcm, mustRecord, openWorld, readRecord, readings, withBakes, type Bake, type Line, type World } from '../1819/helpers.ts';
import {
  AC, ALIGNER, DOC, FILM, FIXTURE, FLICKS, FPS24, FULL, RATE, SAMPLE, TIMEOUT, captionsOf, decodeCall, decodedSound, exportCall, filmDocument, filmRun, int,
  mono, musicBed, none, part, pcmBytes, putEvidence, receiptOf, sec, sha256, str, table, useFileTemp, useShow, voices, wavF32,
  type Cue, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('onsets');
const TWO_FRAMES = 2 * FILM.frame;
const LATE = FLICKS / 5;
const ms = (flicks: number): string => `${((flicks * 1000) / FLICKS).toFixed(1)} ms`;
const SPOKEN = FIXTURE.speech.spans.map((s) => s.line);
const lineText = (line: string): string => str(part(FIXTURE.document, 'script', 'lines', line)['text'], `line ${line}: text`);

interface Made { w: World; document: JsonObject; first: Record<string, number> }
let made: Promise<Made> | undefined;
/** The world, once for the file: the hub's store holding the film's sound and each line's text; each recording's PCM
 * kept by a BLOCKED words bake; deepbuild/bakes installed on its model host; and each line's words record made by the
 * real job. `first` is where each line's first word starts in the film by that record: t + (start − in). */
function world(): Promise<Made> {
  made ??= (async () => {
    const bin = shows.bin(FULL);
    const vs = voices();
    const bed = wavF32(musicBed(), RATE);
    const text = (line: string): Uint8Array => new TextEncoder().encode(lineText(line));
    const w = await openWorld([bed, ...Object.values(vs).flatMap((v) => [v.wav, text(v.spec.line)])]);
    for (const v of Object.values(vs)) {
      mustBlockForPcm(bin, w, { asset: v.sha, kind: 'words', analyzer: ALIGNER, source: 'aligner' }, v.pcm, `line ${v.spec.line}'s recording, with no record`);
    }
    await withBakes(w);
    const filled: Record<string, { sha: string; record: string }> = {};
    const first: Record<string, number> = {};
    for (const v of Object.values(vs)) {
      const { record } = await mustRecord(w, JOB.words, ALIGNER, [{ name: 'pcm', sha256: v.pcmSha }, { name: 'text', sha256: sha256(text(v.spec.line)) }], RATE);
      filled[v.asset] = { sha: v.sha, record };
      const words = readRecord(w, record).words as Line[] | undefined;
      expect(words?.length, `the aligner's record of line ${v.spec.line} holds its ${v.spec.words.length} words`).toBe(v.spec.words.length);
      first[v.spec.line] = (v.spec.at - v.spec.in) * SAMPLE + int(words![0]!.start, `line ${v.spec.line}: the record's first word's start`);
    }
    return { w, document: filmDocument(filled, sha256(bed)), first };
  })();
  return made;
}

interface Leg { cues: Cue[]; markers: Record<string, number>; onsets: number[]; first: Record<string, number> }
/** The film exported open, its word markers read, and the activity bake of its decoded MP4's sound. */
async function leg(planted?: Planted): Promise<Leg> {
  const { w, document, first } = await world();
  const bin = shows.bin(FULL);
  const dir = temp();
  const out = join(dir, 'film.mp4');
  const label = planted ? `the film with the aligner's words (planted ${planted})` : 'the film with the aligner\'s words';
  const anchors = SPOKEN.map((line) => `@${line}.word:${lineText(line).split(' ')[0]!}#1`);
  const replies = filmRun(bin, w.evidence, document, [
    exportCall({ doc: DOC.a, out, video: { codec: 'h264' }, audio: { codec: 'aac' }, captions: { mode: 'open', files: ['srt'] } }),
    decodeCall(out, join(dir, 'sound')),
    ...anchors.map((text): JsonObject => ({ call: 'time', doc: DOC.a, text })),
  ], label, planted);
  const cues = captionsOf(receiptOf(replies[0]!, `${label}: the export`).raw, `${label}: the export`).cues;
  const markers = Object.fromEntries(SPOKEN.map((line, i) => {
    const r = replies[2 + i]!;
    expect(r['outcome'], `${label}: ${anchors[i]} resolves to a word marker: ${JSON.stringify(r).slice(0, 400)}`).toBe('resolved');
    return [line, int(r['t'], `${label}: ${anchors[i]}: t`)];
  }));

  const sound = decodedSound(replies[1]!, join(dir, 'sound'), `${label}: the MP4`);
  const heard = mono(sound);
  const asset = putEvidence(w.evidence, wavF32(heard, sound.rate));
  const ask: Bake = { asset, kind: 'activity', analyzer: VAD, threshold: 0.5 };
  const pcm = mustBlockForPcm(bin, w, ask, pcmBytes(heard), `${label}: the decoded delivery, with no record`);
  const { record } = await mustRecord(w, JOB.activity, VAD, [{ name: 'pcm', sha256: pcm }], sound.rate);
  const spans = readings(bakes(bin, w, [{ ...ask, record }], `${label}: the decoded delivery`)[0]!, ask, `${label}: the activity bake`).spans as Line[] | undefined;
  expect(Array.isArray(spans), `${label}: the activity bake answers spans`).toBe(true);
  return { cues, markers, onsets: spans!.map((s, i) => int(s.start, `${label}: spans[${i}].start`)), first };
}

/** Each spoken line's caption against the speech onsets of the decoded delivery, in time order; each failure starts
 * `caption <name>`. A caption-only line has no speech and is not read. */
function onsetFailures(l: Leg): string[] {
  return l.cues.filter((c) => SPOKEN.includes(c.line)).flatMap((c) => {
    if (l.onsets.length === 0) return [`caption ${c.name}: the activity bake finds no speech onset in the decoded delivery`];
    const nearest = l.onsets.reduce((a, b) => (Math.abs(b - c.in) < Math.abs(a - c.in) ? b : a));
    return Math.abs(nearest - c.in) <= TWO_FRAMES ? [] : [`caption ${c.name}: its in-time ${sec(c.in)} is ${ms(Math.abs(nearest - c.in))} from the nearest speech onset in the decoded delivery, ${sec(nearest)} (2 frames, 83.3 ms, allowed)`];
  });
}
/** Captions and word markers in agreement: each spoken line's caption starts on the frame its first word's marker
 * falls in, and that marker is `late` flicks after the record's first word. Each failure names its line. */
function agreementFailures(l: Leg, late: number): string[] {
  return SPOKEN.flatMap((line) => {
    const cue = l.cues.find((c) => c.line === line);
    const marker = l.markers[line]!;
    const f: string[] = [];
    if (!cue) return [`line ${line}: the receipt lists no caption for it`];
    if (cue.in !== Math.floor(marker / FILM.frame) * FILM.frame) f.push(`line ${line}: its caption starts at ${sec(cue.in)} and its first word's marker is at ${sec(marker)}, on another frame`);
    if (marker !== l.first[line]! + late) f.push(`line ${line}: its first word's marker is at ${marker} flicks, not its record's first word, ${l.first[line]!}, plus ${late}`);
    return f;
  });
}

describe(`${AC[9]} each caption starts within 2 frames of the speech the activity bake hears in the decoded delivery`, () => {
  it(`${AC[9]} with each line's words baked by the pinned aligner, each spoken caption of the exported film starts within 2 frames of a speech onset the pinned activity bake finds in the decoded MP4, on the frame of its first word's marker, and within 2 frames of the fixture's in-time`, async () => {
    const l = await leg();
    expect(l.cues.map((c) => c.name), 'the film\'s captions are the fixture\'s four').toEqual(FIXTURE.cues.map((c) => c.name));
    none(agreementFailures(l, 0), 'captions and word markers');
    const want = table(FPS24).captions;
    const far = l.cues.flatMap((c, i) => {
      const allowed = SPOKEN.includes(c.line) ? TWO_FRAMES : 0;
      return Math.abs(c.in - want[i]!.in) <= allowed ? [] : [`caption ${c.name}: its in-time ${sec(c.in)} is ${ms(Math.abs(c.in - want[i]!.in))} from the fixture's ${sec(want[i]!.in)}, where its first word was put (${ms(allowed)} allowed)`];
    });
    none(far, 'the captions against the fixture file');
    none(onsetFailures(l), 'each caption against the speech onsets of the decoded delivery');
  }, TIMEOUT);

  it(`${AC[9]} a planted words bake 200 ms late keeps captions and markers in agreement and fails, naming the first caption`, async () => {
    const l = await leg('words_bake_200ms_late');
    none(agreementFailures(l, LATE), 'the planted bake\'s captions and word markers, each 200 ms late');
    const failures = onsetFailures(l);
    expect(failures[0] ?? '', `the planted bake (words_bake_200ms_late) fails, its first failure naming the first caption: ${JSON.stringify(failures)}`).toMatch(/^caption intro\.1: its in-time /);
  }, TIMEOUT);
});
