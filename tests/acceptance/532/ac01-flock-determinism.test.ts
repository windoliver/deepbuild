// Criterion 1 (no upstream test): "A 100-boid flock at 60 Hz that reads a wind slider and writes 100 positions
// gives identical full-state hashes at each checkpoint, step hashes and continuation probes run twice, replayed
// from each checkpoint, and at 1,000 seeks in random order against playing; a planted checkpoint that leaves out
// the program's globals fails that comparison on the full-state hash of the first checkpoint after the seek,
// naming that checkpoint and the first step that differs"
//
// Through `deep-logic bake` (its restores, probes and seeks) and `determinism` (logic.determinism) (README:
// deep-logic). The flock (flock.ts) runs 1,200 steps on a seeded wind track, checkpointing every 60 steps. Run
// twice, in two processes, everything a bake gives is equal. Each checkpoint below the last is restored and run on
// 120 steps, with a continuation probe (a wind entry three steps on, 60 steps) from it and from the straight state.
// 1,000 seeks to seeded steps in a seeded order each give, against playing, the step hashes from the seek to the
// first checkpoint after it, that checkpoint's full-state hash, and a probe's. `checkpoint_drops_globals` keeps the
// flock's memory but not its globals ($rng and $wind): the comparison fails at the first checkpoint after each
// seek, and logic.determinism names that checkpoint and the first step that differs.
import { describe, expect, it } from 'vitest';
import { AC, EVERY, TIMEOUT, bakeCall, bakeOf, determinismCall, determinismOf, firstDiff, firstStepDiff, hashesOf, logicBin, none, onMac, prebuild, rows, seeded, yours, type Bake, type BakeSpec, type Entry, type ProbeResult, type SeekSpec } from './helpers.ts';
import { FLOCK, flockPiece, windTrack } from './flock.ts';

prebuild(() => { logicBin(); });

const STEPS = 1200;
const RUN_ON = 120;
const FROM = Array.from({ length: STEPS / EVERY }, (_, i) => i * EVERY);
const SEEKS = 1000;
const AT_TIMES = [2.5, 7.25, 12.75];
const probeEntries = (c: number): Entry[] => [yours('wind', c + 3, 0.7, 1)];
const seekEntries = (s: number): Entry[] => [yours('wind', s + 1, -0.3, 1)];
/** 1,000 seek targets, each before the last checkpoint, in a seeded (random) order. */
function seekTargets(): number[] {
  const r = seeded(532_011);
  return Array.from({ length: SEEKS }, () => Math.floor(r() * (STEPS - EVERY)));
}
function spec(seeks: number[]): BakeSpec {
  return {
    steps: STEPS, track: windTrack(532_01, STEPS),
    restores: FROM.map((from) => ({ from, steps: Math.min(RUN_ON, STEPS - from), probe: { entries: probeEntries(from), steps: 60 } })),
    probes: [...FROM.map((c) => ({ at: c, entries: probeEntries(c), steps: 60 })), ...seeks.map((s) => ({ at: s, entries: seekEntries(s), steps: 5 }))],
    seeks: seeks.map((s): SeekSpec => ({ to: s, probe: { entries: seekEntries(s), steps: 5 } })),
  };
}
const probeRows = (p: ProbeResult): string[] => [...rows(p.steps, FLOCK), `deep ${p.deep_hash[FLOCK]}`];
const straightAt = (b: Bake, step: number): string | undefined => (b.checkpoints[FLOCK] ?? []).find((c) => c.step === step)?.deep_hash;

/** Each restore against the straight run: full-state hashes at its checkpoints, step hashes and arrays, probes. */
function judgeRestores(b: Bake): string[] {
  const failures: string[] = [];
  const straight = b.checkpoints[FLOCK] ?? [];
  expect(straight.map((c) => c.step), 'the straight run checkpoints every 60 steps from step 0').toEqual(Array.from({ length: STEPS / EVERY + 1 }, (_, i) => i * EVERY));
  expect(b.restores.map((r) => r.from), 'one restore per checkpoint below the last').toEqual(FROM);
  for (const [i, r] of b.restores.entries()) {
    const end = r.from + Math.min(RUN_ON, STEPS - r.from);
    const d1 = firstDiff((r.checkpoints[FLOCK] ?? []).map((c) => `${c.step} ${c.deep_hash}`), straight.filter((c) => c.step >= r.from && c.step <= end).map((c) => `${c.step} ${c.deep_hash}`));
    if (d1) failures.push(`restored from ${r.from}: full-state hashes differ at ${d1}`);
    const d2 = firstDiff(rows(r.steps, FLOCK), rows(b.steps.filter((s) => s.step >= r.from && s.step < end), FLOCK));
    if (d2) failures.push(`restored from ${r.from}: step hashes or positions differ at ${d2}`);
    const p = b.probes[i];
    const d3 = r.probe && p ? firstDiff(probeRows(r.probe), probeRows(p)) : 'no probe from both states';
    if (d3) failures.push(`restored from ${r.from}: the continuation probe differs at ${d3}`);
  }
  return failures;
}
/** Each seek against playing: the first checkpoint after it by full-state hash, the step hashes up to it, and its probe. */
function judgeSeeks(b: Bake, targets: number[]): string[] {
  const failures: string[] = [];
  expect(b.seeks.map((s) => s.to), 'one seek result per seek, in the order asked').toEqual(targets);
  const straight = hashesOf(b.steps, FLOCK);
  for (const [i, s] of b.seeks.entries()) {
    const next = (Math.floor(s.to / EVERY) + 1) * EVERY;
    expect(s.from, `the seek to ${s.to} restored the nearest checkpoint at or before it`).toBe(Math.floor(s.to / EVERY) * EVERY);
    expect(s.checkpoint.step, `the seek to ${s.to} reports the first checkpoint after it`).toBe(next);
    if (s.checkpoint.deep_hash[FLOCK] !== straightAt(b, next)) failures.push(`seek to ${s.to}: the full-state hash of checkpoint ${next}, the first after the seek, differs from playing`);
    const d = firstDiff(s.hashes[FLOCK] ?? [], straight.slice(s.to, next));
    if (d) failures.push(`seek to ${s.to}: step hashes differ from playing at ${d}`);
    const p = b.probes[FROM.length + i];
    if (!s.probe || !p || firstDiff([...(s.probe.hashes[FLOCK] ?? []), s.probe.deep_hash[FLOCK] ?? ''], [...hashesOf(p.steps, FLOCK), p.deep_hash[FLOCK] ?? ''])) failures.push(`seek to ${s.to}: its continuation probe differs from playing's`);
  }
  return failures;
}
/** What two runs must agree on. */
const everything = (b: Bake): string[] => [
  ...rows(b.steps, FLOCK), ...(b.checkpoints[FLOCK] ?? []).map((c) => `checkpoint ${c.step} ${c.deep_hash}`),
  ...b.restores.flatMap((r) => [...(r.checkpoints[FLOCK] ?? []).map((c) => `restore ${r.from} ${c.step} ${c.deep_hash}`), ...rows(r.steps, FLOCK).map((x) => `restore ${r.from} ${x}`), ...(r.probe ? probeRows(r.probe) : [])]),
  ...b.probes.flatMap((p) => probeRows(p).map((x) => `probe ${p.at} ${x}`)),
  ...b.seeks.map((s) => JSON.stringify(s)),
];

describe(`${AC[1]} the flock replays exactly: run twice, from each checkpoint and at 1,000 seeks`, () => {
  it(`${AC[1]} run twice, replayed from each checkpoint and at 1,000 seeks in random order, the flock gives playing's full-state hashes, step hashes and continuation probes, and logic.determinism passes`, () => {
    const targets = seekTargets();
    const det = determinismOf(onMac([determinismCall(flockPiece(), { steps: STEPS, track: windTrack(532_01, STEPS) }, AT_TIMES)])[0]!, 'logic.determinism of the flock');
    expect(det.failures, 'logic.determinism finds nothing').toEqual([]);
    expect(det.verdict, 'logic.determinism passes the flock').toBe('PASS');
    const call = bakeCall(flockPiece(), spec(targets));
    const a = bakeOf(onMac([call])[0]!, 'the first bake');
    const b = bakeOf(onMac([call])[0]!, 'the second bake, in another process');
    expect(a.traps, 'the flock never traps').toEqual([]);
    expect(a.steps.length, 'the bake holds every step').toBe(STEPS);
    expect(new Set((a.checkpoints[FLOCK] ?? []).map((c) => c.deep_hash)).size, 'the flock\'s state changes between checkpoints').toBe(STEPS / EVERY + 1);
    expect(firstDiff(everything(b), everything(a)), 'two runs give the same hashes, positions, restores, probes and seeks').toBeNull();
    none(judgeRestores(a), 'every restore from a checkpoint equals playing');
    none(judgeSeeks(a, targets), 'every seek equals playing');
  }, TIMEOUT);

  it(`${AC[1]} a planted checkpoint that leaves out the globals (checkpoint_drops_globals) fails on the full-state hash of the first checkpoint after the seek, and logic.determinism names that checkpoint and the first step that differs`, () => {
    const targets = seekTargets().slice(0, 50);
    const track = windTrack(532_01, STEPS);
    const [detReply, bakeReply] = onMac([determinismCall(flockPiece(), { steps: STEPS, track }, AT_TIMES), bakeCall(flockPiece(), spec(targets))], ['checkpoint_drops_globals']);
    const [straightReply] = onMac([bakeCall(flockPiece(), spec(targets))]);
    const straight = bakeOf(straightReply!, 'the straight bake');
    const planted = bakeOf(bakeReply!, 'the bake with checkpoint_drops_globals');
    expect(firstDiff(rows(planted.steps, FLOCK), rows(straight.steps, FLOCK)), 'playing is unchanged by the planted checkpoint').toBeNull();
    const seekFailures = judgeSeeks(planted, targets);
    for (const s of planted.seeks) {
      const next = (Math.floor(s.to / EVERY) + 1) * EVERY;
      expect(seekFailures.some((f) => f.startsWith(`seek to ${s.to}: the full-state hash of checkpoint ${next}`)), `the seek to ${s.to} fails on the full-state hash of checkpoint ${next}, the first after it: ${seekFailures.slice(0, 5).join('; ')}`).toBe(true);
    }
    const det = determinismOf(detReply!, 'logic.determinism with checkpoint_drops_globals');
    expect(det.verdict, 'logic.determinism fails the planted checkpoint').toBe('FAIL');
    const deep = det.failures.filter((f) => f.run === 'seek' && f.field === 'deep_hash');
    expect(deep.length, `logic.determinism fails a seek on a full-state hash: ${JSON.stringify(det.failures).slice(0, 800)}`).toBeGreaterThan(0);
    for (const f of deep) {
      expect(f.item, 'the failure names the flock').toBe(FLOCK);
      expect(f.from, 'the failure names the checkpoint the seek restored').not.toBeNull();
      expect(f.checkpoint, `the seek from ${f.from} fails at the first checkpoint after it`).toBe(f.from! + EVERY);
      const restore = planted.restores.find((r) => r.from === f.from);
      expect(restore, `the planted bake restored checkpoint ${f.from}`).toBeDefined();
      expect(f.step, `the seek from ${f.from} names the first step whose step hash differs`).toBe(firstStepDiff(restore!.steps, straight.steps, FLOCK));
    }
  }, TIMEOUT);
});
