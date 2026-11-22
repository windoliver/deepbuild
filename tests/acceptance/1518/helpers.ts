// Test-side tools for the #1518 acceptance tests (README: The surface under test, Fixtures): recordings made at run
// time with each word at a known sample (a 60 s take spoken word by word by macOS `say`, tone bursts, a square-wave take
// with a 30 ms kept fragment, and a video whose every frame shows its own number, made by ffmpeg), the words records
// written from those samples (and a copy shifted 150 ms), film documents holding one `cut.words@1` item, the expansion's
// row read from `deep show`'s reply, the judges the criteria hold that row and an export to, and a world of a real hub
// with deepbuild/speech for the pinned transcriber. Nothing here stands in for the recipe, the mixer, the export, the
// decode worker, the transcriber or `cut.heard`: every reading is what deep-show or the hub answers, and every expected
// value comes from the issue, the design or where these tools put each sample.
//
// Reused by import: #501's build, scenario and evidence store; #509's claim, verdict rows, media_heard, deep_job and
// model host (its World, with this suite's own hub and deep mcp under /tmp/dh1518-*); #1819's `say` and WAV writer.
// Safety: hub worlds live under /tmp/dh1518-* and are removed after their file; the hub and deep mcp run with HOME in the
// world's folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; every process is one this file started,
// stopped by its PID (the model host by #509's helpers, by the process group it leads); nothing is stopped by name or port.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { pcmBytes, say, wavF32 } from '../1819/fixtures/synth.ts';
import { isObject, present, scenario } from '../501/helpers.ts';
import {
  CLAIM, DOC, FLICKS, REPO, TRANSCRIBER, TRANSCRIPT, coded, fieldOf, filmRun, int, putEvidence, readJson, rowFrom, runShow, sha256, show, transcribe,
  verdictCall, type JsonObject, type JsonValue, type Line, type World,
} from '../509/helpers.ts';

export { isObject, present, scenario } from '../501/helpers.ts';
export {
  CLAIM, DOC, FLICKS, FULL, REPO, SPEECH, TIMEOUT, TRANSCRIBER, TRANSCRIPT, blockedUnless, coded, fieldOf, filmRun, hear, inconclusive,
  outputOf, putEvidence, readJson, rowFrom, runJob, runShow, sha256, show, stopHost, transcribe, useShow, useTemp, verdictCall, withPlugin,
  type JsonObject, type JsonValue, type Line, type World,
} from '../509/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: '#1518.1dbfdc9b', 2: '#1518.d365703e', 3: '#1518.c2ae9106', 4: '#1518.57df01e0',
  5: '#1518.3499b3ff', 6: '#1518.b19abf07', 7: '#1518.ef499157', 8: '#1518.bf377712',
} as const;

/** The wrong programs the issue names, each chosen by a scenario's `planted` (design: As built (#1518)). */
export const PLANTED = { raw: 'cut_on_raw_times', drops: 'cut_drops_fragments', empty: 'cut_heard_passes_empty' } as const;

// ---------------------------------------------------------------------------------------------------
// Time. Every recording is at 48 kHz: 14,700 flicks a sample.

export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
/** The recipe's defaults (design): `search` 200 ms, `crossfade` {min 5 ms, max 40 ms}, in samples. */
export const SEARCH = (200 * RATE) / 1000;
export const XFADE_MAX = (40 * RATE) / 1000;
/** A number of milliseconds as samples. */
export const ms = (n: number): number => Math.round((n * RATE) / 1000);
export const ITEM = 'cut';
export const KIND = 'cut.words@1';
/** The default verdict row's `from` and its kind (design): `<claim>#cut.heard`. */
export const HEARD = 'cut.heard';

// ---------------------------------------------------------------------------------------------------
// Recordings: one channel of f32 at 48 kHz, each word at the samples [start, end) the fixture put it at (its true times).

export interface Word { text: string; start: number; end: number }
export interface Recording { samples: Float32Array; words: Word[] }
/** `keep` as the design takes it: word indexes and inclusive `[first, last]` ranges, counted from 0. */
export type Keep = (number | [number, number])[];
/** Every word kept but `removed`: the inclusive ranges between them. */
export function keepAllBut(count: number, removed: readonly number[]): Keep {
  const out: Keep = [];
  let from = 0;
  for (const r of [...removed].sort((a, b) => a - b)) {
    if (r > from) out.push([from, r - 1]);
    from = r + 1;
  }
  if (from < count) out.push([from, count - 1]);
  return out;
}
/** The word indexes a keep list keeps. */
export function keptOf(keep: Keep): Set<number> {
  const out = new Set<number>();
  for (const k of keep) {
    if (typeof k === 'number') out.add(k);
    else for (let i = k[0]; i <= k[1]; i++) out.add(i);
  }
  return out;
}
const plain = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}_'-]/gu, '');

// The 60 s take (criteria 1 and 2): twelve sentences spoken word by word by `say -v Samantha` (#1819's), each word cut to
// the samples between its first and last above −50 dBFS and laid at gain 0.5 with 120 ms of digital silence between the
// words of a sentence and an even pause between sentences, so the take is 60 s exactly. The word in brackets in each
// sentence is the one the keep list leaves out: twelve marked cuts, each an inserted word between two kept ones. A word
// sample that `say` wrote as exactly 0 is lifted to 1e-6, so the gaps are the take's only digital silence.
export const SENTENCES = [
  'We heard the [loud] train arrive', 'She bought fresh [warm] bread this morning', 'The children tossed the [heavy] stone away',
  'He filled the [empty] glass with water', 'My mother watered the [green] plant today', 'Her bright [happy] smile lit the room',
  'We walked across the [quiet] park together', 'The old [wooden] clock stopped last night', 'The [early] flight left on time',
  'Please [gently] bring the chairs inside', 'The kids played on the [tall] swing', 'The store raised the [weekly] price again',
] as const;
const WORD_FLOOR = 10 ** (-50 / 20);
export const SPEECH_GAP = ms(120);
const spokenClips = new Map<string, Float32Array>();
function spoken(word: string): Float32Array {
  let c = spokenClips.get(word);
  if (!c) {
    const x = say(word, RATE);
    let a = 0;
    while (a < x.length && Math.abs(x[a]!) <= WORD_FLOOR) a++;
    let b = x.length;
    while (b > a && Math.abs(x[b - 1]!) <= WORD_FLOOR) b--;
    if (b <= a) throw Error(`BLOCKED: macOS say spoke nothing for ${JSON.stringify(word)}`);
    c = x.slice(a, b).map((v, i) => (v === 0 ? (i % 2 ? -1e-6 : 1e-6) : v));
    spokenClips.set(word, c);
  }
  return c;
}
export interface Speech extends Recording { removed: number[]; keep: Keep; text: string; keptText: string }
let speechMade: Speech | undefined;
/** The 60 s take, made once per file. */
export function speechTake(): Speech {
  if (speechMade) return speechMade;
  const total = 60 * RATE;
  const lead = ms(500);
  const sentences = SENTENCES.map((s) => s.split(' ').map((w) => ({ text: plain(w), removed: w.startsWith('['), x: spoken(plain(w)) })));
  const sound = sentences.reduce((n, s) => n + s.reduce((m, w) => m + w.x.length, 0) + SPEECH_GAP * (s.length - 1), 0);
  const pause = Math.min(ms(2000), Math.floor((total - lead - ms(1000) - sound) / (sentences.length - 1)));
  if (pause < ms(300)) throw Error(`BLOCKED: say speaks the take's ${sentences.flat().length} words in ${(sound / RATE).toFixed(2)} s with their gaps, too long for a 60 s recording with 0.3 s between sentences`);
  const samples = new Float32Array(total);
  const words: Word[] = [];
  const removed: number[] = [];
  let at = lead;
  sentences.forEach((s, k) => {
    s.forEach((w, i) => {
      if (w.removed) removed.push(words.length);
      for (let j = 0; j < w.x.length; j++) samples[at + j] = 0.5 * w.x[j]!;
      words.push({ text: w.text, start: at, end: at + w.x.length });
      at += w.x.length + (i < s.length - 1 ? SPEECH_GAP : 0);
    });
    if (k < sentences.length - 1) at += pause;
  });
  const text = words.map((w) => w.text).join(' ');
  const keptText = words.filter((_, i) => !removed.includes(i)).map((w) => w.text).join(' ');
  speechMade = { samples, words, removed, keep: keepAllBut(words.length, removed), text, keptText };
  return speechMade;
}

/** A word of a synthesized recording: its text, its first sample, its length in samples and its tone's frequency. */
export interface Tone { text: string; start: number; length: number; hz: number }
/** Sine bursts at amplitude 0.5 with 2 ms raised-cosine ends, in digital silence, `total` samples long. */
export function bursts(tones: readonly Tone[], total: number): Recording {
  const samples = new Float32Array(total);
  const ramp = ms(2);
  for (const t of tones) {
    for (let i = 0; i < t.length; i++) {
      const edge = Math.min(1, i / ramp, (t.length - 1 - i) / ramp);
      samples[t.start + i] = 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * edge)) * Math.sin((2 * Math.PI * t.hz * i) / RATE);
    }
  }
  return { samples, words: tones.map((t) => ({ text: t.text, start: t.start, end: t.start + t.length })) };
}
/** `n` tone words of 200 ms from 0.5 s, 100 ms apart (criteria 7 and 8): word k at 300 + 3k Hz. */
export function toneTake(n: number): Recording {
  const tones = Array.from({ length: n }, (_, k) => ({ text: `tone${k}`, start: ms(500) + k * ms(300), length: ms(200), hz: 300 + 3 * k }));
  return bursts(tones, ms(500) + n * ms(300) + ms(1000));
}

// Criterion 4's take: five words of a 500 Hz square wave at ±0.5 (half-period 48 samples). w0 and w4 are kept with
// 120 ms of silence after w0 and before w4; w1 (removed), w2 (kept, 30 ms) and w3 (removed) run on with no silence and
// one square wave across them, each edge a sign change. Inside the bounds of w2's two cuts every 40 ms window holds
// only samples of ±0.5, so no spot is quieter than the raw points: by the design's rule both cuts stay at w2's edges,
// 30 ms apart, less than half its two 40 ms crossfades.
export interface FragmentTake extends Recording { fragment: number; keep: Keep }
export function fragmentTake(): FragmentTake {
  const half = 48;
  const lead = ms(300), long = ms(300), short = ms(30), gap = ms(120);
  const s0 = lead, s1 = s0 + long + gap, s2 = s1 + long, s3 = s2 + short, s4 = s3 + long + gap;
  const total = s4 + long + ms(300);
  const samples = new Float32Array(total);
  const square = (from: number, to: number, phase0: number): void => {
    for (let i = from; i < to; i++) samples[i] = Math.floor((i - phase0) / half) % 2 === 0 ? 0.5 : -0.5;
  };
  square(s0, s0 + long, s0);
  square(s1, s3 + long, s1);
  square(s4, s4 + long, s4);
  const words: Word[] = [
    { text: 'ash', start: s0, end: s0 + long }, { text: 'birch', start: s1, end: s1 + long }, { text: 'cedar', start: s2, end: s2 + short },
    { text: 'dogwood', start: s3, end: s3 + long }, { text: 'elm', start: s4, end: s4 + long },
  ];
  return { samples, words, fragment: 2, keep: [0, 2, 4] };
}

// ---------------------------------------------------------------------------------------------------
// The video recording (criteria 3, 5 and 6): 10 s, 160 × 90 at 30 fps, H.264 (libx264, no B-frames) with its sound as
// 16-bit FLAC in one MP4, made by ffmpeg from raw frames and raw samples. Frame k shows k in binary: ten columns of
// 16 px, column i's top half white and bottom half black when bit i is set, the other way when not. The sound is sixteen
// tone words (word w at 300 + 70w Hz, 300 ms long, its start at 1 s + 0.5 w s + half a frame) in digital silence. Its
// twin shows frame k's number k − 3 (its picture three frames late) over the same sound.

export const VIDEO = { size: [160, 90] as [number, number], fps: 30, frames: 300, seconds: 10, columns: 10 } as const;
export const VIDEO_TONES: Tone[] = Array.from({ length: 16 }, (_, w) => ({
  text: `tone${300 + 70 * w}`, start: Math.round((1 + 0.5 * w + 1 / 60) * RATE), length: ms(300), hz: 300 + 70 * w,
}));
export const videoSound = (): Recording => bursts(VIDEO_TONES, VIDEO.seconds * RATE);
/** The video's keep list: four words left out, 3, 6, 10 and 13, so five runs and four splices. */
export const VIDEO_REMOVED = [3, 6, 10, 13] as const;
export const VIDEO_KEEP: Keep = keepAllBut(VIDEO_TONES.length, VIDEO_REMOVED);

function findFfmpeg(): string {
  for (const c of [process.env['DEEP_FFMPEG'], 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && /\blibx264\b/.test(r.stdout ?? '') && /\bflac\b/.test(r.stdout ?? '')) return c;
  }
  throw Error('BLOCKED: the video fixture is made by ffmpeg with libx264 and its flac encoder; none was found on PATH, /opt/homebrew/bin, /usr/local/bin or DEEP_FFMPEG. Unblock: brew install ffmpeg');
}
const videos = new Map<number, Buffer>();
/** The video recording's MP4 bytes, its picture `late` frames behind its sound (0 for the fixture, 3 for the twin). */
export function videoRecording(late = 0): Buffer {
  const made = videos.get(late);
  if (made) return made;
  const ffmpeg = findFfmpeg();
  const [w, h] = VIDEO.size;
  const frames = Buffer.alloc(VIDEO.frames * w * h);
  for (let k = 0; k < VIDEO.frames; k++) {
    const code = Math.max(0, k - late);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (code >> Math.floor(x / 16)) & 1;
      frames[k * w * h + y * w + x] = (y < h / 2) === (bit === 1) ? 255 : 0;
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'deep-1518-video-'));
  try {
    const audio = join(dir, 'sound.f32');
    writeFileSync(audio, Buffer.from(pcmBytes(videoSound().samples)));
    const out = join(dir, 'recording.mp4');
    execFileSync(ffmpeg, [
      '-hide_banner', '-v', 'error', '-nostdin', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-r', String(VIDEO.fps), '-i', 'pipe:0',
      '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-qp', '10', '-bf', '0', '-g', String(VIDEO.fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'flac', '-sample_fmt', 's16', '-strict', 'experimental', '-t', String(VIDEO.seconds), out,
    ], { input: frames, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
    const bytes = readFileSync(out);
    videos.set(late, bytes);
    return bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// Words records (Analysis bake, the `bake.words` row): kind, analyzer, weights, the PCM's hash, the 10 ms frame and each
// word's start and end in flicks of the source, written from where the fixture put each word, `shift` samples later.

export const ALIGNER = 'charsiu-aligner@1.0.0';
/** The 150 ms the criterion shifts the stated times by: every start and end later than the fixture's true times. */
export const SHIFT = ms(150);
export function wordsRecord(pcmSha: string, words: readonly Word[], shift = 0): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    kind: 'bake.words', analyzer: ALIGNER, weights: [], pcm_sha256: pcmSha, frame: FLICKS / 100,
    words: words.map((w) => ({ text: w.text, start: (w.start + shift) * SAMPLE, end: (w.end + shift) * SAMPLE, phonemes: [] })),
  }));
}
/** A record's words as samples, `shift` later than the true ones: what a cut's raw points and bounds are read from. */
export const stated = (words: readonly Word[], shift = 0): Word[] => words.map((w) => ({ text: w.text, start: w.start + shift, end: w.end + shift }));

/** A one-channel recording in an evidence store: its WAV (32-bit float, so its PCM is its samples), its PCM and record. */
export interface Staged { sha: string; pcm: Uint8Array; pcmSha: string; record: string }
export function stageWav(evidence: string, rec: Recording, shift = 0): Staged {
  const sha = putEvidence(evidence, wavF32(rec.samples, RATE));
  const pcm = pcmBytes(rec.samples);
  const pcmSha = sha256(pcm);
  return { sha, pcm, pcmSha, record: putEvidence(evidence, wordsRecord(pcmSha, rec.words, shift)) };
}

// ---------------------------------------------------------------------------------------------------
// Documents (#502's film shape): one asset `rec` (license CC0, records in `attached`) and one `cut.words@1` item `cut`
// with `recording: "rec"` and a keep list, the recipe's other params left at their defaults.

const CC0_LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #1518 acceptance tests.' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function cutItem(keep: Keep, order = 'a5'): JsonObject {
  return { id: ITEM, kind: KIND, name: 'Cut by words', order, params: { recording: 'rec', keep: keep as unknown as JsonValue } };
}
const asset = (sha: string, attached: readonly string[]): JsonObject => ({ sha256: sha, license: CC0_LICENSE, attached: [...attached] });
/** A sound-only film, 64 × 64 at 24 fps, with a block sliding so every frame differs, and the cut item. */
export function soundFilm(sha: string, attached: readonly string[], keep: Keep, seconds: number): JsonObject {
  const rect = (id: string, box: number[], role: string, order: string): JsonObject => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
  return {
    format: 1, id: 'cut', profile: 'film', title: 'A recording cut by its words', description: 'A recording cut by its words, for the #1518 acceptance tests.',
    size: [64, 64], camera: 'cam', requires: { modules: { media: '^1' } }, transport: { span: `${seconds}s`, frame_rate: [24, 1], sample_rate: RATE },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [32, 32, 0], view_width: 64 } },
      back: rect('back', [0, 0, 64, 64], 'ground', 'a1'), mover: rect('mover', [0, 24, 16, 16], 'accent', 'a2'), [ITEM]: cutItem(keep),
    },
    channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${seconds}s`, value: 48, interp: 'linear' } } } },
    assets: { rec: asset(sha, attached) },
  };
}
/** A film of the video recording: the document's size is the video's, 30 fps, and nothing but the cut item. */
export function videoFilm(sha: string, attached: readonly string[], keep: Keep): JsonObject {
  return {
    format: 1, id: 'cutvideo', profile: 'film', title: 'A screen recording cut by its words', description: 'A video recording cut by its words, for the #1518 acceptance tests.',
    size: [...VIDEO.size], requires: { modules: { media: '^1' } }, transport: { span: `${VIDEO.seconds}s`, frame_rate: [VIDEO.fps, 1], sample_rate: RATE },
    items: { [ITEM]: cutItem(keep, 'a1') }, assets: { rec: asset(sha, attached) },
  };
}
/** The document with `records` added to the recording asset's `attached`. */
export function withAttached(doc: JsonObject, records: readonly string[]): JsonObject {
  const d = clone(doc);
  const a = (d['assets'] as JsonObject)['rec'] as JsonObject;
  a['attached'] = [...((a['attached'] as JsonValue[] | undefined) ?? []), ...records];
  return d;
}
/** The document stored as a shared document of yours (#96, #306's form): one layer of yours, every item in it. */
export function yours(doc: JsonObject): JsonObject {
  const d = clone(doc);
  d['layers'] = { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } };
  for (const item of Object.values(d['items'] as JsonObject)) (item as JsonObject)['layer'] = 'you-main';
  return d;
}

// ---------------------------------------------------------------------------------------------------
// deep-show calls beyond #501's and #509's.

const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const patchId = (n: number): string => ulid('01JB1518P', n);
/** `deep show` of a whole document from your shell, asking for its issues and, with `timing`, its check's times. */
export function presentWith(doc: string, document: JsonObject, timing = false): JsonObject {
  return { ...present(doc, document), include: timing ? ['issues', 'timing'] : ['issues'] };
}
/** Your one-op patch of a shared document, `set` at `path` of item `id`. */
export const patchCall = (doc: string, n: number, base: number, id: string, path: string, value: JsonValue, reason: string): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, patch: { patch: patchId(n), doc, base, reason, ops: [{ op: 'set', id, path, value }] } });
export const readCall = (doc: string): JsonObject => ({ call: 'read', doc, peer: YOU_PEER });
/** The scenario's three documents on their panels (#501's), document a stored as a shared document holding `seed`. */
export function sharedScenario(evidence: string, seed: JsonObject, calls: JsonObject[]): JsonObject {
  const docs: JsonObject = { [DOC.a]: { panel: 'main', document: seed } };
  for (const id of [DOC.b, DOC.c]) docs[id] = { panel: `side-${id.slice(-1)}` };
  return scenario(evidence, calls, { docs });
}
/** A reply's outcome is `presented`, or the test fails naming the reply. */
export function presented(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply?.['outcome'], `${what} is presented by your deep show: ${show(reply, 2500)}`).toBe('presented');
  return reply!;
}

// ---------------------------------------------------------------------------------------------------
// The expansion's row (design): in `deep show`'s `expansions`, the row of instance `cut` holds `strips` (the document's
// `<item>.s<k>` entries), `derived` (the pictures `<item>.p<k>`), `channels` (`<item>.p<k>.shown`), `removed`,
// `fragments` and `cuts`. A section given as a map by ID or as a list of entries with `id` is read either way (chosen).

export interface Strip { id: string; track: number; asset: string; start: number; in: number; out: number; fadeIn: number; fadeOut: number; raw: JsonObject }
export interface Cut { word: number; side: 'in' | 'out'; raw: number; at: number; sample: number; entry: JsonObject }
export interface Fragment { word: number; text: string; why: string; entry: JsonObject }
export interface CutRow { row: JsonObject; strips: Strip[]; derived: [string, JsonObject][]; channels: [string, JsonObject][]; removed: number[]; fragments: Fragment[]; cuts: Cut[] }

function entries(v: JsonValue | undefined, what: string): [string, JsonObject][] {
  if (isObject(v)) return Object.entries(v).map(([id, e]) => { expect(isObject(e), `${what}.${id} is an object: ${show(e)}`).toBe(true); return [id, e as JsonObject]; });
  expect(Array.isArray(v), `${what} is a map by ID or a list of entries with \`id\`: ${show(v ?? null)}`).toBe(true);
  return (v as JsonValue[]).map((e, i) => {
    expect(isObject(e) && typeof e['id'] === 'string', `${what}[${i}] is an entry with an \`id\`: ${show(e)}`).toBe(true);
    return [(e as JsonObject)['id'] as string, e as JsonObject];
  });
}
const whole = int;
const fadeLength = (v: JsonValue | undefined, what: string): number => {
  if (v === undefined || v === null) return 0;
  expect(isObject(v), `${what} is {length, curve}, got ${show(v)}`).toBe(true);
  return whole((v as JsonObject)['length'], `${what}.length (flicks)`);
};
/** The asset a strip plays: `src` as a hash, or `{asset}`. */
const stripAsset = (s: JsonObject): string => (typeof s['src'] === 'string' ? s['src'] : isObject(s['src']) && typeof s['src']['asset'] === 'string' ? s['src']['asset'] : '');
/** The row of the `cut` item in a reply's `expansions`; a missing field fails, naming it. */
export function cutRow(reply: JsonObject, what: string, item = ITEM): CutRow {
  const list = Array.isArray(reply['expansions']) ? reply['expansions'] : [];
  const rows = list.filter((r): r is JsonObject => isObject(r) && r['instance'] === item);
  expect(rows.length, `${what}: deep show's \`expansions\` holds one row for the ${KIND} item \`${item}\` (design: As built (#1518)); it holds ${show(list.map((r) => (isObject(r) ? { instance: r['instance'] ?? null, kind: r['kind'] ?? null } : r)), 800)}`).toBe(1);
  const row = rows[0]!;
  const strips = entries(row['strips'], `${what}: the row's strips`).map(([id, s]) => ({
    id, track: whole(s['track'], `${what}: strip ${id}.track`), asset: stripAsset(s),
    start: whole(s['start'], `${what}: strip ${id}.start (flicks)`), in: whole(s['in'], `${what}: strip ${id}.in (flicks)`), out: whole(s['out'], `${what}: strip ${id}.out (flicks)`),
    fadeIn: fadeLength(s['fade_in'], `${what}: strip ${id}.fade_in`), fadeOut: fadeLength(s['fade_out'], `${what}: strip ${id}.fade_out`), raw: s,
  })).sort((a, b) => a.start - b.start);
  strips.forEach((s, k) => expect(s.id, `${what}: the strips are \`${item}.s<k>\`, k from 1 in order (design)`).toBe(`${item}.s${k + 1}`));
  const removedV = row['removed'];
  expect(Array.isArray(removedV) && removedV.every((n) => Number.isSafeInteger(n)), `${what}: the row's \`removed\` is a list of word indexes: ${show(removedV ?? null)}`).toBe(true);
  const fragV = row['fragments'] ?? [];
  expect(Array.isArray(fragV), `${what}: the row's \`fragments\` is a list: ${show(fragV)}`).toBe(true);
  const fragments = (fragV as JsonValue[]).map((f, i) => {
    expect(isObject(f), `${what}: fragments[${i}] is {word, text, why}: ${show(f)}`).toBe(true);
    const o = f as JsonObject;
    return { word: whole(o['word'], `${what}: fragments[${i}].word`), text: String(o['text'] ?? ''), why: typeof o['why'] === 'string' ? o['why'] : '', entry: o };
  });
  const cutsV = row['cuts'];
  expect(Array.isArray(cutsV), `${what}: the row's \`cuts\` is a list of {word, side, raw, at, sample}: ${show(cutsV ?? null)}`).toBe(true);
  const cuts = (cutsV as JsonValue[]).map((c, i) => {
    expect(isObject(c) && (c['side'] === 'in' || c['side'] === 'out'), `${what}: cuts[${i}] is {word, side: in | out, raw, at, sample}: ${show(c)}`).toBe(true);
    const o = c as JsonObject;
    return {
      word: whole(o['word'], `${what}: cuts[${i}].word`), side: o['side'] as 'in' | 'out', raw: whole(o['raw'], `${what}: cuts[${i}].raw (flicks)`),
      at: whole(o['at'], `${what}: cuts[${i}].at (flicks)`), sample: whole(o['sample'], `${what}: cuts[${i}].sample`), entry: o,
    };
  }).sort((a, b) => a.raw - b.raw || (a.side === 'out' ? -1 : 1));
  return {
    row, strips, removed: removedV as number[], fragments, cuts,
    derived: row['derived'] === undefined ? [] : entries(row['derived'], `${what}: the row's derived`),
    channels: row['channels'] === undefined ? [] : entries(row['channels'], `${what}: the row's channels`),
  };
}
/** The row's fields the design names, as text: what "byte-identical" compares, a derived item's `layer` left out. */
export function rowText(r: CutRow): string {
  const derived = Object.fromEntries(r.derived.map(([id, d]) => { const { layer: _layer, ...rest } = d; return [id, rest]; }));
  return JSON.stringify({ strips: r.row['strips'], derived, channels: r.row['channels'] ?? null, removed: r.removed, fragments: r.row['fragments'] ?? [], cuts: r.row['cuts'] });
}
/** The cuts the keep list makes around single removed words between kept ones: an `out` after the word before each and an `in` before the word after. */
export const expectedCuts = (removed: readonly number[]): string[] => removed.flatMap((r) => [`${r - 1}:out`, `${r + 1}:in`]).sort();
export const cutKeys = (cuts: readonly Cut[]): string[] => cuts.map((c) => `${c.word}:${c.side}`).sort();

/** How a strip list plays a span of source samples [start, end): whole (inside one strip, clear of its fades), part, or none. */
export function playedAs(strips: readonly Strip[], start: number, end: number): 'whole' | 'part' | 'none' {
  const [a, b] = [start * SAMPLE, end * SAMPLE];
  if (strips.some((s) => s.in + s.fadeIn <= a && b <= s.out - s.fadeOut)) return 'whole';
  return strips.some((s) => s.in < b && a < s.out) ? 'part' : 'none';
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2's judgment of each cut point, against the fixture's samples and true times and the record the document
// read: the cut's `raw` is the record's start of the kept word after it (`in`) or end of the word before it (`out`), and
// `at` is its sample in flicks; it lies within `search` of the raw point and between the middles of the words either side
// by the record; its 40 ms window's energy (the channels' mean, squared and summed over `crossfade.max` samples centred on
// it) is the least of any such sample's, to 0.1% of the range from least to most; the mean is 0 there or has the other
// sign from the sample before; and it lies strictly inside no kept word by the true times. Each failure names its cut,
// numbered from 1 in the source's order.

export function placementFailures(rec: Recording, record: readonly Word[], kept: ReadonlySet<number>, cuts: readonly Cut[]): string[] {
  const x = rec.samples;
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i]! + x[i]! * x[i]!;
  const half = XFADE_MAX / 2;
  const energy = (n: number): number => prefix[Math.min(x.length, Math.max(0, n + half))]! - prefix[Math.min(x.length, Math.max(0, n - half))]!;
  const sign = (n: number): number => Math.sign(x[n] ?? 0);
  const out: string[] = [];
  cuts.forEach((c, i) => {
    const w = record[c.word];
    const name = `cut ${i + 1} (word ${c.word} "${w?.text ?? '?'}", side ${c.side}, sample ${c.sample})`;
    if (!w || !kept.has(c.word)) { out.push(`${name}: names a word the keep list doesn't keep`); return; }
    const rawS = c.side === 'in' ? w.start : w.end;
    if (c.raw !== rawS * SAMPLE) out.push(`${name}: raw is ${c.raw} flicks, not the record's ${c.side === 'in' ? 'start' : 'end'} of the word, ${rawS * SAMPLE}`);
    if (c.at !== c.sample * SAMPLE) out.push(`${name}: at is ${c.at} flicks, not its sample's ${c.sample * SAMPLE}`);
    const [l, r] = c.side === 'in' ? [record[c.word - 1], w] : [w, record[c.word + 1]];
    const lo = Math.max(rawS - SEARCH, l ? (l.start + l.end) / 2 : 0);
    const hi = Math.min(rawS + SEARCH, r ? (r.start + r.end) / 2 : x.length);
    const n = c.sample;
    if (n < Math.floor(lo) || n > Math.ceil(hi)) out.push(`${name}: outside search of its raw point (sample ${rawS}) between the middles of the words either side (${lo.toFixed(1)} to ${hi.toFixed(1)})`);
    let least = Infinity, most = -Infinity, where = -1;
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) { const e = energy(m); if (e < least) { least = e; where = m; } if (e > most) most = e; }
    if (where >= 0 && energy(n) - least > 1e-3 * (most - least) + 1e-12) out.push(`${name}: not in a local energy minimum: its window's energy is ${energy(n).toExponential(3)}, the least within search is ${least.toExponential(3)} (at sample ${where})`);
    if (!(x[n] === 0 || sign(n) !== sign(n - 1))) out.push(`${name}: not on a zero crossing: the sample is ${x[n]} and the one before ${x[n - 1]}`);
    for (const k of kept) {
      const t = rec.words[k]!;
      if (t.start < n && n < t.end) out.push(`${name}: inside the kept word ${k} "${t.text}" by its true times [${t.start}, ${t.end})`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// cut.heard (design): the verdict's default row `<claim>#cut.heard`, BLOCKED with one `cut.heard_unrun` entry per item
// while no transcript of its cut result is attached; that PCM transcribed by the real `narration.transcript` job on
// whisper-cpp@1.9.5 through deep_job; the record listed in the recording asset's `attached`; and the verdict again.

export interface HeardEntry { doc: string; item: string; job: string; analyzer: string; pcm: string; sample_rate: number; channels: number; locale: string; raw: JsonObject }
const field = fieldOf;
/** The row's `cut.heard_unrun` entries (any object in the row with that code), each with its fields on it or its
 * `actual` (chosen: where the entry sits, #509's reading). */
export function heardEntries(row: JsonObject, what: string): HeardEntry[] {
  return coded(row, 'cut.heard_unrun').map((e, i) => {
    const f = (k: string): JsonValue | undefined => field(e, k);
    const at = `${what}: cut.heard_unrun entry ${i + 1} (${show(e, 800)})`;
    expect(typeof f('pcm_sha256') === 'string' && /^[0-9a-f]{64}$/.test(f('pcm_sha256') as string), `${at} names the cut result's PCM by its SHA-256`).toBe(true);
    expect(Number.isSafeInteger(f('sample_rate')) && Number.isSafeInteger(f('channels')) && typeof f('locale') === 'string', `${at} gives sample_rate, channels and locale`).toBe(true);
    return {
      doc: String(f('doc') ?? ''), item: String(f('item') ?? ''), job: String(f('job') ?? ''), analyzer: String(f('analyzer') ?? ''),
      pcm: f('pcm_sha256') as string, sample_rate: f('sample_rate') as number, channels: f('channels') as number, locale: f('locale') as string, raw: e,
    };
  });
}
/** The verdict's `cut.heard` row (by its default `from`). */
export const heardRow = (verdict: JsonObject, what: string): JsonObject => rowFrom(verdict, HEARD, what);
/** The row's error issues of `code`, each with its fields on it or its `actual`. */
export function issuesOf(row: JsonObject, code: string): { word: number | null; text: string; t: JsonValue | undefined; raw: JsonObject }[] {
  return (Array.isArray(row['issues']) ? row['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['code'] === code && i['severity'] === 'error')
    .map((i) => ({ word: Number.isSafeInteger(field(i, 'word')) ? (field(i, 'word') as number) : null, text: String(field(i, 'text') ?? ''), t: field(i, 't'), raw: i }));
}

/** A cut film before it is heard: its expansion's row, and its first verdict's cut.heard row, BLOCKED with one unrun entry. */
export interface Unheard { what: string; planted: string | undefined; document: JsonObject; shown: JsonObject; cut: CutRow; first: JsonObject; entry: HeardEntry }
export function unheard(bin: string, evidence: string, document: JsonObject, what: string, planted?: string): Unheard {
  const [shown, v0] = filmRun(bin, evidence, document, [verdictCall], `${what}, before any transcript`, planted ? { planted } : {});
  presented(shown, what);
  const cut = cutRow(shown!, what);
  const first = heardRow(v0!, `${what}, before any transcript`);
  expect(first['result'], `${what}: with no transcript of the cut result attached, ${CLAIM}#${HEARD} is BLOCKED: ${show(first, 2000)}`).toBe('BLOCKED');
  const found = heardEntries(first, what);
  expect(found.length, `${what}: one cut.heard_unrun entry, for the item ${ITEM}: ${show(found.map((e) => e.raw), 1500)}`).toBe(1);
  return { what, planted, document, shown: shown!, cut, first, entry: found[0]! };
}
/** The film heard back: its unrun entry's PCM run through the transcriber, the record attached, and the verdict again
 * (under the same planted program). */
export interface Heard extends Unheard { record: string; transcript: Line; verdict: JsonObject; row: JsonObject }
export async function heardAgain(bin: string, w: World, u: Unheard): Promise<Heard> {
  const e = u.entry;
  const { record } = await transcribe(w, { line: ITEM, scope: 'cut result', pcm: e.pcm, sample_rate: e.sample_rate, channels: e.channels, locale: e.locale, raw: e.raw }, []);
  const transcript = readJson(w.evidence, record, `${u.what}: the transcript of the cut result`);
  const [shown, verdict] = filmRun(bin, w.evidence, withAttached(u.document, [record]), [verdictCall], u.what, u.planted ? { planted: u.planted } : {});
  presented(shown, `${u.what}, with the transcript attached`);
  return { ...u, record, transcript, verdict: verdict!, row: heardRow(verdict!, u.what) };
}

/** `media_mix` of a document holding only `strips`, from 0 to the last strip's end: the hash of its interleaved f32 PCM. */
export function mixedPcm(bin: string, evidence: string, strips: readonly Strip[], what: string): { sha: string; frames: number; channels: number } {
  const end = Math.max(...strips.map((s) => s.start + (s.out - s.in)));
  const doc = { transport: { sample_rate: RATE, span: end }, strips: Object.fromEntries(strips.map((s) => [s.id, s.raw])) };
  const [reply] = runShow(bin, scenario(evidence, [{ call: 'media_mix', doc, segments: [{ from: 0, to: end }] }]), what);
  const seg = ((reply?.['mix'] as JsonObject | undefined)?.['segments'] as JsonValue[] | undefined)?.[0];
  expect(isObject(seg) && typeof seg['sha256'] === 'string', `${what}: media_mix answers the segment's PCM hash: ${show(reply, 1500)}`).toBe(true);
  const s = seg as JsonObject;
  return { sha: s['sha256'] as string, frames: Number(s['frames']), channels: Number(s['channels']) };
}

// ---------------------------------------------------------------------------------------------------
// The video recording staged (criteria 3, 5 and 6): its MP4 put in the store; the PCM the host decodes from it named
// by the `cut.words_unbaked` refusal the design gives for a recording with no words record (`{job, analyzer,
// pcm_sha256, sample_rate, channels}`, read from any reply of a run that presents it and asks for a verdict); and the
// words record of the tones' true times written for that PCM.

export interface StagedVideo { sha: string; pcmSha: string; record: string; unbaked: JsonObject }
const pcmOfVideo = new Map<string, JsonObject>();
export function stageVideo(bin: string, evidence: string, late = 0): StagedVideo {
  const sha = putEvidence(evidence, videoRecording(late));
  let unbaked = pcmOfVideo.get(sha);
  if (!unbaked) {
    const replies = filmRun(bin, evidence, videoFilm(sha, [], VIDEO_KEEP), [verdictCall], 'the video recording with no words record');
    const found = coded(replies, 'cut.words_unbaked');
    expect(found.length, `the video recording with no words record: the ${KIND} item is refused with cut.words_unbaked, naming the job to run first and the PCM by its hash (design): ${show(replies, 2500)}`).toBeGreaterThan(0);
    unbaked = found[0]!;
    pcmOfVideo.set(sha, unbaked);
  }
  const pcmSha = field(unbaked, 'pcm_sha256');
  expect(typeof pcmSha === 'string' && /^[0-9a-f]{64}$/.test(pcmSha), `cut.words_unbaked names the recording's PCM by its SHA-256: ${show(unbaked)}`).toBe(true);
  expect([field(unbaked, 'sample_rate'), field(unbaked, 'channels')], `cut.words_unbaked gives the PCM's rate and channels, the recording's 48 kHz mono: ${show(unbaked)}`).toEqual([RATE, 1]);
  return { sha, pcmSha: pcmSha as string, record: putEvidence(evidence, wordsRecord(pcmSha as string, videoSound().words)), unbaked };
}

// ---------------------------------------------------------------------------------------------------
// An export read back (criteria 3 and 5): the film exported (H.264, the default PCM sound) and the delivered file
// decoded by `media_decode` (#498's decode worker) into its frames (BGRA) and its sound. A frame's number is read from its
// ten columns: a bit is set where the top half is brighter than the bottom by more than 80 of 255, clear where darker
// by as much; a frame with any column between those reads as no number (no picture of the recording shown).

export interface Played { rate: number; sound: Float32Array; start: number; frames: { t: number; code: number | null }[] }
export function readExport(bin: string, evidence: string, document: JsonObject, dir: string, what: string): { replies: JsonObject[]; played: Played } {
  const out = join(dir, 'cut.mp4');
  const decoded = join(dir, 'decoded');
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, document), { call: 'export', doc: DOC.a, out, video: { codec: 'h264' } }, { call: 'media_decode', path: out, out: decoded, format: 'bgra' }]), what);
  presented(replies[0], what);
  expect(replies[1]?.['outcome'], `${what}: the film is exported: ${show(replies[1], 2000)}`).toBe('exported');
  const streams = ((replies[2]?.['decoded'] as JsonObject | undefined)?.['streams'] as JsonValue[] | undefined) ?? [];
  const audio = streams.filter((s): s is JsonObject => isObject(s) && s['type'] === 'audio');
  const video = streams.filter((s): s is JsonObject => isObject(s) && s['type'] === 'video');
  expect([audio.length, video.length], `${what}: the delivered file decodes to one sound track and one picture track: ${show(replies[2], 2000)}`).toEqual([1, 1]);
  const a = audio[0]!;
  const nch = Number(a['channels']);
  const bytes = readFileSync(join(decoded, String(a['file'])));
  const frames = Math.floor(bytes.length / (4 * nch));
  const sound = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < nch; c++) s += bytes.readFloatLE(4 * (i * nch + c)); sound[i] = s / nch; }
  const first = Array.isArray(a['first']) ? (a['first'] as number[]) : [0, 1];
  const v = video[0]!;
  const [w, h] = (v['size'] as number[] | undefined) ?? [0, 0];
  const pictures = ((v['frames'] as JsonValue[] | undefined) ?? []).filter(isObject).map((f) => {
    const pts = f['pts'] as number[];
    return { t: pts[0]! / pts[1]!, code: frameCode(readFileSync(join(decoded, String(f['file']))), w!, h!) };
  }).sort((p, q) => p.t - q.t);
  return { replies, played: { rate: Number(a['sample_rate']), sound, start: first[0]! / first[1]!, frames: pictures } };
}
function frameCode(bgra: Buffer, w: number, h: number): number | null {
  if (w !== VIDEO.size[0] || h !== VIDEO.size[1] || bgra.length < w * h * 4) return null;
  const mean = (x0: number, x1: number, y0: number, y1: number): number => {
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += bgra[(y * w + x) * 4 + 1]!;
    return s / ((x1 - x0) * (y1 - y0));
  };
  let code = 0;
  for (let i = 0; i < VIDEO.columns; i++) {
    const d = mean(16 * i + 3, 16 * i + 13, 8, 37) - mean(16 * i + 3, 16 * i + 13, 53, 82);
    if (Math.abs(d) <= 80) return null;
    if (d > 0) code |= 1 << i;
  }
  return code;
}
/** The tone words the export plays, in order: each onset (the first sample at or above 0.01 after 50 ms below it, where the
 * level passes 0.05 within 5 ms), its end (where 20 ms below 0.01 begin), and which of the video's tones it is by its
 * frequency, counted from its sign changes over the 50 ms from 5 ms after its onset. */
export interface Onset { word: number; hz: number; at: number; end: number }
export function onsetsOf(p: Played): Onset[] {
  const x = p.sound;
  const out: Onset[] = [];
  let quiet = ms(50);
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]!) < 0.01) { quiet++; continue; }
    const after = quiet >= ms(50);
    quiet = 0;
    if (!after) continue;
    let peak = 0;
    for (let j = i; j < Math.min(x.length, i + ms(5)); j++) peak = Math.max(peak, Math.abs(x[j]!));
    if (peak <= 0.05) continue;
    let changes = 0;
    const from = i + ms(5);
    for (let j = from + 1; j < Math.min(x.length, from + ms(50)); j++) if (x[j] !== 0 && Math.sign(x[j]!) !== Math.sign(x[j - 1]!)) changes++;
    const hz = changes / 2 / 0.05;
    let end = x.length;
    for (let j = i, still = 0; j < x.length; j++) {
      if (Math.abs(x[j]!) >= 0.01) still = 0;
      else if (++still >= ms(20)) { end = j - still + 1; break; }
    }
    const word = VIDEO_TONES.reduce((best, t, k) => (Math.abs(t.hz - hz) < Math.abs(VIDEO_TONES[best]!.hz - hz) ? k : best), 0);
    out.push({ word, hz, at: p.start + i / p.rate, end: p.start + end / p.rate });
    i = end - 1;
  }
  return out;
}
/** The number of the frame shown at `t` seconds: the last frame whose time is at or before it. */
export function codeAt(p: Played, t: number): number | null {
  let found: number | null = null;
  for (const f of p.frames) { if (f.t <= t + 1e-9) found = f.code; else break; }
  return found;
}
/** How far a source time `at` (in frames) lies outside the span [c, c + 1) of frame c, in frames; 0 inside it. */
export const framesFrom = (at: number, c: number): number => (at < c ? c - at : at > c + 1 ? at - c - 1 : 0);
/**
 * In step within one frame, read from the export's own sound and picture: at each tone's onset in the sound, the frame
 * shown then holds the number of a source frame whose span lies within one frame of the tone's start in the source (a
 * tenth of a frame given for reading the onset). Each failure names the tone and the splice it follows.
 */
export function stepFailures(p: Played, onsets: readonly Onset[], spliceBefore: (word: number) => number): string[] {
  const out: string[] = [];
  for (const o of onsets) {
    const t = VIDEO_TONES[o.word]!;
    const where = `tone ${o.word} (${t.hz} Hz, the ${spliceBefore(o.word) ? `run after splice ${spliceBefore(o.word)}` : 'first run'}), heard from ${o.at.toFixed(4)} s`;
    const c = codeAt(p, o.at);
    const at = (t.start / RATE) * VIDEO.fps;
    if (c === null) out.push(`${where}: the frame shown then holds no picture of the recording`);
    else if (framesFrom(at, c) > 1.1) out.push(`${where}: the picture shows source frame ${c} while the sound is at source frame ${at.toFixed(2)}, ${framesFrom(at, c).toFixed(2)} frames apart, more than one`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The hub world: #509's (a real hub in a temp home, deep mcp for deep_job, the model host its helpers start), with this
// suite's own hub and deep mcp so that the world lives under /tmp/dh1518-*. Its shape is #509's World, so #509's
// withPlugin, stopHost, runJob, asks and transcribe read it as their own.

const sleep = (n: number) => new Promise<void>((resolve) => setTimeout(resolve, n));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
const made: string[] = [];
const owned = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 30_000);
const track = (child: ChildProcess): void => {
  const pid = child.pid;
  if (!pid) return;
  owned.add(pid);
  child.once('exit', () => owned.delete(pid));
};
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
async function startHub(home: string, env: Record<string, string>): Promise<{ pid: number; socket: string; root: string }> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  track(child);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  expect(ready?.['ready'], `the hub starts: ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!['socket'] === 'string' ? ready!['socket'] : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 1_800_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.['id'] === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
/** A world under /tmp/dh1518-*: a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you) and a deep mcp in a project
 * folder. deep-show run's `evidence` is the hub's store, so a PCM a verdict keeps is what deep_job takes by hash. */
export async function openWorld(): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the hub runs ${CLI.slice(REPO.length)}, which isn't built; run npm run build --workspaces (README: Run them)`);
  const tmp = realpathSync(mkdtempSync('/tmp/dh1518-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  const evidence = join(home, '.deepbuild', 'evidence');
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  mkdirSync(project);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm') });
  const child = spawn(NODE, [CLI, 'mcp'], { cwd: project, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  track(child);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1518', version: '0' } });
  if (!init['result']) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return { tmp, home, hub, mcp, project, evidence, hosts: new Map() } as unknown as World;
}
/** A record's file in the store still hashes to its name. */
export function storedIntact(evidence: string, sha: string): boolean {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) && statSync(path).isFile() && sha256(readFileSync(path)) === sha;
}
/** The transcript record's text, which media_heard compares. */
export const transcriptText = (t: Line, what: string): string => {
  expect(typeof t['text'], `${what}: the ${TRANSCRIPT} record of ${TRANSCRIBER} holds its text`).toBe('string');
  return t['text'] as string;
};

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-1518-proof/.

const PROOF_DIR = join(tmpdir(), 'deep-1518-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
