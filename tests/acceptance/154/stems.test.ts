// AC1 #154.c8c95dbc: "A score renders identical stems by hash on two runs and after an unrelated note is added to
// another stem, and adding one note to a stem changes no other note's noise, no take before it and no take on another
// instrument, while over 1,000 notes on an instrument with four takes no note repeats the previous note's take"
//
// asserts: the song (README: Fixtures) planned by deep-show's score_plan and rendered stem by stem with deep_job on
// deepbuild/score, in two hubs: every stem is a fresh render (a miss) in each, and the same stem hashes come out, the
// second hub rendering the song with a note added to `strings` first (so `keys` and `pads` are rendered fresh from the
// edited score) and the song as it was after. A harp note added to `keys` between two harp notes: the new stem equals
// the old plus that note rendered alone (the same item and event ID), sample for sample, so no other note's noise
// moved, and every piano and bell note keeps the take heard in it. A piano note added on 3:3 under an ID that sorts
// before every other: each piano note before it keeps its take, each bell note keeps its own, and the stem is the same
// up to its onset. The etude's 1,000 notes on four takes: the take heard at each note (each take carries a harmonic of
// its own) is never the previous note's, and the steps between takes aren't one fixed cycle (the draws are hashed).
import { describe, expect, it } from 'vitest';
import {
  AC, ADDED, BELL, ETUDE_NOTES, PIANO, SONG_BPM, TIMEOUT, cacheOf, etude, flickAt, harpAlone, heardTake, hz, keysLibrary, mono, packDirs, planOf, planReply,
  proof, renderPlan, renderStem, outputsOf, sampleOf, scoreWorld, song, stemOf, judgeSum, useShow, type Plan, type World,
} from './helpers.ts';

const showBin = useShow();
const LIB = keysLibrary();
let shared: Promise<World> | undefined;
/** One world for the three edit tests of this file: deepbuild/score and test/keys, fetched. */
const world = (): Promise<World> => (shared ??= scoreWorld([LIB]));

function plan(w: World, document: ReturnType<typeof song>, item: string, what: string): Plan {
  return planOf(planReply(showBin(), w.evidence, document, item, packDirs(w), what), what);
}
/** The take heard at each of `events` in a stem, from the plan's note_on samples. */
function heard(x: Float64Array, p: Plan, events: { id: string }[], f0: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const n = p.note_on.find((o) => o.event === e.id);
    expect(n, `the plan's note_on lists ${e.id}`).toBeDefined();
    out[e.id] = heardTake(x, n!.sample, f0);
  }
  return out;
}

describe(`${AC[1]} stems by hash, hashed draws and the round robin`, () => {
  it(`${AC[1]} two hubs render the song's stems with the same hashes, and a note added to strings leaves keys and pads byte for byte`, async () => {
    const w1 = await scoreWorld([LIB]);
    const original = plan(w1, song(LIB), 'song', 'the song');
    expect(Object.keys(original.stems).sort(), 'the song plans its three stems').toEqual(['keys', 'pads', 'strings']);
    const first = await renderPlan(w1, original, 'the song in the first hub');
    for (const [name, r] of Object.entries(first)) expect([cacheOf(r.outcome), r.started > 0], `the first hub renders ${name} fresh: ${r.outcome.text.slice(0, 400)}`).toEqual(['miss', true]);

    const w2 = await scoreWorld([LIB]);
    const editedPlan = plan(w2, song(LIB, 'strings_note'), 'song', 'the song with g_new on strings');
    const edited = await renderPlan(w2, editedPlan, 'the song with g_new on strings, in the second hub');
    for (const [name, r] of Object.entries(edited)) expect([cacheOf(r.outcome), r.started > 0], `the second hub renders ${name} of the edited song fresh: ${r.outcome.text.slice(0, 400)}`).toEqual(['miss', true]);
    const again = await renderPlan(w2, plan(w2, song(LIB), 'song', 'the song, again'), 'the song in the second hub');
    expect([cacheOf(again['strings']!.outcome), again['strings']!.started > 0], 'the second hub renders the song\'s strings fresh').toEqual(['miss', true]);
    proof('ac1-two-runs.json', {
      first: Object.fromEntries(Object.entries(first).map(([n, r]) => [n, r.stem])),
      edited: Object.fromEntries(Object.entries(edited).map(([n, r]) => [n, r.stem])),
      again: Object.fromEntries(Object.entries(again).map(([n, r]) => [n, r.stem])),
    });
    expect(edited['keys']!.stem, 'keys, rendered fresh from the score with a note added to strings, is the first hub\'s keys by hash').toBe(first['keys']!.stem);
    expect(edited['pads']!.stem, 'pads, rendered fresh from the score with a note added to strings, is the first hub\'s pads by hash').toBe(first['pads']!.stem);
    expect(edited['strings']!.stem, 'strings with g_new is another stem').not.toBe(first['strings']!.stem);
    for (const name of ['keys', 'pads', 'strings']) expect(again[name]!.stem, `the second run's ${name} is the first's by hash`).toBe(first[name]!.stem);
  }, TIMEOUT);

  it(`${AC[1]} a harp note added to keys changes no other note's noise and no take of piano or bell`, async () => {
    const w = await world();
    const without = plan(w, song(LIB), 'song', 'the song');
    const withNote = plan(w, song(LIB, 'harp_note'), 'song', 'the song with h_new');
    const alone = plan(w, harpAlone(), 'song', 'h_new alone');
    const r = {
      without: outputsOf(await renderStem(w, without.stems['keys']!), 'keys of the song'),
      with: outputsOf(await renderStem(w, withNote.stems['keys']!), 'keys with h_new'),
      alone: outputsOf(await renderStem(w, alone.stems['keys']!), 'h_new alone'),
    };
    const s = { without: stemOf(w, r.without.stem, 'keys'), with: stemOf(w, r.with.stem, 'keys with h_new'), alone: stemOf(w, r.alone.stem, 'h_new alone') };
    const aloneLevel = Math.max(...Array.from(mono(s.alone), Math.abs));
    expect(aloneLevel, 'h_new alone sounds (its stem peaks above −40 dBFS)').toBeGreaterThan(0.01);
    const sum = judgeSum(s.with, s.without, s.alone, 2);
    const takes = {
      without: { piano: heard(mono(s.without), without, PIANO, hz(60)), bell: heard(mono(s.without), without, BELL, hz(72)) },
      with: { piano: heard(mono(s.with), withNote, PIANO, hz(60)), bell: heard(mono(s.with), withNote, BELL, hz(72)) },
    };
    proof('ac1-noise.json', { stems: r, sum, takes });
    expect(sum, `keys with ${ADDED.harp_note} is keys without it plus ${ADDED.harp_note} alone, so no other note's noise moved: ${sum.join(' | ')}`).toEqual([]);
    expect(takes.with.piano, 'every piano note keeps its take').toEqual(takes.without.piano);
    expect(takes.with.bell, 'every bell note keeps its take').toEqual(takes.without.bell);
  }, TIMEOUT);

  it(`${AC[1]} a piano note added on 3:3 moves no piano take before it and no bell take, and the stem is the same up to its onset`, async () => {
    const w = await world();
    const without = plan(w, song(LIB), 'song', 'the song');
    const withNote = plan(w, song(LIB, 'piano_note'), 'song', 'the song with a0_extra');
    const a = stemOf(w, outputsOf(await renderStem(w, without.stems['keys']!), 'keys of the song').stem, 'keys');
    const b = stemOf(w, outputsOf(await renderStem(w, withNote.stems['keys']!), 'keys with a0_extra').stem, 'keys with a0_extra');
    const onset = sampleOf(flickAt('3:3', SONG_BPM));
    const before = PIANO.filter((p) => flickAt(p.at, SONG_BPM) < flickAt('3:3', SONG_BPM));
    const takes = {
      without: { piano: heard(mono(a), without, before, hz(60)), bell: heard(mono(a), without, BELL, hz(72)) },
      with: { piano: heard(mono(b), withNote, before, hz(60)), bell: heard(mono(b), withNote, BELL, hz(72)), added: heard(mono(b), withNote, [{ id: ADDED.piano_note }], hz(60)) },
    };
    let firstOff = -1;
    for (let i = 0; i < onset && firstOff < 0; i++) if (a.samples[0]![i] !== b.samples[0]![i] || a.samples[1]![i] !== b.samples[1]![i]) firstOff = i;
    proof('ac1-take-before.json', { onset, before: before.map((p) => p.id), takes, firstOff });
    expect(before.length, 'five piano notes come before 3:3').toBe(5);
    expect(takes.with.piano, `each piano note before ${ADDED.piano_note} keeps its take`).toEqual(takes.without.piano);
    expect(takes.with.bell, `each bell note keeps its take: ${ADDED.piano_note} is on another instrument`).toEqual(takes.without.bell);
    expect(firstOff, `keys is the same sample for sample before ${ADDED.piano_note}'s onset at sample ${onset}`).toBe(-1);
  }, TIMEOUT);

  it(`${AC[1]} over the etude's 1,000 notes on four takes, no note repeats the previous note's take`, async () => {
    const w = await world();
    const p = plan(w, etude(LIB), 'etude', 'the etude');
    const keys = p.stems['keys'];
    expect(keys, 'the etude plans its stem keys').toBeDefined();
    expect(keys!.inputs.length, 'its one instrument plays a preset of four takes').toBe(4);
    const x = mono(stemOf(w, outputsOf(await renderStem(w, keys!), 'the etude').stem, 'the etude'));
    const notes = p.note_on.filter((n) => n.stem === 'keys').sort((m, n) => m.sample - n.sample);
    expect(notes.length, 'the etude has 1,000 notes').toBe(ETUDE_NOTES);
    notes.forEach((n, k) => expect(n.sample, `${n.event} sits on sample ${k} × 3,000`).toBe(k * 3000));
    const takes = notes.map((n) => heardTake(x, n.sample, hz(60)));
    const repeats = takes.flatMap((t, k) => (k > 0 && t === takes[k - 1] ? [`${notes[k]!.event} repeats take ${t + 1} of ${notes[k - 1]!.event}`] : []));
    const steps = new Set(takes.slice(1).map((t, k) => (t - takes[k]! + 4) % 4));
    const used = new Set(takes);
    proof('ac1-etude.json', { takes: takes.map((t, k) => `${notes[k]!.event}:${t + 1}`), repeats: repeats.length, steps: [...steps] });
    expect(repeats, `no note repeats the previous note's take: ${repeats.slice(0, 8).join('; ')}`).toEqual([]);
    expect(used.size, 'all four takes are heard').toBe(4);
    expect(steps.size, 'the take steps aren\'t one fixed cycle: the round robin starts from a hashed draw').toBeGreaterThan(1);
  }, TIMEOUT);
});
