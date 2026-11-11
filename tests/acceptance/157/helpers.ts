// Test-side tools for the #157 acceptance tests: `deep-show` built once per Cargo feature set and driven by one JSON
// scenario on stdin (`deep-show run`), with the scenario's `planted` key for the wrong programs (as #502's suite names
// them); the fixture films made at test time (a look with known colours, a ground, a static side panel and two bars
// that move one pixel a frame, so no frame is flat and every frame differs; the film's sound as float WAVs); the
// `export` call and the readers of what it answers: the receipt, a FAIL's issues, a stop; this suite's own reader of
// the delivered file's ISO BMFF boxes (top-level order, edit lists, sample tables, sync samples, colour boxes); FFmpeg
// as a second reader of the delivered file; the decode worker's replies (#498's readers); a test file system made
// with `hdiutil`; a run watched from outside; and the judges the tests share. Nothing here stands in for the export,
// its guards, the encode tool or the decode worker: each is read from what `deep-show` answers or writes. JSON
// readers, the build, scenarios, the evidence store, BLAKE3 and the PNG reader are #501's; the float WAV writer is
// #502's; the decode worker's reply readers are #498's. README: The surface under test.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, expect } from 'vitest';
import { floatWav } from '../502/helpers.ts';
import {
  DOC, FLICKS, REPO as REPO_ROOT, TIMEOUT, frameLength, isObject, present, presented, putEvidence, runShow, scenario, sha256, show, type JsonObject, type JsonValue, type Rate,
} from '../501/helpers.ts';

export {
  DOC, FLICKS, FULL, REPO, TIMEOUT, arr, bgra, blocked, failsNaming, filesUnder, frameLength, getEvidence, hex64, hexes, inconclusive, int, isObject,
  n, none, num, obj, present, presented, putEvidence, receiptOf, referenceMacProblem, runShow, scenario, seeded, sha256, show, str, useShow, useTemp,
  type JsonObject, type JsonValue, type Rate, type Receipt,
} from '../501/helpers.ts';
export { floatWav } from '../502/helpers.ts';
export {
  R, assetOf, decodedOf, mediaDecode, mediaImport, rat, ratEq, showRat, topBoxes, type Rat,
} from '../498/decode/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #157.3b13ad66',
  2: 'AC2 #157.e50d5c52',
  3: 'AC3 #157.aad32dbe',
  4: 'AC4 #157.6cdc16ff',
  5: 'AC5 #157.77edcbb0',
  6: 'AC6 #157.155f2628',
  7: 'AC7 #157.96eb79fd',
  8: 'AC8 #157.760918c9',
  9: 'AC9 #157.72589e8f',
  10: 'AC10 #157.b9317df5',
  11: 'AC11 #157.966e730a',
  12: 'AC12 #157.98831309',
  13: 'AC13 #157.89f63701',
  14: 'AC14 #157.d2250c69',
  15: 'AC15 #157.0d980b87',
  16: 'AC16 #157.e141bc60',
  17: 'AC17 #157.ac47cfd5',
  18: 'AC18 #157.965b3a67',
  19: 'AC19 #157.e9670c64',
  20: 'AC20 #157.bc4ae1e7',
  21: 'AC21 #157.e306d0a0',
  22: 'AC22 #157.71f39245',
  23: 'AC23 #157.dd0134eb',
  24: 'AC24 #157.1201423e',
  25: 'AC25 #157.31dd861b',
  26: 'AC26 #157.65f8ee56',
  27: 'AC27 #157.96010227',
  28: 'AC28 #157.41e9b5bf',
  29: 'AC29 #157.2b3d3587',
} as const;

/** The build with the test canvas module `test.guards` (README: Cargo features): the items that write a NaN, lose
 * the device and draw a frame differently the second time. */
export const GUARDS = 'full,test-export-guards';

/** The wrong programs the criteria name, each chosen by the scenario's `planted` (README: Planted programs). */
export type Planted =
  | 'blank_counts_dark_only' | 'encode_full_range_bt601' | 'encoder_starves_bitrate' | 'limiter_without_codec_margin'
  | 'prores_fed_full_range' | 'muxer_strips_audio_edit_list' | 'muxer_edit_list_1024' | 'muxer_swaps_channels'
  | 'writer_drops_frame_700' | 'writer_repeats_frame_701' | 'muxer_keeps_end_padding' | 'prores_premultiplies_straight'
  | 'h264_full_range_under_limited_tags' | 'muxer_writes_moov_last' | 'encoder_ignores_chapters' | 'video_writer_drops_frame'
  | 'muxer_timescale_600' | 'muxer_timescale_1000' | 'shard_rounds_first_sample' | 'limiter_lookahead_uncompensated'
  | 'muxer_drops_video_edit_list' | 'reader_pads_last_packet' | 'export_without_disk_gate' | 'export_stores_raw_frames'
  | 'fidelity_keeps_frames' | 'wrap_compares_second_frame';

// ---------------------------------------------------------------------------------------------------
// Runs

/** One scenario: document a presented, then `calls`; their replies. A planted program is the scenario's `planted`. */
export function filmRun(bin: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const replies = runShow(bin, scenario(evidence, [present(DOC.a, document), ...calls], planted ? { planted } : {}), label);
  presented(replies[0]!, `${label}: the document`);
  return replies.slice(1);
}

/** Folders that last for the file (a run several legs read), removed after it. */
export function useFileTemp(tag: string): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), `deep-157-${tag}-`)); made.push(d); return d; };
}

export const exportCall = (ask: JsonObject): JsonObject => ({ call: 'export', doc: DOC.a, ...ask });
export const H264_AAC: JsonObject = { video: { codec: 'h264' }, audio: { codec: 'aac' } };
export const H264_PCM: JsonObject = { video: { codec: 'h264' }, audio: { codec: 'pcm' } };
export const PRORES_PCM: JsonObject = { video: { codec: 'prores_4444', alpha: 'straight' }, audio: { codec: 'pcm' } };

/** A reply that isn't a delivery: its outcome and issues, each a line `<check or code>: <the issue's JSON>` (README:
 * FAIL, stop, refusal). A delivery gives none. */
export function issueLines(reply: JsonObject): string[] {
  if (reply['outcome'] === 'exported') return [];
  const list = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const head = `${String(reply['outcome'])}${reply['code'] === undefined ? '' : ` ${String(reply['code'])}`}`;
  if (list.length === 0) return [`${head}: ${show(reply, 800)}`];
  return list.map((i) => `${String(i['check'] ?? i['code'] ?? i['measure'] ?? head)}: ${JSON.stringify(i)}`);
}
/** The issues of a reply raised by one check kind. */
export const issuesOf = (reply: JsonObject, check: string): JsonObject[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i): i is JsonObject => isObject(i) && i['check'] === check);
/** The frames an issue names: `frame` and every entry of `frames`. */
export function framesNamed(i: JsonObject): number[] {
  const out: number[] = [];
  if (typeof i['frame'] === 'number') out.push(i['frame']);
  if (Array.isArray(i['frames'])) for (const f of i['frames']) if (typeof f === 'number') out.push(f);
  return out;
}
/** Every file left under `dir`, by relative path. */
export function leftIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p)); } };
  walk(dir);
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------
// The look (README: Fixtures): flat colours the tests know, and a finish (grain for criterion 4). Its bytes go into
// the evidence store; a film names it as #407's films do. It resolves under the look guard (deep-canvas-marks look.rs
// `resolve_in`) wherever status shows and everywhere: every status colour 3:1 on the ground, the raised ground and hover
// and selected over either, and 4.5:1 to the ground for its label; ink_primary, ink_secondary and ink_tertiary 4.5:1
// on each of those surfaces; every role at an alpha the ink's colour; every opaque role but the ground, and every
// alpha role over the ground and the raised ground, at least min_distance (0.1) in OKLab from each status colour; and a
// focus ring 3:1 on every surface. A look the guard refuses is silently replaced by the shipped one, which has none of
// the roles the films name, so a colour here changes only within those rules.

export interface Look { id: string; sha: string; bytes: Buffer }
export const COLOURS = {
  ground: '#e8e8e8', muted: '#8c8c8c', accent: '#f2c230', raised: '#d4d4d4', paper: '#f0f0f0', black: '#000000', white: '#ffffff',
  ramp_lo: '#0838a8', ramp_hi: '#f08020',
} as const;
export type Role = keyof typeof COLOURS | 'ink';
export function lookOf(id: string, colours: Partial<Record<keyof typeof COLOURS, string>> = {}, finish: JsonObject[] = []): Look {
  const c = { ...COLOURS, ...colours };
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: `The #157 acceptance look ${id}: flat colours the tests know.`,
    palette: {
      ...c, graphite: '#1b1d22', fog: '#e3e4e6',
      graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d22d6', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a',
      orchid: '#b0207f', indigo: '#2c3e7b',
    },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog', paper: 'paper', black: 'black', white: 'white',
      ramp_lo: 'ramp_lo', ramp_hi: 'ramp_hi',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled', focus: 'graphite',
      hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo',
    },
    themes: { light: {} },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish,
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: sha256(bytes), bytes };
}
/** 8-bit luma of an sRGB colour `#rrggbb` (BT.709 weights on the coded values), 0 to 255. */
export function luma(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}

// ---------------------------------------------------------------------------------------------------
// Fixture films (README: Fixtures). Times are flicks; a rate's frame is a whole number of flicks.

export const CC0: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made at test time by the #157 acceptance tests.' };
export const frameFlicks = (rate: Rate): number => {
  const d = frameLength(rate);
  if (d === null) throw Error(`${rate.join('/')} is not a valid frame rate`);
  return Number(d);
};
/** The sample frames of `frames` frames at `rate` and `sr`: ⌊frames × Δ × sr ÷ 705,600,000⌋. */
export const samplesOf = (frames: number, rate: Rate, sr: number): number => Number((BigInt(frames) * BigInt(frameFlicks(rate)) * BigInt(sr)) / BigInt(FLICKS));
export const order = (k: number): string => `a${String(k).padStart(3, '0')}`;
export function rect(id: string, box: [number, number, number, number], role: Role, k: number, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: order(k), params: { box, paint: { fill: { role } } }, ...extra };
}
export function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a00cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A channel whose keys hold: each value from its frame until the next key's (`at` in frames). */
export function holdFrames(target: string, rate: Rate, keys: [number, JsonValue][]): JsonObject {
  const d = frameFlicks(rate);
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([at, value], i) => [`k${String(i).padStart(4, '0')}`, { t: at * d, value, interp: 'hold' }])) };
}
/** A channel through `values[k]` at frame k, straight between frames. */
export function perFrame(target: string, rate: Rate, values: number[]): JsonObject {
  const d = frameFlicks(rate);
  return { target, type: 'f32', keys: Object.fromEntries(values.map((value, k) => [`k${String(k).padStart(5, '0')}`, { t: k * d, value, interp: 'linear' }])) };
}
/** base + (k mod period) at frame k: a straight run over each period that jumps back at the next. */
function cycle(target: string, base: number, period: number, frames: number, rate: Rate): JsonObject {
  const d = frameFlicks(rate);
  const keys: JsonObject = {};
  let n = 0;
  const key = (at: number, value: number, interp: string): void => { keys[`k${String(n++).padStart(5, '0')}`] = { t: at * d, value, interp }; };
  for (let a = 0; a < frames; a += period) {
    const b = Math.min(a + period - 1, frames - 1);
    key(a, base, 'linear');
    if (b > a) key(b, base + (b - a), 'hold');
  }
  return { target, type: 'f32', keys };
}

export interface FilmSpec {
  size?: [number, number]; rate?: Rate; frames: number; sampleRate?: number;
  /** The film's sound, one Float32Array a channel, played from 0 at unity: `tone` (440 and 660 Hz, the default), or
   * none. */
  sound?: 'tone' | 'none' | Float32Array[]; soundLicense?: JsonObject;
  look?: Look; moving?: boolean; plain?: boolean; items?: JsonObject[]; channels?: JsonObject; markers?: JsonObject; shots?: JsonObject;
  transitions?: JsonObject; loop?: 'wrap' | 'ping_pong'; script?: JsonObject; checks?: JsonObject[]; assets?: JsonObject; strips?: JsonObject;
  buses?: JsonObject; processors?: JsonObject; locale?: string; title?: string; requires?: JsonObject;
}
/** The stereo tone a fixture film plays: 440 Hz left at 0.2 and 660 Hz right at 0.15, `frames` sample frames. */
export function toneChannels(frames: number, sr: number): Float32Array[] {
  const l = new Float32Array(frames); const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { l[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr); r[i] = 0.15 * Math.sin((2 * Math.PI * 660 * i) / sr); }
  return [l, r];
}
/**
 * A fixture film, its look and sound put in the evidence store: `size` (160 × 90) at `rate` (24/1) for `frames`
 * frames; a ground (`ground`, grey 232), a static side panel over the left 40% (`muted`), and, unless `moving` is
 * false, a bar (`accent`) moving right one pixel a frame and a tick (`raised`) moving down one pixel a frame, each
 * starting over at its edge, so every frame differs from every other and no frame is flat; `items` drawn over them.
 */
export function filmDoc(evidence: string, s: FilmSpec): JsonObject {
  const size = s.size ?? [160, 90];
  const rate = s.rate ?? [24, 1];
  const [W, H] = size;
  const sr = s.sampleRate ?? 48_000;
  const look = s.look ?? lookOf('film-157');
  putEvidence(evidence, look.bytes);
  const items: JsonObject[] = [camera2d(size)];
  const channels: JsonObject = { ...(s.channels ?? {}) };
  if (!s.plain) {
    items.push(rect('back', [0, 0, W, H], 'ground', 1), rect('side', [0, 0, Math.round(0.4 * W), H], 'muted', 2));
    if (s.moving !== false) {
      const bw = Math.max(2, Math.round(W / 40)); const x0 = Math.round(0.4 * W);
      const th = Math.max(2, Math.round(H / 30)); const tx = Math.round(0.05 * W); const tw = Math.round(0.3 * W);
      items.push(rect('bar', [x0, 0, bw, H], 'accent', 3), rect('tick', [tx, 0, tw, th], 'raised', 4));
      channels['bar_x'] = cycle('items/bar/params/box/0', x0, W - x0 - bw, s.frames, rate);
      channels['tick_y'] = cycle('items/tick/params/box/1', 0, H - th, s.frames, rate);
    }
  }
  items.push(...(s.items ?? []));
  const assets: JsonObject = { [look.id]: { sha256: look.sha, license: CC0 }, ...(s.assets ?? {}) };
  const strips: JsonObject = { ...(s.strips ?? {}) };
  const samples = samplesOf(s.frames, rate, sr);
  if (s.sound !== 'none') {
    const chans = Array.isArray(s.sound) ? s.sound : toneChannels(samples, sr);
    const sha = putEvidence(evidence, floatWav(chans, sr));
    assets['sound'] = { sha256: sha, license: s.soundLicense ?? CC0 };
    strips['sound'] = { track: 1, src: sha, start: 0, in: 0, out: (chans[0]!.length * FLICKS) / sr, rate: 1 };
  }
  return {
    format: 1, id: 'film-157', profile: 'film', title: s.title ?? 'An export guards fixture',
    description: 'A film the #157 acceptance tests export: a ground, a side panel and bars that move every frame.',
    size, ...(s.locale ? { locale: s.locale } : {}), camera: 'cam', look: { asset: `${look.id}@1`, theme: 'light' },
    transport: { span: s.frames * frameFlicks(rate), frame_rate: rate, sample_rate: sr, ...(s.loop ? { loop: s.loop } : {}) },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), channels, assets, strips,
    ...(s.markers ? { markers: s.markers } : {}), ...(s.shots ? { shots: s.shots } : {}), ...(s.transitions ? { transitions: s.transitions } : {}),
    ...(s.script ? { script: s.script } : {}), ...(s.checks ? { checks: s.checks } : {}), ...(s.buses ? { buses: s.buses } : {}),
    ...(s.processors ? { processors: s.processors } : {}), ...(s.requires ? { requires: s.requires } : {}),
  };
}

/** A sound asset in the store as a float WAV, and its strip entry played from `start` flicks. */
export function soundStrip(evidence: string, chans: Float32Array[], sr: number, start = 0, track = 2): { sha: string; strip: JsonObject } {
  const sha = putEvidence(evidence, floatWav(chans, sr));
  return { sha, strip: { track, src: sha, start, in: 0, out: (chans[0]!.length * FLICKS) / sr, rate: 1 } };
}

// ---------------------------------------------------------------------------------------------------
// The sync fixture (Check input: export kinds: export.sync): a white frame and a 2 ms full-scale 4 kHz burst at the
// frame that shows each whole second, here seconds 1 to `seconds − 1`, over a black film.

/** The frame that shows whole second s at `rate`: ⌊s ÷ Δ⌋. */
export const frameShowing = (s: number, rate: Rate): number => Math.floor((s * FLICKS) / frameFlicks(rate));
/** The burst: 2 ms of a 4 kHz sine at full scale. */
export function burst(sr: number): Float32Array {
  const n = Math.round(0.002 * sr);
  return Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 4000 * i) / sr));
}
/** A burst's first sample: the white frame's start, ⌊k × Δ × sr ÷ 705,600,000⌋. */
export const burstSample = (k: number, rate: Rate, sr: number): number => samplesOf(k, rate, sr);
export interface SyncFilm { document: JsonObject; seconds: number[]; frames: number; rate: Rate; sr: number; white: number[]; bursts: number[][]; channels: Float32Array[] }
/**
 * The sync fixture at `rate` and `sr`, `seconds` long: black, with a full-frame white rect shown only on the frame that
 * shows each whole second from 1, and a burst at that frame's start on the left channel and, `rightLag` samples
 * later, on the right (0: the same sample), at full scale or `level`. With `limiter`, the master ends in a limiter
 * with 5 ms of lookahead.
 */
export function syncFilm(evidence: string, rate: Rate, sr: number, seconds: number, o: { rightLag?: number; limiter?: boolean; size?: [number, number]; level?: number } = {}): SyncFilm {
  const frames = Math.round((seconds * FLICKS) / frameFlicks(rate));
  const marks = Array.from({ length: seconds - 1 }, (_, i) => i + 1);
  const white = marks.map((s) => frameShowing(s, rate));
  const total = samplesOf(frames, rate, sr);
  const l = new Float32Array(total); const r = new Float32Array(total);
  const b = burst(sr).map((v) => v * (o.level ?? 1));
  const lag = o.rightLag ?? 0;
  const bursts = white.map((k) => [burstSample(k, rate, sr), burstSample(k, rate, sr) + lag]);
  for (const [a, c] of bursts) { l.set(b, a!); r.set(b, c!); }
  const size = o.size ?? [160, 90];
  const keys: [number, JsonValue][] = [[0, 0]];
  for (const k of white) keys.push([k, 1], [k + 1, 0]);
  const document = filmDoc(evidence, {
    size, rate, frames, sampleRate: sr, sound: [l, r], plain: true,
    items: [rect('dark', [0, 0, size[0], size[1]], 'black', 1), rect('flash', [0, 0, size[0], size[1]], 'white', 2, { adjust: { opacity: 0 } })],
    channels: { flash: holdFrames('items/flash/adjust/opacity', rate, keys) },
    // A sync film is dark between its marks by design: the whole span is declared, so film.blank reads it as meant.
    checks: [{ kind: 'film.blank', except: [[0, frames * frameFlicks(rate)]] }],
    ...(o.limiter ? { buses: { master: { processors: ['tp'] } }, processors: { tp: { kind: 'limiter', ceiling: -1, lookahead: 0.005, release: 0.05, oversample: 4 } } } : {}),
  });
  return { document, seconds: marks, frames, rate, sr, white, bursts, channels: [l, r] };
}
/** The lag, in samples, at which `x` best matches `template` around sample `at` (within ±`search`): the cross-
 * correlation's peak, ties to the smallest lag. */
export function lagAt(x: Float32Array, template: Float32Array, at: number, search: number): number {
  let best = -Infinity; let lag = 0;
  for (let d = -search; d <= search; d++) {
    const o = at + d;
    if (o < 0 || o + template.length > x.length) continue;
    let c = 0;
    for (let i = 0; i < template.length; i++) c += x[o + i]! * template[i]!;
    if (c > best + 1e-9 || (Math.abs(c - best) <= 1e-9 && Math.abs(d) < Math.abs(lag))) { best = c; lag = d; }
  }
  return lag;
}

// ---------------------------------------------------------------------------------------------------
// ISO BMFF: this suite's own reader of a delivered MP4 or MOV, apart from the decode worker and FFmpeg.

export interface Box { type: string; start: number; size: number; header: number }
/** The boxes between `from` and `to` (64-bit sizes and size 0 read). */
export function boxes(b: Buffer, from = 0, to = b.length): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = b.readUInt32BE(at); let header = 8;
    const type = b.toString('latin1', at + 4, at + 8);
    if (size === 1) { size = Number(b.readBigUInt64BE(at + 8)); header = 16; } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type, start: at, size, header });
    at += size;
  }
  return out;
}
const child = (b: Buffer, parent: Box, type: string, skip = 0): Box | undefined => boxes(b, parent.start + parent.header + skip, parent.start + parent.size).find((x) => x.type === type);
const body = (b: Buffer, x: Box): Buffer => b.subarray(x.start + x.header, x.start + x.size);
export interface Colr { kind: string; primaries: number; transfer: number; matrix: number; fullRange: boolean | null }
export interface Edit { duration: bigint; mediaTime: bigint; rate: number }
export interface Track {
  id: number; handler: string; entry: string; timescale: number; edits: Edit[] | null; stts: [number, number][]; ctts: [number, number][] | null;
  syncSamples: number[] | null; samples: number; colr: Colr | null;
}
export interface Movie { top: Box[]; timescale: number; tracks: Track[] }
/** The movie's top-level boxes and each track's tables. */
export function readMovie(b: Buffer, what: string): Movie {
  const top = boxes(b);
  const moov = top.find((x) => x.type === 'moov');
  expect(moov, `${what}: the file has a moov box (top level: ${top.map((x) => x.type).join(', ')})`).toBeDefined();
  const mvhd = body(b, child(b, moov!, 'mvhd')!);
  const timescale = mvhd.readUInt32BE(mvhd[0] === 1 ? 20 : 12);
  const tracks = boxes(b, moov!.start + moov!.header, moov!.start + moov!.size).filter((x) => x.type === 'trak').map((trak): Track => {
    const tkhd = body(b, child(b, trak, 'tkhd')!);
    const id = tkhd.readUInt32BE(tkhd[0] === 1 ? 20 : 12);
    const edts = child(b, trak, 'edts');
    const elst = edts ? child(b, edts, 'elst') : undefined;
    let edits: Edit[] | null = null;
    if (elst) {
      const e = body(b, elst); const v1 = e[0] === 1; const n = e.readUInt32BE(4);
      edits = Array.from({ length: n }, (_, i) => {
        const o = 8 + i * (v1 ? 20 : 12);
        return v1
          ? { duration: e.readBigUInt64BE(o), mediaTime: e.readBigInt64BE(o + 8), rate: e.readInt16BE(o + 16) + e.readUInt16BE(o + 18) / 65536 }
          : { duration: BigInt(e.readUInt32BE(o)), mediaTime: BigInt(e.readInt32BE(o + 4)), rate: e.readInt16BE(o + 8) + e.readUInt16BE(o + 10) / 65536 };
      });
    }
    const mdia = child(b, trak, 'mdia')!;
    const mdhd = body(b, child(b, mdia, 'mdhd')!);
    const hdlr = body(b, child(b, mdia, 'hdlr')!);
    const minf = child(b, mdia, 'minf')!;
    const stbl = child(b, minf, 'stbl')!;
    const table = (type: string): Buffer | null => { const x = child(b, stbl, type); return x ? body(b, x) : null; };
    const pairs = (t: Buffer | null, signed: boolean): [number, number][] | null => t === null ? null
      : Array.from({ length: t.readUInt32BE(4) }, (_, i) => [t.readUInt32BE(8 + 8 * i), signed ? t.readInt32BE(12 + 8 * i) : t.readUInt32BE(12 + 8 * i)]);
    const stss = table('stss');
    const stsz = table('stsz')!;
    const stsd = child(b, stbl, 'stsd')!;
    const entry = boxes(b, stsd.start + stsd.header + 8, stsd.start + stsd.size)[0]!;
    let colr: Colr | null = null;
    const handler = hdlr.toString('latin1', 8, 12);
    if (handler === 'vide') {
      const c = boxes(b, entry.start + 86, entry.start + entry.size).find((x) => x.type === 'colr');
      if (c) {
        const cb = body(b, c); const kind = cb.toString('latin1', 0, 4);
        colr = { kind, primaries: cb.readUInt16BE(4), transfer: cb.readUInt16BE(6), matrix: cb.readUInt16BE(8), fullRange: kind === 'nclx' ? (cb[10]! & 0x80) !== 0 : null };
      }
    }
    return {
      id, handler, entry: entry.type, timescale: mdhd.readUInt32BE(mdhd[0] === 1 ? 20 : 12), edits,
      stts: pairs(table('stts'), false)!, ctts: pairs(table('ctts'), true), syncSamples: stss === null ? null : Array.from({ length: stss.readUInt32BE(4) }, (_, i) => stss.readUInt32BE(8 + 4 * i)),
      samples: stsz.readUInt32BE(8), colr,
    };
  });
  return { top, timescale, tracks };
}
export function trackOf(m: Movie, handler: 'vide' | 'soun', what: string): Track {
  const t = m.tracks.filter((x) => x.handler === handler);
  expect(t.length, `${what}: the file holds one ${handler === 'vide' ? 'video' : 'sound'} track`).toBe(1);
  return t[0]!;
}
/** Each sample's composition time in its track's timescale (decode times from stts, plus ctts), in decode order. */
export function compositionTimes(t: Track): bigint[] {
  const out: bigint[] = [];
  let dts = 0n;
  for (const [count, delta] of t.stts) for (let i = 0; i < count; i++) { out.push(dts); dts += BigInt(delta); }
  if (t.ctts) { let k = 0; for (const [count, off] of t.ctts) for (let i = 0; i < count; i++) { out[k] = out[k]! + BigInt(off); k++; } }
  return out;
}
/** For presented frame k (presentation order), its sample's number (1-based, decode order). */
export function sampleOfFrame(t: Track): number[] {
  const cts = compositionTimes(t);
  return cts.map((c, i) => ({ c, i })).sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : a.i - b.i)).map((x) => x.i + 1);
}

// ---------------------------------------------------------------------------------------------------
// FFmpeg: the second reader (#136: an upstream reader counts only when run on our output). Located as #502's suite
// does; without it a test is BLOCKED.

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = name === 'ffmpeg' ? process.env['DEEP_FFMPEG'] : process.env['DEEP_FFPROBE'];
  for (const c of [env, name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
let tools: { ffmpeg: string; ffprobe: string } | null | undefined;
/** FFmpeg's ffmpeg and ffprobe, or the test fails BLOCKED with the unblock line. */
export function ffmpegTools(): { ffmpeg: string; ffprobe: string } {
  if (tools === undefined) {
    const ffmpeg = findTool('ffmpeg'); const ffprobe = findTool('ffprobe');
    tools = ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
  }
  if (!tools) expect.fail('BLOCKED: FFmpeg is the second reader of the delivered file here, and ffmpeg or ffprobe was not found on PATH, in /opt/homebrew/bin or /usr/local/bin; this is not a pass. Unblock: brew install ffmpeg, or name the binaries in DEEP_FFMPEG and DEEP_FFPROBE');
  return tools;
}
export function ffprobeJson(args: string[]): JsonObject {
  return JSON.parse(execFileSync(ffmpegTools().ffprobe, ['-v', 'error', '-of', 'json', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 })) as JsonObject;
}
export function ffmpegOut(args: string[]): Buffer {
  return execFileSync(ffmpegTools().ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', ...args], { maxBuffer: 2 ** 31, stdio: ['ignore', 'pipe', 'pipe'] });
}
const ratOf = (text: string): { n: bigint; d: bigint } => { const m = /^(\d+)\/(\d+)$/.exec(text); if (!m) throw Error(`not a rational: ${text}`); return { n: BigInt(m[1]!), d: BigInt(m[2]!) }; };
export interface FfFrames { tb: { n: bigint; d: bigint }; frames: { pts: bigint; key: boolean }[] }
/** The first video stream's decoded frames as FFmpeg presents them (edit lists applied): pts in its time base. */
export function ffVideoFrames(path: string): FfFrames {
  const j = ffprobeJson(['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts,best_effort_timestamp,key_frame:stream=time_base', path]);
  const s = (j['streams'] as JsonObject[] | undefined)?.[0];
  const tb = ratOf(String(s?.['time_base']));
  const frames = ((j['frames'] ?? []) as JsonObject[]).map((f, k) => {
    const p = Number(f['pts'] ?? f['best_effort_timestamp']);
    expect(Number.isSafeInteger(p), `FFmpeg gives frame ${k} of ${path} no presentation time: ${show(f)}`).toBe(true);
    return { pts: BigInt(p), key: Number(f['key_frame']) === 1 };
  });
  return { tb, frames };
}
export interface FfAudio { rate: number; channels: number; startPts: bigint; durationTs: bigint | null; tb: { n: bigint; d: bigint } }
/** FATE's gaplessenc probe fields of the first audio stream: start_pts and duration_ts, with its rate and layout. */
export function ffAudioStream(path: string): FfAudio {
  const j = ffprobeJson(['-select_streams', 'a:0', '-show_entries', 'stream=start_pts,duration_ts,time_base,sample_rate,channels', path]);
  const s = (j['streams'] as JsonObject[] | undefined)?.[0] ?? {};
  return {
    rate: Number(s['sample_rate']), channels: Number(s['channels']), startPts: BigInt(Number(s['start_pts'] ?? 0)),
    durationTs: s['duration_ts'] === undefined ? null : BigInt(Number(s['duration_ts'])), tb: ratOf(String(s['time_base'])),
  };
}
/** The first audio stream decoded by FFmpeg (priming and padding trimmed as its demuxer reads them), per channel. */
export function ffPcm(path: string, channels: number): Float32Array[] {
  const raw = ffmpegOut(['-i', path, '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', '-']);
  const n = Math.floor(raw.length / (4 * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c]![i] = raw.readFloatLE(4 * (i * channels + c));
  return out;
}
/** Each decoded video frame's luma plane (W × H bytes), the codes as coded (decoded to yuv420p with no conversion). */
export function ffLuma(path: string, w: number, h: number): Buffer[] {
  const raw = ffmpegOut(['-i', path, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-']);
  const per = (w * h * 3) / 2;
  return Array.from({ length: Math.floor(raw.length / per) }, (_, k) => raw.subarray(k * per, k * per + w * h));
}
/** BT.709 limited-range luma of a BGRA8 frame, as the export's conversion pass makes it (rounded). */
export function lumaOf(bgra8: Buffer): Uint8Array {
  const y = new Uint8Array(bgra8.length / 4);
  for (let i = 0; i < y.length; i++) y[i] = Math.round(16 + (219 * (0.2126 * bgra8[4 * i + 2]! + 0.7152 * bgra8[4 * i + 1]! + 0.0722 * bgra8[4 * i]!)) / 255);
  return y;
}
export function mse(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; }
  return s / a.length;
}

// ---------------------------------------------------------------------------------------------------
// A run watched from outside: `deep-show run` started asynchronously with its own environment, `tick` called every
// 200 ms while it runs. Stopped only by its own PID on timeout.

export interface Watched { status: number | null; stdout: string; stderr: string; replies: JsonObject[] | null }
export function runAsync(bin: string, sc: JsonObject, o: { env?: NodeJS.ProcessEnv; tick?: () => void; timeoutMs?: number } = {}): Promise<Watched> {
  return new Promise((done) => {
    const child = spawn(bin, ['run'], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(o.env ?? {}) } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify(sc)}\n`);
    const poll = o.tick ? setInterval(() => { try { o.tick!(); } catch { /* a file vanished between listing and reading */ } }, 200) : null;
    const timer = setTimeout(() => { if (child.pid) process.kill(child.pid, 'SIGKILL'); }, o.timeoutMs ?? 3_000_000);
    child.on('close', (status) => {
      if (poll) clearInterval(poll);
      clearTimeout(timer);
      let replies: JsonObject[] | null = null;
      const line = stdout.split('\n').find((l) => l.trim() !== '');
      try {
        const answer = JSON.parse(line ?? 'null') as JsonValue;
        if (isObject(answer) && answer['ok'] === true && Array.isArray(answer['replies'])) replies = answer['replies'].filter(isObject);
      } catch { /* read below */ }
      done({ status, stdout, stderr, replies });
    });
  });
}
/** A watched run's replies, or a failure naming why there are none. */
export function watchedReplies(w: Watched, calls: number, what: string): JsonObject[] {
  expect(w.status, `${what}: deep-show run exits 0; stdout: ${w.stdout.slice(0, 800)}; stderr: ${w.stderr.slice(-1500)}`).toBe(0);
  expect(w.replies, `${what}: one answer line, ok, with replies: ${w.stdout.slice(0, 800)}`).not.toBeNull();
  expect(w.replies!.length, `${what}: one reply per call`).toBe(calls);
  return w.replies!;
}

// ---------------------------------------------------------------------------------------------------
// A test file system (criterion 25): a disk image made and attached with macOS `hdiutil`, detached and deleted after
// the file. Off macOS, or when hdiutil can't attach one, the test is BLOCKED.

export interface Volume { mount: string; free: () => number; used: () => number; fillTo: (free: number) => void }
const attached: { mount: string; image: string }[] = [];
afterAll(() => {
  for (const v of attached.splice(0)) {
    spawnSync('hdiutil', ['detach', v.mount, '-force'], { encoding: 'utf8' });
    rmSync(v.image, { recursive: true, force: true });
  }
}, TIMEOUT);
const statfs = (dir: string): { free: number; used: number } => { const s = statfsSync(dir); return { free: s.bavail * s.bsize, used: (s.blocks - s.bfree) * s.bsize }; };
/**
 * A fresh volume: `small` is a 64 MB HFS+ image, which `fillTo` fills with one file until the free space it reports
 * is the size asked; `large` is a 10 GB sparse bundle, which takes host disk only as it fills. Detached and deleted
 * after the file.
 */
export function volume(kind: 'small' | 'large'): Volume {
  if (process.platform !== 'darwin') expect.fail(`BLOCKED: a test file system is a disk image attached with hdiutil, a macOS tool, and this is ${process.platform}; this is not a pass`);
  const dir = mkdtempSync(join(tmpdir(), `deep-157-vol-${kind}-`));
  const image = join(dir, kind === 'small' ? 'small.dmg' : 'large.sparsebundle');
  const mount = join(dir, 'mnt');
  mkdirSync(mount);
  const make = kind === 'small'
    ? ['create', '-size', '64m', '-fs', 'HFS+', '-volname', 'deep157small', image]
    : ['create', '-size', '10g', '-type', 'SPARSEBUNDLE', '-fs', 'HFS+', '-volname', 'deep157large', image];
  const c = spawnSync('hdiutil', make, { encoding: 'utf8' });
  if (c.status !== 0) { rmSync(dir, { recursive: true, force: true }); expect.fail(`BLOCKED: hdiutil could not make the ${kind} test file system: ${c.stderr || c.stdout}; this is not a pass`); }
  const a = spawnSync('hdiutil', ['attach', '-nobrowse', '-noverify', '-noautoopen', '-mountpoint', mount, image], { encoding: 'utf8' });
  if (a.status !== 0) { rmSync(dir, { recursive: true, force: true }); expect.fail(`BLOCKED: hdiutil could not attach the ${kind} test file system: ${a.stderr || a.stdout}; this is not a pass`); }
  attached.push({ mount, image: dir });
  return {
    mount, free: () => statfs(mount).free, used: () => statfs(mount).used,
    fillTo: (free: number) => { const fill = statfs(mount).free - free; if (fill > 0) writeFileSync(join(mount, 'filler.bin'), Buffer.alloc(fill)); },
  };
}
/** Files under `dir` that hold raw frames: any named `.bgra`, `.yuv`, `.nv12` or `.raw`, and every file of a folder
 * holding two or more files each exactly one frame's BGRA8 bytes (`frameBytes`) or its 4:2:0 planes. A single file
 * that passes through such a size while it grows (the PCM, the delivery) is not one. */
export function rawFrameFiles(dir: string, frameBytes: number): string[] {
  const nv12 = (frameBytes / 4) * 1.5;
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    const sized: string[] = [];
    for (const e of names) {
      const p = join(d, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(bgra|yuv|nv12|raw)$/i.test(e)) out.push(p);
      else if (st.size === frameBytes || st.size === nv12) sized.push(p);
    }
    if (sized.length >= 2) out.push(...sized);
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Judges the files share

/** The streaming profile's true-peak limit for an integrated reading: −2.0 dBTP above −14.0 LUFS, else −1.0. */
export const streamingPeakLimit = (integrated: number): number => (integrated > -14.0 ? -2.0 : -1.0);
/** Each named field of `fidelity` in a receipt (README: the receipt), read strictly. */
export interface Fidelity { frames: number; samples: number | null; floor: number; psnrY: number | null; ssim: number | null; alpha: { psnr: number | null; ssim: number | null } | null; worst: { frame: number; psnr_y: number | null; ssim: number | null }[] }
export function fidelityOf(receipt: JsonObject, what: string): Fidelity {
  const f = receipt['fidelity'];
  expect(isObject(f), `${what}: receipt.fidelity is an object, got ${show(f ?? null, 400)}`).toBe(true);
  const o = f as JsonObject;
  const nn = (v: JsonValue | undefined, w: string): number | null => {
    expect(v === null || (typeof v === 'number' && Number.isFinite(v)), `${what}: receipt.fidelity.${w} is a number or null, got ${show(v ?? 'undefined')}`).toBe(true);
    return v as number | null;
  };
  const floor = o['floor'];
  expect(isObject(floor) && typeof floor['psnr_y'] === 'number', `${what}: receipt.fidelity.floor.psnr_y is a number, got ${show(floor ?? null)}`).toBe(true);
  const alpha = o['alpha'];
  const worst = o['worst_1pct'];
  expect(Array.isArray(worst), `${what}: receipt.fidelity.worst_1pct is a list, got ${show(worst ?? null)}`).toBe(true);
  expect(typeof o['frames'] === 'number', `${what}: receipt.fidelity.frames is a number, got ${show(o['frames'] ?? null)}`).toBe(true);
  return {
    frames: o['frames'] as number, samples: o['samples'] === undefined ? null : nn(o['samples'], 'samples'),
    floor: (floor as JsonObject)['psnr_y'] as number, psnrY: nn(o['psnr_y'], 'psnr_y'), ssim: nn(o['ssim'], 'ssim'),
    alpha: isObject(alpha) ? { psnr: nn(alpha['psnr'], 'alpha.psnr'), ssim: nn(alpha['ssim'], 'alpha.ssim') } : null,
    worst: (worst as JsonValue[]).filter(isObject).map((w) => ({ frame: Number(w['frame']), psnr_y: (w['psnr_y'] ?? null) as number | null, ssim: (w['ssim'] ?? null) as number | null })),
  };
}
/** A frame meets the floor when its PSNR-Y is at or over it (null: identical) or, for the 40 dB floor, its SSIM is at
 * least 0.98 (Check input: export kinds). */
export const meetsFloor = (psnr: number | null, ssim: number | null, floor: number): boolean => psnr === null || psnr >= floor || (floor === 40 && ssim !== null && ssim >= 0.98);

/** A file's bytes, read once. */
export const bytesOf = (path: string): Buffer => readFileSync(path);
