// Test-side tools for the #509 acceptance tests: lines spoken word by word by macOS `say` and laid at known samples
// (their words and activity records written from those samples, as #502's suite writes them); the planted cut of a
// line; film documents with a script; `deep-show run` scenarios in which you present the film and a claim of the
// agent's gets a `verdict`; the verdict's rows and the entries, issues and asks they hold; a world of a real hub with
// first-party job plug-ins installed from packages/jobs and their model hosts started with the design's run lines;
// `deep mcp` spoken to as an agent's MCP client for deep_job; the hub's socket as the cli role for the record and your
// yes; and the test plug-in that adds a speech tool. Nothing here stands in for a transcriber, a normalizer, a speech
// engine, a mixer or a check: every reading is what deep-show or the hub answers, and every expected value comes from
// the issue, the design or where these tools put each sample (README: Fixtures).
//
// Safety: hub worlds live under /tmp/dh509-* and are removed after their file; the hub, `deep` commands and `deep mcp`
// run with HOME in the world's folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; a model host runs
// with your HOME (its builds and weights are cached there) and without DEEP_*. Every process is one this file started,
// stopped by its PID (a model host by the process group it leads); nothing is stopped by name or port. No paid or
// remote model is called; the paid speech tool is a local program that only declares a cost.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { pcmBytes, wavF32 } from '../1819/fixtures/synth.ts';
import { DOC, FLICKS, REPO, isObject, present, putEvidence, runShow, scenario, sha256, show, type JsonObject, type JsonValue } from '../501/helpers.ts';

export {
  DOC, FLICKS, FULL, REPO, TIMEOUT, arr, blocked, inconclusive, int, num, obj, putEvidence, receiptOf, referenceMacProblem, runShow, scenario, sha256, show,
  useShow, useTemp, type JsonObject, type JsonValue,
} from '../501/helpers.ts';
export { pcmBytes } from '../1819/fixtures/synth.ts';
export { floatWav } from '../502/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: '#509.d30b5b10', 2: '#509.9f77940a', 3: '#509.18ee17cc', 4: '#509.ea6d2be6', 5: '#509.b4d021e2', 6: '#509.637f3d04', 7: '#509.8b57734f',
  8: '#509.b2cb3b6a', 9: '#509.72d0ae67', 10: '#509.39975b5a', 11: '#509.659d2ba6', 12: '#509.75b040de', 13: '#509.a5c9def9',
} as const;

/** A precondition that isn't the criterion (a voice, a host, a fixture's own truth): failing it is BLOCKED, never a pass. */
export function blockedUnless(ok: boolean, why: string): void {
  expect(ok, `BLOCKED: ${why}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time. Every take is at 48 kHz: 14,700 flicks a sample.

export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
/** A sample count as flicks. */
export const flicksOf = (samples: number): number => samples * SAMPLE;
/** Seconds as the time grammar writes them: `<n>s` (callers pass whole milliseconds or round samples). */
export const lit = (seconds: number): string => `${Number(seconds.toFixed(6))}s`;

// ---------------------------------------------------------------------------------------------------
// Speech made at test time: each word spoken alone by `say -v Samantha -r 220`, cut to the samples between its first and
// last above −50 dBFS, at 48 kHz. A take lays a line's words from sample 0 with 50 ms of silence between them, so each
// word's start and end are known to the sample whatever the voice sounds like on this macOS.

const VOICE = 'Samantha';
const WPM = 220;
export const GAP = Math.round(0.05 * RATE);
const WORD_FLOOR = 10 ** (-50 / 20);

/** `text` spoken by `say` as one channel of f32 at 48 kHz; BLOCKED when the voice can't speak. */
function sayRaw(text: string, voice = VOICE, wpm: number | null = WPM, rate = RATE): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), 'deep-509-say-'));
  try {
    const out = join(dir, 'say.wav');
    try {
      execFileSync('say', ['-v', voice, ...(wpm ? ['-r', String(wpm)] : []), '-o', out, '--file-format=WAVE', `--data-format=LEF32@${rate}`, text], { stdio: 'pipe', timeout: 120_000 });
    } catch (e) {
      throw Error(`BLOCKED: macOS say -v ${voice} could not write ${JSON.stringify(text)} (${(e as Error).message.slice(0, 200)}); install the ${voice} voice in System Settings, Spoken Content`);
    }
    const b = readFileSync(out);
    for (let at = 12; at + 8 <= b.length;) {
      const id = b.toString('ascii', at, at + 4);
      const size = b.readUInt32LE(at + 4);
      if (id === 'data') {
        const x = new Float32Array(Math.floor(Math.min(size, b.length - at - 8) / 4));
        for (let i = 0; i < x.length; i++) x[i] = b.readFloatLE(at + 8 + 4 * i);
        return x;
      }
      at += 8 + size + (size % 2);
    }
    throw Error(`BLOCKED: macOS say -v ${voice} wrote no samples for ${JSON.stringify(text)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const clips = new Map<string, Float32Array>();
/** One word spoken alone, cut at −50 dBFS. */
function wordClip(word: string, voice = VOICE): Float32Array {
  const key = `${voice}\u0000${word}`;
  let c = clips.get(key);
  if (!c) {
    const x = sayRaw(word, voice);
    let a = 0;
    while (a < x.length && Math.abs(x[a]!) <= WORD_FLOOR) a++;
    let b = x.length;
    while (b > a && Math.abs(x[b - 1]!) <= WORD_FLOOR) b--;
    if (b <= a) throw Error(`BLOCKED: macOS say -v ${voice} spoke nothing for ${JSON.stringify(word)}`);
    c = x.slice(a, b);
    clips.set(key, c);
  }
  return c;
}

/** A word of a take: the text's word, and the samples it sounds in, [start, end). */
export interface Word { text: string; start: number; end: number }
/**
 * A line's take: its text, its samples, each text word's span, and each word's region (its span, or the silence-padded
 * slot it sits in), all in samples from the take's start.
 */
export interface Take { text: string; samples: Float32Array; words: Word[]; regions: [number, number][] }
export interface TakeOptions {
  /** What is spoken for each of the text's words (default: the word itself); a group of several words is spoken word by word. */
  groups?: string[];
  /** One word laid in a slot of this many samples, the word centred in silence (the cut twin's slot). */
  slot?: { word: number; samples: number };
  /** Silence before the first word, in samples. */
  lead?: number;
  gain?: number;
}
/** The take of `text`: each word (or its group) spoken alone, laid from `lead` with GAP between words. */
export function take(text: string, o: TakeOptions = {}): Take {
  const texts = text.trim().split(/\s+/);
  const groups = o.groups ?? texts;
  if (groups.length !== texts.length) throw Error(`take: ${groups.length} spoken groups for the ${texts.length} words of ${JSON.stringify(text)}`);
  const gain = o.gain ?? 0.5;
  const parts: { at: number; x: Float32Array }[] = [];
  const words: Word[] = [];
  const regions: [number, number][] = [];
  let at = o.lead ?? 0;
  groups.forEach((g, k) => {
    const said = g.split(/\s+/).map((w) => wordClip(w));
    const len = said.reduce((n, c) => n + c.length, 0) + GAP * (said.length - 1);
    if (o.slot && o.slot.word === k) {
      if (len > o.slot.samples) throw Error(`BLOCKED: say speaks ${JSON.stringify(g)} in ${len} samples, more than its ${o.slot.samples}-sample slot`);
      const pad = Math.floor((o.slot.samples - len) / 2);
      regions.push([at, at + o.slot.samples]);
      at += pad;
    } else regions.push([at, at + len]);
    const start = at;
    said.forEach((c, i) => { parts.push({ at, x: c }); at += c.length + (i < said.length - 1 ? GAP : 0); });
    words.push({ text: texts[k]!, start, end: at });
    if (o.slot && o.slot.word === k) at = regions[k]![1];
    at += GAP;
  });
  const samples = new Float32Array(at - GAP);
  for (const p of parts) for (let i = 0; i < p.x.length; i++) samples[p.at + i] = gain * p.x[i]!;
  return { text, samples, words, regions };
}
/** The take with silence before it so that its last word ends exactly at sample `end`. */
export function endingAt(t: Take, end: number): Take {
  const last = t.words[t.words.length - 1]!.end;
  if (last > end) throw Error(`BLOCKED: the take of ${JSON.stringify(t.text)} ends at sample ${last}, after ${end}`);
  const shift = end - last;
  const samples = new Float32Array(t.samples.length + shift);
  samples.set(t.samples, shift);
  return { text: t.text, samples, words: t.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })), regions: t.regions.map(([a, b]) => [a + shift, b + shift]) };
}
/**
 * The planted cut: word k's region removed from the take, every later sample moved up. Its words record keeps the text's
 * words in place (README: The cut twin): word k is given 10 ms of the silence where the cut was.
 */
export function cutRegion(t: Take, k: number): Take {
  const [a, b] = t.regions[k]!;
  const n = b - a;
  const samples = new Float32Array(t.samples.length - n);
  samples.set(t.samples.subarray(0, a));
  samples.set(t.samples.subarray(b), a);
  const mid = a + Math.floor(GAP / 2);
  const move = (s: number): number => (s >= b ? s - n : s);
  return {
    text: t.text, samples,
    words: t.words.map((w, i) => (i === k ? { text: w.text, start: mid - 240, end: mid + 240 } : { text: w.text, start: move(w.start), end: move(w.end) })),
    regions: t.regions.map(([x, y], i) => (i === k ? [a, a] : [move(x), move(y)])),
  };
}
/** The take with word k's sound and the gap after it removed (the copy with one word cut; its words come from the aligner). */
export function cutWord(t: Take, k: number): Float32Array {
  const [a, b] = t.regions[k]!;
  const end = Math.min(t.samples.length, b + GAP);
  const samples = new Float32Array(t.samples.length - (end - a));
  samples.set(t.samples.subarray(0, a));
  samples.set(t.samples.subarray(end), a);
  return samples;
}
/** A steady 1 kHz tone of `seconds` at peak `amp` with 5 ms ramps: a synthesized take whose loudness is known. */
export function tone(seconds: number, amp: number, hz = 1000): Float32Array {
  const n = Math.round(seconds * RATE);
  const ramp = Math.round(0.005 * RATE);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.min(1, i / ramp, (n - 1 - i) / ramp) * Math.sin((2 * Math.PI * hz * i) / RATE);
  return x;
}
/** A tone take for a text whose sound no test hears: its words laid evenly over the tone (a compile-only fixture). */
export function toneTake(text: string, seconds: number): Take {
  const texts = text.trim().split(/\s+/);
  const samples = tone(seconds, 0.1, 440);
  const each = Math.floor(samples.length / texts.length);
  const words = texts.map((w, k) => ({ text: w, start: k * each, end: (k + 1) * each - (k === texts.length - 1 ? 0 : GAP) }));
  return { text, samples, words, regions: words.map((w) => [w.start, w.end]) };
}

// ---------------------------------------------------------------------------------------------------
// The records a film's audio asset lists in `attached` and the test may supply (Analysis bake, #502's shapes): the
// words record and the activity record, written from the take's own samples. Criterion 8 alone reads the aligner's.

export const ALIGNER = 'charsiu-aligner@1.0.0';
const VAD = 'silero-vad@6.2.3';
const plainWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}_'-]/gu, '');
/** A take's words record: kind, analyzer, weights, the PCM's hash, the 10 ms frame and each word in flicks. */
export function wordsRecord(t: Take, pcmSha: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    kind: 'bake.words', analyzer: ALIGNER, weights: [], pcm_sha256: pcmSha, frame: FLICKS / 100,
    words: t.words.map((w) => ({ text: plainWord(w.text), start: flicksOf(w.start), end: flicksOf(w.end), phonemes: [] })),
  }));
}
/** An activity record over `frames` samples: each 10 ms frame's speech probability 1 inside `spans` (samples) and 0 outside, read both ways. */
export function activityRecord(pcmSha: string, length: number, spans: [number, number][]): Uint8Array {
  const frame = RATE / 100;
  const p = Array.from({ length: Math.ceil(length / frame) }, (_, i) => (spans.some(([a, b]) => i * frame >= a && (i + 1) * frame <= b) ? 1 : 0));
  return new TextEncoder().encode(JSON.stringify({ kind: 'bake.activity', analyzer: VAD, weights: [], pcm_sha256: pcmSha, frame: FLICKS / 100, speech: p, speech_reversed: p }));
}

/** A take staged in an evidence store: its WAV, its PCM's hash, and the records its asset lists in `attached`. */
export interface Staged { take: Take; wav: Uint8Array; sha: string; pcm: Uint8Array; pcmSha: string; words: string; attached: string[] }
export interface StageOptions {
  /** The take's sound as stereo (both channels alike), so a bus carries it as it carries a stereo bed. */
  stereo?: boolean;
  /** A words record other than the take's own (the aligner's), by hash; or none at all. */
  words?: string | null;
  /** An activity record of the take's word spans (or of `spans`). */
  activity?: boolean | [number, number][];
  samples?: Float32Array;
}
/** Each channel's samples interleaved as f32 little-endian: the bytes a PCM's hash is of. */
export function interleaved(channels: Float32Array[]): Uint8Array {
  const frames = channels[0]!.length;
  const b = Buffer.alloc(frames * channels.length * 4);
  let o = 0;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return new Uint8Array(b);
}
/** Interleaved 32-bit float WAV of the channels at 48 kHz. */
export function wavOf(channels: Float32Array[]): Uint8Array {
  if (channels.length === 1) return wavF32(channels[0]!, RATE);
  const data = interleaved(channels);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(channels.length, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * channels.length * 4, 28); h.writeUInt16LE(channels.length * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([h, data]));
}
export function stage(evidence: string, t: Take, o: StageOptions = {}): Staged {
  const x = o.samples ?? t.samples;
  const channels = o.stereo ? [x, Float32Array.from(x)] : [x];
  const wav = wavOf(channels);
  const pcm = o.stereo ? interleaved(channels) : pcmBytes(x);
  const pcmSha = sha256(pcm);
  const sha = putEvidence(evidence, wav);
  const attached: string[] = [];
  const words = o.words === undefined ? putEvidence(evidence, wordsRecord(t, pcmSha)) : o.words;
  if (words) attached.push(words);
  if (o.activity) attached.push(putEvidence(evidence, activityRecord(pcmSha, x.length, Array.isArray(o.activity) ? o.activity : t.words.map((w) => [w.start, w.end]))));
  return { take: t, wav, sha, pcm, pcmSha, words: words ?? '', attached };
}

// ---------------------------------------------------------------------------------------------------
// Film documents (#502's shapes): 64 × 64 at 24 fps, 48 kHz, a block sliding so every frame differs, the script's lines
// each with its own recording, captions by netflix-en-adult.

export const FRAME = FLICKS / 24;
export const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Spoken by macOS say for the #509 acceptance tests.' };
export const NARRATOR: JsonObject = { name: 'The test voice', license: CC0, synthetic: false };
/** An asset entry for a staged take. */
export const assetOf = (s: Staged, license: JsonObject = CC0): JsonObject => ({ sha256: s.sha, license, attached: s.attached });
/** A line with its own recording, at `t` seconds (left out with `after`), and its other fields. */
export function recorded(asset: string, text: string, t: number | null, fields: JsonObject = {}): JsonObject {
  return { ...(t === null ? {} : { t: lit(t) }), text, recording: { asset }, ...fields };
}
export interface FilmSpec {
  span: number; lines: Record<string, JsonObject>; assets: Record<string, JsonObject>;
  strips?: JsonObject; buses?: JsonObject; processors?: JsonObject; markers?: JsonObject; clips?: JsonObject; placements?: JsonObject;
  items?: JsonObject[]; narrator?: JsonObject; locale?: string;
}
export function film(s: FilmSpec): JsonObject {
  const rect = (id: string, box: number[], role: string, order: string, extra: JsonObject = {}): JsonObject => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra });
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [32, 32, 0], view_width: 64 } },
    rect('back', [0, 0, 64, 64], 'ground', 'a1'), rect('mover', [0, 24, 16, 16], 'accent', 'a2'), ...(s.items ?? []),
  ];
  return {
    format: 1, id: 'film', profile: 'film', title: 'A narrated film', description: 'A film whose script the #509 acceptance tests hear back.',
    size: [64, 64], locale: s.locale ?? 'en', camera: 'cam', transport: { span: lit(s.span), frame_rate: [24, 1], sample_rate: RATE },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    channels: { slide: { target: 'items/mover/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: lit(s.span), value: 48, interp: 'linear' } } } },
    assets: s.assets,
    ...(s.strips ? { strips: s.strips } : {}), ...(s.buses ? { buses: s.buses } : {}), ...(s.processors ? { processors: s.processors } : {}),
    ...(s.markers ? { markers: s.markers } : {}), ...(s.clips ? { clips: s.clips } : {}), ...(s.placements ? { placements: s.placements } : {}),
    script: { narrator: s.narrator ?? NARRATOR, lines: s.lines, captions: { profile: 'netflix-en-adult' } },
  };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The document with line `id`'s fields replaced. */
export function withLine(doc: JsonObject, id: string, fields: JsonObject): JsonObject {
  const d = clone(doc);
  const lines = (d['script'] as JsonObject)['lines'] as JsonObject;
  lines[id] = { ...(lines[id] as JsonObject), ...fields };
  return d;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: you present the film (`deep show` from your shell) and the agent's claim, whose one deliverable is the
// film, gets a verdict (#403's claims, #407's verdict rows).

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: narration', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
export const CLAIM = 'claim:01JB509C000000000000000001';
export const verdictCall: JsonObject = { call: 'verdict', claim: CLAIM };
export const timeCall = (text: string): JsonObject => ({ call: 'time', doc: DOC.a, text });
export interface RunOptions { state?: string; planted?: string }
/** One scenario: the film presented by you, then `calls`; every reply, the presentation's first. */
export function filmRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, o: RunOptions = {}): JsonObject[] {
  const sc = scenario(evidence, [present(DOC.a, document), ...calls], {
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } }, processes: PROCESSES,
    claims: { [CLAIM]: { session: ALPHA.id, deliverables: [DOC.a], requirements: [] } },
    ...(o.state ? { state: o.state } : {}), ...(o.planted ? { planted: o.planted } : {}),
  });
  return runShow(bin, sc, o.planted ? `${what} (planted ${o.planted})` : what);
}
/** A run whose film must be presented: the replies to `calls`. */
export function presentedRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, o: RunOptions = {}): JsonObject[] {
  const replies = filmRun(bin, evidence, document, calls, what, o);
  blockedUnless(replies[0]!['outcome'] === 'presented', `${what}: the film is presented by your deep show: ${show(replies[0], 1500)}`);
  return replies.slice(1);
}

/** Every object anywhere in a value whose `code` is `code`. */
export function coded(v: JsonValue | undefined, code: string): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (x: JsonValue | undefined): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObject(x)) { if (x['code'] === code) out.push(x); Object.values(x).forEach(walk); }
  };
  walk(v);
  return out;
}
/** A field of an issue or entry: on it, else in its `actual`. */
export function fieldOf(o: JsonObject, name: string): JsonValue | undefined {
  if (name in o) return o[name];
  return isObject(o['actual']) ? o['actual'][name] : undefined;
}
/** Every string in a value, deep, lower-cased. */
export const words = (v: JsonValue | undefined): string => JSON.stringify(v ?? null).toLowerCase();
/** The rows a verdict holds from the default `from` (README: The rows). */
function rowsFrom(verdict: JsonObject, from: string): JsonObject[] {
  const rows = Array.isArray(verdict['requirements']) ? verdict['requirements'] : [];
  return rows.filter((r): r is JsonObject => isObject(r) && isObject(r['from']) && r['from']['default'] === from);
}
/** The one row the default `from` adds, or a failure naming how many there were. */
export function rowFrom(verdict: JsonObject, from: string, what: string): JsonObject {
  const rows = rowsFrom(verdict, from);
  expect(rows.length, `${what}: the verdict holds one row with from: {default: ${JSON.stringify(from)}}, the row ${CLAIM}#${from.replace(/@\d+$/, '')}; it holds ${rows.length}: ${show(verdict['requirements'] ?? null, 2500)}`).toBe(1);
  return rows[0]!;
}
/** A row's error issues of `code`. */
export const errors = (row: JsonObject, code: string): JsonObject[] =>
  (Array.isArray(row['issues']) ? row['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['code'] === code && i['severity'] === 'error');
/** The exception asks a verdict lists, on its rows and on itself, by ID. */
export function exceptionAsks(verdict: JsonObject): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>();
  const lists = [verdict['asks'], ...(Array.isArray(verdict['requirements']) ? verdict['requirements'] : []).map((r) => (isObject(r) ? r['asks'] : undefined))];
  for (const l of lists) for (const a of Array.isArray(l) ? l : []) if (isObject(a) && a['kind'] === 'exception' && typeof a['id'] === 'string') out.set(a['id'], a);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// media_heard: the pure comparison (Check input: narration.transcript@1).

const heardCall = (expected: string, heard: string, locale?: string, names?: string[]): JsonObject =>
  ({ call: 'media_heard', expected, heard, ...(locale ? { locale } : {}), ...(names ? { names } : {}) });
export interface Heard { expected: string[]; heard: string[]; match: boolean; missing: string[]; extra: string[]; wrong: [string, string][]; raw: JsonObject }
const strings = (v: JsonValue | undefined, what: string): string[] => {
  expect(Array.isArray(v) && v.every((s) => typeof s === 'string'), `${what} is a list of tokens, got ${show(v ?? null)}`).toBe(true);
  return v as string[];
};
function heardOf(reply: JsonObject, what: string): Heard {
  expect(typeof reply['match'], `${what}: media_heard answers match, a boolean: ${show(reply)}`).toBe('boolean');
  const wrong = reply['wrong'];
  expect(Array.isArray(wrong) && wrong.every((p) => Array.isArray(p) && p.length === 2), `${what}: wrong is a list of [expected, heard] pairs: ${show(wrong ?? null)}`).toBe(true);
  return {
    expected: strings(reply['expected'], `${what}: expected`), heard: strings(reply['heard'], `${what}: heard`), match: reply['match'] === true,
    missing: strings(reply['missing'], `${what}: missing`), extra: strings(reply['extra'], `${what}: extra`),
    wrong: (wrong as JsonValue[]).map((p) => (p as JsonValue[]).map((s) => String(s)) as [string, string]), raw: reply,
  };
}
/** media_heard on each pair, in one deep-show run. */
export function hear(bin: string, evidence: string, pairs: { expected: string; heard: string; locale?: string; names?: string[] }[], what: string): Heard[] {
  const replies = runShow(bin, scenario(evidence, pairs.map((p) => heardCall(p.expected, p.heard, p.locale, p.names))), what);
  return replies.map((r, i) => heardOf(r, `${what}: pair ${i + 1} (${JSON.stringify(pairs[i]!.expected)} heard as ${JSON.stringify(pairs[i]!.heard)})`));
}

// ---------------------------------------------------------------------------------------------------
// The hub world (#1819's harness): a real hub in a temp home whose evidence store already holds your files, `deep mcp`
// for deep_job, the hub's socket as the cli role, and first-party job plug-ins with their model hosts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;

/** A first-party job plug-in and its model host's run line (the port its manifest names). */
export interface Plugin { id: string; dir: string; script: string; port: number }
export const SPEECH: Plugin = { id: 'deepbuild/speech', dir: join(REPO, 'packages/jobs/speech'), script: 'packages/jobs/speech/host/host.py', port: 8720 };
export const BAKES: Plugin = { id: 'deepbuild/bakes', dir: join(REPO, 'packages/jobs/bakes'), script: 'packages/jobs/bakes/host/host.py', port: 8719 };
export const TRANSCRIBER = 'whisper-cpp@1.9.5';
export const TRANSCRIPT = 'narration.transcript';
export const KOKORO = 'kokoro@0.9.4';
export const PLATFORM = 'platform-say@1.0.0';
export const AZURE = 'azure-speech@1.0.0';
/** The speech kind's fixture line, which a new tool speaks through deep_job to show it joins. */
export const FIXTURE_LINE = 'The quick brown fox jumps over the lazy dog.';

const made: string[] = [];
const owned = new Set<number>();
const groups = new Set<number>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of groups) try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
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
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    track(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 1_800_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

interface Hub { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
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
  const plant = env['DEEP_HUB_PLANT'];
  expect(ready?.['ready'], `the hub starts${plant ? ` with DEEP_HUB_PLANT=${plant}, a planted program this suite names (README: Planted programs)` : ''}: ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!['socket'] === 'string' ? ready!['socket'] : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check. */
async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line['id'] === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** The hub's record after log position `after`, through events.read on the cli role. */
export async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const reply = await control(w, 'events.read', { after: from, limit: 1000 });
    if (reply['error']) throw Error(`BLOCKED: events.read was refused: ${JSON.stringify(reply['error'])}`);
    const page = reply['result'].events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!['log_pos'];
  }
}
export async function lastPos(w: World): Promise<number> {
  const all = await events(w);
  return all.length ? Math.max(...all.map((e) => Number(e['log_pos']))) : 0;
}
export const dataOf = (e: Line): Line => (typeof e['data'] === 'string' ? parse(e['data']) ?? {} : e['data'] ?? {});
export interface Ask { handle: string; kind: string; text: string; data: Line; pos: number }
/** The asks raised in the record after `after`, oldest first. */
export async function asks(w: World, after = 0): Promise<Ask[]> {
  return (await events(w, after)).filter((e) => e['kind'] === 'ask.created').map((e) => ({ handle: `ask:${String(e['id'])}`, kind: String(dataOf(e)['kind']), text: JSON.stringify(dataOf(e)), data: dataOf(e), pos: Number(e['log_pos']) }));
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
export async function yes(w: World, ask: Ask): Promise<Ran> {
  const option = (ask.data['options'] as Line[] | undefined)?.find((o) => o['decision'] === 'allow')?.['id'];
  if (typeof option !== 'string') return { code: null, stdout: '', stderr: `${ask.handle} has no option whose decision is allow: ${JSON.stringify(ask.data['options'])}` };
  return deep(['inbox', 'answer', ask.handle, option], w.home, w.project);
}

export interface Outcome { isError: boolean; value: Line; text: string }
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
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  track(child);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-509', version: '0' } });
  if (!init['result']) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}

async function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
interface ModelHost { pid: number; child: ChildProcess; tail: () => string }
/**
 * A plug-in's model host started from the checkout with the design's run line and your HOME, waited on until it answers
 * on 127.0.0.1:<port> (its first start builds its tools and fetches its weights). A host this suite didn't start already
 * answering there, or this one exiting or not answering in 60 minutes, is BLOCKED: nothing it didn't start is stopped.
 */
async function startModelHost(p: Plugin): Promise<ModelHost> {
  if (await answers(p.port)) throw Error(`BLOCKED: something this suite didn't start already answers on 127.0.0.1:${p.port}, the port ${p.id} names for its model host (another worktree's host?); stop it yourself and run again`);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^DEEP_/.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  env['PATH'] = `/opt/homebrew/bin:${process.env['PATH'] ?? '/usr/bin:/bin'}`;
  const child = spawn('uv', ['run', '--script', p.script, '--port', String(p.port)], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) { owned.add(child.pid); groups.add(child.pid); }
  let out = '';
  const keep = (d: string) => { out = (out + d).slice(-4000); };
  child.stdout!.setEncoding('utf8').on('data', keep);
  child.stderr!.setEncoding('utf8').on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', (e) => { exited = true; keep(`${e.message} (is uv installed? brew install uv)`); });
  for (const deadline = Date.now() + 3_600_000; ;) {
    if (await answers(p.port)) break;
    if (exited) throw Error(`BLOCKED: ${p.id}'s model host (uv run --script ${p.script} --port ${p.port}) exited before it answered on 127.0.0.1:${p.port}: ${out.slice(-2000)}`);
    if (Date.now() > deadline) throw Error(`BLOCKED: ${p.id}'s model host didn't answer on 127.0.0.1:${p.port} within 60 minutes: ${out.slice(-2000)}`);
    await sleep(1000);
  }
  return { pid: child.pid!, child, tail: () => out };
}
async function stopModelHost(h: ModelHost, port: number): Promise<void> {
  const ended = new Promise<void>((resolve) => { if (h.child.exitCode !== null || h.child.signalCode !== null) resolve(); else h.child.once('exit', () => resolve()); });
  try { process.kill(-h.pid, 'SIGTERM'); } catch { /* gone */ }
  await Promise.race([ended, sleep(10_000)]);
  try { process.kill(-h.pid, 'SIGKILL'); } catch { /* gone */ }
  groups.delete(h.pid);
  for (const deadline = Date.now() + 30_000; await answers(port);) {
    if (Date.now() > deadline) throw Error(`the model host this suite started (process group ${h.pid}) still answers on 127.0.0.1:${port} after it was stopped`);
    await sleep(250);
  }
}

export interface World { tmp: string; home: string; hub: Hub; mcp: Mcp; project: string; evidence: string; hosts: Map<number, ModelHost> }
const YOURS = { name: 'yours', allows: ['export', 'report', 'post'] as const };
/**
 * A world: a temp home whose evidence store holds `files` (your recordings, PCM and texts, put there before the hub
 * starts by a writer connected as you dropping them in), a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you;
 * DEEP_HUB_PLANT a planted hub), and a deep mcp in a project folder. deep-show run's `evidence` is this store.
 */
export async function openWorld(files: Uint8Array[], plant?: string): Promise<World> {
  const tmp = realpathSync(mkdtempSync('/tmp/dh509-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(project);
  const evidence = join(home, '.deepbuild', 'evidence');
  const store = await openEvidenceStore({ root: evidence });
  const you = store.connect({ role: 'you', via: 'drop' });
  const seen = new Set<string>();
  for (const bytes of files) {
    if (seen.has(sha256(bytes))) continue;
    seen.add(sha256(bytes));
    const put = await you.put({ bytes, kind: 'file', source: 'you:drop', redaction: 'complete', license: YOURS });
    if (put.status !== 'stored' || put.evidence.sha256 !== sha256(bytes)) throw Error(`harness: the store didn't keep a fixture by its hash: ${JSON.stringify(put)}`);
  }
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  const mcp = await startMcp(home, project);
  return { tmp, home, hub, mcp, project, evidence, hosts: new Map() };
}
/** `deep install <folder>`, as you, confirmed by the stubbed OS. */
export const install = (w: World, folder: string): Promise<Ran> => deep(['install', folder], w.home, w.project);
/** A first-party plug-in's model host started and the plug-in installed from its folder, as you install any package. */
export async function withPlugin(w: World, p: Plugin): Promise<void> {
  expect(existsSync(join(p.dir, 'deepbuild.json')), `the first-party plug-in ${p.id} is at ${p.dir.slice(REPO.length)} (README: The surface): no deepbuild.json there`).toBe(true);
  const host = await startModelHost(p);
  w.hosts.set(p.port, host);
  const ran = await install(w, p.dir);
  expect(ran.code, `deep install ${p.dir.slice(REPO.length)} installs ${p.id}, its tools qualifying on its model host: ${shown(ran)}; the host said ${host.tail().slice(-1500)}`).toBe(0);
}
/** The plug-in's model host stopped: a job on its tools can't run. */
export async function stopHost(w: World, p: Plugin): Promise<void> {
  const h = w.hosts.get(p.port);
  if (h) await stopModelHost(h, p.port);
  w.hosts.delete(p.port);
}
const hostTail = (w: World, p: Plugin): string => w.hosts.get(p.port)?.tail().slice(-800) ?? '';

/** One deep_job call through deep mcp. */
export async function deepJob(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_job', arguments: args });
  if (reply['error']) return { isError: true, value: reply['error'] as Line, text: JSON.stringify(reply['error']) };
  const result = (reply['result'] ?? {}) as Line;
  const text = Array.isArray(result['content']) ? String(result['content'].find((c: Line) => c?.['type'] === 'text')?.['text'] ?? '') : '';
  const value = (result['structuredContent'] ?? parse(text) ?? {}) as Line;
  return { isError: result['isError'] === true, value, text: text || JSON.stringify(value) };
}
export interface JobRun { outcome: Outcome; replies: Outcome[]; yeses: string[]; ms: number }
/**
 * One deep_job run. A reply held on an ask that sends a file to a host gets your yes and the call is made again, at most
 * five times (#1819's reading: no criterion here reads such an ask). `ms` is the last call's wall time.
 */
export async function runJob(w: World, args: Line): Promise<JobRun> {
  const replies: Outcome[] = [];
  const yeses: string[] = [];
  for (let i = 0; ; i++) {
    const t0 = performance.now();
    const out = await deepJob(w, args);
    const ms = performance.now() - t0;
    replies.push(out);
    if (out.value['status'] !== 'held' || typeof out.value['ask'] !== 'string' || i >= 5) return { outcome: out, replies, yeses, ms };
    const ask = (await asks(w)).find((a) => a.handle === out.value['ask']);
    if (!ask) return { outcome: out, replies, yeses, ms };
    const ran = await yes(w, ask);
    yeses.push(`${ask.handle}: ${ask.text.slice(0, 300)} -> ${ran.code}`);
  }
}
export const done = (o: Outcome): boolean => !o.isError && o.value['status'] === 'done';
/** An output of a done run, by hash. */
export const outputOf = (o: Outcome, name: string): string | undefined => o.value['outputs']?.[name]?.['sha256'];
/** A JSON record from the evidence store by its hash (`<2 hex>/<62 hex>`). */
export function readJson(evidence: string, sha: string, what: string): Line {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const v = parse(readFileSync(path, 'utf8'));
  expect(v, `${what}: ${sha} is a JSON object`).toBeDefined();
  return v!;
}
/** deep_job's list: each kind with its plug-in and tools. */
export async function kinds(w: World): Promise<Line[]> {
  const o = await deepJob(w, { op: 'list' });
  expect(!o.isError && Array.isArray(o.value['kinds']), `deep_job {op: "list"} answers its kinds: ${o.text.slice(0, 1500)}`).toBe(true);
  return o.value['kinds'] as Line[];
}
export const toolsOf = (list: Line[], kind: string): Line[] => (list.find((k) => k['kind'] === kind)?.['tools'] ?? []) as Line[];

// ---------------------------------------------------------------------------------------------------
// Transcripts: the verdict BLOCKED with one narration.transcript_unrun entry per line and scope, the PCM kept by its
// hash; deep_job runs narration.transcript on whisper-cpp@1.9.5 for each; the records are listed in the line's audio
// asset's `attached`; the verdict again.

export interface Unrun { line: string; scope: string; pcm: string; sample_rate: number; channels: number; locale: string; raw: JsonObject }
export function unrunOf(row: JsonObject, what: string): Unrun[] {
  return coded(row, 'narration.transcript_unrun').map((e, i) => {
    const f = (k: string): JsonValue | undefined => fieldOf(e, k);
    const at = `${what}: narration.transcript_unrun entry ${i + 1} (${show(e, 600)})`;
    expect(typeof f('line') === 'string' && typeof f('scope') === 'string' && typeof f('pcm_sha256') === 'string', `${at} names its line, scope and pcm_sha256`).toBe(true);
    expect([f('job'), f('analyzer')], `${at} names the job kind and the analyzer`).toEqual([TRANSCRIPT, TRANSCRIBER]);
    expect(Number.isInteger(f('sample_rate')) && Number.isInteger(f('channels')) && typeof f('locale') === 'string', `${at} gives the PCM's sample_rate and channels and the locale`).toBe(true);
    return { line: f('line') as string, scope: f('scope') as string, pcm: f('pcm_sha256') as string, sample_rate: f('sample_rate') as number, channels: f('channels') as number, locale: f('locale') as string, raw: e };
  });
}
/** deep_job narration.transcript on one entry's PCM: the transcript record's hash, or the run fails, naming the scope. */
export async function transcribe(w: World, u: Unrun, names: string[]): Promise<{ record: string; run: JobRun }> {
  const run = await runJob(w, {
    op: 'run', kind: TRANSCRIPT, tool: TRANSCRIBER,
    params: JSON.stringify({ sample_rate: u.sample_rate, channels: u.channels, locale: u.locale, names }), inputs: [{ name: 'pcm', sha256: u.pcm }],
  });
  const record = outputOf(run.outcome, 'transcript');
  expect(done(run.outcome) && typeof record === 'string', `deep_job runs ${TRANSCRIPT} on ${TRANSCRIBER} for line ${u.line}'s ${u.scope} scope (PCM ${u.pcm}), its one output \`transcript\` by hash: ${run.outcome.text.slice(0, 1500)}; the model host said ${hostTail(w, SPEECH)}`).toBe(true);
  return { record: record!, run };
}
/** The document with `records` added to each line's audio asset's `attached`, by line. */
function attachTo(document: JsonObject, records: Record<string, string[]>): JsonObject {
  const d = clone(document);
  const lines = (d['script'] as JsonObject)['lines'] as JsonObject;
  for (const [line, add] of Object.entries(records)) {
    const asset = (((lines[line] as JsonObject)['recording'] ?? (lines[line] as JsonObject)['speech']) as JsonObject)['asset'] as string;
    const a = (d['assets'] as JsonObject)[asset] as JsonObject;
    a['attached'] = [...((a['attached'] as JsonValue[] | undefined) ?? []), ...add];
  }
  return d;
}
export interface Judged { document: JsonObject; first: JsonObject; verdict: JsonObject; row: JsonObject; unrun: Unrun[]; records: Record<string, string[]>; transcripts: Line[] }
/**
 * A film heard back: its first verdict BLOCKED with an unrun entry for each spoken line's line and mix scopes, each run by
 * the real transcriber, the records attached, and the verdict again (the transcript row of each, by the default from).
 */
export async function heardBack(bin: string, w: World, document: JsonObject, what: string, o: RunOptions = {}): Promise<Judged> {
  const [first] = presentedRun(bin, w.evidence, document, [verdictCall], `${what}, before any transcript`, o);
  const row0 = rowFrom(first!, 'narration.transcript@1', `${what}, before any transcript`);
  expect(row0['result'], `${what}: with no transcript record the row ${CLAIM}#narration.transcript is BLOCKED: ${show(row0, 1500)}`).toBe('BLOCKED');
  const unrun = unrunOf(row0, what);
  const lines = Object.entries(((document['script'] as JsonObject)['lines'] as JsonObject)).filter(([, l]) => (l as JsonObject)['kind'] === undefined || (l as JsonObject)['kind'] === 'speech');
  for (const [id] of lines) for (const scope of ['line', 'mix']) {
    expect(unrun.some((u) => u.line === id && u.scope === scope), `${what}: the BLOCKED row has a narration.transcript_unrun entry for line ${id}'s ${scope} scope: ${show(unrun.map((u) => u.raw), 1500)}`).toBe(true);
  }
  const records: Record<string, string[]> = {};
  const transcripts: Line[] = [];
  for (const u of unrun) {
    const names = (((document['script'] as JsonObject)['lines'] as JsonObject)[u.line] as JsonObject)['names'];
    const { record } = await transcribe(w, u, Array.isArray(names) ? names.map(String) : []);
    (records[u.line] ??= []).push(record);
    transcripts.push({ line: u.line, scope: u.scope, pcm: u.pcm, record, transcript: readJson(w.evidence, record, `line ${u.line}'s ${u.scope} transcript`) });
  }
  const heard = attachTo(document, records);
  const [verdict] = presentedRun(bin, w.evidence, heard, [verdictCall], what, o);
  return { document: heard, first: first!, verdict: verdict!, row: rowFrom(verdict!, 'narration.transcript@1', what), unrun, records, transcripts };
}
/** The verdict on a document whose transcripts are already attached. */
export function judgeAgain(bin: string, w: World, document: JsonObject, what: string, o: RunOptions = {}): { verdict: JsonObject; row: JsonObject } {
  const [verdict] = presentedRun(bin, w.evidence, document, [verdictCall], what, o);
  return { verdict: verdict!, row: rowFrom(verdict!, 'narration.transcript@1', what) };
}
/** The row's mismatch errors naming `line`. */
export const mismatchesOf = (row: JsonObject, line: string): JsonObject[] => errors(row, 'narration.mismatch').filter((i) => fieldOf(i, 'line') === line);
/** The words a mismatch names as missing, lower-cased. */
export const missingOf = (i: JsonObject): string[] => (Array.isArray(fieldOf(i, 'missing')) ? (fieldOf(i, 'missing') as JsonValue[]).map((x) => String(x).toLowerCase()) : []);

// ---------------------------------------------------------------------------------------------------
// The test plug-in that adds a speech tool (fixtures/voice): copied per use, `*.fixture` renamed, its tool's line and
// name written, its digest set by the extension host's packageDigest.

export interface VoicePlan { id: string; tool: string; version: string; cost?: { usd: number } }
/** The fixture line as the test tool speaks it: `say -v Samantha` at its own rate, 24 kHz, 16-bit mono. */
export function lineWav(): Uint8Array {
  const x = sayRaw(FIXTURE_LINE, VOICE, null, 24_000);
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 2 * i);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24_000, 24); h.writeUInt32LE(48_000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([h, data]));
}
function unfixture(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) unfixture(path);
    else if (name.endsWith('.fixture')) renameSync(path, join(dir, name.slice(0, -'.fixture'.length)));
  }
}
/** The test speech plug-in in `dir`, for `plan`, its tool speaking `wav` for the fixture line. */
export async function voicePlugin(dir: string, plan: VoicePlan, wav: Uint8Array): Promise<string> {
  const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
  cpSync(join(HERE, 'fixtures', 'voice'), dir, { recursive: true });
  unfixture(dir);
  const tool = `${plan.tool}@${plan.version}`;
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ tool, ...(plan.cost ? { cost: plan.cost } : {}) })}\n`);
  writeFileSync(join(dir, 'tool', 'line.wav'), wav);
  writeFileSync(join(dir, 'tool', 'voice.json'), `${JSON.stringify({ tool, line: FIXTURE_LINE })}\n`);
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest['id'] = plan.id;
  manifest['version'] = plan.version;
  manifest['job_tools'] = [{ kind: 'speech', tool }];
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest['digest'] = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-509-proof/.

const PROOF_DIR = join(tmpdir(), 'deep-509-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
