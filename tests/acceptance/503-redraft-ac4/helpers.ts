// Test-side tools for the blind redraft of #503 AC4's lossy clause (README): the lossy fixtures, made at test time by
// pinned FFmpeg recipes from a source signal written here; FFmpeg's own decode of each, the reference; one run of
// `deep-show run` decoding every fixture through `media_decode`; and the judgement of each decode against its
// reference, as sentences that start with the fixture's name. FFmpeg only makes fixtures and references: nothing here
// stands in for the decode worker or its decoders, which are read from what `deep-show` answers and writes.
// `deep-show run`, `media_decode`, `workers` and their reply parsers are #498's (tests/acceptance/498/decode); the
// build, the WAV writer and reader, the seeded generator and the verdict helpers are #501's (tests/acceptance/501).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  arr, decodedOf, describeWorker, f32, isObject, mediaDecode, obj, refusalOf, runRaw, workersCall, workersOf,
  type JsonObject, type JsonValue, type Worker,
} from '../498/decode/helpers.ts';
import { blocked, readWav, seeded, sha256, wav16 } from '../501/helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The bound (README: The reference and the bound): the peak per-sample difference from FFmpeg's decode, in dBFS of
// a full scale of 1.0, at or below −90 dBFS.

const BOUND_DBFS = -90;
/** −90 dBFS as a magnitude: 10^(−90/20) ≈ 3.1623e-5, a little over one 16-bit step (2^−15 ≈ 3.0518e-5, −90.31 dBFS). */
const BOUND = 10 ** (BOUND_DBFS / 20);
const dbfs = (x: number): string => (x === 0 ? '-inf dBFS' : `${(20 * Math.log10(x)).toFixed(2)} dBFS`);

// ---------------------------------------------------------------------------------------------------
// The lossy fixtures (README: Fixtures). Each is made from the source signal at its own rate and channel count by one
// FFmpeg encoder, and FFmpeg's decoder named in `decoder` makes its reference.

type Format = 'MP3' | 'AAC-LC' | 'HE-AAC' | 'Opus (Ogg)' | 'Opus (WebM)' | 'Vorbis (Ogg)';
type OpusMode = 'SILK' | 'hybrid' | 'CELT';
export interface Recipe {
  name: string; format: Format; ext: string; rate: number; channels: 1 | 2;
  /** FFmpeg's encoder and its options, and the muxer that writes the file. */
  encoder: string; options: string[]; muxer: string;
  /** FFmpeg's decoder whose output is the reference. */
  decoder: string;
  /** What ffprobe must read of the file for it to be this fixture: the codec, the AAC profile, a word of the container's
   * format name, and for Opus a mode its packets must use. */
  codec: string; profile?: string; container: string; opusMode?: OpusMode;
}

const mp3 = { format: 'MP3', ext: '.mp3', encoder: 'libmp3lame', muxer: 'mp3', decoder: 'mp3float', codec: 'mp3', container: 'mp3' } as const;
const m4a = { ext: '.m4a', muxer: 'mp4', decoder: 'aac', codec: 'aac', container: 'mp4' } as const;
const opus = { encoder: 'libopus', decoder: 'libopus', codec: 'opus' } as const;
const ogg = { ext: '.opus', muxer: 'ogg', container: 'ogg' } as const;
const webm = { ext: '.webm', muxer: 'webm', container: 'webm' } as const;
const vorbis = { format: 'Vorbis (Ogg)', ext: '.ogg', encoder: 'vorbis', muxer: 'ogg', decoder: 'vorbis', codec: 'vorbis', container: 'ogg' } as const;

export const LOSSY: readonly Recipe[] = [
  { ...mp3, name: 'mp3-cbr-44k-stereo', rate: 44_100, channels: 2, options: ['-b:a', '192k'] },
  { ...mp3, name: 'mp3-vbr-24k-mono', rate: 24_000, channels: 1, options: ['-q:a', '4'] },
  { ...m4a, name: 'aac-lc-48k-stereo', format: 'AAC-LC', rate: 48_000, channels: 2, encoder: 'aac', options: ['-b:a', '160k'], profile: 'LC' },
  { ...m4a, name: 'aac-lc-44k-mono', format: 'AAC-LC', rate: 44_100, channels: 1, encoder: 'aac_at', options: ['-profile:a', '1', '-b:a', '96k'], profile: 'LC' },
  { ...m4a, name: 'he-aac-48k-stereo', format: 'HE-AAC', rate: 48_000, channels: 2, encoder: 'aac_at', options: ['-profile:a', '4', '-b:a', '64k'], profile: 'HE-AAC' },
  { ...m4a, name: 'he-aac-v2-48k-stereo', format: 'HE-AAC', rate: 48_000, channels: 2, encoder: 'aac_at', options: ['-profile:a', '28', '-b:a', '32k'], profile: 'HE-AACv2' },
  { ...opus, ...ogg, name: 'opus-ogg-48k-stereo', format: 'Opus (Ogg)', rate: 48_000, channels: 2, options: ['-b:a', '128k'], opusMode: 'CELT' },
  { ...opus, ...ogg, name: 'opus-ogg-16k-mono', format: 'Opus (Ogg)', rate: 16_000, channels: 1, options: ['-application', 'voip', '-b:a', '16k'], opusMode: 'SILK' },
  { ...opus, ...webm, name: 'opus-webm-48k-stereo', format: 'Opus (WebM)', rate: 48_000, channels: 2, options: ['-b:a', '96k'], opusMode: 'CELT' },
  { ...opus, ...webm, name: 'opus-webm-48k-mono', format: 'Opus (WebM)', rate: 48_000, channels: 1, options: ['-application', 'voip', '-b:a', '20k'], opusMode: 'hybrid' },
  { ...vorbis, name: 'vorbis-ogg-44k-stereo', rate: 44_100, channels: 2, options: ['-strict', 'experimental'] },
  { ...vorbis, name: 'vorbis-ogg-22k-stereo', rate: 22_050, channels: 2, options: ['-strict', 'experimental'] },
];

/** A fixture's label at the head of every sentence about it. */
export const label = (r: Recipe): string => `${r.name} [${r.format}]`;

/**
 * The source signal: 3 s at `rate`, 16-bit. Left: 440 Hz at 0.25 and 3,150 Hz at 0.12, a linear chirp from 100 Hz to
 * min(12 kHz, 0.45 × rate) at 0.1, seeded noise at ±0.06 from 1 s to 1.5 s, and from 2 s a 2 kHz hit at 0.3 decaying as
 * e^(−40 t). Right: 660 Hz at 0.22 (phase 0.3), 5,200 Hz at 0.1, the chirp inverted, half the noise and 0.7 of the hit.
 * Both fade in and out over 5 ms. Mono is their mean. Peaks: about 0.68 stereo, 0.44 mono.
 */
function source(rate: number, channels: 1 | 2): Buffer {
  const seconds = 3;
  const n = seconds * rate;
  const noise = seeded(503);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const f0 = 100;
  const f1 = Math.min(12_000, 0.45 * rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.005, (seconds - t) / 0.005);
    const chirp = 0.1 * Math.sin(2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * seconds)));
    const hiss = t >= 1 && t < 1.5 ? 0.06 * (2 * noise() - 1) : 0;
    const hit = t >= 2 ? 0.3 * Math.exp(-40 * (t - 2)) * Math.sin(2 * Math.PI * 2000 * (t - 2)) : 0;
    left[i] = fade * (0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 3150 * t) + chirp + hiss + hit);
    right[i] = fade * (0.22 * Math.sin(2 * Math.PI * 660 * t + 0.3) + 0.1 * Math.sin(2 * Math.PI * 5200 * t) - chirp + 0.5 * hiss + 0.7 * hit);
  }
  if (channels === 2) return wav16([left, right], rate);
  return wav16([left.map((l, i) => (l + right[i]!) / 2)], rate);
}

// ---------------------------------------------------------------------------------------------------
// FFmpeg (README: Run it). Found as DEEP_FFMPEG / DEEP_FFPROBE, on PATH, or in /opt/homebrew/bin or /usr/local/bin;
// without it, or without an encoder, decoder or muxer a recipe names, the test is BLOCKED.

export interface Tools { ffmpeg: string; ffprobe: string }

function find(name: 'ffmpeg' | 'ffprobe', env: string | undefined): string | null {
  for (const c of [env, name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

/** ffmpeg and ffprobe with every encoder, decoder and muxer the recipes name, or BLOCKED naming what is missing. */
export function fixtureTools(): Tools {
  const ffmpeg = find('ffmpeg', process.env['DEEP_FFMPEG']);
  const ffprobe = find('ffprobe', process.env['DEEP_FFPROBE']);
  if (!ffmpeg || !ffprobe) blocked('the fixtures and FFmpeg\'s reference decodes need ffmpeg and ffprobe, and none was found on PATH, /opt/homebrew/bin, /usr/local/bin or DEEP_FFMPEG/DEEP_FFPROBE. Unblock: brew install ffmpeg');
  const list = (flag: string): string => spawnSync(ffmpeg!, ['-hide_banner', flag], { encoding: 'utf8' }).stdout ?? '';
  const has = (text: string, name: string): boolean => new RegExp(`^\\s*\\S+\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm').test(text);
  const [encoders, decoders, muxers] = [list('-encoders'), list('-decoders'), list('-muxers')];
  const missing = [
    ...[...new Set([...LOSSY.map((r) => r.encoder), 'pcm_f32le'])].filter((e) => !has(encoders, e)).map((e) => `encoder ${e}`),
    ...[...new Set(LOSSY.map((r) => r.decoder))].filter((d) => !has(decoders, d)).map((d) => `decoder ${d}`),
    ...[...new Set([...LOSSY.map((r) => r.muxer), 'wav'])].filter((m) => !has(muxers, m)).map((m) => `muxer ${m}`),
  ];
  if (missing.length > 0) blocked(`${ffmpeg} lacks ${missing.join(', ')}, which the lossy fixtures and their reference decodes need (README: Fixtures). Unblock: an FFmpeg build with libmp3lame, libopus and the platform's AAC encoder, such as brew install ffmpeg on macOS`);
  return { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
}

function ffmpegRun(tools: Tools, args: string[], what: string): void {
  const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) blocked(`${what}: ffmpeg ${args.join(' ')} failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? '').slice(-1500)}`);
}
function probeJson(tools: Tools, args: string[]): JsonObject {
  return obj(JSON.parse(execFileSync(tools.ffprobe, ['-v', 'error', '-of', 'json', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })) as JsonValue, 'ffprobe\'s answer');
}

/** The Opus mode of each packet, from its TOC byte's configuration number (RFC 6716 §3.1: 0–11 SILK, 12–15 hybrid,
 * 16–31 CELT). */
function opusModes(tools: Tools, path: string): Set<OpusMode> {
  const packets = arr(probeJson(tools, ['-select_streams', 'a:0', '-show_packets', '-show_data', path])['packets'], 'ffprobe packets');
  const modes = new Set<OpusMode>();
  for (const p of packets) {
    const data = isObject(p) && typeof p['data'] === 'string' ? p['data'] : '';
    const toc = /00000000: ([0-9a-f]{2})/.exec(data);
    if (!toc) continue;
    const config = parseInt(toc[1]!, 16) >> 3;
    modes.add(config < 12 ? 'SILK' : config < 16 ? 'hybrid' : 'CELT');
  }
  return modes;
}

export interface Fixture extends Recipe { path: string; sha256: string }

/** The fixture made in `dir` by its recipe and checked by ffprobe to be what the recipe says; BLOCKED when the local
 * encoder can't make it. */
export function makeFixture(tools: Tools, r: Recipe, dir: string): Fixture {
  const src = join(dir, `${r.name}.source.wav`);
  writeFileSync(src, source(r.rate, r.channels));
  const path = join(dir, `${r.name}${r.ext}`);
  ffmpegRun(tools, ['-i', src, '-map', '0:a:0', '-c:a', r.encoder, ...r.options, '-f', r.muxer, path], `making ${label(r)}`);
  const probed = probeJson(tools, ['-select_streams', 'a:0', '-show_entries', 'stream=codec_name,profile:format=format_name', path]);
  const stream = obj(arr(probed['streams'], 'ffprobe streams')[0], `ffprobe's stream of ${r.name}`);
  const format = String(obj(probed['format'], `ffprobe's format of ${r.name}`)['format_name']);
  const gaps: string[] = [];
  if (stream['codec_name'] !== r.codec) gaps.push(`codec ${String(stream['codec_name'])}, not ${r.codec}`);
  if (r.profile && stream['profile'] !== r.profile) gaps.push(`profile ${String(stream['profile'])}, not ${r.profile}`);
  if (!format.split(',').includes(r.container)) gaps.push(`container ${format}, not ${r.container}`);
  const bytes = readFileSync(path);
  // WebM is Matroska whose EBML DocType is "webm" (element 0x4282, size 4).
  if (r.container === 'webm' && !bytes.subarray(0, 64).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) gaps.push('an EBML DocType other than webm');
  if (r.opusMode && !opusModes(tools, path).has(r.opusMode)) gaps.push(`no ${r.opusMode} packet (modes: ${[...opusModes(tools, path)].join(', ') || 'none'})`);
  if (gaps.length > 0) blocked(`the local ${r.encoder} encoder made ${label(r)} with ${gaps.join('; ')}, so this fixture can't be made here as its recipe says (README: Fixtures)`);
  return { ...r, path, sha256: sha256(bytes) };
}

/** FFmpeg's decode of a fixture, as its rate, channel count, frames and each channel's samples. */
export interface Reference { rate: number; channels: number; frames: number; samples: Float32Array[] }

/**
 * The reference (README: The reference and the bound): `ffmpeg -c:a <decoder> -i <fixture> -map 0:a:0 -c:a pcm_f32le
 * -f wav <file>`, the decoder's own output written as 32-bit float without resampling, remixing or dither. Its frames
 * start at the first sample FFmpeg keeps after the priming and end where FFmpeg's demuxer ends the stream.
 */
export function reference(tools: Tools, f: Fixture, dir: string): Reference {
  const out = join(dir, `${f.name}.reference.wav`);
  ffmpegRun(tools, ['-c:a', f.decoder, '-i', f.path, '-map', '0:a:0', '-c:a', 'pcm_f32le', '-f', 'wav', out], `FFmpeg's ${f.decoder} decode of ${label(f)}`);
  const wav = readWav(readFileSync(out), `FFmpeg's decode of ${f.name}`);
  const frames = wav.channels[0]?.length ?? 0;
  if (frames === 0) blocked(`FFmpeg's ${f.decoder} decoder gave no samples for ${label(f)}`);
  return { rate: wav.rate, channels: wav.channels.length, frames, samples: wav.channels };
}

// ---------------------------------------------------------------------------------------------------
// The run (README: The surface under test): one `deep-show run` scenario decoding every fixture with `media_decode`,
// then `workers`.

export interface Decodes { pid: number; replies: JsonObject[]; workers: Worker[]; outs: string[] }

/** `deep-show run` on `{evidence, planted?, calls}`: exit 0, one answer line, ok, one reply per call. */
export function decodeAll(bin: string, fixtures: readonly Fixture[], evidence: string, outDir: string, planted?: string): Decodes {
  const what = planted ? `deep-show run, planted ${planted}` : 'deep-show run';
  const outs = fixtures.map((f) => join(outDir, f.name));
  const calls: JsonObject[] = [...fixtures.map((f, i) => mediaDecode(f.path, outs[i]!)), workersCall()];
  const r = runRaw(bin, { evidence, ...(planted ? { planted } : {}), calls });
  expect(r.status, `${what} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what} answers the scenario ok (media_decode, workers${planted ? `, planted ${planted}` : ''}: README, The surface under test); got ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return { pid: r.pid, replies, workers: workersOf(replies[fixtures.length]!, `${what}: workers`), outs };
}

// ---------------------------------------------------------------------------------------------------
// The judgement (README: Criterion to test; The reference and the bound)

interface Judged { failures: string[]; pcm: string | null }

/** One fixture's decode in a run against FFmpeg's: every failure a sentence starting with the fixture's label; `pcm`
 * the SHA-256 of the decoded samples file. */
function judge(f: Fixture, i: number, run: Decodes, ref: Reference): Judged {
  const at = label(f);
  const reply = run.replies[i]!;
  const refused = refusalOf(reply, `${at}: media_decode`);
  if (refused) {
    const codec = isObject(reply['refused']) ? reply['refused']['codec'] : undefined;
    return { failures: [`${at}: refused ${refused.code}${typeof codec === 'string' ? ` naming codec ${codec}` : ''}, where FFmpeg decodes it`], pcm: null };
  }
  if (!isObject(reply['decoded'])) return { failures: [`${at}: media_decode answered no decoded samples: ${JSON.stringify(reply).slice(0, 400)}`], pcm: null };
  const d = decodedOf(reply, run.outs[i]!, `${at}: media_decode`);
  const failures: string[] = [];
  // In the worker: not deep-show's own process, and a decode worker that ran this decode on this file's hash.
  if (d.worker === run.pid) failures.push(`${at}: decoded in deep-show's own process ${run.pid}, not in a decode worker`);
  const w = run.workers.find((x) => x.pid === d.worker);
  if (!w) failures.push(`${at}: the process that decoded it (${d.worker}) is not among the run's workers`);
  else if (w.role !== 'decode_worker' || !w.jobs.some((j) => j.op === 'decode' && j.file === f.sha256)) failures.push(`${at}: ${describeWorker(w)} is not a decode worker that ran a decode of ${f.sha256}`);
  if (d.audio.length !== 1) return { failures: [...failures, `${at}: ${d.audio.length} decoded audio streams; FFmpeg's decode has 1`], pcm: null };
  const a = d.audio[0]!;
  if (!existsSync(a.file)) return { failures: [...failures, `${at}: the decoded samples file ${a.file} is missing`], pcm: null };
  const bytes = readFileSync(a.file);
  if (a.sample_rate !== ref.rate) failures.push(`${at}: decoded at ${a.sample_rate} Hz; FFmpeg's decode is at ${ref.rate} Hz`);
  if (a.channels !== ref.channels) failures.push(`${at}: ${a.channels} channels; FFmpeg's decode has ${ref.channels}`);
  if (bytes.length !== a.samples * a.channels * 4) failures.push(`${at}: the samples file holds ${bytes.length} bytes, not samples × channels × 4 = ${a.samples * a.channels * 4}`);
  if (a.samples !== ref.frames) failures.push(`${at}: ${a.samples} samples a channel; FFmpeg's decode has ${ref.frames} (${a.samples > ref.frames ? '+' : ''}${a.samples - ref.frames})`);
  if (a.channels === ref.channels && a.channels > 0) {
    // Sample k of ours against sample k of FFmpeg's, from each one's first sample, over the frames both have.
    const ours = f32(bytes);
    const n = Math.min(Math.floor(ours.length / a.channels), ref.frames);
    let peak = 0; let where = [0, 0]; let squares = 0; let bad: number[] | null = null;
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < a.channels; c++) {
        const x = ours[k * a.channels + c]!;
        if (!Number.isFinite(x)) { bad ??= [k, c]; continue; }
        const e = Math.abs(x - ref.samples[c]![k]!);
        squares += e * e;
        if (e > peak) { peak = e; where = [k, c]; }
      }
    }
    if (n === 0) failures.push(`${at}: no decoded sample to compare`);
    if (bad) failures.push(`${at}: sample ${bad[0]}, channel ${bad[1]} is not a finite number`);
    if (n > 0 && peak > BOUND) failures.push(`${at}: the peak per-sample difference from FFmpeg's decode is ${dbfs(peak)} (${peak.toExponential(3)} of full scale) at sample ${where[0]}, channel ${where[1]}, over the ${BOUND_DBFS} dBFS bound; RMS difference ${dbfs(Math.sqrt(squares / (n * a.channels)))}`);
  }
  return { failures, pcm: sha256(bytes) };
}

/** Every fixture's judgement in one run, and a run that lists deep-show's own process as a worker. */
export function judgeAll(fixtures: readonly Fixture[], run: Decodes, refs: readonly Reference[]): { failures: string[]; pcm: (string | null)[] } {
  const judged = fixtures.map((f, i) => judge(f, i, run, refs[i]!));
  const listed = run.workers.filter((w) => w.pid === run.pid).map((w) => `the run lists deep-show's own process as a worker: ${describeWorker(w)}`);
  return { failures: [...judged.flatMap((j) => j.failures), ...listed], pcm: judged.map((j) => j.pcm) };
}

/** A pattern for sentences about one fixture that say what failed. */
export const about = (f: Recipe, what: RegExp): RegExp => new RegExp(`^${label(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .*(?:${what.source})`);
