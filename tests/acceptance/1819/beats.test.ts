// AC2: "A click track at 100 BPM reads 100 ± 0.5 BPM and one at 96 BPM reads 96 ± 0.5 BPM; a planted tracker that
// returns a fixed 120 BPM fails, naming the asset"
//
// Two 30 s click tracks at 48 kHz (fixtures/synth.ts clickTrack), a click every 0.6 s and every 0.625 s from 0.5 s, on
// whole samples, so their tempos are exactly 100 and 96 BPM. Through the design's surfaces (README: The surface): each
// media_bake {kind: beats, analyzer: beat-this@1.1.0} with no record is BLOCKED and keeps its PCM; deep_job runs
// bake.beats on beat-this@1.1.0 with that PCM by hash; media_bake with the record answers `beats` and `tempo`, which
// must read 100 ± 0.5 and 96 ± 0.5. The planted tracker `beats_fixed_120` (a deep-show scenario plant, README: Planted
// programs) answers 120 BPM on both records and fails, its failure for each track naming the asset.
import { describe, expect, it } from 'vitest';
import { clickTrack, pcmBytes, sha256, wavF32 } from './fixtures/synth.ts';
import { AC, JOB, TIMEOUT, TRACKER, bakes, mustBlockForPcm, mustRecord, openWorld, proof, readings, useShow, withBakes, type Bake, type Line, type ShowPlant } from './helpers.ts';

const show = useShow();

interface Track { bpm: number; asset: string; ask: Bake; record?: string }

/** Each track's tempo against its own, within 0.5 BPM; each failure names the track's asset. */
function judgeTempo(tracks: Track[], replies: Line[], label: string): { failures: string[]; tempos: unknown[] } {
  const failures: string[] = [];
  const tempos = tracks.map((t, i) => {
    const tempo = readings(replies[i]!, t.ask, `${label}: the ${t.bpm} BPM click track`).tempo as unknown;
    if (typeof tempo !== 'number' || !Number.isFinite(tempo)) failures.push(`the asset ${t.asset} (the ${t.bpm} BPM click track): its beats bake answers no tempo: ${JSON.stringify(tempo)}`);
    else if (Math.abs(tempo - t.bpm) > 0.5) failures.push(`the asset ${t.asset} (the ${t.bpm} BPM click track) reads ${tempo.toFixed(3)} BPM, not ${t.bpm} ± 0.5`);
    return tempo;
  });
  return { failures, tempos };
}

describe('AC2 the beats bake reads a click track\'s tempo within 0.5 BPM', () => {
  it(`${AC[2]} click tracks at 100 and 96 BPM read 100 ± 0.5 and 96 ± 0.5 BPM; the planted tracker beats_fixed_120 reads 120 and fails, naming each asset`, async () => {
    const made = [clickTrack(100), clickTrack(96)];
    const wavs = made.map((c) => wavF32(c.samples, c.rate));
    const tracks: Track[] = made.map((c, i) => {
      const asset = sha256(wavs[i]!);
      return { bpm: c.bpm, asset, ask: { asset, kind: 'beats', analyzer: TRACKER } };
    });
    const w = await openWorld(wavs);
    const pcms = tracks.map((t, i) => mustBlockForPcm(show(), w, t.ask, pcmBytes(made[i]!.samples), `the ${t.bpm} BPM click track, with no record`));

    await withBakes(w);
    for (const [i, t] of tracks.entries()) t.record = (await mustRecord(w, JOB.beats, TRACKER, [{ name: 'pcm', sha256: pcms[i]! }], made[i]!.rate)).record;
    const asked = tracks.map((t) => ({ ...t.ask, record: t.record! }));
    const clean = judgeTempo(tracks, bakes(show(), w, asked, 'the click tracks'), 'the click tracks');
    proof('ac2-tempo.json', { tracks: tracks.map(({ bpm, asset, record }) => ({ bpm, asset, record })), tempos: clean.tempos, failures: clean.failures });
    expect(clean.failures, 'each click track reads its tempo within 0.5 BPM').toEqual([]);

    const plant: ShowPlant = 'beats_fixed_120';
    const planted = judgeTempo(tracks, bakes(show(), w, asked, 'the click tracks', plant), `the click tracks (planted ${plant})`);
    proof('ac2-planted.json', { plant, tempos: planted.tempos, failures: planted.failures });
    expect(planted.tempos.every((t) => typeof t === 'number' && Math.abs(t - 120) <= 0.5), `the planted tracker ${plant} reads 120 BPM on both tracks: ${JSON.stringify(planted.tempos)}`).toBe(true);
    expect(tracks.map((t) => planted.failures.some((f) => f.includes(t.asset))), `the planted tracker ${plant} fails each track, naming its asset: ${JSON.stringify(planted.failures)}`).toEqual([true, true]);
  }, TIMEOUT);
});
