// AC4 #503.89909452, Oracle lane, containers: what FATE's Matroska and Ogg recipes hold of Opus and Vorbis
// (fixtures/fate/fate/matroska.mak lines 216 and 220, ogg-opus.mak line 3, ogg-vorbis.mak lines 3 and 15, at
// 24e860f6d3): Opus codec delay kept through Matroska (WebM's container) and Ogg, chained Ogg streams, and Vorbis
// timestamps across pages after the encoder delay. Those recipes print demuxer metadata (packets, initial padding,
// stream tags), which our worker doesn't answer; what they protect reaches the decoded sound, so each sample is held
// here as criterion 4 holds a lossy file: the worker's decode has FFmpeg's decode's rate, channels and length, sample
// for sample within −90 dBFS. The vendored matroska-opus-remux reference fixes the codec delay the first sample holds
// (312 samples), which FFmpeg's own probe of the file is checked against first.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AC4, FULL, LOSSY_DBFS, TIMEOUT, decodeAll, ffmpegPcm, ffmpegTools, none, peakDb, requireMac, samples, useShow, useTemp, vendored, type Pcm,
} from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

const CASES = [
  { test: 'fate-matroska-opus-remux', sample: 'mkv/codec_delay_opus.mkv' },
  { test: 'fate-matroska-ogg-opus-remux', sample: 'ogg/intro-partial.opus' },
  { test: 'fate-ogg-opus-chained-meta', sample: 'ogg-opus/chained-meta.ogg' },
  { test: 'fate-ogg-vorbis-chained-meta', sample: 'ogg-vorbis/chained-meta.ogg' },
  { test: 'fate-ogg-vorbis-ts-offset', sample: 'ogg-vorbis/tos.ogg' },
];

describe(`${AC4} FATE's Matroska and Ogg recipes for Opus and Vorbis, on our demuxers and decoders`, () => {
  it(`${AC4} Opus codec delay in Matroska and Ogg, chained Ogg Opus and Vorbis, and Vorbis after its encoder delay decode to FFmpeg's decode, length for length, within −90 dBFS`, async () => {
    requireMac('the decode worker');
    const paths = await samples(CASES.map((c) => c.sample));
    // The reference's codec delay, and FFmpeg's own reading of the same file.
    const padding = /initial_padding=(\d+)/.exec(vendored('ref/fate/matroska-opus-remux'))?.[1];
    expect(padding, 'the vendored matroska-opus-remux reference states the stream\'s initial padding').toBe('312');
    const probed = execFileSync(ffmpegTools().ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=initial_padding', '-of', 'default=nw=1:nk=1', paths.get('mkv/codec_delay_opus.mkv')!], { encoding: 'utf8' }).trim();
    expect(probed, 'FFmpeg reads the same 312 samples of codec delay in codec_delay_opus.mkv').toBe(padding);
    const decoded = decodeAll(show_.bin(FULL), temp(), CASES.map((c) => ({ name: c.test, path: paths.get(c.sample)!, out: temp() })));
    const failures: string[] = [];
    for (const c of CASES) {
      const got = decoded.get(c.test)!;
      if (typeof got === 'string') { failures.push(got); continue; }
      const ours = got as Pcm; const ref = ffmpegPcm(paths.get(c.sample)!);
      if (ours.rate !== ref.rate || ours.channels !== ref.channels || ours.frames !== ref.frames) {
        failures.push(`${c.test} (${c.sample}): ${ours.frames} frames of ${ours.channels} channels at ${ours.rate} Hz, FFmpeg's decode ${ref.frames} of ${ref.channels} at ${ref.rate}`);
        continue;
      }
      const peak = peakDb(ours.samples, ref.samples);
      if (!(peak <= LOSSY_DBFS)) failures.push(`${c.test} (${c.sample}): the peak difference from FFmpeg's decode is ${peak.toFixed(2)} dBFS, above ${LOSSY_DBFS} dBFS`);
    }
    none(failures, 'the Matroska and Ogg recipes\' samples through our decoders');
  }, TIMEOUT);
});
