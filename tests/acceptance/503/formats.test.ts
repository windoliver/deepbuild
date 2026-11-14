// AC4 #503.89909452: "Each listed audio format decodes in the worker on macOS to PCM hashes equal to the reference
// decode for lossless formats and within −90 dBFS of FFmpeg's decode for lossy ones, and a file in an unlisted format
// is refused, naming its codec"
//
// Through `deep-show run`'s `media_decode` (#498's decode worker). The listed formats are the Scope's: WAV, AIFF, CAF,
// MP3, AAC-LC and HE-AAC, ALAC, FLAC, Opus (Ogg, WebM) and Vorbis (Ogg). Every file is made here by the local FFmpeg.
// Lossless: the reference decode is the integer PCM this suite wrote, each sample ÷ 2^(depth − 1) as f32 (Decode
// worker), checked first against FFmpeg's own decode of the file; the hash is SHA-256 of the interleaved little-endian
// f32, the bytes `media_decode` writes. Lossy: FFmpeg's decode of the same file, f32, at the stream's own rate, against
// ours sample for sample: the peak difference at or below −90 dBFS (README: Readings). The upstream recipes for this
// criterion are in tests/acceptance/503-oracle/.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LOSSY_DBFS, TIMEOUT, blocked, decodeCall, decodedPcm, encodersMissing, ffmpeg, ffmpegPcm, integerPcm, isObject, lossySource, none,
  obj, arr, peakDb, probeAudio, rawPcm, referencePcm, requireMac, runShowPid, scenario, sha256, show, str, useShow, useTemp, workerPid,
  type JsonObject,
} from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

/** Makes a fixture with the local FFmpeg; a tool that can't is a missing platform need. */
function make(args: string[], input: Buffer | undefined, what: string): void {
  try { ffmpeg(['-y', ...args], input); } catch (e) { blocked(`the local FFmpeg could not make ${what}: ${(e as Error).message.slice(-600)}`); }
}

interface Lossless { name: string; file: string; depth: 8 | 16 | 24; channels: number; rate: number; codec: string; out: string[] }
const LOSSLESS: Lossless[] = [
  { name: 'WAV 8-bit', file: 'u8.wav', depth: 8, channels: 1, rate: 22_050, codec: 'pcm_u8', out: ['-c:a', 'pcm_u8', '-f', 'wav'] },
  { name: 'WAV 16-bit', file: 's16.wav', depth: 16, channels: 2, rate: 44_100, codec: 'pcm_s16le', out: ['-c:a', 'pcm_s16le', '-f', 'wav'] },
  { name: 'WAV 24-bit', file: 's24.wav', depth: 24, channels: 2, rate: 48_000, codec: 'pcm_s24le', out: ['-c:a', 'pcm_s24le', '-f', 'wav'] },
  { name: 'AIFF 16-bit', file: 's16.aiff', depth: 16, channels: 2, rate: 44_100, codec: 'pcm_s16be', out: ['-c:a', 'pcm_s16be', '-f', 'aiff'] },
  { name: 'AIFF 24-bit', file: 's24.aiff', depth: 24, channels: 2, rate: 48_000, codec: 'pcm_s24be', out: ['-c:a', 'pcm_s24be', '-f', 'aiff'] },
  { name: 'CAF 16-bit', file: 's16.caf', depth: 16, channels: 2, rate: 44_100, codec: 'pcm_s16be', out: ['-c:a', 'pcm_s16be', '-f', 'caf'] },
  { name: 'CAF 24-bit', file: 's24.caf', depth: 24, channels: 1, rate: 96_000, codec: 'pcm_s24le', out: ['-c:a', 'pcm_s24le', '-f', 'caf'] },
  { name: 'ALAC 16-bit', file: 's16-alac.m4a', depth: 16, channels: 2, rate: 44_100, codec: 'alac', out: ['-c:a', 'alac', '-f', 'mp4'] },
  { name: 'ALAC 24-bit', file: 's24-alac.m4a', depth: 24, channels: 2, rate: 48_000, codec: 'alac', out: ['-c:a', 'alac', '-f', 'mp4'] },
  { name: 'FLAC 16-bit', file: 's16.flac', depth: 16, channels: 2, rate: 44_100, codec: 'flac', out: ['-c:a', 'flac', '-f', 'flac'] },
  { name: 'FLAC 24-bit', file: 's24.flac', depth: 24, channels: 2, rate: 96_000, codec: 'flac', out: ['-c:a', 'flac', '-f', 'flac'] },
];
const RAW = { 8: ['u8', 'pcm_u8'], 16: ['s16le', 'pcm_s16le'], 24: ['s24le', 'pcm_s24le'] } as const;

interface Lossy { name: string; file: string; codec: string; profile?: string; encoder: string; out: string[] }
/** HE-AAC is AudioToolbox's encoder at profile 4 (AAC HE, SBR); FFmpeg's own AAC encoder makes only AAC-LC. */
const LOSSY: Lossy[] = [
  { name: 'MP3', file: 'a.mp3', codec: 'mp3', encoder: 'libmp3lame', out: ['-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3'] },
  { name: 'AAC-LC', file: 'lc.m4a', codec: 'aac', profile: 'LC', encoder: 'aac', out: ['-c:a', 'aac', '-b:a', '192k', '-f', 'mp4'] },
  { name: 'HE-AAC', file: 'he.m4a', codec: 'aac', profile: 'HE-AAC', encoder: 'aac_at', out: ['-c:a', 'aac_at', '-profile:a', '4', '-b:a', '64k', '-f', 'mp4'] },
  { name: 'Opus (Ogg)', file: 'a.opus', codec: 'opus', encoder: 'libopus', out: ['-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg'] },
  { name: 'Opus (WebM)', file: 'a.webm', codec: 'opus', encoder: 'libopus', out: ['-c:a', 'libopus', '-b:a', '128k', '-f', 'webm'] },
  { name: 'Vorbis (Ogg)', file: 'a.ogg', codec: 'vorbis', encoder: 'vorbis', out: ['-c:a', 'vorbis', '-strict', 'experimental', '-f', 'ogg'] },
];

/** Every file decoded by the worker in one `deep-show run`: its PCM and the worker's pid, and deep-show's own. */
function decodeAll(paths: string[], what: string): { replies: JsonObject[]; outs: string[]; pid: number } {
  const outs = paths.map(() => temp());
  const { replies, pid } = runShowPid(show_.bin(FULL), scenario(temp(), paths.map((p, i) => decodeCall(p, outs[i]!))), what);
  return { replies, outs, pid };
}

describe(`${AC[4]} our own decoders for the listed audio formats`, () => {
  it(`${AC[4]} each lossless format (WAV, AIFF, CAF, ALAC, FLAC at 16 and 24 bits, WAV at 8) decodes in the worker to the PCM hash of the reference decode`, () => {
    requireMac('the decode worker');
    const missing = encodersMissing(['flac', 'alac', 'pcm_u8', 'pcm_s16be', 'pcm_s24be', 'pcm_s24le']);
    if (missing) blocked(missing);
    const dir = temp();
    const made = LOSSLESS.map((f, k) => {
      const frames = Math.round(1.5 * f.rate);
      const x = integerPcm(f.depth, f.channels, frames, 5030 + k);
      const raw = rawPcm(x, f.depth);
      const rawPath = join(dir, `${f.file}.raw`); writeFileSync(rawPath, raw);
      const path = join(dir, f.file);
      const [fmt, codec] = RAW[f.depth];
      make(['-f', fmt, '-ar', String(f.rate), '-ac', String(f.channels), '-i', rawPath, ...f.out, path], undefined, f.name);
      // The fixture is what it says: its codec and depth, and FFmpeg decodes it back to the very samples written.
      const p = probeAudio(path);
      expect(str(p['codec_name'], `${f.name}: codec`), `${f.name}: the file's codec`).toBe(f.codec);
      if (f.codec === 'flac' || f.codec === 'alac') expect(Number(p['bits_per_raw_sample']), `${f.name}: ${f.depth}-bit samples`).toBe(f.depth);
      expect(sha256(ffmpeg(['-i', path, '-c:a', codec, '-f', fmt, '-'])), `${f.name}: FFmpeg decodes the file to the samples written`).toBe(sha256(raw));
      return { f, path, frames, ref: referencePcm(x, f.depth) };
    });
    const { replies, outs, pid } = decodeAll(made.map((m) => m.path), 'the lossless files');
    const failures: string[] = [];
    made.forEach((m, i) => {
      const what = m.f.name;
      const reply = replies[i]!;
      if (typeof reply['code'] === 'string' || typeof reply['error'] === 'string') { failures.push(`${what}: the decode is refused: ${show(reply, 400)}`); return; }
      const w = workerPid(reply, what);
      if (!(w > 0 && w !== pid)) failures.push(`${what}: decoded by pid ${w}, not a worker apart from deep-show (pid ${pid})`);
      const pcm = decodedPcm(reply, outs[i]!, what);
      if (pcm.rate !== m.f.rate || pcm.channels !== m.f.channels || pcm.frames !== m.frames) failures.push(`${what}: ${pcm.frames} frames of ${pcm.channels} channels at ${pcm.rate} Hz, not ${m.frames} of ${m.f.channels} at ${m.f.rate}`);
      const got = sha256(pcm.bytes); const want = sha256(m.ref);
      if (got !== want) {
        const at = pcm.samples.findIndex((s, k) => k * 4 >= m.ref.length || s !== m.ref.readFloatLE(4 * k));
        failures.push(`${what}: its PCM hashes to ${got}, the reference decode to ${want}; first differing sample ${at}: ${pcm.samples[at]} against ${at >= 0 && at * 4 < m.ref.length ? m.ref.readFloatLE(4 * at) : 'none'}`);
      }
    });
    none(failures, 'every lossless format at the reference decode\'s PCM hash');
  }, TIMEOUT);

  it(`${AC[4]} each lossy format (MP3, AAC-LC, HE-AAC, Opus in Ogg and WebM, Vorbis in Ogg) decodes in the worker within −90 dBFS of FFmpeg's decode`, () => {
    requireMac('the decode worker');
    const missing = encodersMissing([...new Set(LOSSY.map((l) => l.encoder))]);
    if (missing) blocked(missing);
    const dir = temp();
    const src = join(dir, 'source.f32'); writeFileSync(src, lossySource());
    const made = LOSSY.map((l) => {
      const path = join(dir, l.file);
      make(['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', src, ...l.out, path], undefined, l.name);
      const p = probeAudio(path);
      expect(str(p['codec_name'], `${l.name}: codec`), `${l.name}: the file's codec`).toBe(l.codec);
      if (l.profile) expect(p['profile'], `${l.name}: the AAC profile`).toBe(l.profile);
      const ref = ffmpegPcm(path);
      // The fixture can tell a right decode from a wrong one: it isn't silence, and FFmpeg's own decode one sample
      // late is beyond the bound.
      expect(peakDb(ref.samples, new Float32Array(ref.samples.length)), `${l.name}: FFmpeg's decode is sound, not silence`).toBeGreaterThan(-30);
      expect(peakDb(ref.samples, ref.samples, ref.channels), `${l.name}: FFmpeg's decode one sample late is beyond ${LOSSY_DBFS} dBFS`).toBeGreaterThan(LOSSY_DBFS);
      return { l, path, ref };
    });
    const { replies, outs, pid } = decodeAll(made.map((m) => m.path), 'the lossy files');
    const failures: string[] = [];
    made.forEach((m, i) => {
      const what = m.l.name;
      const reply = replies[i]!;
      if (typeof reply['code'] === 'string' || typeof reply['error'] === 'string') { failures.push(`${what}: the decode is refused: ${show(reply, 400)}`); return; }
      const w = workerPid(reply, what);
      if (!(w > 0 && w !== pid)) failures.push(`${what}: decoded by pid ${w}, not a worker apart from deep-show (pid ${pid})`);
      const pcm = decodedPcm(reply, outs[i]!, what);
      if (pcm.rate !== m.ref.rate || pcm.channels !== m.ref.channels || pcm.frames !== m.ref.frames) {
        failures.push(`${what}: ${pcm.frames} frames of ${pcm.channels} channels at ${pcm.rate} Hz, FFmpeg's decode ${m.ref.frames} of ${m.ref.channels} at ${m.ref.rate}`);
        return;
      }
      const peak = peakDb(pcm.samples, m.ref.samples);
      console.log(`${AC[4]}: ${what}: peak difference from FFmpeg's decode ${peak.toFixed(2)} dBFS`);
      if (!(peak <= LOSSY_DBFS)) failures.push(`${what}: the peak difference from FFmpeg's decode is ${peak.toFixed(2)} dBFS, above ${LOSSY_DBFS} dBFS`);
    });
    none(failures, `every lossy format within ${LOSSY_DBFS} dBFS of FFmpeg's decode`);
  }, TIMEOUT);

  it(`${AC[4]} a file in an unlisted format (AC-3 in MP4) is refused, naming its codec`, () => {
    requireMac('the decode worker');
    const missing = encodersMissing(['ac3']);
    if (missing) blocked(missing);
    const dir = temp();
    const src = join(dir, 'source.f32'); writeFileSync(src, lossySource());
    const path = join(dir, 'ac3.mp4');
    make(['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', src, '-c:a', 'ac3', '-b:a', '192k', '-f', 'mp4', path], undefined, 'the AC-3 file');
    expect(str(probeAudio(path)['codec_name'], 'AC-3: codec'), 'the fixture is AC-3').toBe('ac3');
    const out = temp();
    const { replies } = runShowPid(show_.bin(FULL), scenario(temp(), [{ call: 'media_import', path }, decodeCall(path, out)]), 'the AC-3 file');
    const [imported, decoded] = replies;
    expect(decoded!['code'], `the decode is refused unsupported_codec: ${show(decoded)}`).toBe('unsupported_codec');
    const named = str(decoded!['codec'], 'the refusal names the codec (codec)');
    expect(/^ac-?3$/i.test(named), `the refusal names AC-3, got ${named}`).toBe(true);
    // In the probe's own words: when the import answers a probe, the refusal names the codec as the probe does.
    const probe = isObject(imported) && isObject(imported['asset']) && isObject(imported['asset']['probe']) ? imported['asset']['probe'] : null;
    if (probe) {
      const audio = arr(probe['streams'], 'the probe: streams').map((s, i) => obj(s, `the probe: streams[${i}]`)).find((s) => s['type'] === 'audio');
      expect(audio && audio['codec'], 'the refusal names the codec in the probe\'s words').toBe(named);
    } else {
      expect(imported!['code'], `with no probe, the import is refused unsupported_codec too: ${show(imported)}`).toBe('unsupported_codec');
    }
  }, TIMEOUT);
});
