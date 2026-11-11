// AC7 #154.54798db1: "A score with loop {from: "5:1", to: "9:1"} gives stems whose loop points sit on those bar lines
// exactly, and three passes of the region by a looping strip match a straight render of those bars' events played
// three times in a row within −96 dBFS per sample from the second pass on, while on a fixture whose last note rings
// past the region's end the same stem looped without the fold differs there by more than −40 dBFS"
//
// asserts: the bed (README: Fixtures; 90 BPM, so 5:1 is sample 512,000 and 9:1 sample 1,024,000), every note in bars
// 5 to 8 and each stem's last note sounding past 9:1, planned with loop {from: "5:1", to: "9:1"} and rendered: each
// stem's FLAC carries LOOPSTART 512000 and LOOPLENGTH 512000 and its meta's loop is {start: 512000, end: 1024000}. The
// same score without the loop (the same item and event IDs, so the same draws) renders straight stems with no loop
// points. media_mix plays the looped stems as strips with `loop: true` from their start, and the straight stems once;
// three passes of the straight render laid one region apart (512,000 samples) and summed are the reference. From the
// second pass on (samples 1,024,000 to 2,048,000) the looping strips match it within −96 dBFS on every sample. The
// planted twin, built here from the straight render: its region [5:1, 9:1) repeated with no fold; it differs from the
// reference by more than −40 dBFS at the start of the second pass, and this test's judge fails it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { putEvidence, readWav, runShow, scenario } from '../501/helpers.ts';
import {
  AC, SAMPLE, TIMEOUT, dbfs, film, fromStore, judgeMatch, metaOf, packDirs, planOf, planReply, pluck, proof, renderPlan, scoreItem, scoreWorld,
  stemOf, synth, tempDir, tempo, useShow, type Ev, type JsonObject,
} from './helpers.ts';

const showBin = useShow();
const FROM = 512_000;
const TO = 1_024_000;
const PASS = TO - FROM;

/** The bed: `tone` (the synth sine) on stem bed, `chime` (the plucked harp) on stem ring, every note in bars 5 to 8;
 * s_last is held from 8:3 for 2 s and r_last rings from 8:4 for 1 s, both past 9:1. Velocities stay low, so the
 * master's limiter (−1 dBFS) never acts on the mixes compared. */
function bed(loop: boolean): JsonObject {
  const n = (at: string, inst: string, pitch: number, dur: string): Ev => ({ at, inst, pitch, dur, vel: 0.2, release: '0.1s' });
  const events: Record<string, Ev> = {
    s1: n('5:1', 'tone', 60, '2s'), s2: n('6:3', 'tone', 64, '1s'), s3: n('7:2', 'tone', 62, '1.5s'), s_last: n('8:3', 'tone', 67, '2s'),
    r1: n('5:1', 'chime', 72, '0.5s'), r2: n('7:1', 'chime', 76, '0.5s'), r_last: n('8:4', 'chime', 79, '1s'),
  };
  const instruments = { tone: synth('sine', 'bed'), chime: pluck('harp', 'ring') };
  return film([scoreItem('bed', instruments, events, loop ? { from: '5:1', to: '9:1' } : undefined)], { tempo: tempo(90), span: '24s' });
}
/** Stems copied into a store of their own and played by media_mix as `strips` (#499's media document): the master's
 * samples per channel, as floats, from its segment's WAV. */
function mix(bin: string, stems: Buffer[], strips: JsonObject, span: number, what: string): Float64Array[] {
  const evidence = tempDir();
  for (const bytes of stems) putEvidence(evidence, bytes);
  const doc: JsonObject = { transport: { sample_rate: 48_000, span }, strips };
  const replies = runShow(bin, scenario(evidence, [{ call: 'media_mix', doc, segments: [{ from: 0, to: span, write: true }] }]), what);
  const seg = (replies[0]?.['mix'] as JsonObject | undefined)?.['segments'] as JsonObject[] | undefined;
  const wav = seg?.[0]?.['wav'];
  expect(typeof wav, `${what}: media_mix writes its segment as a WAV: ${JSON.stringify(replies[0]).slice(0, 600)}`).toBe('string');
  const read = readWav(readFileSync(join(evidence, String(wav).slice(0, 2), String(wav).slice(2))), what);
  return read.channels.map((c) => Float64Array.from(c));
}

describe(`${AC[7]} a loop region folded, its points on the bar lines, seamless from the second pass`, () => {
  it(`${AC[7]} loop {5:1, 9:1}: loop points on the bar lines exactly, three looped passes match the straight render from the second pass within −96 dBFS, and the stem looped without the fold differs by more than −40 dBFS`, async () => {
    const bin = showBin();
    const w = await scoreWorld([]);
    const looped = planOf(planReply(bin, w.evidence, bed(true), 'bed', packDirs(w), 'the bed with its loop'), 'the bed with its loop');
    const straight = planOf(planReply(bin, w.evidence, bed(false), 'bed', packDirs(w), 'the bed without a loop'), 'the bed without a loop');
    expect(Object.keys(looped.stems).sort(), 'the bed plans two stems').toEqual(['bed', 'ring']);
    const a = await renderPlan(w, looped, 'the looped bed');
    const b = await renderPlan(w, straight, 'the straight bed');
    const points: Record<string, unknown> = {};
    for (const name of ['bed', 'ring']) {
      const f = stemOf(w, a[name]!.stem, `looped ${name}`);
      const meta = metaOf(w, a[name]!.meta, `looped ${name}`);
      points[name] = { LOOPSTART: f.comments['LOOPSTART'], LOOPLENGTH: f.comments['LOOPLENGTH'], meta: meta.loop };
      expect([f.comments['LOOPSTART'], f.comments['LOOPLENGTH']], `looped ${name}'s FLAC carries its loop points in samples: 5:1 is ${FROM}, 4 bars are ${PASS}`).toEqual([String(FROM), String(PASS)]);
      expect(meta.loop, `looped ${name}'s meta.loop is the region`).toEqual({ start: FROM, end: TO });
      const s = stemOf(w, b[name]!.stem, `straight ${name}`);
      expect(s.comments['LOOPSTART'], `straight ${name} has no loop points`).toBeUndefined();
      expect(metaOf(w, b[name]!.meta, `straight ${name}`).loop, `straight ${name}'s meta.loop is null`).toBeNull();
    }

    // The looped stems as strips with loop: true from their start, for three passes of the region and 0.5 s more.
    const stripSpan = (TO + 2 * PASS + 24_000) * SAMPLE;
    const span = stripSpan + 24_000 * SAMPLE;
    const strip = (sha: string, k: number, extra: JsonObject): JsonObject => ({ track: k + 1, src: { asset: sha }, start: 0, in: 0, out: stemOf(w, sha, sha).frames * SAMPLE, ...extra });
    const names = ['bed', 'ring'];
    const loopMix = mix(bin, names.map((n) => fromStore(w, a[n]!.stem, n)), Object.fromEntries(names.map((n, k) => [`loop_${n}`, strip(a[n]!.stem, k, { loop: true, span: stripSpan })])), span, 'the looped stems, looping');
    const once = mix(bin, names.map((n) => fromStore(w, b[n]!.stem, n)), Object.fromEntries(names.map((n, k) => [`once_${n}`, strip(b[n]!.stem, k, {})])), span, 'the straight stems, once');
    const end = TO + 2 * PASS;
    // The reference: the straight render played three times in a row, one region apart.
    const ref = once.map((c) => { const out = new Float64Array(end); for (let i = 0; i < end; i++) for (let k = 0; k < 3; k++) out[i] = out[i]! + (c[i - k * PASS] ?? 0); return out; });
    // The planted twin: the straight render's region repeated, with no fold.
    const twin = once.map((c) => { const out = new Float64Array(end); for (let i = 0; i < end; i++) out[i] = i < TO ? c[i] ?? 0 : c[FROM + ((i - TO) % PASS)] ?? 0; return out; });
    const seam = Math.max(...twin.map((c, ch) => { let m = 0; for (let i = TO; i < TO + 48_000; i++) m = Math.max(m, Math.abs(c[i]! - ref[ch]![i]!)); return m; }));
    const real = judgeMatch(loopMix, ref, TO, end, -96, 'the looping strips');
    const planted = judgeMatch(twin, ref, TO, end, -96, 'the stem looped without the fold');
    proof('ac7-loop.json', { points, stems: { looped: { bed: a['bed']!.stem, ring: a['ring']!.stem }, straight: { bed: b['bed']!.stem, ring: b['ring']!.stem } }, real, planted, seam_dbfs: dbfs(seam) });
    expect(real, `from the second pass on the looping strips match three straight passes within −96 dBFS: ${real.join(' | ')}`).toEqual([]);
    expect(dbfs(seam), `looped without the fold, the stem differs from three straight passes at the second pass's start by more than −40 dBFS (${dbfs(seam).toFixed(1)} dBFS)`).toBeGreaterThan(-40);
    expect(planted.length, 'this test\'s judge fails the stem looped without the fold').toBeGreaterThan(0);
  }, TIMEOUT);
});
