// AC4 #503.89909452, Oracle lane, lossy decoders: FFmpeg's FATE recipes (fixtures/fate/fate/{aac,mp3,opus,vorbis}.mak
// at 24e860f6d3) run on our code. Each recipe decodes a conformance stream and compares the decode with its reference
// decode by tiny_psnr under a stated bound; here the decode is the worker's (`media_decode`), converted as the recipe's
// command writes its output (`pcm`: s16le; mp3: f32le after `atrim`; opus: s16le), and compared with the same reference
// under the same bound (README: How a recipe maps onto our output).
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  AC4, FULL, TIMEOUT, decodeAll, f32le, none, recipeFailures, requireMac, s16le, samples, useShow, useTemp, type Pcm, type Recipe,
} from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

interface Case { recipe: Recipe; sample: string; ref: string; endSample?: number }
/** Runs each case's sample through the worker and compares as its recipe does; every failure names its recipe. */
async function run(cases: Case[]): Promise<string[]> {
  requireMac('the decode worker');
  const paths = await samples(cases.flatMap((c) => [c.sample, c.ref]));
  const pcm = decodeAll(show_.bin(FULL), temp(), cases.map((c) => ({ name: c.recipe.test, path: paths.get(c.sample)!, out: temp() })));
  const failures: string[] = [];
  for (const c of cases) {
    const got = pcm.get(c.recipe.test)!;
    if (typeof got === 'string') { failures.push(got); continue; }
    const p = got as Pcm;
    const x = c.endSample === undefined ? p.samples : p.samples.subarray(0, c.endSample * p.channels);
    failures.push(...recipeFailures(c.recipe, readFileSync(paths.get(c.ref)!), c.recipe.unit === 'f32' ? f32le(x) : s16le(x)));
  }
  return failures;
}

const aac = (test: string, sample: string, ref: string): Case => ({ recipe: { test, cmp: 'oneoff', unit: 's16', fuzz: 2, target: 0, sizeTolerance: 0 }, sample, ref });
const mp3 = (test: string, sample: string, ref: string, endSample?: number): Case =>
  ({ recipe: { test, cmp: 'oneoff', unit: 'f32', fuzz: 18, target: 0, sizeTolerance: 0 }, sample, ref, ...(endSample === undefined ? {} : { endSample }) });
const opus = (test: string, sample: string, ref: string, target: number): Case => ({ recipe: { test, cmp: 'stddev', unit: 's16', fuzz: 3, target, sizeTolerance: 0 }, sample, ref });
const vorbis = (test: string, sample: string, ref: string, fuzz = 1): Case => ({ recipe: { test, cmp: 'oneoff', unit: 's16', fuzz, target: 0, sizeTolerance: 0 }, sample, ref });

describe(`${AC4} FATE's lossy decoder recipes on our decoders`, () => {
  it(`${AC4} aac.mak: AAC-LC and HE-AAC (SBR, PS) conformance streams within one-off 2 of their reference decodes`, async () => {
    none(await run([
      aac('fate-aac-al04_44', 'aac/al04_44.mp4', 'aac/al04_44.s16'),
      aac('fate-aac-al05_44', 'aac/al05_44.mp4', 'aac/al05_44.s16'),
      aac('fate-aac-al_sbr_hq_cm_48_2', 'aac/al_sbr_cm_48_2.mp4', 'aac/al_sbr_hq_cm_48_2.s16'),
      aac('fate-aac-al_sbr_hq_sr_48_2_fsaac48', 'aac/al_sbr_sr_48_2_fsaac48.mp4', 'aac/al_sbr_hq_sr_48_2_fsaac48.s16'),
      aac('fate-aac-al_sbr_ps_06_ur', 'aac/al_sbr_ps_06_new.mp4', 'aac/al_sbr_ps_06_ur.s16'),
      aac('fate-aac-ct-sbr_i-ps_i.mp4', 'aac/CT_DecoderCheck/sbr_i-ps_i.mp4', 'aac/CT_DecoderCheck/aacPlusv2.wav'),
    ]), 'aac.mak on our AAC decoder');
  }, TIMEOUT);

  it(`${AC4} mp3.mak: MP3 conformance bitstreams within one-off 18 (f32) of their reference decodes`, async () => {
    none(await run([
      mp3('fate-mp3-float-conf-compl', 'mp3-conformance/compl.bit', 'mp3-conformance/compl.f32'),
      mp3('fate-mp3-float-conf-he_48khz', 'mp3-conformance/he_48khz.bit', 'mp3-conformance/he_48khz.f32', 171_648),
      mp3('fate-mp3-float-conf-si', 'mp3-conformance/si.bit', 'mp3-conformance/si.f32', 134_784),
    ]), 'mp3.mak on our MP3 decoder');
  }, TIMEOUT);

  it(`${AC4} opus.mak: RFC 8251 test vectors (CELT, SILK, hybrid) in Matroska within their stddev bounds of the reference decodes`, async () => {
    none(await run([
      opus('fate-opus-testvector01', 'opus/testvector01.mka', 'opus/testvector01.dec', 0),
      opus('fate-opus-testvector02', 'opus/testvector02.mka', 'opus/testvector02.dec', 191),
      opus('fate-opus-testvector05', 'opus/testvector05.mka', 'opus/testvector05_v2.dec', 108),
      opus('fate-opus-testvector11', 'opus/testvector11.mka', 'opus/testvector11.dec', 0),
    ]), 'opus.mak on our Opus decoder');
  }, TIMEOUT);

  it(`${AC4} vorbis.mak: Vorbis test files in Ogg within one-off 1 (2 for moog) of their reference decodes`, async () => {
    none(await run([
      vorbis('fate-vorbis-1', 'vorbis/1.0.1-test_small.ogg', 'vorbis/1.0.1-test_small.pcm'),
      vorbis('fate-vorbis-7', 'vorbis/highrate-test_small.ogg', 'vorbis/highrate-test_small.pcm'),
      vorbis('fate-vorbis-12', 'vorbis/mono_small.ogg', 'vorbis/mono_small.pcm'),
      vorbis('fate-vorbis-13', 'vorbis/moog_small.ogg', 'vorbis/moog_small.pcm', 2),
    ]), 'vorbis.mak on our Vorbis decoder');
  }, TIMEOUT);
});
