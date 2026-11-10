// Criterion 1 (no upstream test): "A lab whose logic at 60 Hz emits a shot occurrence {power: f64} on each press of
// Fire, with a Spawn on its occurrences filtered to shot, fed presses stamped at 1.000, 2.000, and so on to 10.000 s,
// holds exactly 10 rows, at steps 60, 120 and so on to 600, and starts 10 voices, each at its step's time to the
// sample, played straight, after a seek to 5.5 s and in a video export; a planted module that adds a second copy of
// the rows of each step a seek runs again fails logic.determinism, naming the first step whose occurrences differ from
// the straight run's"
//
// The rows through `deep-logic` (its bake's `occurrences`, and a seek to step 330, 5.5 s); the voices through
// `deep-show run`: `media_mix` of the lab document with the presses on its `track`, played straight over [0, 11 s),
// seeked back to 5.5 s in the same play, and seeked to 5.5 s cold; and a video `export` of the presented lab, whose
// per-frame PCM hashes must be the straight play's samples. `shot` (programs.ts) writes one row per Fire entry, a the
// press's number, b 0, power the press's number. README: Criteria to tests.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, TIMEOUT, asset, bakeCall, bakeOf, determinismCall, determinismOf, exportCall, f32le, mediaMixCall, mixOf, none, notPresented,
  onMac, pcmOf, prebuild, present, putEvidence, receiptOf, rowText, runShow, scenario, secs, sha256, tone, useTemp, type Row, type Segment,
} from './helpers.ts';
import { shot } from './programs.ts';
import { LAB, LAB_SPAN, LAB_STEPS, PRESS_STEPS, SPAWN, VOICE_FRAMES, labDoc, labPiece, labTrack, voiceFailures, voiceSample } from './fixtures.ts';

prebuild(['deep-logic', 'deep-show']);
const temp = useTemp();

const SEEK_STEP = 330; // 5.5 s at 60 Hz
const SEEK_AT = secs(5.5);
const SEEK_SAMPLE = 264_000;
const END_SAMPLE = 528_000;
const SPEC = { steps: LAB_STEPS, track: labTrack() };

/** The 10 rows the lab must hold: press n at step 60n, at n s, a n, b 0, power n. */
const EXPECTED: Row[] = PRESS_STEPS.map((k, i) => ({ step: k, t: (k / 60) * FLICKS, kind: 'shot', a: i + 1, b: 0, fields: { power: i + 1 } }));

/** The lab's assets in a fresh evidence store: its program and the spawn's tone. */
function labAssets(): { ev: string; program: string; tone: { sha: string; samples: Float32Array } } {
  const ev = temp();
  return { ev, program: putEvidence(ev, shot().bytes), tone: asset(ev, tone(1000, VOICE_FRAMES, 0.5)) };
}
/** Every voice the spawn must start: one a row, at its step's time, in row order. */
function voiceListFailures(voices: { spawn: string; occurrence: number; pair: unknown[]; start: number; stolen_by: unknown }[], what: string): string[] {
  const failures: string[] = [];
  if (voices.length !== 10) failures.push(`${what}: ${voices.length} voices, not 10: ${JSON.stringify(voices).slice(0, 800)}`);
  PRESS_STEPS.forEach((k, i) => {
    const v = voices[i];
    const want = { spawn: SPAWN, occurrence: i, pair: [i + 1, 0], start: (k / 60) * FLICKS, stolen_by: null };
    const got = v && { spawn: v.spawn, occurrence: v.occurrence, pair: v.pair, start: v.start, stolen_by: v.stolen_by };
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: the voice of the press at step ${k} is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  });
  return failures;
}

describe(`${AC[1]} a lab's shots: 10 rows at their steps and 10 voices at their steps' samples, played, seeked and exported`, () => {
  it(`${AC[1]} the lab holds exactly 10 shot rows, at steps 60, 120 … 600, played straight and after a seek to 5.5 s, and logic.determinism passes`, () => {
    const [bakeReply, detReply] = onMac([bakeCall(labPiece(), { ...SPEC, seeks: [{ to: SEEK_STEP }] }), determinismCall(labPiece(), SPEC, [5.5])]);
    const bake = bakeOf(bakeReply!, 'the bake of the shot lab, its logic item declaring emits {shot: {fields: {power: f64}}}');
    const rows = bake.occurrences[LAB];
    expect(rows, `the bake holds ${LAB}'s occurrence list`).toBeDefined();
    expect(rows!.map(rowText), 'played straight, the list holds exactly 10 rows: one shot at each press\'s step, at its time, in order').toEqual(EXPECTED.map(rowText));
    const seek = bake.seeks.find((s) => s.to === SEEK_STEP);
    expect(seek, 'the bake answers the seek to step 330 (5.5 s)').toBeDefined();
    expect(seek!.occurrences[LAB]?.map(rowText), 'after a seek to 5.5 s, the list holds the same 10 rows').toEqual(EXPECTED.map(rowText));
    const det = determinismOf(detReply!, 'logic.determinism of the shot lab at 5.5 s');
    expect([det.verdict, det.failures], 'logic.determinism passes the lab, its rows compared as its arrays are').toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${AC[1]} the spawn on lab.occurrences filtered to shot starts 10 voices, each at its step's time to the sample, played straight and after a seek to 5.5 s`, () => {
    const a = labAssets();
    const doc = labDoc(a.program, a.tone.sha);
    const played: Segment[] = [{ from: 0, to: LAB_SPAN, write: true }, { from: SEEK_AT, to: LAB_SPAN, write: true }];
    const cold: Segment[] = [{ from: SEEK_AT, to: LAB_SPAN, write: true }];
    const [straightReply, coldReply] = runShow(scenario(a.ev, [mediaMixCall(doc, labTrack(), played), mediaMixCall(doc, labTrack(), cold)]), 'media_mix of the shot lab');
    const straight = mixOf(straightReply!, played, 'media_mix of the shot lab, played straight then seeked back to 5.5 s');
    none(voiceListFailures(straight.voices, 'played'), 'the spawn starts one voice per shot row, at its step\'s time');
    const pcm = pcmOf(a.ev, straight.segments[0]!, 'the straight play over [0, 11 s)');
    none(voiceFailures(pcm, a.tone.samples, 'played straight'), 'each voice starts at its step\'s time to the sample');
    const tail = sha256(f32le(pcm, SEEK_SAMPLE, END_SAMPLE));
    expect(straight.segments[1]!.sha256, 'seeked back to 5.5 s in the same play, [5.5 s, 11 s) is the straight play\'s samples').toBe(tail);
    const seeked = mixOf(coldReply!, cold, 'media_mix of the shot lab, seeked to 5.5 s cold');
    none(voiceListFailures(seeked.voices, 'seeked cold to 5.5 s'), 'a cold seek to 5.5 s plans the same 10 voices');
    expect(seeked.segments[0]!.sha256, 'seeked cold to 5.5 s, [5.5 s, 11 s) is the straight play\'s samples').toBe(tail);
  }, TIMEOUT);

  it(`${AC[1]} a video export of the lab carries the same 10 voices: each frame's samples are the straight play's`, () => {
    const a = labAssets();
    const doc = labDoc(a.program, a.tone.sha);
    const out = temp();
    const whole: Segment[] = [{ from: 0, to: LAB_SPAN, write: true }];
    const [shown, mixReply, exportReply] = runShow(scenario(a.ev, [
      present(DOC.a, doc),
      mediaMixCall(doc, labTrack(), whole),
      exportCall({ doc: DOC.a, out: `${out}/lab.mp4`, frame_rate: [60, 1], video: { codec: 'h264' }, audio: { codec: 'pcm', sample_rate: 48_000 }, track: labTrack() }),
    ]), 'the shot lab presented, played and exported');
    none([notPresented(shown!, 'the shot lab (a logic@1 item and a spawn on lab.occurrences)')].filter((x): x is string => x !== null), 'the lab document is presented');
    const straight = mixOf(mixReply!, whole, 'media_mix of the shot lab');
    const pcm = pcmOf(a.ev, straight.segments[0]!, 'the straight play over [0, 11 s)');
    none(voiceFailures(pcm, a.tone.samples, 'played straight'), 'each voice starts at its step\'s time to the sample');
    const receipt = receiptOf(exportReply!, 'the video export of the shot lab');
    expect(receipt.frame_rate, 'the export is at 60 fps').toEqual([60, 1]);
    expect(receipt.duration, 'the export is the whole 11 s').toBe(LAB_SPAN);
    expect(receipt.pcm_hashes.length, 'one PCM hash per frame: 660').toBe(660);
    const differing: string[] = [];
    for (let k = 0; k < 660; k++) {
      if (receipt.pcm_hashes[k] !== sha256(f32le(pcm, 800 * k, 800 * k + 800))) {
        const voice = PRESS_STEPS.find((s) => voiceSample(s) >= 800 * k && voiceSample(s) < 800 * k + 800);
        differing.push(`frame ${k} (samples ${800 * k} to ${800 * k + 800})${voice ? `, where the voice of the press at step ${voice} starts` : ''}`);
      }
    }
    none(differing, 'the export\'s sound is the straight play\'s, frame by frame');
  }, TIMEOUT);

  it(`${AC[1]} a planted module that adds a second copy of the rows of each step a seek runs again (seek_repeats_occurrences) fails logic.determinism, naming the first step whose occurrences differ`, () => {
    const [clean] = onMac([determinismCall(labPiece(), SPEC, [5.5])]);
    const ok = determinismOf(clean!, 'logic.determinism of the shot lab at 5.5 s');
    expect([ok.verdict, ok.failures], 'logic.determinism passes the lab').toEqual(['PASS', []]);
    const [planted] = onMac([determinismCall(labPiece(), SPEC, [5.5])], 'seek_repeats_occurrences');
    const d = determinismOf(planted!, 'logic.determinism with seek_repeats_occurrences');
    expect(d.verdict, `logic.determinism fails the planted module: ${JSON.stringify(d.failures)}`).toBe('FAIL');
    const seeks = d.failures.filter((f) => f.run === 'seek');
    expect(seeks.length, `a seek run fails: ${JSON.stringify(d.failures)}`).toBeGreaterThan(0);
    // A seek restoring checkpoint c runs steps c, c + 1 … again; the first of them holding a row is the first step
    // whose occurrences differ: c itself for a checkpoint on a press's step, 60 for checkpoint 0.
    for (const f of seeks) {
      const first = PRESS_STEPS.find((k) => k >= (f.from ?? 0));
      expect(f.step, `the seek from checkpoint ${f.from} names step ${first}, the first step it ran again that holds a row: ${JSON.stringify(f)}`).toBe(first);
    }
  }, TIMEOUT);
});
