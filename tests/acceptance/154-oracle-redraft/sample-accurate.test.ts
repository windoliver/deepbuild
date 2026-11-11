// AC2 #154.8b0e5b99, Oracle lane: "Each event's note_on lands on its resolved flick within one sample, ..."
//
// Ported from web-platform-tests at 2f57f45d21482f94b36123dfcec77ae7ab859bc1,
// webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html (3-Clause BSD License,
// Copyright web-platform-tests contributors). No upstream code is copied: its setup and assertions are re-expressed
// against our output, keeping upstream's numbers.
//
// Upstream schedules one sound at each of nine sample offsets (0, 3, 512, 517, 1000, 1005, 20000, 21234, 37590), inside
// and across render quanta, renders offline, and checks that the left and right channels match, that sound appears at
// exactly those offsets and nowhere else, and that the count of onsets found is nine with none misplaced. Ours: a score
// whose nine notes start at those offsets, each in a window of its own 49,152 samples (so each keeps upstream's place
// inside any block of up to 16,384 samples), written as integer flicks (sample × 14,700), on a sampled instrument whose
// one take starts at full level, with no attack. It is planned by `score_plan` and rendered by deep_job, and the stem is
// read here as FLAC. Upstream's impulse becomes a note's first sample: everything before it in its window is silence,
// and its own sample isn't.
import { describe, expect, it } from 'vitest';
import {
  AC, firstSound, library, metaNotes, once, plan, readMeta, readStem, render, sampled, SAMPLE, SAMPLE_OFFSETS, scoreDoc, scoreWorld, SPACING, TIMEOUT, tone,
  UPSTREAM, useShow, type Event,
} from './helpers.ts';

const bin = useShow();
const TONE = library('testlib/onset', 'tone', 69, [tone(440, 0.25)]);
const onsetOf = (k: number) => k * SPACING + SAMPLE_OFFSETS[k]!;
const EVENTS: Record<string, Event> = Object.fromEntries(SAMPLE_OFFSETS.map((_, k) => [`impulse${k}`, { at: onsetOf(k) * SAMPLE, inst: 'tone', pitch: 69, dur: '0.25s', vel: 1, pan: 0, attack: 0, release: 0.01 } satisfies Event]));
const doc = scoreDoc({ id: 'scheduling', instruments: { tone: sampled(TONE, 'onsets') }, events: EVENTS, span: '12s', packs: [TONE] });
const world = once(() => scoreWorld([TONE]));

describe(`${AC[2]} (Oracle: ${UPSTREAM.project} ${UPSTREAM.commit.slice(0, 10)} ${UPSTREAM.file}) each note starts on exactly its scheduled sample`, () => {
  it(`${AC[2]} sample-accurate scheduling, ported: nine notes at upstream's offsets each start on exactly their sample and nowhere else, left and right match, nine found and none misplaced`, async () => {
    const { w, dirs } = await world();
    const p = plan(bin(), w.evidence, doc, dirs, 'the scheduling score');
    for (let k = 0; k < SAMPLE_OFFSETS.length; k++) {
      const row = p.note_on.find((n) => n.event === `impulse${k}`);
      expect(row?.sample, `the plan schedules impulse${k} at sample ${onsetOf(k)}`).toBe(onsetOf(k));
    }
    const r = await render(w, p.stems.onsets!, 'the scheduling score: onsets');
    const meta = metaNotes(readMeta(w, r.meta, 'the scheduling score: meta'), 'the scheduling score: meta');
    for (let k = 0; k < SAMPLE_OFFSETS.length; k++) expect(meta.find((n) => n.event === `impulse${k}`)?.sample, `the job's note_on for impulse${k}`).toBe(onsetOf(k));
    const stem = readStem(w, r.stem, 'the scheduling score: onsets');

    // Upstream: "Content of left and right channels match".
    const [left, right] = [stem.samples[0]!, stem.samples[1]!];
    let mismatch = -1;
    for (let i = 0; i < stem.total && mismatch < 0; i++) if (left[i] !== right[i]) mismatch = i;
    expect(mismatch, 'the left and right channels match').toBe(-1);

    // Upstream: every sound found is at a scheduled offset ("Non-zero sample found at sample offset"), and the count.
    let found = 0;
    const misplaced: string[] = [];
    for (let k = 0; k < SAMPLE_OFFSETS.length; k++) {
      const first = firstSound(stem, k * SPACING, (k + 1) * SPACING);
      if (first === onsetOf(k)) found++;
      else misplaced.push(`impulse${k}: first sound at sample ${first} of its window [${k * SPACING}, ${(k + 1) * SPACING}), scheduled at ${onsetOf(k)} (upstream offset ${SAMPLE_OFFSETS[k]})`);
    }
    expect(misplaced, 'bad offsets: none').toEqual([]);
    expect(found, 'the number of onsets found').toBe(SAMPLE_OFFSETS.length);
  }, TIMEOUT);
});
