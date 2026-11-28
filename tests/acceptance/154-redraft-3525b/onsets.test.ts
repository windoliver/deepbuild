// AC2 #154.8b0e5b99: "Each event's note_on lands on its resolved flick within one sample, and score.pitch fails a note
// whose library sample is tuned 50 cents sharp while its event declares the true pitch, naming the event, and passes it
// on the in-tune sample; a planted check that reads the event's pitch instead of the stem passes the sharp sample and
// fails this test"
//
// Onsets: one sampled instrument whose one take starts at full level (cosine phase), eleven notes placed every way `at`
// takes (bar:beat with and without `b`, a fractional beat, notes inside a tempo ramp and after it, a marker plus an
// offset, seconds, frames and integer flicks), each 0.26 s long with at least 0.39 s of silence before the next. Each
// note's resolved flick is worked out here from the tempo map's closed form; the plan's note_on, the job's meta and the
// first sample that sounds in the stem must each sit within one sample (14,700 flicks) of it.
//
// Pitch: a library whose manifest states root 69 (A4) for a take that is really 50 cents sharp (452.89 Hz), and one
// whose take is A4; the same event, pitch "A4", on each. score.pitch (the kind's output check `score.render.pitch`)
// must fail the job on the sharp one, naming the event (and the cents, as the design says), keeping nothing, and pass
// it on the in-tune one. The planted check reads the event's declared pitch, so it passes the sharp sample; the judge
// below fails it.
import { describe, expect, it } from 'vitest';
import {
  AC, beatFlicks, beatOf, fl, FLICKS, firstSound, library, metaNotes, once, plan, readMeta, readStem, render, runStem, sampled, SAMPLE, scoreDoc,
  scoreWorld, show, TIMEOUT, tone, useShow, type Event, type Outcome,
} from './helpers.ts';

const bin = useShow();
const TEMPO = [
  { at: '0s', bpm: 120, span: 16 },
  { at: '5:1b', bpm: 120, span: 8, to_bpm: 90 },
  { at: '7:1b', bpm: 90, span: 64 },
];
const TUNED = library('testlib/tuned', 'tone', 69, [tone(440, 0.3)]);
const SHARP = library('testlib/sharp', 'tone', 69, [tone(440 * 2 ** (50 / 1200), 0.6)]);
const MARKER_AT = beatFlicks(TEMPO, beatOf(3, 1));
const bb = (bar: number, beat: number) => beatFlicks(TEMPO, beatOf(bar, beat));
/** Each event's `at`, and its resolved flick worked out here. */
const PLACED: Record<string, { at: string | number; t: number }> = {
  o_beat: { at: '1:2', t: bb(1, 2) },
  o_fraction: { at: '1:3.5', t: bb(1, 3.5) },
  o_suffix: { at: '2:1b', t: bb(2, 1) },
  o_marker: { at: '@drop+0.25s', t: MARKER_AT + fl(0.25) },
  o_bar4: { at: '4:2', t: bb(4, 2) },
  o_frames: { at: '180f', t: (180 * FLICKS) / 24 },
  o_ramp_in: { at: '5:2', t: bb(5, 2) },
  o_seconds: { at: '10.5s', t: fl(10.5) },
  o_ramp_late: { at: '6:3.5', t: bb(6, 3.5) },
  o_after_ramp: { at: '7:2', t: bb(7, 2) },
  o_flicks: { at: fl(14.5), t: fl(14.5) },
};
const onsetsDoc = scoreDoc({
  id: 'onsets', instruments: { lead: sampled(TUNED, 'lead') }, tempo: TEMPO, span: '20s', packs: [TUNED],
  markers: { drop: { kind: 'cue', t: '3:1b' } },
  events: Object.fromEntries(Object.entries(PLACED).map(([id, p]) => [id, { at: p.at, inst: 'lead', pitch: 69, dur: '0.25s', vel: 0.8, attack: 0, release: 0.01 } satisfies Event])),
});
const PROBE = 'tuning_probe';
const pitchDoc = (lib: typeof TUNED) => scoreDoc({
  id: 'pitch', instruments: { lead: sampled(lib, 'lead') }, span: '4s', packs: [lib],
  events: { [PROBE]: { at: '0.5s', inst: 'lead', pitch: 'A4', dur: '0.5s', vel: 0.8, attack: 0, release: 0.01 } },
});

const world = once(() => scoreWorld([TUNED, SHARP]));
const within = (got: number, want: number) => Math.abs(got - want) <= SAMPLE;

/** score.pitch's verdict on one render, as this suite reads it: failed (naming what) or passed. */
interface PitchVerdict { failed: boolean; text: string }
/** The judge: the sharp note must fail naming its event; the in-tune one must pass. */
function judgePitch(sharp: PitchVerdict, tuned: PitchVerdict): string[] {
  const failures: string[] = [];
  if (!sharp.failed) failures.push(`score.pitch passed ${PROBE}, whose library sample is 50 cents sharp, while its event declares A4: ${sharp.text.slice(0, 400)}`);
  else if (!sharp.text.includes(PROBE)) failures.push(`score.pitch failed the sharp note without naming its event ${PROBE}: ${sharp.text.slice(0, 400)}`);
  if (tuned.failed) failures.push(`score.pitch failed ${PROBE} on the in-tune sample: ${tuned.text.slice(0, 400)}`);
  return failures;
}
const verdictOf = (o: Outcome): PitchVerdict => ({ failed: o.value.status !== 'done', text: o.text });
const MIDI: Record<string, number> = { A4: 69 };
/** The planted check: each note's pitch read from its event, held to the event's own pitch, so it can't see the stem. */
function eventPitchCheck(events: Record<string, Event>): PitchVerdict {
  const off = Object.entries(events).map(([id, e]) => {
    const declared = typeof e.pitch === 'number' ? e.pitch : MIDI[e.pitch]!;
    const heard = typeof e.pitch === 'number' ? e.pitch : MIDI[e.pitch]!;
    return { id, cents: 100 * (heard - declared) };
  }).filter((n) => Math.abs(n.cents) > 35);
  return { failed: off.length > 0, text: off.map((n) => `${n.id} ${n.cents} cents`).join('; ') || 'every note within 35 cents' };
}

describe(`${AC[2]} note_on lands on each event's resolved flick within one sample; score.pitch fails a note on a sample 50 cents sharp, naming the event, and passes it in tune; a check reading the event's pitch fails`, () => {
  it(`${AC[2]} each event's note_on (the plan's, the job's meta and the first sample that sounds in the stem) lands within one sample of its resolved flick, through a tempo ramp, a marker, seconds, frames and flicks`, async () => {
    const { w, dirs } = await world();
    const p = plan(bin(), w.evidence, onsetsDoc, dirs, 'the onsets score');
    const ids = Object.keys(PLACED);
    for (const id of ids) {
      const rows = p.note_on.filter((n) => n.event === id);
      expect(rows.length, `the plan's note_on has one row for ${id}: ${show(p.note_on)}`).toBe(1);
      const n = rows[0]!;
      expect(n.stem, `${id}'s note_on names its stem`).toBe('lead');
      expect(within(n.t, PLACED[id]!.t), `${id}'s note_on t ${n.t} is within one sample (${SAMPLE} flicks) of its resolved flick ${PLACED[id]!.t}`).toBe(true);
      expect(within(n.sample * SAMPLE, PLACED[id]!.t), `${id}'s note_on sample ${n.sample} is within one sample of ${PLACED[id]!.t / SAMPLE}`).toBe(true);
    }
    const order = [...p.note_on].sort((a, b) => a.t - b.t || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));
    expect(p.note_on.map((n) => n.event), 'note_on is in (t, event) order').toEqual(order.map((n) => n.event));
    const r = await render(w, p.stems.lead!, 'the onsets score: lead');
    const meta = metaNotes(readMeta(w, r.meta, 'the onsets score: meta'), 'the onsets score: meta');
    const stem = readStem(w, r.stem, 'the onsets score: lead');
    for (const id of ids) {
      const want = PLACED[id]!.t;
      const m = meta.find((x) => x.event === id);
      expect(m && within(m.sample * SAMPLE, want), `meta's note_on for ${id} (${show(m)}) is within one sample of ${want / SAMPLE}`).toBe(true);
      const s = Math.round(want / SAMPLE);
      const heard = firstSound(stem, s - 4800, s + 4800);
      expect(heard >= 0 && within(heard * SAMPLE, want), `${id} sounds in the stem from sample ${heard}, within one sample of its resolved ${(want / SAMPLE).toFixed(2)}`).toBe(true);
    }
  }, TIMEOUT);

  it(`${AC[2]} score.pitch fails the job for a note whose sample is 50 cents sharp, naming the event, keeps nothing, and passes the same event on the in-tune sample; the planted check that reads the event's pitch passes the sharp sample and fails`, async () => {
    const { w, dirs } = await world();
    const sharpPlan = plan(bin(), w.evidence, pitchDoc(SHARP), dirs, 'the sharp score');
    const sharp = (await runStem(w, sharpPlan.stems.lead!)).outcome;
    expect(sharp.value.status, `the render of a note 50 cents sharp fails: ${sharp.text.slice(0, 1200)}`).toBe('failed');
    expect(sharp.text, 'the failure is score.pitch\'s, the kind\'s output check score.render.pitch').toMatch(/score\.(render\.)?pitch/);
    expect(sharp.text, `the failure names the event ${PROBE}`).toContain(PROBE);
    const cents = (sharp.text.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    expect(cents.some((c) => c >= 40 && c <= 60), `the failure names the cents (about 50): ${sharp.text.slice(0, 600)}`).toBe(true);
    expect(sharp.value.outputs?.stem, 'nothing is kept: no stem output').toBeUndefined();
    const tunedPlan = plan(bin(), w.evidence, pitchDoc(TUNED), dirs, 'the in-tune score');
    const tuned = await render(w, tunedPlan.stems.lead!, 'the in-tune score: lead');
    expect(tuned.outcome.value.status, 'the same event on the in-tune sample passes score.pitch').toBe('done');
    expect(judgePitch(verdictOf(sharp), verdictOf(tuned.outcome)), 'score.pitch, as rendered').toEqual([]);
    const events = pitchDoc(SHARP).items.score.params.events as Record<string, Event>;
    const planted = eventPitchCheck(events);
    expect(planted.failed, 'the planted check passes the sharp sample').toBe(false);
    expect(judgePitch(planted, verdictOf(tuned.outcome)).length, 'the planted check that reads the event\'s pitch fails this test').toBeGreaterThan(0);
  }, TIMEOUT);
});
