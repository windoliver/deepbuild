// #2016.dd1c9e69 AC1: "In a field of identical trees under a 5 m/s wind with gusts at 20 m scale, the gust term at a
// tree 20 m downwind equals the upwind tree's 4 s earlier within 1e-4, trees 2 m apart lean within 10% of each other,
// no vertex moves more than `amount`, and seeking equals playing by pixel hash"
//
// Its first three clauses, one test each, on one played run of the field (fixtures/field.json: 36 identical trees on
// a 2 m grid, 12 along the wind and 3 across it, each with the same mod.sway@1) and one frame of the same field with
// every sway switched off, for the trees' rest positions. Both are `view3d` calls in their own `deep-gpu run`
// processes, with the `sway` report (README: The surface under test): each frame's vertex positions and gust terms
// as the GPU computed them. The fourth clause, seek against play, is seek.test.ts. Metal only: INCONCLUSIVE off
// macOS.

import { describe, expect, it } from 'vitest';
import {
  AMOUNT, DOWNWIND_M, EARLIER_FRAMES, EARLIER_S, FPS, GUST_TOLERANCE, LAST, LEAN_SHARE, NEIGHBOUR_M, fmt, gustOf, norm, pairs,
  requireMetal, rowOf, sub, trees, useBuild, useOut, view3d, writeField, type Frame, type V3,
} from './helpers.ts';

const AC = '#2016.dd1c9e69 AC1';
const bin = useBuild();
const out = useOut();

/** A gust that never changes by more than this over 12 s, or that two trees 20 m apart share at every moment, can't show a gust rolling (README: Readings). */
const GUST_MOVES = 1e-2;
/** f32 rounding allowed on a move: 1e-4 m, a third of a thousandth of `amount` (README: Readings). */
const ROUNDING_M = 1e-4;

let played: Frame[] | undefined;
/** Frames 0 … 96 of the swaying field, every tree's `sway` row asked for: drawn once, read by all three tests. */
function play(): Frame[] {
  played ??= view3d(bin(), out(), writeField(out(), true), 0, LAST + 1, trees().map((t) => t.id), 'the swaying field, played');
  return played;
}

let rested: Map<string, V3[]> | undefined;
/** Each tree's vertex positions with every sway switched off (`enabled: false`): frame 0 of the still field. */
function rest(): Map<string, V3[]> {
  if (!rested) {
    const [f] = view3d(bin(), out(), writeField(out(), false), 0, 1, trees().map((t) => t.id), 'the field with its sway off');
    rested = new Map(trees().map((t) => [t.id, rowOf(f!, t.id, 'the field with its sway off').positions]));
  }
  return rested;
}

/** Tree `id`'s positions in frame `f`, the same count as at rest. */
function positions(f: Frame, id: string, at: V3[]): V3[] {
  const p = rowOf(f, id, 'the swaying field').positions;
  expect(p.length, `frame ${f.frame}: tree ${id} reports as many vertices swaying as at rest (${at.length})`).toBe(at.length);
  return p;
}

describe(`${AC}: a field of identical trees under a 5 m/s wind with gusts at 20 m scale`, () => {
  it(`${AC} (gusts roll): the gust term at a tree ${DOWNWIND_M} m downwind equals the upwind tree's ${EARLIER_S} s earlier within ${GUST_TOLERANCE}`, () => {
    requireMetal();
    const frames = play();
    const along = pairs(trees(), DOWNWIND_M, true);
    expect(along.length, 'the field has two pairs of trees 20 m apart along the wind in each of its 3 rows').toBe(6);
    const problems: string[] = [];
    let worst = { d: 0, at: '' };
    for (const [up, down] of along) {
      const ups = frames.map((f) => gustOf(f, up.id, 'the swaying field'));
      const downs = frames.map((f) => gustOf(f, down.id, 'the swaying field'));
      // Guards: the gust moves over the run, and the two trees don't share one gust at the same moment.
      const range = Math.max(...ups) - Math.min(...ups);
      if (range <= GUST_MOVES) problems.push(`${up.id}'s gust term spans only ${range.toExponential(3)} over 0 … 12 s, so no gust passes it`);
      const together = Math.max(...frames.map((_, n) => Math.abs(downs[n]! - ups[n]!)));
      if (together <= GUST_MOVES) problems.push(`${down.id} and ${up.id}, 20 m apart, have gust terms within ${together.toExponential(3)} of each other at every moment, so equal terms 4 s apart can't show a gust rolling`);
      for (let n = EARLIER_FRAMES; n <= LAST; n++) {
        const d = Math.abs(downs[n]! - ups[n - EARLIER_FRAMES]!);
        if (d > worst.d) worst = { d, at: `${down.id} at ${n / FPS} s reads ${downs[n]!.toFixed(6)}, ${up.id} at ${(n - EARLIER_FRAMES) / FPS} s reads ${ups[n - EARLIER_FRAMES]!.toFixed(6)}` };
      }
    }
    if (worst.d > GUST_TOLERANCE) problems.push(`the gust term 20 m downwind differs from the upwind tree's 4 s earlier by up to ${worst.d.toExponential(3)}, over ${GUST_TOLERANCE}: ${worst.at}`);
    expect(problems, `${AC}: over ${along.length} pairs of trees 20 m apart along the wind, at every frame from 4 s to 12 s`).toEqual([]);
  }, 1_800_000);

  it(`${AC} (neighbours lean together): trees ${NEIGHBOUR_M} m apart lean within ${LEAN_SHARE * 100}% of each other`, () => {
    requireMetal();
    const frames = play();
    const still = rest();
    // A tree's lean: the mean move of its top vertices (those within 1 mm of its highest rest point).
    const lean = new Map<string, V3[]>();
    for (const t of trees()) {
      const at = still.get(t.id)!;
      const topY = Math.max(...at.map((p) => p[1]));
      const top = at.flatMap((p, k) => (p[1] >= topY - 1e-3 ? [k] : []));
      lean.set(t.id, frames.map((f) => {
        const p = positions(f, t.id, at);
        const sum: V3 = [0, 0, 0];
        for (const k of top) { const d = sub(p[k]!, at[k]!); sum[0] += d[0]; sum[1] += d[1]; sum[2] += d[2]; }
        return [sum[0] / top.length, sum[1] / top.length, sum[2] / top.length];
      }));
    }
    const most = Math.max(...[...lean.values()].flat().map(norm));
    expect(most, `${AC}: the field sways: some tree leans at least amount ÷ 4 (${AMOUNT / 4} m) in 0 … 12 s; the largest lean is ${most.toFixed(5)} m`).toBeGreaterThanOrEqual(AMOUNT / 4);
    const near = pairs(trees(), NEIGHBOUR_M, false);
    expect(near.length, 'the field has trees 2 m apart').toBe(57);
    let judged = 0;
    const over: string[] = [];
    for (const [a, b] of near) {
      for (let n = 0; n <= LAST; n++) {
        const la = lean.get(a.id)![n]!; const lb = lean.get(b.id)![n]!;
        const larger = Math.max(norm(la), norm(lb));
        // Judged where the pair clearly leans: the larger lean at least half the field's largest (README: Readings).
        if (larger < most / 2) continue;
        judged++;
        const d = norm(sub(la, lb));
        if (d > LEAN_SHARE * larger) over.push(`${a.id} and ${b.id} at ${n / FPS} s: leans ${fmt(la)} and ${fmt(lb)} m differ by ${d.toFixed(5)} m, ${(100 * d / larger).toFixed(1)}% of the larger`);
      }
    }
    expect(judged, `${AC}: some pair of neighbours leans at least half the field's largest lean (${(most / 2).toFixed(5)} m) at some frame`).toBeGreaterThan(0);
    expect(over.slice(0, 20), `${AC}: trees 2 m apart lean within 10% of each other: ${over.length} of ${judged} judged pair-frames are over (the first 20 shown)`).toEqual([]);
  }, 1_800_000);

  it(`${AC} (bounded): no vertex moves more than amount (${AMOUNT} m)`, () => {
    requireMetal();
    const frames = play();
    const still = rest();
    let most = { d: 0, at: '' };
    for (const t of trees()) {
      const at = still.get(t.id)!;
      for (const f of frames) {
        const p = positions(f, t.id, at);
        for (let k = 0; k < at.length; k++) {
          const d = norm(sub(p[k]!, at[k]!));
          if (d > most.d) most = { d, at: `tree ${t.id}, vertex ${k} (rest ${fmt(at[k]!)}), at ${f.frame / FPS} s: ${fmt(p[k]!)}` };
        }
      }
    }
    expect(most.d, `${AC}: the field sways: some vertex moves at least amount ÷ 4 (${AMOUNT / 4} m) in 0 … 12 s; the largest move is ${most.d.toFixed(5)} m`).toBeGreaterThanOrEqual(AMOUNT / 4);
    expect(most.d, `${AC}: no vertex moves more than amount (${AMOUNT} m, with ${ROUNDING_M} m for f32 rounding); the largest move is ${most.d.toFixed(5)} m (${(most.d / AMOUNT).toFixed(3)} × amount), ${most.at}`).toBeLessThanOrEqual(AMOUNT + ROUNDING_M);
  }, 1_800_000);
});
