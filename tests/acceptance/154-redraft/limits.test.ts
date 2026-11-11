// AC6 #154.74061b19: "A sustained pad at MIDI 40 not marked bass is refused naming the event, and a held note of 61 s
// is refused"
//
// `deep show` of one film per case, in one `deep-show run` scenario, with a sample library offered to the pack store
// (#306) for the sustained library preset. Times are seconds, so no case needs a tempo map. The boundary pairs the design names: a pad note at MIDI 48 passes and at 47
// is refused; a note held 60 s passes and 61 s is refused. The issue's cases: a pad at MIDI 40 refused, naming the
// event (as a synth `pad` and as a library preset with `sustained: true`), passing once its instrument is marked bass;
// a plucked note at MIDI 40 is no pad and passes. Codes as the design's As built names them: `score.pad_too_low` and
// `score.note_too_long`. The merge base is the wrong program (it has no score kind).
import { describe, expect, it } from 'vitest';
import {
  AC, docHandle, issuesOf, library, pluck, present, presented, runShow, sampled, scenario, scoreDoc, show, synth, tempDir, TIMEOUT, tone, useShow,
  writeLibrary, type Event, type Instrument, type Line,
} from './helpers.ts';

const bin = useShow();
const STRINGS = library('testlib/strings', 'strings', 48, [tone(130.8128, 1)], { sustained: true });
const ev = (id: string, pitch: number, dur = '4s'): Record<string, Event> => ({ [id]: { at: '0s', inst: 'part', pitch, dur, vel: 0.7 } });
const docOf = (id: string, inst: Instrument, events: Record<string, Event>) =>
  scoreDoc({ id, instruments: { part: inst }, events, span: '90s', packs: inst.source.sampled ? [STRINGS] : [] });

interface Case { name: string; doc: Line; event: string; refused?: string }
const CASES: Case[] = [
  { name: 'a synth pad at MIDI 48', doc: docOf('pad48', synth('pad', 'pad'), ev('pad_at_48', 48)), event: 'pad_at_48' },
  { name: 'a synth pad at MIDI 47', doc: docOf('pad47', synth('pad', 'pad'), ev('pad_at_47', 47)), event: 'pad_at_47', refused: 'score.pad_too_low' },
  { name: 'a synth pad at MIDI 40, not marked bass', doc: docOf('pad40', synth('pad', 'pad'), ev('pad_at_40', 40)), event: 'pad_at_40', refused: 'score.pad_too_low' },
  { name: 'a synth pad at MIDI 40 marked bass', doc: docOf('bass40', synth('pad', 'pad', true), ev('bass_pad_at_40', 40)), event: 'bass_pad_at_40' },
  { name: 'a sustained library preset at MIDI 40, not marked bass', doc: docOf('strings40', sampled(STRINGS, 'pad'), ev('strings_at_40', 40)), event: 'strings_at_40', refused: 'score.pad_too_low' },
  { name: 'a plucked note at MIDI 40 (not a pad)', doc: docOf('pluck40', pluck('nylon', 'guitar'), ev('pluck_at_40', 40, '2s')), event: 'pluck_at_40' },
  { name: 'a note held 60 s', doc: docOf('held60', synth('sine', 'lead'), ev('held_60s', 69, '60s')), event: 'held_60s' },
  { name: 'a note held 61 s', doc: docOf('held61', synth('sine', 'lead'), ev('held_61s', 69, '61s')), event: 'held_61s', refused: 'score.note_too_long' },
];

/** Each case's `deep show` reply, from one scenario with the library offered to the pack store. */
function replies(): Map<string, Line> {
  const dir = writeLibrary(tempDir(), '127.0.0.1:9', STRINGS);
  const docs = CASES.map((_, i) => docHandle(i + 1));
  const got = runShow(bin(), scenario(tempDir(), docs, CASES.map((c, i) => present(docs[i]!, c.doc)), [{ id: STRINGS.id, dir }]), 'the pad and held-note cases');
  return new Map(CASES.map((c, i) => [c.name, got[i]!]));
}
/** Refused, with an error of `code` that names the event. */
function refusedNaming(reply: Line, code: string, event: string, what: string): void {
  const hits = issuesOf(reply).filter((i) => i.code === code && i.severity === 'error');
  expect(hits.map((h) => show(h.raw, 300)), `${what}: an error ${code}; the reply: ${show(reply)}`).not.toEqual([]);
  expect(hits.some((h) => JSON.stringify(h.raw).includes(event)), `${what}: ${code} names the event ${event}: ${show(hits.map((h) => h.raw))}`).toBe(true);
  expect(reply.outcome, `${what}: the document is refused`).toBe('refused');
}
const caseOf = (name: string) => CASES.find((c) => c.name === name)!;

describe(`${AC[6]} a sustained pad at MIDI 40 not marked bass is refused naming the event, and a held note of 61 s is refused`, () => {
  it(`${AC[6]} a sustained pad below MIDI 48 not marked bass is refused naming the event (40 and 47; as a synth pad and a sustained library preset); MIDI 48 passes, bass passes, and a pluck at 40 is no pad`, () => {
    const got = replies();
    for (const name of ['a synth pad at MIDI 48', 'a synth pad at MIDI 40 marked bass', 'a plucked note at MIDI 40 (not a pad)']) presented(got.get(name)!, name);
    for (const name of ['a synth pad at MIDI 40, not marked bass', 'a synth pad at MIDI 47', 'a sustained library preset at MIDI 40, not marked bass']) {
      const c = caseOf(name);
      refusedNaming(got.get(name)!, c.refused!, c.event, name);
    }
  }, TIMEOUT);

  it(`${AC[6]} a held note of 61 s is refused naming the event, and one of 60 s passes`, () => {
    const got = replies();
    presented(got.get('a note held 60 s')!, 'a note held 60 s');
    for (const name of ['a note held 61 s']) {
      const c = caseOf(name);
      refusedNaming(got.get(name)!, c.refused!, c.event, name);
    }
  }, TIMEOUT);
});
