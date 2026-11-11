// AC3 #502.ea7fce3c: "An R 128 export measures −23 LUFS ±0.2 LU at no more than −1 dBTP, adult captions stay within 20
// characters a second, and the same build on the same architecture renders identical samples"
// AC7 #502.ecdfe344: "The fixture's mix with a 12 LU LRA, exported at r128 with the limiter idle, reads LRA 12 ± 0.1 LU;
// a planted normalizer that rides gain to −23 LUFS reads under 11 LU and fails, naming lra"
// AC8 #502.6db99478: "An export with `audio.codec: pcm` whose master is Tech 3341 case 1 reads that case's integrated
// loudness on its receipt within 0.1 LU, and its decoded delivery reads the same"
//
// Through `deep-show run`'s `export` with `loudness_profile` (README: `export`). Each delivery's sound is also read
// apart from its receipt: decoded by the decode worker (`media_decode`) and measured by the loudness bake
// (`media_bake`, the meter #500's suites hold to the EBU signals), so no criterion rests on the receipt's word alone.
// AC3 exports the fixture film; its twin, a line too fast for 20 characters a second, must FAIL, naming the caption.
// AC7's film is the fixture's with no script, its music strip playing the fixture's range mix (one tone, 6 s at −26 and
// 6 s at −14 dBFS); planted: `normalizer_rides_gain`. AC8's master is seq-3341-1-16bit.wav from the EBU loudness test
// set, read from #500's cache; its twin, the same master 6 dB down, must fail this suite's judge, naming integrated.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ebuSet, type EbuSet } from '../500/bake/helpers.ts';
import {
  AC, DOC, FAST, FILM, FIXTURE, FLICKS, FULL, RATE, TIMEOUT, captionFailures, captionsOf, characters, clone, decodeCall, decodedSound, exportCall, failedIssues,
  failsNaming, fastSpecs, filesUnder, filmRun, loudnessOf, lu, masterFilm, meter, none, part, putEvidence, rangeFilm, rangeTone, receiptOf, stage,
  useFileTemp, useShow, wavFrames, within, FPS24, type JsonObject, type Readings,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('loudness');
const AAC = { video: { codec: 'h264' }, audio: { codec: 'aac' } };

/** R 128 (Loudness and caption profiles): −23.0 LUFS ± 0.2 LU, true peak at most −1 dBTP. Each failure names its measure. */
function r128Failures(r: Readings, where: string): string[] {
  const f: string[] = [];
  if (!within(r.integrated, -23, 0.2)) f.push(`integrated: ${where} reads ${lu(r.integrated)} LUFS, not −23.0 ± 0.2`);
  if (!(r.true_peak <= -1 + 1e-9)) f.push(`true_peak: ${where} reads ${lu(r.true_peak)} dBTP, above −1`);
  return f;
}

describe(`${AC[3]} an R 128 export of the fixture film is at −23 LUFS and under −1 dBTP, its adult captions within 20 characters a second, its samples the same on every run`, () => {
  it(`${AC[3]} the film exported at r128 with the netflix-en-adult captions reads −23 ± 0.2 LUFS and at most −1 dBTP on its receipt, on its receipt's delivery and by the loudness bake of its decoded MP4; each caption is within 20 characters a second; two runs give the same PCM hashes; and a twin whose line is too fast FAILs, naming the caption`, () => {
    const runs = ['first', 'second'].map((name) => {
      const evidence = temp(); const dir = temp();
      const out = join(dir, 'film.mp4');
      const [exported, decoded] = filmRun(shows.bin(FULL), evidence, stage(evidence).document, [
        exportCall({ doc: DOC.a, out, ...AAC, loudness_profile: 'r128', captions: { profile: 'netflix-en-adult', mode: 'open', files: ['srt'] } }),
        decodeCall(out, join(dir, 'sound')),
      ], `the fixture film at r128, ${name} run`);
      return { evidence, dir, receipt: receiptOf(exported!, `the r128 export, ${name} run`), decoded: decoded! };
    });
    const [a, b] = [runs[0]!, runs[1]!];
    const loud = loudnessOf(a.receipt.raw, 'the r128 export');
    expect(loud.profile, 'the receipt names its loudness profile').toBe('r128');
    const heard = meter(shows.bin(FULL), a.evidence, decodedSound(a.decoded, join(a.dir, 'sound'), 'the r128 export\'s MP4'), 'the loudness bake of the decoded MP4');
    none([...r128Failures(loud, 'the receipt, of the PCM it delivers,'), ...r128Failures(loud.delivery, 'the receipt\'s delivery'), ...r128Failures(heard, 'the loudness bake of the decoded MP4')], 'R 128');

    const captions = captionsOf(a.receipt.raw, 'the r128 export');
    expect(captions.profile, 'the captions are held to the adult profile').toBe('netflix-en-adult');
    none(captionFailures(captions.cues, FPS24), 'the export\'s captions against the fixture file');
    const fast = captions.cues.flatMap((c) => {
      const chars = characters(c.text.split('\n'));
      const seconds = (c.out - c.in) / FLICKS;
      return chars <= FIXTURE.profile.max_cps * seconds + 1e-9 ? [] : [`caption ${c.name}: ${chars} characters in ${seconds.toFixed(3)} s, ${(chars / seconds).toFixed(1)} a second, over 20`];
    });
    none(fast, 'adult captions within 20 characters a second');

    expect(a.receipt.pcm_hashes.length, 'the PCM is hashed, frame span by frame span').toBe(FILM.frames);
    const k = a.receipt.pcm_hashes.findIndex((h, i) => h !== b.receipt.pcm_hashes[i]);
    expect([k, b.receipt.pcm_hashes.length], `a second run of the same build renders identical samples${k >= 0 ? `; frame ${k}'s span differs` : ''}`).toEqual([-1, FILM.frames]);

    // The twin: `listen` says 22 characters in the time of one word, 26.4 a second once held to 5/6 s.
    const evidence = temp(); const dir = temp();
    const twin = clone(stage(evidence, fastSpecs()).document);
    part(twin, 'script', 'lines', FAST.line)['text'] = FAST.text;
    const [reply] = filmRun(shows.bin(FULL), evidence, twin, [exportCall({ doc: DOC.a, out: join(dir, 'film.mp4'), ...AAC, loudness_profile: 'r128', captions: { profile: 'netflix-en-adult', mode: 'open', files: ['srt'] } })], 'the twin whose line is too fast');
    const named = failedIssues(reply!, 'the twin\'s export').filter((i) => i['caption'] === FAST.caption);
    expect(named.map((i) => i['measure']), `the twin FAILs, naming the caption ${FAST.caption} and max_cps: ${JSON.stringify(reply).slice(0, 800)}`).toEqual(['max_cps']);
    expect(filesUnder(dir).map(([p]) => p), 'the FAILed export wrote nothing').toEqual([]);
  }, TIMEOUT);
});

/** Criterion 7's judge, on a reply to the range film's r128 export: delivered, its limiter idle, its loudness range
 * 12 ± 0.1 LU on the receipt, on the receipt's delivery and (when `heard` is given) by the bake of the decoded file.
 * Each failure names its measure. */
function rangeFailures(reply: JsonObject, heard: Readings | null): string[] {
  if (reply['outcome'] !== 'exported') {
    const issues = reply['outcome'] === 'failed' ? failedIssues(reply, 'the range film\'s export') : [];
    const named = issues.map((i) => `${String(i['measure'])}: the export FAILed: it reads ${String(i['reading'])} against ${String(i['target'])}`);
    return named.length ? named : [`the range film's export was not delivered: ${JSON.stringify(reply).slice(0, 600)}`];
  }
  const loud = loudnessOf(receiptOf(reply, 'the range film\'s export').raw, 'the range film\'s export');
  const want = FIXTURE.range_mix.lra;
  const f: string[] = [];
  if (!within(loud.integrated, -23, 0.2)) f.push(`integrated: the receipt reads ${lu(loud.integrated)} LUFS, not −23.0 ± 0.2`);
  if (loud.limiter_cut) f.push('limiter_cut: the limiter cut, and the mix is far under its ceiling');
  if (!within(loud.lra, want, 0.1)) f.push(`lra: the receipt reads ${lu(loud.lra)} LU, not ${want} ± 0.1`);
  if (!within(loud.delivery.lra, want, 0.1)) f.push(`lra: the receipt's delivery reads ${lu(loud.delivery.lra)} LU, not ${want} ± 0.1`);
  if (heard && !within(heard.lra, want, 0.1)) f.push(`lra: the loudness bake of the decoded MP4 reads ${lu(heard.lra)} LU, not ${want} ± 0.1`);
  return f;
}
const rangeAsk = (out: string): JsonObject => exportCall({ doc: DOC.a, out, ...AAC, loudness_profile: 'r128' });

describe(`${AC[7]} one static gain keeps the mix's 12 LU loudness range`, () => {
  it(`${AC[7]} the fixture's range mix, 12 LU by the loudness bake, exported at r128 with the limiter idle, reads LRA 12 ± 0.1 LU on its receipt, on its receipt's delivery and by the bake of its decoded MP4`, () => {
    const evidence = temp(); const dir = temp();
    const out = join(dir, 'range.mp4');
    const source = meter(shows.bin(FULL), evidence, { rate: RATE, channels: rangeTone() }, 'the loudness bake of the range mix');
    expect(within(source.lra, FIXTURE.range_mix.lra, 0.1), `the fixture's mix has a 12 LU loudness range before any gain: the bake reads ${lu(source.lra)} LU`).toBe(true);
    const [exported, decoded] = filmRun(shows.bin(FULL), evidence, rangeFilm(evidence).document, [rangeAsk(out), decodeCall(out, join(dir, 'sound'))], 'the range mix at r128');
    receiptOf(exported!, 'the range film\'s export');
    const heard = meter(shows.bin(FULL), evidence, decodedSound(decoded!, join(dir, 'sound'), 'the range film\'s MP4'), 'the loudness bake of the decoded MP4');
    none(rangeFailures(exported!, heard), 'the range mix at r128');
  }, TIMEOUT);

  it(`${AC[7]} a planted normalizer that rides gain to −23 LUFS reads under 11 LU and FAILs, naming lra, with nothing written`, () => {
    const evidence = temp(); const dir = temp();
    const [reply] = filmRun(shows.bin(FULL), evidence, rangeFilm(evidence).document, [rangeAsk(join(dir, 'range.mp4'))], 'the range mix at r128', 'normalizer_rides_gain');
    const lra = failedIssues(reply!, 'the planted normalizer\'s export').filter((i) => i['measure'] === 'lra');
    expect(lra.length, `the planted export FAILs, naming lra: ${JSON.stringify(reply).slice(0, 800)}`).toBe(1);
    const [reading, target] = [lra[0]!['reading'], lra[0]!['target']];
    expect(typeof reading === 'number' && reading < 11, `the planted normalizer's delivery reads under 11 LU: ${JSON.stringify(reading)}`).toBe(true);
    expect(typeof target === 'number' && within(target, FIXTURE.range_mix.lra, 0.1), `it is held to the master's own range before the gain, 12 LU: ${JSON.stringify(target)}`).toBe(true);
    failsNaming(rangeFailures(reply!, null), /^lra: /, 'the planted normalizer (normalizer_rides_gain)');
    expect(filesUnder(dir).map(([p]) => p), 'the FAILed export wrote nothing').toEqual([]);
  }, TIMEOUT);
});

let set: EbuSet | string = 'BLOCKED: the EBU set was not read';
beforeAll(async () => { set = await ebuSet(); }, TIMEOUT);
/** Tech 3341 case 1: a 1 kHz stereo sine at −23 dBFS for 20 s, whose integrated loudness is −23.0 LUFS. */
const CASE1 = { file: 'seq-3341-1-16bit.wav', integrated: -23.0 } as const;
const EBU_LICENSE: JsonObject = { id: 'LicenseRef-EBU-loudness-test-set-v05', terms: 'Provided by the EBU as is, for technical testing purposes only.', shareable: false, credit: 'EBU loudness test set v05' };

/** One PCM export of a film whose master is case 1 (`gain` dB down for the twin): the receipt's reading, its
 * delivery's and the loudness bake's of the decoded file, each against the case's −23.0 ± 0.1. */
function case1Failures(gain?: number): string[] {
  if (typeof set === 'string') expect.fail(set);
  const evidence = temp(); const dir = temp();
  const bytes = set.file(CASE1.file);
  const out = join(dir, 'case1.mp4');
  const what = `the PCM export of ${CASE1.file}${gain === undefined ? '' : ` at ${gain} dB`}`;
  const [exported, decoded] = filmRun(shows.bin(FULL), evidence, masterFilm(putEvidence(evidence, bytes), wavFrames(bytes), EBU_LICENSE, gain), [
    exportCall({ doc: DOC.a, out, video: { codec: 'h264' }, audio: { codec: 'pcm' } }), decodeCall(out, join(dir, 'sound')),
  ], what);
  const loud = loudnessOf(receiptOf(exported!, what).raw, what);
  expect(loud.profile, 'with no loudness_profile the receipt names none, and still carries the readings').toBe('none');
  const heard = meter(shows.bin(FULL), evidence, decodedSound(decoded!, join(dir, 'sound'), what), 'the loudness bake of the decoded file');
  const f: string[] = [];
  const hold = (v: number, where: string): void => { if (!within(v, CASE1.integrated, 0.1)) f.push(`integrated: ${where} reads ${lu(v)} LUFS, not case 1's ${CASE1.integrated.toFixed(1)} ± 0.1`); };
  hold(loud.integrated, 'the receipt');
  hold(loud.delivery.integrated, 'the receipt\'s delivery');
  hold(heard.integrated, 'the loudness bake of the decoded file');
  if (!within(loud.delivery.integrated, loud.integrated, 0.01)) f.push(`integrated: the decoded delivery reads ${lu(loud.delivery.integrated)} LUFS and the receipt ${lu(loud.integrated)}: not the same`);
  return f;
}

describe(`${AC[8]} a PCM export whose master is Tech 3341 case 1 reads −23.0 LUFS on its receipt and on its decoded delivery`, () => {
  it(`${AC[8]} ${CASE1.file} as the master, exported with audio.codec pcm, reads −23.0 ± 0.1 LUFS on the receipt, the same on its decoded delivery, and by the loudness bake of the decoded file; the same master 6 dB down fails, naming integrated`, () => {
    none(case1Failures(), 'case 1\'s integrated loudness');
    failsNaming(case1Failures(-6), /^integrated: the receipt reads -2[89]\.\d+ LUFS/, 'the twin 6 dB down');
  }, TIMEOUT);
});
