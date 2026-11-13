// Test-side tools for the #502 acceptance tests: the fixture film read from fixtures/film.json (its document, cue list
// and expected caption times, criterion 6); the film's sound made at test time (each word spoken alone by macOS `say`
// and put at the sample the fixture file fixes; a music bed; tones); the words records the fixture film attaches,
// written from the fixture's own word times; the caption layout rule in integers, used only to check the fixture file
// against itself; `deep-show run` scenarios and the `export` call's new request and reply fields, read strictly; the
// sidecars' own readers (.srt and .vtt) and FFmpeg's; a delivered file's sound through the decode worker and the
// loudness bake; and the judges the tests hold replies to. Nothing here stands in for the export, the caption layout,
// the mixer, the meter or a sidecar writer: each is read from what `deep-show` answers or writes (README: The surface
// under test). JSON readers, the build, scenarios, the evidence store, the PNG reader and BLAKE3 are #501's helpers;
// `say`, the music bed and the float WAV writer are #1819's.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { music, pcmBytes, say, wavF32 } from '../1819/fixtures/synth.ts';
import {
  DOC, FLICKS, arr, int, isObject, num, obj, present, presented, putEvidence, runShow, scenario, sha256, show, str,
  type JsonObject, type JsonValue,
} from '../501/helpers.ts';

export {
  DOC, FLICKS, FULL, REPO, TIMEOUT, arr, bgra, blake3, blocked, decodePng, failsNaming, filesUnder, getEvidence, hex64, inconclusive, int, isObject,
  none, num, obj, present, presented, putEvidence, readWav, receiptOf, runShow, scenario, sha256, show, snapshotPicture, str, useShow,
  type JsonObject, type JsonValue, type Receipt,
} from '../501/helpers.ts';
export { pcmBytes, wavF32 } from '../1819/fixtures/synth.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #502.a6f3c068',
  2: 'AC2 #502.029aec8f',
  3: 'AC3 #502.ea7fce3c',
  4: 'AC4 #502.67480f9c',
  5: 'AC5 #502.e18dfcba',
  6: 'AC6 #502.65fdf864',
  7: 'AC7 #502.ecdfe344',
  8: 'AC8 #502.6db99478',
  9: 'AC9 #502.ec7abd09',
  10: 'AC10 #502.60b58438',
  11: 'AC11 #502.550b7034',
} as const;

/** The wrong programs the criteria name, each selected by the scenario's `planted` (README: Planted programs). */
export type Planted = 'normalizer_rides_gain' | 'words_bake_200ms_late' | 'sidecar_times_at_24fps';

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; the film's sound is at 48 kHz, 14,700 flicks a sample.

export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
export const sec = (flicks: number): string => `${(flicks / FLICKS).toFixed(4)} s`;
/** Flicks rounded down to the millisecond, in integers (Export: a sidecar's times). */
export const msOf = (flicks: number): number => Number((BigInt(flicks) * 1000n) / BigInt(FLICKS));

// ---------------------------------------------------------------------------------------------------
// The fixture film (criterion 6): fixtures/film.json, checked in. Every expected value a film test uses is read here.

export interface WordSlot { text: string; start: number; end: number }
/** A spoken line's recording: `at`, the film sample its strip starts at (the line's `t`); `in` and `out`, the samples
 * of the recording the strip plays; `samples`, its length; `words`, where each word's samples sit in it. */
export interface RecordingSpec { line: string; at: number; in: number; out: number; samples: number; gain: number; words: WordSlot[] }
export interface CueSpec { name: string; line: string; lines: string[] }
export interface ExpectedCaption { name: string; in_frame: number; out_frame: number; in: number; out: number; in_ms: number; out_ms: number }
export interface ExpectedTable { frame_rate: [number, number]; frame: number; captions: ExpectedCaption[] }
export interface Span { start: number; end: number }
export interface Fixture {
  issue: number;
  about: string;
  sample_rate: number;
  document: JsonObject;
  recordings: Record<string, RecordingSpec>;
  music: { asset: string; seconds: number; rms_dbfs: number };
  profile: { name: string; max_chars: number; max_lines: number; max_cps: number; min_dur: [number, number]; max_dur: number; gap_frames: number };
  cues: CueSpec[];
  expected: Record<string, ExpectedTable>;
  speech: { spans: (Span & { line: string })[]; ducked: Span[] };
  range_mix: { about: string; hz: number; low_dbfs: number; high_dbfs: number; seconds_each: number; lra: number };
}
export const FIXTURE_FILE = join('tests', 'acceptance', '502', 'fixtures', 'film.json');
export const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'film.json'), 'utf8')) as Fixture;
/** The film's own rate and the rate criterion 10 exports it at: the keys of the fixture's `expected`. */
export const FPS24 = '24/1';
export const NTSC = '24000/1001';
export function table(rate: string): ExpectedTable {
  const t = FIXTURE.expected[rate];
  if (!t) throw Error(`fixtures/film.json has no expected caption times at ${rate}`);
  return t;
}
/** The film: 480 × 270, 12 s, 288 frames of 29,400,000 flicks at its own 24 fps. */
export const FILM = { size: [480, 270] as [number, number], rate: [24, 1] as [number, number], frames: 288, frame: 29_400_000, span: 12 * FLICKS } as const;

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** A nested object of a document or a reply, by keys; a missing one fails, naming the path. */
export function part(doc: JsonObject, ...keys: string[]): JsonObject {
  let at = doc;
  keys.forEach((k, i) => { at = obj(at[k], `\`${keys.slice(0, i + 1).join('.')}\``); });
  return at;
}

// ---------------------------------------------------------------------------------------------------
// The caption layout rule (Narration and captions), in integers. It is used only to check the fixture file against
// itself (criterion 6): no test takes an expected value from it.

const graphemes = (text: string): number => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
/** A seconds literal such as `7.905s` as flicks; it must be a whole number of them. */
export function literal(text: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?s$/.exec(text);
  if (!m) throw Error(`${text} is not a seconds literal`);
  const frac = m[2] ?? '';
  const scaled = BigInt(m[1]! + frac) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) throw Error(`${text} is not a whole number of flicks`);
  return scaled / den;
}
const floorDiv = (a: bigint, b: bigint): bigint => a / b;
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
export interface Laid { name: string; line: string; lines: string[]; in: number; out: number }
/** The fixture film's captions at a frame rate, by the rule: words fill lines within `max_chars`, each `max_lines`
 * lines a caption; in = ⌊a ÷ Δ⌋Δ and out = ⌈b ÷ Δ⌉Δ from its first word's start and last word's end (a caption-only
 * line: its `t`, and its characters ÷ `max_cps` later); then, in time order, a caption shorter than `min_dur` ends
 * ⌈min_dur ÷ Δ⌉ frames after it starts, and one that would end less than `gap_frames` frames before the next ends
 * `gap_frames` frames before it. */
export function layout(fx: Fixture, rate: [number, number]): Laid[] {
  const F = BigInt(FLICKS);
  const frame = (F * BigInt(rate[1])) / BigInt(rate[0]);
  const p = fx.profile;
  const out: { name: string; line: string; lines: string[]; a: bigint; b: [bigint, bigint] }[] = [];
  for (const [id, raw] of Object.entries(part(fx.document, 'script', 'lines'))) {
    const line = obj(raw, `line ${id}`);
    const words = str(line['text'], `line ${id}: text`).trim().split(/\s+/);
    const rows: number[][] = [];
    words.forEach((w, k) => {
      const row = rows[rows.length - 1];
      if (row && graphemes([...row.map((i) => words[i]!), w].join(' ')) <= p.max_chars) row.push(k); else rows.push([k]);
    });
    const t = literal(str(line['t'], `line ${id}: t`));
    const spoken = line['kind'] !== 'caption';
    const spec = spoken ? Object.values(fx.recordings).find((r) => r.line === id) : undefined;
    if (spoken && (!spec || spec.words.length !== words.length)) throw Error(`line ${id} has ${words.length} words and its recording ${spec?.words.length ?? 'none'}`);
    const sound = (sample: number): bigint => t + BigInt(sample - spec!.in) * BigInt(SAMPLE);
    for (let n = 0; n * p.max_lines < rows.length; n++) {
      const mine = rows.slice(n * p.max_lines, (n + 1) * p.max_lines);
      const first = mine[0]![0]!;
      const last = mine[mine.length - 1]!.slice(-1)[0]!;
      const lines = mine.map((r) => r.map((i) => words[i]!).join(' '));
      if (spoken) out.push({ name: `${id}.${n + 1}`, line: id, lines, a: sound(spec!.words[first]!.start), b: [sound(spec!.words[last]!.end), 1n] });
      else {
        if (rows.length > p.max_lines) throw Error(`the caption-only line ${id} makes more than one caption; the fixture times only one`);
        out.push({ name: `${id}.${n + 1}`, line: id, lines, a: t, b: [t * BigInt(p.max_cps) + BigInt(graphemes(lines.join(' '))) * F, BigInt(p.max_cps)] });
      }
    }
  }
  const laid = out.map((c) => ({ name: c.name, line: c.line, lines: c.lines, in: floorDiv(c.a, frame), out: ceilDiv(c.b[0], c.b[1] * frame) })).sort((x, y) => Number(x.in - y.in));
  const [mn, md] = [BigInt(p.min_dur[0]), BigInt(p.min_dur[1])];
  laid.forEach((c, i) => {
    if ((c.out - c.in) * frame * md < mn * F) c.out = c.in + ceilDiv(mn * F, md * frame);
    const next = laid[i + 1];
    if (next && c.out > next.in - BigInt(p.gap_frames)) c.out = next.in - BigInt(p.gap_frames);
  });
  return laid.map((c) => ({ name: c.name, line: c.line, lines: c.lines, in: Number(c.in * frame), out: Number(c.out * frame) }));
}
/** A caption's characters: the graphemes of its words joined by single spaces. */
export const characters = (lines: string[]): number => graphemes(lines.join(' '));

// ---------------------------------------------------------------------------------------------------
// Sound made at test time. A spoken line's recording: each word spoken alone by `say -v Samantha` at 48 kHz, cut to the
// samples between its first and last above −50 dBFS, scaled by the fixture's gain and put at the sample the fixture
// fixes; a word longer than its slot is cut at the slot's end with a 5 ms fade. So each word starts where the fixture
// says, whatever the voice sounds like on this macOS.

const WORD_FLOOR = 10 ** (-50 / 20);
const spoken = new Map<string, Float32Array>();
function clip(word: string): Float32Array {
  let c = spoken.get(word);
  if (!c) {
    const x = say(word, RATE);
    let a = 0;
    while (a < x.length && Math.abs(x[a]!) <= WORD_FLOOR) a++;
    let b = x.length;
    while (b > a && Math.abs(x[b - 1]!) <= WORD_FLOOR) b--;
    if (b <= a) throw Error(`BLOCKED: macOS say spoke nothing for ${JSON.stringify(word)}`);
    c = x.slice(a, b);
    spoken.set(word, c);
  }
  return c;
}
export interface Voice { asset: string; spec: RecordingSpec; samples: Float32Array; wav: Uint8Array; sha: string; pcm: Uint8Array; pcmSha: string }
/** The recordings of the fixture's spoken lines (or of `specs`, a twin's), by asset ID. */
export function voices(specs: Record<string, RecordingSpec> = FIXTURE.recordings): Record<string, Voice> {
  const out: Record<string, Voice> = {};
  for (const [asset, spec] of Object.entries(specs)) {
    const x = new Float32Array(spec.samples);
    for (const w of spec.words) {
      const c = clip(w.text);
      const n = Math.min(c.length, w.end - w.start);
      for (let i = 0; i < n; i++) x[w.start + i] = spec.gain * c[i]!;
      const fade = Math.min(240, n);
      if (c.length > n) for (let i = 0; i < fade; i++) x[w.start + n - 1 - i]! *= i / fade;
    }
    const wav = wavF32(x, RATE);
    const pcm = pcmBytes(x);
    out[asset] = { asset, spec, samples: x, wav, sha: sha256(wav), pcm, pcmSha: sha256(pcm) };
  }
  return out;
}
/** The film's music: #1819's chord pad, 12 s at the fixture's level, one channel at 48 kHz. */
export function musicBed(): Float32Array {
  const x = music(FIXTURE.music.seconds, RATE);
  const scale = 10 ** ((FIXTURE.music.rms_dbfs + 35) / 20);
  for (let i = 0; i < x.length; i++) x[i]! *= scale;
  return x;
}
/** The film's narration alone, in film samples: each recording's played part where its strip puts it. */
export function narration(vs: Record<string, Voice>): Float32Array {
  const x = new Float32Array(FILM.span / SAMPLE);
  for (const v of Object.values(vs)) for (let s = v.spec.in; s < v.spec.out; s++) x[v.spec.at + s - v.spec.in] = v.samples[s]!;
  return x;
}

/** Interleaved 32-bit float WAV of `channels` at `rate`. */
export function floatWav(channels: Float32Array[], rate: number): Buffer {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return b;
}

// ---------------------------------------------------------------------------------------------------
// The words records the fixture film attaches (README: Fixtures, The words records). A record is the Analysis bake
// row's: kind, analyzer, weights, pcm_sha256, frame and words in flicks. These are written by the test from the
// fixture's own word times, the samples it put each word at; criterion 9 alone reads records the real jobs made.

export const ALIGNER = 'charsiu-aligner@1.0.0';
export function fixtureRecord(v: Voice): Uint8Array {
  const record = {
    kind: 'bake.words', analyzer: ALIGNER, weights: [], pcm_sha256: v.pcmSha, frame: FLICKS / 100,
    words: v.spec.words.map((w) => ({ text: w.text.toLowerCase(), start: w.start * SAMPLE, end: w.end * SAMPLE, phonemes: [] })),
  };
  return new TextEncoder().encode(JSON.stringify(record));
}

/** The fixture's document with the values made at test time filled in: each asset's SHA-256, each voice asset's
 * attached words record, and the music strip's source. */
export function filmDocument(voice: Record<string, { sha: string; record: string }>, musicSha: string): JsonObject {
  const doc = clone(FIXTURE.document);
  const assets = part(doc, 'assets');
  for (const [id, raw] of Object.entries(assets)) {
    const a = obj(raw, `assets.${id}`);
    if (id === FIXTURE.music.asset) { a['sha256'] = musicSha; continue; }
    const v = voice[id];
    if (!v) throw Error(`no recording was made for the asset ${id}`);
    a['sha256'] = v.sha;
    a['attached'] = [v.record];
  }
  part(doc, 'strips', 'music')['src'] = musicSha;
  return doc;
}
export interface Staged { document: JsonObject; voices: Record<string, Voice>; music: Float32Array }
/** The fixture film staged in an evidence store: its recordings, their words records written from the fixture's word
 * times, and its music, each put there by hash; and its document. `specs` makes a twin's recordings. */
export function stage(evidence: string, specs: Record<string, RecordingSpec> = FIXTURE.recordings): Staged {
  const vs = voices(specs);
  const bed = musicBed();
  const filled: Record<string, { sha: string; record: string }> = {};
  for (const v of Object.values(vs)) filled[v.asset] = { sha: putEvidence(evidence, v.wav), record: putEvidence(evidence, fixtureRecord(v)) };
  return { document: filmDocument(filled, putEvidence(evidence, wavF32(bed, RATE))), voices: vs, music: bed };
}
/** The film without its script: the same picture and music, no narration, no captions and no ducking (criterion 4's
 * render with the caption layer removed). */
export function withoutScript(document: JsonObject): JsonObject {
  const doc = clone(document);
  delete doc['script'];
  delete doc['ducking'];
  const assets = part(doc, 'assets');
  for (const id of Object.keys(assets)) if (id !== FIXTURE.music.asset) delete assets[id];
  return doc;
}
/** Criterion 3's twin, a line too fast for 20 characters a second: `listen` says four words, 22 characters, in the
 * 0.54 s its one word took, so its caption, held to 5/6 s, would need 26.4 characters a second. */
export const FAST = { line: 'listen', asset: 'voice_listen', text: 'Listen closely to this', caption: 'listen.1' } as const;
export function fastSpecs(): Record<string, RecordingSpec> {
  const specs = clone(FIXTURE.recordings);
  const spec = specs[FAST.asset]!;
  const slot = spec.words[0]!;
  const each = (slot.end - slot.start) / 4;
  spec.words = FAST.text.split(' ').map((text, k) => ({ text, start: slot.start + k * each, end: slot.start + (k + 1) * each }));
  return specs;
}

const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Synthesized by the #502 acceptance tests.' };
/** One tone at two levels, the fixture's `range_mix`: `low_dbfs` for the first half and `high_dbfs` for the second, both
 * channels alike, so its loudness range is the levels' difference. */
export function rangeTone(): Float32Array[] {
  const m = FIXTURE.range_mix;
  const half = m.seconds_each * RATE;
  const x = new Float32Array(2 * half);
  for (let i = 0; i < x.length; i++) x[i] = 10 ** ((i < half ? m.low_dbfs : m.high_dbfs) / 20) * Math.sin((2 * Math.PI * m.hz * i) / RATE);
  return [x, Float32Array.from(x)];
}
/** Criterion 7's film: the fixture's document without its script, its music strip playing the range tone. */
export function rangeFilm(evidence: string): { document: JsonObject; tone: string } {
  const tone = putEvidence(evidence, floatWav(rangeTone(), RATE));
  const doc = withoutScript(FIXTURE.document);
  part(doc, 'assets', FIXTURE.music.asset)['sha256'] = tone;
  part(doc, 'strips', 'music')['src'] = tone;
  return { document: doc, tone };
}
/** A small film whose master is one sound asset, played from its start at unity (or `gain` dB): 64 × 64 at 24 fps, a
 * block sliding across, `frames` of sound at 48 kHz, its span the sound's length rounded up to the second. */
export function masterFilm(asset: string, frames: number, license: JsonObject = CC0, gain?: number): JsonObject {
  const seconds = Math.ceil(frames / RATE);
  const rect = (id: string, box: number[], role: string, order: string): JsonObject => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  return {
    format: 1, id: 'master', profile: 'film', title: 'A master for the meter', description: 'One sound asset played on the master, for the #502 loudness tests.',
    size: [64, 64], camera: 'cam', transport: { span: `${seconds}s`, frame_rate: [24, 1], sample_rate: RATE },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [32, 32, 0], view_width: 64 } },
      back: rect('back', [0, 0, 64, 64], 'ground', 'a1'),
      mover: rect('mover', [0, 24, 16, 16], 'accent', 'a2'),
    },
    channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${seconds}s`, value: 48, interp: 'linear' } } } },
    assets: { master: { sha256: asset, license } },
    strips: { master: { track: 1, src: asset, start: '0s', in: 0, out: frames * SAMPLE, rate: 1, ...(gain === undefined ? {} : { gain }) } },
  };
}
/** A 48 kHz PCM WAV's sample frames, from its header. */
export function wavFrames(bytes: Buffer): number {
  let rate = 0; let block = 0;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4);
    if (id === 'fmt ') { rate = bytes.readUInt32LE(o + 12); block = bytes.readUInt16LE(o + 20); }
    if (id === 'data' && block > 0) {
      if (rate !== RATE) throw Error(`the WAV is at ${rate} Hz, and the film's transport at ${RATE}`);
      return Math.floor(Math.min(size, bytes.length - o - 8) / block);
    }
    o += 8 + size + (size % 2);
  }
  throw Error('the WAV has no fmt and data chunks');
}

// ---------------------------------------------------------------------------------------------------
// Temp folders that last for the file (a run several tests read), all under /tmp and removed after it.

export function useFileTemp(tag: string): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join('/tmp', `deep-502-${tag}-`)); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

export const exportCall = (ask: JsonObject): JsonObject => ({ call: 'export', ...ask });
export const decodeCall = (path: string, out: string): JsonObject => ({ call: 'media_decode', path, out, video_frames: 0 });
/** One scenario: document a presented, then `calls`; their replies. A planted program is named in the scenario. */
export function filmRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, document), ...calls], planted ? { planted } : {}), label);
  presented(replies[0]!, `${label}: the film`);
  return replies.slice(1);
}
/** A sidecar's path: beside the delivery, under its name, with the kind as its extension. */
export const sidecar = (out: string, kind: 'srt' | 'vtt'): string => join(dirname(out), `${basename(out, extname(out))}.${kind}`);

/** The loudness readings of a receipt this suite reads: of the PCM it delivers, and of the decoded delivery. */
export interface Readings { integrated: number; lra: number; true_peak: number }
export interface Loudness extends Readings { profile: string; gain: number; limiter_cut: boolean; delivery: Readings }
function readings(o: JsonObject, what: string): Readings {
  return { integrated: num(o['integrated'], `${what}.integrated (LUFS)`), lra: num(o['lra'], `${what}.lra (LU)`), true_peak: num(o['true_peak'], `${what}.true_peak (dBTP)`) };
}
export function loudnessOf(receipt: JsonObject, what: string): Loudness {
  const w = `${what}: receipt`;
  const pcm = readings(receipt, w);
  const delivery = readings(obj(receipt['delivery'], `${w}.delivery`), `${w}.delivery`);
  const profile = str(receipt['loudness_profile'], `${w}.loudness_profile`);
  const gain = num(receipt['gain'], `${w}.gain (dB)`);
  expect(typeof receipt['limiter_cut'], `${w}.limiter_cut is whether the limiter ever cut, a boolean, got ${show(receipt['limiter_cut'])}`).toBe('boolean');
  return { ...pcm, profile, gain, limiter_cut: receipt['limiter_cut'] === true, delivery };
}
export interface Cue { name: string; line: string; text: string; in: number; out: number }
export interface Captions { profile: string; mode: string; files: string[]; violations: JsonValue[]; cues: Cue[] }
export function captionsOf(receipt: JsonObject, what: string): Captions {
  const w = `${what}: receipt.captions`;
  const c = obj(receipt['captions'], w);
  return {
    profile: str(c['profile'], `${w}.profile`), mode: str(c['mode'], `${w}.mode`),
    files: arr(c['files'], `${w}.files`).map((f, i) => str(f, `${w}.files[${i}]`)),
    violations: arr(c['violations'], `${w}.violations`),
    cues: arr(c['cues'], `${w}.cues`).map((v, i) => {
      const o = obj(v, `${w}.cues[${i}]`);
      return {
        name: str(o['name'], `${w}.cues[${i}].name`), line: str(o['line'], `${w}.cues[${i}].line`), text: str(o['text'], `${w}.cues[${i}].text`),
        in: int(o['in'], `${w}.cues[${i}].in (flicks)`), out: int(o['out'], `${w}.cues[${i}].out (flicks)`),
      };
    }),
  };
}
/** The receipt's captions against the fixture's cue list and its expected times at `rate`, exactly; each failure
 * names its caption. */
export function captionFailures(got: Cue[], rate: string): string[] {
  const want = table(rate).captions;
  const f: string[] = [];
  if (got.length !== want.length) f.push(`the receipt lists ${got.length} captions, the fixture ${want.length}: ${got.map((c) => c.name).join(', ')}`);
  want.forEach((w, i) => {
    const cue = FIXTURE.cues[i]!;
    const g = got[i];
    const at = `caption ${w.name}`;
    if (!g) { f.push(`${at}: the receipt has no caption ${i + 1}`); return; }
    if (g.name !== w.name || g.line !== cue.line) f.push(`${at}: the receipt's caption ${i + 1} is ${g.name} of line ${g.line}, not ${w.name} of line ${cue.line}`);
    if (g.text !== cue.lines.join('\n')) f.push(`${at}: its text is ${JSON.stringify(g.text)}, not ${JSON.stringify(cue.lines.join('\n'))}`);
    if (g.in !== w.in) f.push(`${at}: its in-time is ${sec(g.in)} (${g.in} flicks), not frame ${w.in_frame} at ${rate}, ${sec(w.in)} (${w.in} flicks)`);
    if (g.out !== w.out) f.push(`${at}: its out-time is ${sec(g.out)} (${g.out} flicks), not frame ${w.out_frame} at ${rate}, ${sec(w.out)} (${w.out} flicks)`);
  });
  return f;
}
/** A FAILed export's issues (README: `export`, FAIL): `outcome: "failed"` and `issues`, each an object. */
export function failedIssues(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['outcome'], `${what} FAILs: ${show(reply)}`).toBe('failed');
  return arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Sidecars: this suite's own readers of the forms the Export row gives, and FFmpeg's demuxer through ffprobe.

export interface SidecarCue { start: number; end: number; lines: string[] }
const stamp = (h: string, m: string, s: string, ms: string): number => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
function blocks(text: string): string[][] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.split('\n').filter((l) => l !== '')).filter((b) => b.length > 0);
}
/** An .srt's cues: numbered from 1, times `HH:MM:SS,mmm --> HH:MM:SS,mmm`, then the caption's lines. */
export function parseSrt(text: string, what: string): SidecarCue[] {
  return blocks(text).map((b, i) => {
    expect(b[0], `${what}: cue ${i + 1} is numbered ${i + 1}`).toBe(String(i + 1));
    const m = /^(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})$/.exec(b[1] ?? '');
    expect(m !== null, `${what}: cue ${i + 1}'s times are HH:MM:SS,mmm --> HH:MM:SS,mmm, got ${JSON.stringify(b[1])}`).toBe(true);
    return { start: stamp(m![1]!, m![2]!, m![3]!, m![4]!), end: stamp(m![5]!, m![6]!, m![7]!, m![8]!), lines: b.slice(2) };
  });
}
/** A .vtt's cues: the first line `WEBVTT`, then cues with times `HH:MM:SS.mmm --> HH:MM:SS.mmm` (a cue may carry an
 * identifier line before its times) and the caption's lines. */
export function parseVtt(text: string, what: string): SidecarCue[] {
  const [head, ...rest] = blocks(text);
  expect(head, `${what} starts with the line WEBVTT`).toEqual(['WEBVTT']);
  return rest.map((b, i) => {
    const at = b[0]!.includes('-->') ? 0 : 1;
    const m = /^(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})(?: .*)?$/.exec(b[at] ?? '');
    expect(m !== null, `${what}: cue ${i + 1}'s times are HH:MM:SS.mmm --> HH:MM:SS.mmm, got ${JSON.stringify(b[at])}`).toBe(true);
    return { start: stamp(m![1]!, m![2]!, m![3]!, m![4]!), end: stamp(m![5]!, m![6]!, m![7]!, m![8]!), lines: b.slice(at + 1) };
  });
}
/** A sidecar's text, or a failure naming the file the export should have written. */
export function sidecarText(path: string, what: string): string {
  expect(existsSync(path), `${what}: the export wrote ${basename(path)} beside its delivery (${path})`).toBe(true);
  return readFileSync(path, 'utf8');
}
/** A sidecar's cues against the fixture's at `rate`: every caption, in time order, at its in- and out-time rounded
 * down to the millisecond, with its lines as its text. Each failure starts `<file>: cue <n> (<caption>)`. `times`
 * alone leaves the text unread (FFmpeg's packets). */
export function cueFailures(got: { start: number; end: number; lines?: string[] }[], rate: string, file: string): string[] {
  const want = table(rate).captions;
  const f: string[] = [];
  if (got.length !== want.length) f.push(`${file}: it holds ${got.length} cues, the film ${want.length} captions`);
  want.forEach((w, i) => {
    const g = got[i];
    const at = `${file}: cue ${i + 1} (${w.name})`;
    if (!g) { f.push(`${at} is missing`); return; }
    if (g.start !== w.in_ms) f.push(`${at} starts at ${g.start} ms, not ${w.in_ms} ms: frame ${w.in_frame} at ${rate}, rounded down to the millisecond`);
    if (g.end !== w.out_ms) f.push(`${at} ends at ${g.end} ms, not ${w.out_ms} ms: frame ${w.out_frame} at ${rate}, rounded down to the millisecond`);
    const lines = FIXTURE.cues[i]!.lines;
    if (g.lines && g.lines.join('\n') !== lines.join('\n')) f.push(`${at} reads ${JSON.stringify(g.lines)}, not the caption's lines ${JSON.stringify(lines)}`);
  });
  return f;
}

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = name === 'ffmpeg' ? process.env['DEEP_FFMPEG'] : process.env['DEEP_FFPROBE'];
  for (const c of [env, name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
/** FFmpeg's tools with its SubRip and WebVTT demuxers, or why they can't be used here (a `BLOCKED:` line's reason). */
export function ffmpegTools(): { ffmpeg: string; ffprobe: string } | string {
  const ffmpeg = findTool('ffmpeg');
  const ffprobe = findTool('ffprobe');
  const unblock = 'Unblock: brew install ffmpeg, or name the binaries in DEEP_FFMPEG and DEEP_FFPROBE';
  if (!ffmpeg || !ffprobe) return `FFmpeg's subtitle demuxer is the reader the sidecars are held to, and ${!ffmpeg ? 'ffmpeg' : 'ffprobe'} was not found on PATH, in /opt/homebrew/bin or /usr/local/bin. ${unblock}`;
  const demuxers = spawnSync(ffmpeg, ['-hide_banner', '-demuxers'], { encoding: 'utf8' }).stdout ?? '';
  if (!/\bsrt\b/.test(demuxers) || !/\bwebvtt\b/.test(demuxers)) return `${ffmpeg} has no srt or webvtt demuxer. ${unblock}`;
  return { ffmpeg, ffprobe };
}
/** A sidecar's cues as FFmpeg's subtitle demuxer reads them: each packet's start and end in whole milliseconds. */
export function demuxed(ffprobe: string, path: string): { start: number; end: number }[] {
  const out = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-of', 'json', '-show_entries', 'packet=pts,duration:stream=time_base', path], { encoding: 'utf8', maxBuffer: 1 << 26 })) as JsonObject;
  const base = /^(\d+)\/(\d+)$/.exec(str(obj(arr(out['streams'], 'ffprobe: streams')[0], 'ffprobe: the stream')['time_base'], 'ffprobe: time_base'));
  if (!base) throw Error(`ffprobe gave no time base for ${path}`);
  const ms = (ticks: number): number => {
    const x = BigInt(ticks) * 1000n * BigInt(base[1]!);
    if (x % BigInt(base[2]!) !== 0n) throw Error(`${ticks} ticks of ${base[0]} is not a whole number of milliseconds`);
    return Number(x / BigInt(base[2]!));
  };
  return arr(out['packets'], 'ffprobe: packets').map((v, i) => {
    const p = obj(v, `ffprobe: packet ${i}`);
    const pts = int(p['pts'], `ffprobe: packet ${i}.pts`);
    return { start: ms(pts), end: ms(pts + int(p['duration'], `ffprobe: packet ${i}.duration`)) };
  });
}

// ---------------------------------------------------------------------------------------------------
// A delivered file's sound: decoded by the decode worker (`media_decode`, #498), and measured by the loudness bake
// (`media_bake`, #500, the meter #500's suites hold to the EBU signals), apart from what the receipt says.

export interface Sound { rate: number; channels: Float32Array[] }
export function decodedSound(reply: JsonObject, out: string, what: string): Sound {
  const d = obj(reply['decoded'], `${what}: media_decode's decoded (${show(reply, 600)})`);
  const audio = arr(d['streams'], `${what}: decoded.streams`).filter((s): s is JsonObject => isObject(s) && s['type'] === 'audio');
  expect(audio.length, `${what}: the delivery holds one audio track`).toBe(1);
  const s = audio[0]!;
  const nch = int(s['channels'], `${what}: the audio track's channels`);
  const bytes = readFileSync(join(out, str(s['file'], `${what}: the audio track's file`)));
  const frames = Math.floor(bytes.length / (4 * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c]![i] = bytes.readFloatLE(4 * (i * nch + c));
  return { rate: int(s['sample_rate'], `${what}: the audio track's sample_rate`), channels };
}
/** The channels' mean. */
export function mono(s: Sound): Float32Array {
  const x = new Float32Array(s.channels[0]!.length);
  for (const c of s.channels) for (let i = 0; i < x.length; i++) x[i]! += c[i]! / s.channels.length;
  return x;
}
/** The loudness bake's readings of a sound put in the store as a float WAV: integrated, range, and true peak at 8×. */
export function meter(bin: string, evidence: string, sound: Sound, what: string): Readings {
  const asset = putEvidence(evidence, floatWav(sound.channels, sound.rate));
  const [reply] = runShow(bin, { evidence, calls: [{ call: 'media_bake', bake: { asset, kind: 'loudness', tp_oversample: 8 } }] }, what);
  const b = obj(reply!['bake'], `${what}: bake (${show(reply, 600)})`);
  return { integrated: num(b['integrated'], `${what}: bake.integrated`), lra: num(b['range'], `${what}: bake.range`), true_peak: num(b['true_peak'], `${what}: bake.true_peak`) };
}
export const within = (v: number, target: number, band: number): boolean => Math.abs(v - target) <= band + 1e-9;
export const lu = (v: number): string => v.toFixed(3);
