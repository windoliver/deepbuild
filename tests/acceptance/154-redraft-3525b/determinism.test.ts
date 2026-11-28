// AC1 #154.c8c95dbc: "A score renders identical stems by hash on two runs and after an unrelated note is added to
// another stem, and adding one note to a stem changes no other note's noise, no take before it and no take on another
// instrument, while over 1,000 notes on an instrument with four takes no note repeats the previous note's take"
//
// Two worlds, each a fresh hub with its own home, so nothing one rendered is in the other's cache: the same score
// rendered in each must give the same stem hashes, and its `mix` stem must come out the same in the second world when
// the score there also has one more note on its `pad` stem. On one stem holding two sampled instruments of four takes
// each and a plucked string, one note added (a sampled note, then a plucked one) must leave every other note's samples
// as they were, except a later note of the same sampled instrument whose take moved. Which take sounds is read from the
// stem's samples (each take has its own overtone), never only from the job's own `meta`.
import { describe, expect, it } from 'vitest';
import {
  AC, BELLS_FIXTURE, firstDiff, firstSound, KEYS_FIXTURE, metaNotes, none, once, plan, pluck, readMeta, readStem, render, renderAll, sampled, scoreDoc,
  scoreWorld, sha256, synth, TIMEOUT, useShow, whichTake, type Event, type Flac, type Instrument,
} from './helpers.ts';

const bin = useShow();
const KEYS = KEYS_FIXTURE();
const BELLS = BELLS_FIXTURE();
const PITCH: Record<string, number> = { keys: 69, bells: 76 };
const TAKES: Record<string, Float64Array[]> = { keys: KEYS.takes.map((t) => t.samples), bells: BELLS.takes.map((t) => t.samples) };
/** Times are written in seconds, so no tempo map is needed; a "beat" here is 0.5 s (24,000 samples). */
const atBeat = (x: number): string => `${x / 2}s`;
const sampleAt = (x: number): number => x * 24_000;
const note = (beat: number, inst: string, pitch: number, dur = '0.2s'): Event & { beat: number } =>
  ({ beat, at: atBeat(beat), inst, pitch, dur, vel: 0.8, attack: 0, release: 0.01 });

const INSTRUMENTS: Record<string, Instrument> = { keys: sampled(KEYS, 'mix'), bells: sampled(BELLS, 'mix'), guitar: pluck('nylon', 'mix'), pad: synth('pad', 'pad') };
const GUITAR = [57, 60, 64, 62];
/** The `mix` stem's 24 notes, one a beat from beat 1, cycling keys, bells and the plucked string; the `pad` stem's three. */
function events(): Record<string, Event & { beat: number }> {
  const out: Record<string, Event & { beat: number }> = {};
  for (let i = 1; i <= 24; i++) {
    const inst = ['guitar', 'keys', 'bells'][i % 3]!;
    out[`n${String(i).padStart(2, '0')}`] = note(i, inst, inst === 'guitar' ? GUITAR[i % 4]! : PITCH[inst]!);
  }
  out.p1 = note(2, 'pad', 60, '4s');
  out.p2 = note(10, 'pad', 64, '4s');
  out.p3 = note(18, 'pad', 67, '3s');
  return out;
}
const doc = (extra: Record<string, Event & { beat: number }> = {}) => scoreDoc({ id: 'determinism', instruments: INSTRUMENTS, events: { ...events(), ...extra }, span: '40s', packs: [KEYS, BELLS] });
const D0 = doc();
/** One more note on the `pad` stem: unrelated to `mix`. */
const D1 = doc({ p4: note(26, 'pad', 62, '1s') });
/** One more keys note on `mix`, between n12 and n13 in time and in ID order. */
const ADDED_KEYS = { id: 'n12x', ...note(12.5, 'keys', 69) };
const D2 = doc({ [ADDED_KEYS.id]: ADDED_KEYS });
/** One more plucked note on `mix`, between n15 and n16. */
const ADDED_PLUCK = { id: 'n15x', ...note(15.5, 'guitar', 62) };
const D3 = doc({ [ADDED_PLUCK.id]: ADDED_PLUCK });

const world1 = once(() => scoreWorld([KEYS, BELLS]));
const world2 = once(() => scoreWorld([KEYS, BELLS]));

/** A note's samples are compared from its onset for 0.24 s (it sounds 0.21 s), never past the next onset in either score. */
const WINDOW = Math.round(0.24 * 48_000);
/**
 * The judge for one added note: every other note's samples are as they were, unless it is a later note of the added
 * note's sampled instrument whose take moved. Each failure names the note, its time and what changed.
 */
function judgeAdded(before: Flac, after: Flac, notes: Record<string, Event & { beat: number }>, added: { id: string; beat: number; inst: string }): string[] {
  const failures: string[] = [];
  const onsets = [...Object.values(notes).map((n) => n.beat), added.beat].map(sampleAt).sort((a, b) => a - b);
  for (const [id, n] of Object.entries(notes)) {
    if (n.inst === 'pad') continue;
    const s = sampleAt(n.beat);
    const end = Math.min(s + WINDOW, onsets.find((o) => o > s) ?? Infinity);
    const sampledInst = TAKES[n.inst] !== undefined;
    const was = sampledInst ? whichTake(before, s, TAKES[n.inst]!).take : -1;
    const now = sampledInst ? whichTake(after, s, TAKES[n.inst]!).take : -1;
    const mayMove = sampledInst && n.inst === added.inst && n.beat > added.beat;
    if (mayMove && was !== now) continue;
    if (was !== now) failures.push(`${id} (${n.inst} at beat ${n.beat}) changed take ${was + 1} -> ${now + 1} when ${added.id} (${added.inst} at beat ${added.beat}) was added${n.inst === added.inst ? ', a note before it' : ', on another instrument'}`);
    const d = firstDiff(before, after, s, end);
    if (d >= 0) failures.push(`${id} (${n.inst} at beat ${n.beat}) sounds otherwise from sample ${d} (${((d - s) / 48).toFixed(2)} ms into it) when ${added.id} was added: its noise or take changed`);
  }
  return failures;
}
/** Every pair of consecutive notes that sound the same take, by index. */
const repeats = (takes: readonly unknown[]): number[] => takes.flatMap((t, i) => (i > 0 && t === takes[i - 1] ? [i] : []));

describe(`${AC[1]} stems are identical by hash on two runs and after an unrelated note; one added note moves no other note's noise or earlier take, and no take on another instrument; 1,024 notes on four takes never repeat a take`, () => {
  it(`${AC[1]} two runs in two fresh hubs give the same stem hashes, and the mix stem is the same when the second score has one more note on its pad stem`, async () => {
    const { w: w1, dirs: dirs1 } = await world1();
    const first = await renderAll(w1, plan(bin(), w1.evidence, D0, dirs1, 'the score in world 1'), 'the score in world 1');
    const { w: w2, dirs: dirs2 } = await world2();
    const withPad = await renderAll(w2, plan(bin(), w2.evidence, D1, dirs2, 'the score plus a pad note in world 2'), 'the score plus a pad note in world 2');
    expect(withPad.mix?.cache, 'world 2 renders its mix stem afresh (its cache is its own)').toBe('miss');
    expect(withPad.mix?.stem, 'the mix stem is identical by hash after an unrelated note is added to the pad stem, rendered afresh in another hub').toBe(first.mix?.stem);
    expect(withPad.pad?.stem, 'the pad stem, which gained a note, changed').not.toBe(first.pad?.stem);
    const second = await renderAll(w2, plan(bin(), w2.evidence, D0, dirs2, 'the score in world 2'), 'the score in world 2');
    expect(second.pad?.cache, 'world 2 renders the original pad stem afresh').toBe('miss');
    expect(Object.keys(second).sort(), 'the same stems').toEqual(Object.keys(first).sort());
    for (const name of Object.keys(first)) expect(second[name]?.stem, `stem ${name} is identical by hash on the second run`).toBe(first[name]?.stem);
  }, TIMEOUT);

  it(`${AC[1]} adding one note to a stem changes no other note's noise, no take before it and no take on another instrument (a keys note, then a plucked note, added to the mix stem)`, async () => {
    const { w, dirs } = await world2();
    const base = await render(w, plan(bin(), w.evidence, D0, dirs, 'the score').stems.mix!, 'the score: mix');
    const before = readStem(w, base.stem, 'the score: mix');
    const notes = events();
    // Every note sounds where it is placed, so the windows the judge compares hold that note.
    for (const [id, n] of Object.entries(notes)) if (n.inst !== 'pad') expect(Math.abs(firstSound(before, sampleAt(n.beat) - 2400, sampleAt(n.beat) + 2400) - sampleAt(n.beat)), `${id} starts at its beat in the mix stem`).toBeLessThanOrEqual(1);
    for (const [added, d] of [[ADDED_KEYS, D2], [ADDED_PLUCK, D3]] as const) {
      const r = await render(w, plan(bin(), w.evidence, d, dirs, `the score plus ${added.id}`).stems.mix!, `the score plus ${added.id}: mix`);
      const after = readStem(w, r.stem, `the score plus ${added.id}: mix`);
      expect(Math.abs(firstSound(after, sampleAt(added.beat) - 2400, sampleAt(added.beat) + 2400) - sampleAt(added.beat)), `${added.id} sounds at its beat`).toBeLessThanOrEqual(1);
      none(judgeAdded(before, after, notes, added), `adding ${added.id} (${added.inst})`);
      // The job's own record says the same: no take before the added note, and none on another instrument, moved.
      const was = new Map(metaNotes(readMeta(w, base.meta, 'the score: meta'), 'the score: meta').map((m) => [m.event, JSON.stringify(m.take)]));
      const now = new Map(metaNotes(readMeta(w, r.meta, `plus ${added.id}: meta`), `plus ${added.id}: meta`).map((m) => [m.event, JSON.stringify(m.take)]));
      const moved = Object.entries(notes).filter(([id, n]) => TAKES[n.inst] && !(n.inst === added.inst && n.beat > added.beat) && was.get(id) !== now.get(id)).map(([id]) => `${id}: ${was.get(id)} -> ${now.get(id)}`);
      expect(moved, `meta: no take before ${added.id} and none on another instrument moved`).toEqual([]);
    }
  }, TIMEOUT);

  it(`${AC[1]} over 1,024 notes on an instrument with four takes no note repeats the previous note's take, read from the stem; a round robin without the fold repeats and fails`, async () => {
    const { w, dirs } = await world1();
    const ids: string[] = [];
    const notes: Record<string, Event> = {};
    for (let k = 0; k < 1024; k++) {
      const id = `r${String(k).padStart(4, '0')}`;
      ids.push(id);
      notes[id] = { at: atBeat(1 + 0.25 * k), inst: 'keys', pitch: 69, dur: '0.1s', vel: 0.8, attack: 0, release: 0.01 };
    }
    const d = scoreDoc({ id: 'roundrobin', instruments: { keys: sampled(KEYS, 'run') }, events: notes, span: '140s', packs: [KEYS] });
    const r = await render(w, plan(bin(), w.evidence, d, dirs, 'the 1,024-note score').stems.run!, 'the 1,024-note score: run');
    const stem = readStem(w, r.stem, 'the 1,024-note score: run');
    const heard = ids.map((id, k) => ({ id, ...whichTake(stem, sampleAt(1 + 0.25 * k), TAKES.keys!) }));
    const unclear = heard.filter((h) => h.score < 0.98 || h.score - h.next < 0.1).map((h) => `${h.id}: best ${h.score.toFixed(3)}, next ${h.next.toFixed(3)}`);
    expect(unclear, 'each note sounds one of the four takes, recognizably').toEqual([]);
    const takes = heard.map((h) => h.take);
    expect(repeats(takes).map((i) => `${ids[i - 1]} and ${ids[i]} both sound take ${takes[i]! + 1}`), 'no note repeats the previous note\'s take, read from the stem').toEqual([]);
    expect(new Set(takes).size, 'the round robin uses all four takes').toBe(4);
    const meta = metaNotes(readMeta(w, r.meta, 'the 1,024-note score: meta'), 'the 1,024-note score: meta');
    const metaTakes = ids.map((id) => JSON.stringify(meta.find((m) => m.event === id)?.take));
    expect(repeats(metaTakes).map((i) => ids[i]), 'meta: no note repeats the previous note\'s take').toEqual([]);
    const pairs = new Set(ids.map((_, k) => `${metaTakes[k]}=${takes[k]}`));
    expect(pairs.size, `meta's takes are the takes the stem sounds, one to one: ${[...pairs].join(', ')}`).toBe(4);
    // The planted round robin: a take from each note's own hash, mod 4, with no fold. This suite's judge fails it.
    const noFold = ids.map((id) => parseInt(sha256(`score\u0000${id}\u0000take`).slice(0, 8), 16) % 4);
    expect(repeats(noFold).length, 'the planted round robin without the fold repeats a take, and the judge above fails it').toBeGreaterThan(0);
  }, TIMEOUT);
});
