// AC5 #157.77edcbb0: "A streaming export at −14.0 LUFS whose AAC delivery reads −0.7 dBTP fails with both numbers, and the
// corrected export passes on the PCM and on the decoded file"
// AC11 #157.966e730a: "An r128 export of a 60 s film whose loudest 3 s sit 7 LU above its integrated loudness fails at
// −23 LUFS, naming max_s (−16.0 LUFS) and its time, and the same film with that passage 4.5 LU above passes; a caption
// that would end 6 frames before a cut at 24 fps ends 2 frames before it; and two captions 5 frames apart are chained to
// a 2-frame gap"
//
// Through `deep-show run`'s `export` with `loudness_profile` and `captions` (#502's request and receipt fields:
// `integrated`, `max_s`, `true_peak`, `delivery`, `captions.cues`), and #502's readers: the decode worker decodes the
// delivered MP4 and the loudness bake measures it, apart from the receipt. A FAIL's issue is #502's: `{measure,
// reading, target, on, …}`, and AC11's adds `at`, the time of the loudest short-term window. Films: #502's `masterFilm`
// (64 × 64 at 24 fps, one sound file on the master at unity) for the loudness legs; the fixture film (helpers.ts
// `filmDoc`) with two shots, a cut at 5 s and three caption-only lines for the caption legs. Planted:
// `limiter_without_codec_margin`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captionsOf, decodeCall, decodedSound, loudnessOf, lu, masterFilm, meter, within, type Readings } from '../502/helpers.ts';
import {
  AC, CC0, FLICKS, FULL, H264_AAC, TIMEOUT, exportCall, failsNaming, filmDoc, filmRun, floatWav, frameFlicks, isObject, issueLines, leftIn, none,
  putEvidence, receiptOf, seeded, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SR = 48_000;

/** The streaming profile on one reading: −14.0 ± 1.0 LU, true peak at most −1.0 dBTP, or −2.0 above −14.0 LUFS. */
function streamingFailures(r: Readings, where: string): string[] {
  const f: string[] = [];
  if (!within(r.integrated, -14, 1)) f.push(`integrated: ${where} reads ${lu(r.integrated)} LUFS, not −14.0 ± 1.0`);
  const limit = r.integrated > -14.0 ? -2.0 : -1.0;
  if (!(r.true_peak <= limit + 1e-9)) f.push(`true_peak: ${where} reads ${r.true_peak.toFixed(2)} dBTP against ${limit.toFixed(1)}`);
  return f;
}
/** Twenty seconds of stereo noise (σ 0.08, seeded) with a 1 ms 4 kHz burst at 0.9 every 100 ms: loud enough at
 * −14 LUFS for the bursts to reach the limiter, and sharp enough that the AAC coder overshoots them. */
function noise(): Float32Array[] {
  const next = seeded(157);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return [0, 1].map(() => {
    const x = new Float32Array(20 * SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.08 * gauss();
    for (let t = 0; t + 48 < x.length; t += SR / 10) for (let i = 0; i < 48; i++) x[t + i] = 0.9 * Math.sin((2 * Math.PI * 4000 * i) / SR);
    return x;
  });
}
/** The streaming export's judge: delivered, and the receipt, its `delivery` and the bake of the decoded MP4 each in
 * the profile. A FAIL's issues become failures `<measure>: the <on> reads <reading> against <target>`. */
function streamingRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'streaming.mp4');
  const sha = putEvidence(evidence, floatWav(noise(), SR));
  const [exported, decoded] = filmRun(shows.bin(FULL), evidence, masterFilm(sha, 20 * SR, CC0), [
    exportCall({ out, ...H264_AAC, loudness_profile: 'streaming' }), decodeCall(out, join(dir, 'sound')),
  ], 'the noise film at streaming', planted);
  if (exported!['outcome'] !== 'exported') {
    const issues = (Array.isArray(exported!['issues']) ? exported!['issues'] : []).filter(isObject);
    const f = issues.map((i) => `${String(i['measure'])}: the ${String(i['on'])} reads ${typeof i['reading'] === 'number' ? i['reading'].toFixed(2) : String(i['reading'])} dBTP against ${String(i['target'])}`);
    if (leftIn(dir).length) f.push(`the FAILed export left ${leftIn(dir).join(', ')}`);
    return f.length ? f : [`the export wasn't delivered: ${issueLines(exported!).join(' | ').slice(0, 800)}`];
  }
  const loud = loudnessOf(receiptOf(exported!, 'the streaming export').raw, 'the streaming export');
  expect(loud.profile, 'the receipt names its profile').toBe('streaming');
  const heard = meter(shows.bin(FULL), evidence, decodedSound(decoded!, join(dir, 'sound'), 'the streaming MP4'), 'the loudness bake of the decoded MP4');
  return [...streamingFailures(loud, 'the receipt, of the PCM it delivers,'), ...streamingFailures(loud.delivery, 'the delivery'), ...streamingFailures(heard, 'the loudness bake of the decoded MP4')];
}

describe(`${AC[5]} the streaming profile holds after the codec`, () => {
  it(`${AC[5]} the export at streaming reads −14.0 ± 1.0 LUFS and at most −1.0 dBTP (−2.0 above −14.0) on the PCM, on its delivery and by the loudness bake of the decoded MP4`, () => {
    none(streamingRun(), 'the streaming profile');
  }, TIMEOUT);

  it(`${AC[5]} a planted limiter with no codec margin lets the AAC delivery read over −1.0 dBTP, and the export FAILs with both numbers`, () => {
    failsNaming(streamingRun('limiter_without_codec_margin'), /^true_peak: the delivery reads -0\.\d\d dBTP against -1\b/, 'the planted limiter (limiter_without_codec_margin)');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC11: the short-form r128 maximum

/** The gain of the loudest 3 s over the rest that puts them `over` LU above the whole 60 s film's integrated
 * loudness: x = 10^(d/10) with x ÷ ((57 + 3x) ÷ 60) = 10^(over/10). */
const passageGain = (over: number): number => { const r = 10 ** (over / 10); return 10 * Math.log10((57 * r) / (60 - 3 * r)); };
/** 60 s of a 1 kHz sine on both channels at 0.05, the 3 s from 30 s `d` dB louder. */
function passage(over: number): Float32Array[] {
  const g = 10 ** (passageGain(over) / 20);
  const x = new Float32Array(60 * SR);
  for (let i = 0; i < x.length; i++) x[i] = (i >= 30 * SR && i < 33 * SR ? g : 1) * 0.05 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  return [x, Float32Array.from(x)];
}
function r128Run(over: number): { reply: JsonObject; dir: string } {
  const evidence = temp(); const dir = temp();
  const sha = putEvidence(evidence, floatWav(passage(over), SR));
  const [reply] = filmRun(shows.bin(FULL), evidence, masterFilm(sha, 60 * SR, CC0), [exportCall({ out: join(dir, 'r128.mp4'), ...H264_AAC, loudness_profile: 'r128' })], `the 60 s film, its loudest 3 s ${over} LU over`);
  return { reply: reply!, dir };
}

describe(`${AC[11]} r128 holds a short programme's short-term maximum, and captions keep the timing rules at cuts and gaps`, () => {
  it(`${AC[11]} the 60 s film whose loudest 3 s sit 7 LU over its integrated loudness FAILs at −23 LUFS naming max_s (−16.0 LUFS) and its time; with that passage 4.5 LU over it is delivered`, () => {
    const loud = r128Run(7);
    expect(loud.reply['outcome'], `the export FAILs: ${issueLines(loud.reply).join(' | ').slice(0, 800)}`).toBe('failed');
    const maxS = (Array.isArray(loud.reply['issues']) ? loud.reply['issues'] : []).filter(isObject).filter((i) => i['measure'] === 'max_s');
    expect(maxS.length, `one issue names max_s: ${issueLines(loud.reply).join(' | ').slice(0, 800)}`).toBe(1);
    const i = maxS[0]!;
    expect(typeof i['reading'] === 'number' && within(i['reading'], -16.0, 0.1), `it reads −16.0 ± 0.1 LUFS: ${JSON.stringify(i)}`).toBe(true);
    expect(i['target'], 'it is held to −18.0 LUFS').toBe(-18.0);
    const at = typeof i['at'] === 'number' ? i['at'] / FLICKS : NaN;
    expect(within(at, 30, 0.1) || within(at, 33, 0.1), `it names the loudest window's time, 30 s (its start) or 33 s (its end), within the meter's 0.1 s step: ${JSON.stringify(i)}`).toBe(true);
    expect(leftIn(loud.dir), 'the FAILed export wrote nothing').toEqual([]);

    const quiet = r128Run(4.5);
    const l = loudnessOf(receiptOf(quiet.reply, 'the film whose passage is 4.5 LU over').raw, 'the film whose passage is 4.5 LU over');
    const maxSq = receiptOf(quiet.reply, 'the same').raw['max_s'];
    expect(within(l.integrated, -23, 0.2), `the delivery is at −23 ± 0.2 LUFS: ${lu(l.integrated)}`).toBe(true);
    expect(typeof maxSq === 'number' && maxSq <= -18.0 && within(maxSq, -18.5, 0.1), `its max_s reads −18.5 ± 0.1 LUFS, at or under −18.0: ${String(maxSq)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[11]} at 24 fps a caption that would end 6 frames before the cut at frame 120 ends 2 frames before it, and two captions 5 frames apart are chained to a 2-frame gap`, () => {
    const evidence = temp(); const dir = temp();
    const D = frameFlicks([24, 1]);
    const shot = (a: number, b: number): JsonObject => ({ start: a * D, end: b * D, camera: 'cam', move: 'hold', target: [80, 45, 0], view_width: 160 });
    const doc = filmDoc(evidence, {
      frames: 240, locale: 'en',
      shots: { a: shot(0, 120), b: shot(120, 240) }, transitions: { cut: { from: 'a', to: 'b', kind: 'cut', span: 0 } },
      script: {
        narrator: { name: 'Captions only', license: CC0, synthetic: false },
        lines: {
          near: { t: '3s', text: 'Steam rises over the kettle at dawn', kind: 'caption' },
          first: { t: '6s', text: 'The tune dips under words', kind: 'caption' },
          second: { t: 179 * D, text: 'Captions always show', kind: 'caption' },
        },
        captions: { profile: 'netflix-en-adult' },
      },
    });
    const [reply] = filmRun(shows.bin(FULL), evidence, doc, [exportCall({ out: join(dir, 'captions.mp4'), ...H264_AAC, captions: { profile: 'netflix-en-adult', mode: 'open', files: ['srt'] } })], 'the film with a cut and three captions');
    const cues = captionsOf(receiptOf(reply!, 'the film with a cut and three captions').raw, 'the film with a cut and three captions').cues;
    const got = Object.fromEntries(cues.map((c) => [c.name, [c.in / D, c.out / D]]));
    expect(got, 'near.1 ends 2 frames before the cut (118, not 114); first.1 is chained to second.1 with a 2-frame gap (177, not 174); in-times stay on their frames')
      .toEqual({ 'near.1': [72, 118], 'first.1': [144, 177], 'second.1': [179, 203] });
  }, TIMEOUT);
});
