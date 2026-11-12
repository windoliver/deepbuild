// AC1: "A `music` result declared 100 BPM, 4/4, with a 16-bar loop region passes `audio.gen` when the region is
// 38.400 s ± 1 ms and the pinned beat tracker reads 100 ± 0.5 BPM. A planted result generated at 96 BPM fails, naming
// the measured tempo. A planted region of 38.2 s fails, naming the bar count it implies"
//
// The clean bed (fixtures/synth.ts bed: 16 bars at 100 BPM, 1,843,200 samples, its drums, bass and pad declared as
// stems, at the music bus's −23 LUFS) meets every rule of the design's row. Its beats record is made the way the design
// makes one (Analysis bake, #1819): media_bake keeps the PCM, deep_job runs bake.beats on beat-this@1.1.0 through the
// model host, and media_bake reads the record's tempo, which must be 100 ± 0.5. The planted results: the same bed
// rendered at 96 BPM for the same 38.4 s, with its own record (the tracker must read 96 ± 0.5), and the clean bed with
// its region declared 38.2 s (1,833,600 samples, 15.917 bars of 2.4 s). Each is one `sounds` entry read by media_gen.
import { describe, expect, it } from 'vitest';
import { JOB, bakes, mustBlockForPcm, mustRecord, openWorld, readings, withBakes, type Bake } from '../1819/helpers.ts';
import { RATE, bed, barSamples, pcmBytes, sha256, wavF32 } from './fixtures/synth.ts';
import { AC, REGION, TIMEOUT, TRACKER, forProof, gens, mediaDoc, music, namesNumber, ofCode, proof, show, useShow } from './helpers.ts';

const deepShow = useShow();

describe('AC1 a music bed passes audio.gen on its measured tempo and whole bars', () => {
  it(`${AC[1]} a 100 BPM 4/4 bed with a 16-bar region of 38.400 s, read 100 ± 0.5 BPM by the pinned tracker, passes; a bed generated at 96 BPM fails naming the measured tempo; a region of 38.2 s fails naming 15.917 bars`, async () => {
    const clean = bed(100, 16);
    const slow = bed(96, 16).mix.slice(0, REGION);
    expect(clean.length, 'fixture: the clean bed is 16 bars of 2.4 s, 38.400 s').toBe(REGION);
    const wav = { loop: wavF32(clean.mix), drums: wavF32(clean.stems.drums), bass: wavF32(clean.stems.bass), pad: wavF32(clean.stems.pad), slow: wavF32(slow) };
    const asset = Object.fromEntries(Object.entries(wav).map(([k, b]) => [k, sha256(b)])) as Record<keyof typeof wav, string>;
    const pcm = { loop: sha256(pcmBytes(clean.mix)), slow: sha256(pcmBytes(slow)) };
    const stems = { drums: asset.drums, bass: asset.bass, pad: asset.pad };
    const short = Math.round(38.2 * RATE);
    const w = await openWorld(Object.values(wav));
    const bin = deepShow();

    // With no record the tempo rule can't read a tempo: the clean bed is BLOCKED, naming the tracker and its PCM's hash.
    const unread = gens(bin, w.evidence, mediaDoc({ loop: music(asset.loop, REGION, { stems }) }), ['loop'], 'the clean bed with no beats record')['loop']!;
    proof('ac1-no-record.json', forProof(unread));
    expect(unread.state, `the clean bed with no beats record is BLOCKED (nothing missing passes): ${show(unread.raw)}`).toBe('BLOCKED');
    expect([TRACKER, pcm.loop].every((s) => JSON.stringify(unread.blocked ?? null).includes(s)), `its \`blocked\` names ${TRACKER} and the PCM's hash ${pcm.loop}: ${show(unread.blocked)}`).toBe(true);
    expect(unread.issues.map((i) => i.raw), 'the clean bed breaks no rule it can read without a record').toEqual([]);

    // The records: the PCM kept by media_bake (#1819), the model host, deep_job bake.beats on the pinned tracker.
    const ask = (a: string, record?: string): Bake => ({ asset: a, kind: 'beats', analyzer: TRACKER, ...(record ? { record } : {}) });
    mustBlockForPcm(bin, w, ask(asset.loop), pcmBytes(clean.mix), 'the clean bed, with no record');
    mustBlockForPcm(bin, w, ask(asset.slow), pcmBytes(slow), 'the 96 BPM bed, with no record');
    await withBakes(w);
    const record = {
      loop: (await mustRecord(w, JOB.beats, TRACKER, [{ name: 'pcm', sha256: pcm.loop }], RATE)).record,
      slow: (await mustRecord(w, JOB.beats, TRACKER, [{ name: 'pcm', sha256: pcm.slow }], RATE)).record,
    };
    const asks = [ask(asset.loop, record.loop), ask(asset.slow, record.slow)];
    const [tempoLoop, tempoSlow] = bakes(bin, w, asks, 'the beds\' beats records').map((r, i) => readings(r, asks[i]!, 'the beds\' beats').tempo as number);
    proof('ac1-tracker.json', { tracker: TRACKER, records: record, tempo: { clean: tempoLoop, generated_at_96: tempoSlow } });
    expect(Math.abs(tempoLoop! - 100) <= 0.5, `the pinned tracker reads the clean bed 100 ± 0.5 BPM (the criterion's condition): ${tempoLoop}`).toBe(true);
    expect(Math.abs(tempoSlow! - 96) <= 0.5, `the pinned tracker reads the bed generated at 96 BPM 96 ± 0.5 BPM: ${tempoSlow}`).toBe(true);

    const doc = mediaDoc({
      loop: music(asset.loop, REGION, { stems, beats: record.loop }),
      slow_loop: music(asset.slow, REGION, { beats: record.slow }),
      short_loop: music(asset.loop, short, { beats: record.loop }),
    });
    const g = gens(bin, w.evidence, doc, ['loop', 'slow_loop', 'short_loop'], 'the beds with their records');
    proof('ac1-gen.json', { region: { samples: REGION, seconds: REGION / RATE }, short: { samples: short, bars: short / barSamples(100) }, loop: forProof(g['loop']!), slow_loop: forProof(g['slow_loop']!), short_loop: forProof(g['short_loop']!) });

    const loop = g['loop']!;
    expect([loop.state, loop.issues.map((i) => i.raw)], `the clean bed passes audio.gen with no issue: ${show(loop.raw)}`).toEqual(['PASS', []]);

    const slowGen = g['slow_loop']!;
    const tempoIssues = ofCode(slowGen, 'audio.gen.tempo');
    expect(slowGen.state, `the bed generated at 96 BPM fails: ${show(slowGen.raw)}`).toBe('FAIL');
    expect(tempoIssues.some((i) => namesNumber(i, tempoSlow!, 0.06)), `the bed generated at 96 BPM fails with audio.gen.tempo naming the measured tempo ${tempoSlow!.toFixed(3)} BPM: ${show(tempoIssues.map((i) => i.raw))}`).toBe(true);

    const shortGen = g['short_loop']!;
    const bars = short / barSamples(100);
    const barIssues = ofCode(shortGen, 'audio.gen.bars');
    expect(shortGen.state, `the region of 38.2 s fails: ${show(shortGen.raw)}`).toBe('FAIL');
    expect(barIssues.some((i) => namesNumber(i, bars, 0.01)), `the region of 38.2 s fails with audio.gen.bars naming the bar count it implies, ${bars.toFixed(4)}: ${show(barIssues.map((i) => i.raw))}`).toBe(true);
  }, TIMEOUT);
});
