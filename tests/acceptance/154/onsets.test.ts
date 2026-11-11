// AC2 #154.8b0e5b99: "Each event's note_on lands on its resolved flick within one sample, and score.pitch fails a note
// whose library sample is tuned 50 cents sharp while its event declares the true pitch, naming the event, and passes it
// on the in-tune sample; a planted check that reads the event's pitch instead of the stem passes the sharp sample and
// fails this test"
//
// asserts: (1) a plucked score over a tempo map of 90 BPM, a ramp from 90 to 150 BPM linear in beats and 150 BPM: the
// plan's note_on lists every event once, in (t, event) order, each at the flick its bar:beat resolves to through the
// map (within 1 flick of the closed form) and on the 48 kHz sample that flick rounds to, so within one sample of it;
// the rendered stem's meta puts each event on that same sample. The criterion's own sample-exact port of the upstream
// scheduling test is in tests/acceptance/154-oracle/. (2) The note a4_held, declared A4 (MIDI 69), on test/intune's
// take (440 Hz) renders, and this suite's own reading of the stem (the design's measure) puts it within ±35 cents; on
// test/sharp's take (50 cents sharp, its manifest still saying root 69) the render fails its output check
// score.render.pitch, naming a4_held and the cents, with no output. The planted check, built here, reads each event's
// declared pitch instead of the stem: it passes the sharp note, and this test's judge fails it.
import { describe, expect, it } from 'vitest';
import {
  AC, CHECK, FLICKS, SAMPLE, SHARP_CENTS, TIMEOUT, done, hz, measureCents, metaOf, mono, outputsOf, packDirs, planOf, planReply, pluck, proof, ref, renderStem,
  sampled, scoreItem, scoreWorld, stemOf, film, synth, takesOf, tuningLibrary, useShow, type Ev, type JsonObject, type Segment,
} from './helpers.ts';

const showBin = useShow();

/** The map: 4 bars at 90 BPM, 4 bars ramping 90 to 150 BPM linear in beats, then 150 BPM; 4/4 throughout. */
const MAP: { segments: Segment[] } = { segments: [
  { at: '0s', bpm: 90, meter: [4, 4], span: 16, ramp: 'none' },
  { bpm: 90, meter: [4, 4], span: 16, ramp: { to_bpm: 150, shape: 'linear_in_beats' } },
  { bpm: 150, meter: [4, 4], span: 64, ramp: 'none' },
] };
/** A beat count's time in flicks by the closed form (Tempo map and cue alignment), rounded to the nearest flick. */
function expectedFlick(beats: number): number {
  const beat90 = (60 / 90) * FLICKS;
  if (beats <= 16) return Math.round(beats * beat90);
  const rampStart = 16 * beat90;
  if (beats <= 32) return Math.round(rampStart + 16 * Math.log(1 + (beats - 16) / 24) * FLICKS);
  return Math.round(rampStart + 16 * Math.log(150 / 90) * FLICKS + (beats - 32) * 0.4 * FLICKS);
}
/** Each event: its bar:beat as written, and its beats from the start. */
const ONSETS: [string, string, number][] = [
  ['e01', '1:1', 0], ['e02', '2:3b', 6], ['e03', '3:2.5', 9.5], ['e04', '4:4.75', 15.75], ['e05', '5:1', 16], ['e06', '6:1', 20],
  ['e07', '7:2.5', 25.5], ['e08', '8:4', 31], ['e09', '9:1', 32], ['e10', '10:3', 38], ['e11', '12:1.125', 44.125],
];
function rampScore(): JsonObject {
  const events: Record<string, Ev> = {};
  ONSETS.forEach(([id, at], i) => { events[id] = { at, inst: 'string', pitch: 60 + i, dur: '0.2s', vel: 0.5 }; });
  return film([scoreItem('cues', { string: pluck('steel', 'pluck') }, events)], { tempo: MAP, span: '26s' });
}

/** The pitch score: a4_held on the library's A4, and an in-tune sine on the same stem. */
const HELD = 'a4_held';
function tuneScore(library: string): JsonObject {
  const events: Record<string, Ev> = {
    [HELD]: { at: '1:1', inst: 'lead', pitch: 69, dur: '0.5s', vel: 0.8, attack: '0.01s', release: '0.05s' },
    sine_ok: { at: '2:1', inst: 'ping', pitch: 69, dur: '0.5s', vel: 0.5, release: '0.05s' },
  };
  return film([scoreItem('tune', { lead: sampled(library, 'a4', 'lead'), ping: synth('sine', 'lead') }, events)], { tempo: { segments: [{ at: '0s', bpm: 90, meter: [4, 4], span: 64, ramp: 'none' }] }, packs: [library], span: '4s' });
}
interface Verdict { passed: boolean; text: string }
/** The planted check (README: Planted programs): each note's pitch read from its event's declared pitch, where the
 * stem should be measured, so every note sits 0 cents from itself and passes. */
function readsEventPitch(document: JsonObject): Verdict {
  const item = (document['items'] as Record<string, JsonObject>)['tune']!;
  const events = (item['params'] as unknown as { events: Record<string, Ev> }).events;
  const off = Object.entries(events).map(([id, e]) => ({ id, cents: 1200 * Math.log2(hz(Number(e.pitch)) / hz(Number(e.pitch))) }));
  const failing = off.filter((o) => Math.abs(o.cents) > 35);
  return { passed: failing.length === 0, text: failing.map((f) => `${f.id} ${f.cents} cents`).join('; ') };
}
/** This test's judge of a pitch check: it must fail the sharp note, naming a4_held, and pass the in-tune one. */
function judgePitch(sharp: Verdict, intune: Verdict): string[] {
  const failures: string[] = [];
  if (sharp.passed) failures.push(`the check passes ${HELD} on the sample tuned ${SHARP_CENTS} cents sharp`);
  else if (!sharp.text.includes(HELD)) failures.push(`the check fails the sharp sample without naming ${HELD}: ${sharp.text.slice(0, 300)}`);
  if (!intune.passed) failures.push(`the check fails ${HELD} on the in-tune sample: ${intune.text.slice(0, 300)}`);
  return failures;
}

describe(`${AC[2]} note_on on its resolved flick, and score.pitch on the stem`, () => {
  it(`${AC[2]} each event's note_on lands on its resolved flick through a tempo map with a ramp, and the render puts it on that sample`, async () => {
    const w = await scoreWorld([]);
    const plan = planOf(planReply(showBin(), w.evidence, rampScore(), 'cues', packDirs(w), 'the plucked score'), 'the plucked score');
    const rows = ONSETS.map(([event, at, beats]) => ({ event, at, expected: expectedFlick(beats), got: plan.note_on.find((n) => n.event === event) }));
    const r = await renderStem(w, plan.stems['pluck']!);
    const meta = metaOf(w, outputsOf(r, 'the plucked stem').meta, 'the plucked stem');
    proof('ac2-note-on.json', { tempo_map: MAP, rows, meta_note_on: meta.note_on });
    expect(plan.note_on.map((n) => n.event).sort(), 'note_on lists each event once').toEqual(ONSETS.map(([e]) => e).sort());
    const ordered = [...plan.note_on].sort((a, b) => a.t - b.t || (a.event < b.event ? -1 : 1));
    expect(plan.note_on.map((n) => n.event), 'note_on is in (t, event) order').toEqual(ordered.map((n) => n.event));
    for (const row of rows) {
      const n = row.got!;
      expect(n.stem, `${row.event} is on the stem pluck`).toBe('pluck');
      expect(Math.abs(n.t - row.expected), `${row.event} at ${row.at}: note_on t ${n.t} is its resolved flick ${row.expected} (within 1 flick)`).toBeLessThanOrEqual(1);
      expect(Math.abs(n.sample - n.t / SAMPLE), `${row.event}: note_on sample ${n.sample} is the 48 kHz sample its flick ${n.t} rounds to`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(n.sample * SAMPLE - row.expected), `${row.event}: its sample lands within one sample of ${row.expected}`).toBeLessThan(SAMPLE);
      const rendered = meta.note_on.find((m) => m.event === row.event);
      expect(rendered?.sample, `${row.event}: the render's note_on puts it on the plan's sample ${n.sample}`).toBe(n.sample);
    }
  }, TIMEOUT);

  it(`${AC[2]} score.pitch fails a4_held on the sample 50 cents sharp, naming it, passes it in tune, and a planted check reading the event's pitch fails this test`, async () => {
    const intuneLib = tuningLibrary(false);
    const sharpLib = tuningLibrary(true);
    // The fixtures' truth, read by the same measure: the takes sound at 0 and +50 cents of A4.
    const pcm = (wav: Buffer) => Float64Array.from({ length: (wav.length - 44) / 2 }, (_, i) => wav.readInt16LE(44 + 2 * i) / 32767);
    const truth = { intune: measureCents(pcm(takesOf(intuneLib)[0]!.bytes), 960, 69), sharp: measureCents(pcm(takesOf(sharpLib)[0]!.bytes), 960, 69) };
    expect(Math.abs(truth.intune), `test/intune's take measures 0 cents of A4 (${truth.intune.toFixed(2)})`).toBeLessThan(2);
    expect(Math.abs(truth.sharp - SHARP_CENTS), `test/sharp's take measures +${SHARP_CENTS} cents of A4 (${truth.sharp.toFixed(2)})`).toBeLessThan(2);

    const w = await scoreWorld([intuneLib, sharpLib]);
    const docs = { intune: tuneScore(ref(intuneLib)), sharp: tuneScore(ref(sharpLib)) };
    const plans = {
      intune: planOf(planReply(showBin(), w.evidence, docs.intune, 'tune', packDirs(w), 'a4_held on test/intune'), 'a4_held on test/intune'),
      sharp: planOf(planReply(showBin(), w.evidence, docs.sharp, 'tune', packDirs(w), 'a4_held on test/sharp'), 'a4_held on test/sharp'),
    };
    const intune = await renderStem(w, plans.intune.stems['lead']!);
    const sharp = await renderStem(w, plans.sharp.stems['lead']!);
    const stem = stemOf(w, outputsOf(intune, 'the in-tune stem').stem, 'the in-tune stem');
    const meta = metaOf(w, outputsOf(intune, 'the in-tune stem').meta, 'the in-tune stem');
    const at = meta.note_on.find((n) => n.event === HELD)?.sample;
    expect(at, `the in-tune stem's note_on lists ${HELD}`).toBeDefined();
    const heard = measureCents(mono(stem), at! + 960, 69);
    const cents = (sharp.outcome.text.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((v) => Math.abs(v) >= 40 && Math.abs(v) <= 60);
    const product = { sharp: { passed: done(sharp.outcome), text: sharp.outcome.text }, intune: { passed: done(intune.outcome), text: intune.outcome.text } };
    const planted = { sharp: readsEventPitch(docs.sharp), intune: readsEventPitch(docs.intune) };
    const judged = { product: judgePitch(product.sharp, product.intune), planted: judgePitch(planted.sharp, planted.intune) };
    proof('ac2-pitch.json', { truth, heard_in_tune: heard, sharp_reply: sharp.outcome.value, judged });

    expect(Math.abs(heard), `${HELD} in the in-tune stem measures within ±35 cents of A4 by this suite's reading (${heard.toFixed(2)} cents)`).toBeLessThanOrEqual(35);
    expect(done(sharp.outcome), `${HELD} on the sharp sample fails the render: ${sharp.outcome.text.slice(0, 800)}`).toBe(false);
    expect(sharp.outcome.text.includes(CHECK), `the failure names ${CHECK}: ${sharp.outcome.text.slice(0, 800)}`).toBe(true);
    expect(sharp.outcome.text.includes(HELD), `the failure names the event ${HELD}: ${sharp.outcome.text.slice(0, 800)}`).toBe(true);
    expect(cents.length, `the failure names the cents, about ${SHARP_CENTS}: ${sharp.outcome.text.slice(0, 800)}`).toBeGreaterThan(0);
    expect(sharp.outcome.value.outputs, 'the failed render keeps no output').toBeUndefined();
    expect(judged.product, `score.pitch is judged right: ${judged.product.join(' | ')}`).toEqual([]);
    expect(judged.planted.some((f) => f.includes('passes a4_held on the sample tuned')), `the planted check that reads the event's pitch passes the sharp sample and fails this test: ${judged.planted.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
