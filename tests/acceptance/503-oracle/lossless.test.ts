// AC4 #503.89909452, Oracle lane, lossless decoders: FFmpeg's FATE recipes (fixtures/fate/fate/{flac,alac,
// lossless-audio,caf,lavf-audio}.mak at 24e860f6d3) run on our code, each exact:
// - flac.mak and alac.mak round-trip their sources (enc_dec_pcm, oneoff with FUZZ 0): the local FFmpeg encodes the
//   recipe's source with the recipe's options, and the worker's decode must be the source's samples, by PCM hash of
//   each sample ÷ 2^(depth − 1);
// - lossless-audio.mak's fate-lossless-alac: the worker's decode of inside.m4a as s16le hashes to the vendored MD5;
// - caf.mak's fate-caf-demux: the worker's decode of caf-pcm16.caf, as the file's own big-endian s16 samples, has the
//   vendored CRC (the crc muxer's Adler-32);
// - lavf-audio.mak's aiff, wav and caf: the first second of FATE's synthetic sound written in each container as
//   lavf_audio writes it, decoded by the worker, has the vendored CRC.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC4, FULL, TIMEOUT, adler32, blocked, decodeAll, ffmpeg, lavfSecond, md5, none, referenceF32, requireMac, s16le, samples, sha256, useShow, useTemp,
  vendored, wavIntegers, type Pcm,
} from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

function make(args: string[], what: string): void {
  try { ffmpeg(['-y', ...args]); } catch (e) { blocked(`the local FFmpeg could not make ${what}: ${(e as Error).message.slice(-600)}`); }
}

const LUCKY = 'audio-reference/luckynight_2ch_44kHz_s16.wav';
const DIVERTIMENTI = 'audio-reference/divertimenti_2ch_96kHz_s24.wav';
const DRUMS = 'audio-reference/drums_2ch_44kHz_s32_wastedbits.wav';
const CHORUS = 'audio-reference/chorusnoise_2ch_44kHz_s16.wav';
/** flac.mak lines 1–25 and alac.mak lines 1–20: each test, its source and the encoder options its recipe gives. */
const ROUND_TRIPS: { test: string; source: string; codec: 'flac' | 'alac'; opts: string[] }[] = [
  ...['indep', 'left_side', 'mid_side', 'right_side'].map((m) => ({ test: `fate-flac-16-chmode-${m}`, source: LUCKY, codec: 'flac' as const, opts: ['-ch_mode', m] })),
  { test: 'fate-flac-16-fixed', source: LUCKY, codec: 'flac', opts: ['-lpc_type', 'fixed'] },
  { test: 'fate-flac-16-lpc-cholesky', source: LUCKY, codec: 'flac', opts: ['-lpc_type', 'cholesky'] },
  { test: 'fate-flac-16-lpc-levinson', source: LUCKY, codec: 'flac', opts: ['-lpc_type', 'levinson'] },
  { test: 'fate-flac-24-comp-8', source: DIVERTIMENTI, codec: 'flac', opts: ['-compression_level', '8'] },
  { test: 'fate-flac-32-wasted-bits', source: DRUMS, codec: 'flac', opts: ['-strict', 'experimental'] },
  { test: 'fate-flac-rice-params', source: CHORUS, codec: 'flac', opts: [] },
  ...[0, 1, 2].map((l) => ({ test: `fate-alac-16-level-${l}`, source: LUCKY, codec: 'alac' as const, opts: ['-compression_level', String(l)] })),
  { test: 'fate-alac-16-lpc-orders', source: LUCKY, codec: 'alac', opts: ['-min_prediction_order', '1', '-max_prediction_order', '30'] },
  ...[0, 1, 2].map((l) => ({ test: `fate-alac-24-level-${l}`, source: DIVERTIMENTI, codec: 'alac' as const, opts: ['-compression_level', String(l)] })),
  { test: 'fate-alac-24-lpc-orders', source: DIVERTIMENTI, codec: 'alac', opts: ['-min_prediction_order', '1', '-max_prediction_order', '30'] },
];

describe(`${AC4} FATE's lossless recipes on our decoders, exact`, () => {
  it(`${AC4} flac.mak and alac.mak: each recipe's source encoded with its options decodes in the worker to the source's PCM hash`, async () => {
    requireMac('the decode worker');
    const paths = await samples([LUCKY, DIVERTIMENTI, DRUMS, CHORUS]);
    const dir = temp();
    const files = ROUND_TRIPS.map((r) => {
      const path = join(dir, `${r.test}.${r.codec === 'flac' ? 'flac' : 'mov'}`);
      make(['-auto_conversion_filters', '-i', paths.get(r.source)!, '-c', r.codec, ...r.opts, '-f', r.codec === 'flac' ? 'flac' : 'mov', path], r.test);
      return { r, path };
    });
    const decoded = decodeAll(show_.bin(FULL), temp(), files.map((f) => ({ name: f.r.test, path: f.path, out: temp() })));
    const sources = new Map([LUCKY, DIVERTIMENTI, DRUMS, CHORUS].map((s) => [s, wavIntegers(readFileSync(paths.get(s)!), s)]));
    const failures: string[] = [];
    for (const { r } of files) {
      const got = decoded.get(r.test)!;
      if (typeof got === 'string') { failures.push(got); continue; }
      const ours = got as Pcm; const src = sources.get(r.source)!;
      if (ours.rate !== src.rate || ours.channels !== src.channels) failures.push(`${r.test}: ${ours.channels} channels at ${ours.rate} Hz, the source ${src.channels} at ${src.rate}`);
      const want = referenceF32(src.x, src.bits);
      if (sha256(ours.bytes) !== sha256(want)) {
        const at = ours.samples.findIndex((v, i) => i * 4 >= want.length || v !== want.readFloatLE(4 * i));
        failures.push(`${r.test}: the decode's PCM hash isn't the source's (${ours.samples.length} samples against ${want.length / 4}; first differing sample ${at})`);
      }
    }
    none(failures, 'flac.mak and alac.mak round trips through our decoders');
  }, TIMEOUT);

  it(`${AC4} lossless-audio.mak, caf.mak and lavf-audio.mak: inside.m4a to the vendored MD5, caf-pcm16.caf and the synthetic second in AIFF, WAV and CAF to the vendored CRCs`, async () => {
    requireMac('the decode worker');
    const paths = await samples(['lossless-audio/inside.m4a', 'caf/caf-pcm16.caf']);
    const md5Ref = vendored('ref/fate/lossless-alac').trim();
    const cafRef = /^CRC=(0x[0-9a-f]{8})$/m.exec(vendored('ref/fate/caf-demux'))?.[1];
    const lavfRef = (t: string): string | undefined => /CRC=(0x[0-9a-f]{8})/.exec(vendored(`ref/lavf/${t}`))?.[1];
    // The port of FATE's synthetic sound is FATE's: its first second has the reference CRC itself.
    const second = lavfSecond();
    for (const t of ['aiff', 'wav', 'caf']) expect(adler32(second), `the synthetic second's own CRC is lavf-${t}'s`).toBe(lavfRef(t));
    const dir = temp();
    const raw = join(dir, 'asynth1.sw'); writeFileSync(raw, second);
    const lavf = [['aiff', 'pcm_s16be'], ['wav', 'pcm_s16le'], ['caf', 'pcm_s16be']].map(([t, codec]) => {
      const path = join(dir, `lavf.${t!}`);
      make(['-ar', '44100', '-ac', '1', '-f', 's16le', '-i', raw, '-t', '1', '-c:a', codec!, '-f', t!, path], `lavf.${t!}`);
      return { name: `fate-lavf-${t!}`, path, out: temp() };
    });
    const decoded = decodeAll(show_.bin(FULL), temp(), [
      { name: 'fate-lossless-alac', path: paths.get('lossless-audio/inside.m4a')!, out: temp() },
      { name: 'fate-caf-demux', path: paths.get('caf/caf-pcm16.caf')!, out: temp() },
      ...lavf,
    ]);
    const failures: string[] = [];
    const pcm = (name: string): Pcm | null => { const g = decoded.get(name)!; if (typeof g === 'string') { failures.push(g); return null; } return g as Pcm; };
    const alac = pcm('fate-lossless-alac');
    if (alac && md5(s16le(alac.samples)) !== md5Ref) failures.push(`fate-lossless-alac: inside.m4a decodes to s16le with MD5 ${md5(s16le(alac.samples))}, not the reference ${md5Ref}`);
    const caf = pcm('fate-caf-demux');
    if (caf && adler32(s16le(caf.samples, true)) !== cafRef) failures.push(`fate-caf-demux: caf-pcm16.caf's samples have CRC ${adler32(s16le(caf.samples, true))}, not the reference ${String(cafRef)}`);
    for (const t of ['aiff', 'wav', 'caf']) {
      const p = pcm(`fate-lavf-${t}`);
      if (p && adler32(s16le(p.samples)) !== lavfRef(t)) failures.push(`fate-lavf-${t}: lavf.${t} decodes to CRC ${adler32(s16le(p.samples))}, not the reference ${String(lavfRef(t))}`);
    }
    none(failures, 'the lossless references through our decoders');
  }, TIMEOUT);
});
