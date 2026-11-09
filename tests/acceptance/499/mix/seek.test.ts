// AC2: "Seeking into a recursive reverb matches playing to that time bit for bit by PCM hash, from its checkpoints, on
// the same build and architecture; a planted reverb that restores its checkpoint without its tail differs from the
// first sample after the seek and fails, naming the processor"
//
// AC6: "A recursive reverb played for 10 minutes with its checkpoint budget forced to 20 checkpoints' bytes keeps its
// ring within that budget, with checkpoints 32 s apart, and a seek to 9 minutes renders at most 32 s forward and
// matches playing bit for bit by PCM hash on the same build and architecture; a planted ring that drops its oldest
// checkpoint instead renders that seek from the start and fails, naming the processor"
//
// Through `media_mix` (README: The surface under test): one transport plays its segments in order, so a segment whose
// `from` isn't where the one before ended is a seek, in the same process, build and architecture as the play it is
// compared with. A noise strip feeds a bus whose processors are a lowpass EQ (`tone`) and then a feedback reverb
// (`verb`, the recursive kind: `ir: {decay, size, damping}`); each processor's output is hashed per segment (`taps`), so
// a failure names the first processor in the bus's order whose output after the seek differs from playing.
import { describe, expect, it } from 'vitest';
import {
  RATE, SEC, asset, atSample, firstDiff, loudest, mix, noise, pcmOf, sOf, sampleAt, secs, useEvidence, useShow,
  type MediaDoc, type Mix, type Planted, type Processor, type Segment,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const ORDER = ['tone', 'verb'] as const;
const TONE: Processor = { kind: 'eq', bands: [{ type: 'lowpass', freq: 6000, q: 0.707, gain: 0 }] };
const VERB: Processor = { kind: 'reverb', ir: { decay: 3, size: 0.8, damping: 0.3 }, mix: 0.5 };

function roomDoc(src: string, inputSeconds: number, span: number, verb: Processor, loop = false): MediaDoc {
  return {
    transport: { sample_rate: RATE, span },
    strips: { bed: { track: 0, asset: src, start: 0, in: 0, out: secs(inputSeconds), bus: 'room', ...(loop ? { loop: true } : {}) } },
    buses: { room: { processors: [...ORDER], out: 'master', layout: 'stereo' } },
    processors: { tone: TONE, verb },
  };
}

/**
 * What is wrong with one seek against the play it repeats: the seek must restore one of each processor's checkpoints
 * (at or before the target, no further back than `maxForward`) and render the same samples as playing, by hash, per
 * processor and at the master. Names the first processor, in the bus's order, whose output differs.
 */
function seekProblems(m: Mix, play: number, seek: number, maxForward: number, what: string): { f: string[]; named: string | null } {
  const f: string[] = [];
  const p = m.segments[play]!;
  const s = m.segments[seek]!;
  if (s.seek === null) return { f: [`${what}: the segment from ${sOf(s.first)} isn't reported as a seek (seek: null)`], named: null };
  for (const id of ORDER) {
    const r = s.seek[id];
    if (!r) { f.push(`processor \`${id}\`: the seek reports nothing for it (seek.${id} missing)`); continue; }
    const ring = m.processors[id]?.ring;
    if (r.restored === null) f.push(`processor \`${id}\`: the seek to ${s.from / SEC} s restored no checkpoint and rendered from ${r.rendered_from / SEC} s`);
    else {
      if (!ring?.checkpoints.some((c) => c.t === r.restored)) f.push(`processor \`${id}\`: the seek restored a checkpoint at ${r.restored / SEC} s that its ring doesn't hold (${JSON.stringify(ring?.checkpoints.map((c) => c.t / SEC))})`);
      if (r.restored > s.from) f.push(`processor \`${id}\`: the seek restored a checkpoint at ${r.restored / SEC} s, after the seek's ${s.from / SEC} s`);
      if (r.rendered_from !== r.restored) f.push(`processor \`${id}\`: rendered from ${r.rendered_from / SEC} s, not from the checkpoint it restored at ${r.restored / SEC} s`);
    }
    if (s.from - r.rendered_from > maxForward) f.push(`processor \`${id}\`: the seek to ${s.from / SEC} s rendered ${(s.from - r.rendered_from) / SEC} s forward (from ${r.rendered_from / SEC} s), more than ${maxForward / SEC} s`);
  }
  let named: string | null = null;
  for (const id of ORDER) {
    if (p.taps[id] === undefined || s.taps[id] === undefined) { f.push(`processor \`${id}\`: no output hash (taps.${id}) on the play or the seek`); continue; }
    if (p.taps[id] !== s.taps[id]) {
      named = id;
      f.push(`processor \`${id}\`: its output after the seek to ${s.from / SEC} s differs from playing to that time (tap ${s.taps[id]} vs ${p.taps[id]})`);
      break;
    }
  }
  if (p.sha256 !== s.sha256) f.push(`the mix after the seek to ${s.from / SEC} s differs from playing by PCM hash (${s.sha256} vs ${p.sha256})`);
  return { f, named };
}

describe('AC2 seeking into a recursive reverb matches playing bit for bit', () => {
  it('AC2 a noise bed through a lowpass and a 3 s feedback reverb, played to 12 s and then seeked to 7.3 s (mid-block) and played to 12 s, gives the same PCM hash from the reverb\'s checkpoints, the tail still ringing after the bed stops at 8 s; a planted reverb that restores its checkpoint without its tail differs from the first sample after the seek and fails, naming `verb`', () => {
    const SEEK = atSample(350_400); // 7.3 s: 2,737.5 blocks in, so the seek lands mid-block
    const END = secs(12);
    const segments: Segment[] = [{ from: 0, to: SEEK }, { from: SEEK, to: END, write: true }, { from: SEEK, to: END, write: true }];
    const run = (planted?: Planted) => {
      const evidence = evidenceDir();
      const bed = asset(evidence, [noise(8 * RATE, 0.25, 499_02)]).sha;
      const m = mix(show(), evidence, roomDoc(bed, 8, END, VERB), segments, 'the reverb, played then seeked', planted);
      const played = pcmOf(evidence, m.segments[1]!, 'playing from 7.3 s');
      const seeked = pcmOf(evidence, m.segments[2]!, 'the seek to 7.3 s');
      return { m, played, seeked };
    };

    const { m, played, seeked } = run();
    expect(m.segments[0]!.seek, 'the first segment plays from the transport\'s start (seek: null)').toBeNull();
    expect(m.segments[1]!.seek, 'the second segment continues where the first ended (seek: null)').toBeNull();
    // The reverb is recursive and its state matters at the seek: it is still ringing after its input stops.
    const tail = loudest(played, sampleAt(secs(8.5)), sampleAt(secs(9)));
    expect(tail > 1e-3, `the reverb's tail still rings half a second after the bed stops at 8 s (peak ${tail} over 8.5–9 s)`).toBe(true);
    const { f } = seekProblems(m, 1, 2, SEC, 'the seek to 7.3 s');
    const d = firstDiff(played, seeked);
    if (d !== null) f.push(`the seek's samples differ from playing's, first at ${sOf(d)}`);
    expect(f, 'seeking into the reverb equals playing, from its checkpoints').toEqual([]);

    // Wrong program: the reverb restores its checkpoint without its tail (its delay lines empty).
    const w = run('reverb_restores_without_tail');
    const { f: wf, named } = seekProblems(w.m, 1, 2, SEC, 'the seek to 7.3 s');
    const wd = firstDiff(w.played, w.seeked);
    expect(wd, `planted reverb_restores_without_tail differs from the first sample after the seek, ${sOf(sampleAt(SEEK))}; got ${wd === null ? 'no difference' : sOf(wd)}`).toBe(sampleAt(SEEK));
    expect(named, `planted reverb_restores_without_tail fails naming the processor \`verb\` (the EQ before it unchanged); got ${JSON.stringify(wf)}`).toBe('verb');
  }, 1_800_000);
});

describe('AC6 a ten-minute reverb on a forced budget keeps its ring within it, 32 s apart, and seeks to 9 minutes from it', () => {
  it('AC6 with its byte budget forced to 20 of its own checkpoints, a reverb played over a looping bed for 10 minutes keeps its ring within the budget with checkpoints 32 s apart; a seek to 9 minutes restores one and renders at most 32 s forward, matching playing by PCM hash; a planted ring that drops its oldest checkpoint renders that seek from the start and fails, naming `verb`', () => {
    const TEN = secs(600);
    const NINE = secs(540);
    const W = secs(545);
    const SPACING = 32 * SEC;

    // One checkpoint's bytes, from the same reverb's own ring on a short play.
    const probeEv = evidenceDir();
    const probeBed = asset(probeEv, [noise(7 * RATE, 0.25, 499_06)]).sha;
    const short = mix(show(), probeEv, roomDoc(probeBed, 7, secs(5), VERB, true), [{ from: 0, to: secs(5) }], 'a short play, for one checkpoint\'s bytes');
    const cps = short.processors['verb']?.ring.checkpoints ?? [];
    expect(cps.length, `the reverb checkpoints on a short play (every second by default): ${JSON.stringify(short.processors['verb'])}`).toBeGreaterThanOrEqual(4);
    const one = Math.max(...cps.map((c) => c.bytes));
    expect(one > 0, 'a reverb checkpoint holds its tail, so it has bytes').toBe(true);
    const budget = 20 * one;

    const segments: Segment[] = [{ from: 0, to: NINE }, { from: NINE, to: W, write: true }, { from: W, to: TEN }, { from: NINE, to: W, write: true }];
    const run = (planted?: Planted) => {
      const evidence = evidenceDir();
      const bed = asset(evidence, [noise(7 * RATE, 0.25, 499_06)]).sha;
      const m = mix(show(), evidence, roomDoc(bed, 7, TEN, { ...VERB, byte_budget: budget }, true), segments, 'ten minutes of reverb, then a seek to 9 minutes', planted);
      return { m, evidence };
    };

    const { m, evidence } = run();
    const f: string[] = [];
    const ring = m.processors['verb']?.ring;
    expect(ring, 'the reply reports the reverb\'s ring (processors.verb.ring)').toBeDefined();
    if (ring!.budget !== budget) f.push(`processor \`verb\`: its ring's budget is ${ring!.budget} bytes, not the forced ${budget} (20 checkpoints of ${one})`);
    if (ring!.peak_bytes > budget) f.push(`processor \`verb\`: its ring reached ${ring!.peak_bytes} bytes, over its budget of ${budget}`);
    if (ring!.bytes > budget) f.push(`processor \`verb\`: its ring holds ${ring!.bytes} bytes, over its budget of ${budget}`);
    const held = ring!.checkpoints.reduce((a, c) => a + c.bytes, 0);
    if (held > budget) f.push(`processor \`verb\`: its checkpoints add up to ${held} bytes, over its budget of ${budget}`);
    if (ring!.spacing !== SPACING) f.push(`processor \`verb\`: its checkpoints are ${ring!.spacing / SEC} s apart, not 32 s`);
    const times = ring!.checkpoints.map((c) => c.t);
    // On the 32 s grid, one every 32 s with none missing, the last at 576 s (the grid's last point in 10 minutes); a
    // checkpoint at 0 s is the ring's choice.
    const onGrid = times.length >= 18 && times.every((t, k) => t % SPACING === 0 && (k === 0 || t - times[k - 1]! === SPACING)) && times[0]! <= SPACING && times[times.length - 1] === 18 * SPACING;
    if (!onGrid) f.push(`processor \`verb\`: its checkpoints are at ${JSON.stringify(times.map((t) => t / SEC))} s, not every 32 s up to 576 s`);
    f.push(...seekProblems(m, 1, 3, SPACING, 'the seek to 9 minutes').f);
    const d = firstDiff(pcmOf(evidence, m.segments[1]!, 'playing from 9 minutes'), pcmOf(evidence, m.segments[3]!, 'the seek to 9 minutes'));
    if (d !== null) f.push(`the seek's samples differ from playing's, first at ${sOf(d)}`);
    expect(f, 'the ring stays within its forced budget, 32 s apart, and the seek to 9 minutes equals playing').toEqual([]);

    // Wrong program: a ring that drops its oldest checkpoint when it passes its budget, instead of doubling its spacing.
    const w = run('ring_drops_oldest');
    const s = w.m.segments[3]!;
    const wf = seekProblems(w.m, 1, 3, SPACING, 'the seek to 9 minutes').f;
    const fromStart = s.seek?.['verb']?.rendered_from === 0;
    expect(fromStart, `planted ring_drops_oldest renders the seek to 9 minutes from the start (seek.verb: ${JSON.stringify(s.seek?.['verb'])})`).toBe(true);
    expect(wf.some((x) => x.startsWith('processor `verb`: the seek to 540 s rendered 540 s forward')), `planted ring_drops_oldest fails naming the processor \`verb\`; got ${JSON.stringify(wf)}`).toBe(true);
  }, 7_200_000);
});
