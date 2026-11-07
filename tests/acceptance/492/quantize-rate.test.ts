// AC2 #492.f372ab7a: quantize with each jump mode steps on the same flick at 24, 30 and 60 fps, and .rate under placements
// and remaps equals its closed form at chosen flicks and a central difference elsewhere, zero inside holds.
//
// Through `deep-motion eval`. Upstream port (oracle page): WPT's css-easing step-jump-{start,end,none,both}.html, steps(3,
// jump-*) over 3 s read at 0, 0.9, 1.0, 1.9, 2.0 and 2.9 s; their widths as progress are the table below. Step times
// otherwise follow Channel and key: quantize jump: for progress u in a segment of n steps, end ⌊n·u⌋ ÷ n, start
// (⌊n·u⌋ + 1) ÷ n, none ⌊n·u⌋ ÷ (n − 1), both (⌊n·u⌋ + 1) ÷ (n + 1), clamped to [0, 1], "progress comes from exact flicks".
// n = 11 over 3 s has steps that fall between flicks, so a step lands on the first flick at or after it. `.rate` is the
// issue's: the segment derivative times the placement rate times the remap's derivative, read from the frame's
// `placements.<id>.rates.<channel>` (README: The surface under test).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, FLICKS, RULER, accepted, at, channel, clipOf, evalAll, evalOk, film, fl, inOutQuadRate, none, place, posOr, rampChild, rampRate, rateOr, rect, secs, seededTimes, useMotion,
  type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const FPS = [24, 30, 60];
const JUMPS = ['start', 'end', 'none', 'both'] as const;
type Jump = (typeof JUMPS)[number];

/** Progress at step ⌊n·u⌋ = k, as CSS steps() defines it. */
function progress(k: number, n: number, jump: Jump): number {
  const p = jump === 'end' ? k / n : jump === 'start' ? (k + 1) / n : jump === 'none' ? k / (n - 1) : (k + 1) / (n + 1);
  return Math.min(1, Math.max(0, p));
}
/** ⌊n·t ÷ span⌋ from exact flicks. */
const stepOf = (t: number, n: number, span: number): number => Number((BigInt(n) * BigInt(t)) / BigInt(span));

const SPAN = 3;
function stepsDoc(fps: number, n: number, jump: Jump): JsonObject {
  return film(`steps-${fps}-${n}-${jump}`, [rect('dot', [0, 0])], {
    channels: { c: channel('items/dot/at/pos/0', [[0, 0, { quantize: { n, jump } }], [SPAN, 1]]) },
  }, { span: `${SPAN + 1}s`, frame_rate: `${fps}/1` });
}

// WPT's expected widths over the step's range, as progress at 0, 0.9, 1.0, 1.9, 2.0 and 2.9 s.
const WPT: Record<Jump, number[]> = {
  start: [1 / 3, 1 / 3, 2 / 3, 2 / 3, 1, 1],
  end: [0, 0, 1 / 3, 1 / 3, 2 / 3, 2 / 3],
  none: [0, 0, 0.5, 0.5, 1, 1],
  both: [0.25, 0.25, 0.5, 0.5, 0.75, 0.75],
};
const WPT_TIMES = [0, 0.9, 1.0, 1.9, 2.0, 2.9].map(fl);

describe(`${AC[2]} quantize steps and .rate`, () => {
  it(`${AC[2]} each jump mode reads WPT's steps(3) table, and steps on the same flick at 24, 30 and 60 fps, the flick before still on the step before`, () => {
    const failures: string[] = [];
    for (const jump of JUMPS) {
      for (const n of [3, 11]) {
        const span = SPAN * FLICKS;
        // The first flick of each step: ⌈k × span ÷ n⌉, and the flick before it.
        const edges = Array.from({ length: n - 1 }, (_, i) => Math.ceil(((i + 1) * span) / n));
        const times = [...new Set([...(n === 3 ? WPT_TIMES : []), ...edges.flatMap((e) => [e - 1, e])])].sort((a, b) => a - b);
        const answers = evalAll(motion.bin(), FPS.map((fps) => ({ doc: stepsDoc(fps, n, jump), times })));
        const reads = answers.map((answer, i) => accepted(answer, times, `quantize(${n}, ${jump}) at ${FPS[i]} fps`));
        times.forEach((t, i) => {
          const want = progress(stepOf(t, n, span), n, jump);
          FPS.forEach((fps, r) => {
            const got = posOr(reads[r]!.frames[i]!, 'dot', 0);
            if (!(Math.abs(got - want) <= 1e-12)) failures.push(`quantize(${n}, ${jump}) at ${fps} fps reads ${got} at ${t} flicks, not ${want}`);
          });
        });
        if (n === 3) WPT_TIMES.forEach((t, i) => { expect(progress(stepOf(t, 3, span), 3, jump), `fixture: WPT's table for jump-${jump}`).toBeCloseTo(WPT[jump][i]!, 12); });
      }
    }
    none(failures, 'quantize by jump mode');
  }, TIMEOUT);

  it(`${AC[2]} the modifier quantize {hz, jump} steps time on its hz grid by the same rule, the same at each frame rate`, () => {
    // Only start and end have a reading over an open grid; none and both are read through the key form above.
    const HZ = 12;
    const times = [...seededTimes(492_21, 40, 0, fl(1.9)), fl(5 / 12) - 1, fl(5 / 12)];
    const failures: string[] = [];
    for (const jump of ['start', 'end'] as const) {
      const lines = FPS.map((fps) => ({ doc: film(`hz-${fps}-${jump}`, [rect('dot', [0, 0])], { channels: { c: channel('items/dot/at/pos/0', [[0, 0], [4, 4]], 'f32', { modifiers: [{ quantize: { hz: HZ, jump } }] }) } }, { span: '4s', frame_rate: `${fps}/1` }), times }));
      evalAll(motion.bin(), lines).forEach((answer, r) => {
        accepted(answer, times, `the ${jump} modifier at ${FPS[r]} fps`).frames.forEach((f) => {
          const k = stepOf(f.t, HZ, FLICKS);
          const want = (jump === 'end' ? k : k + 1) / HZ;
          const got = posOr(f, 'dot', 0);
          if (!(Math.abs(got - want) <= 1e-12)) failures.push(`the ${jump} modifier at ${FPS[r]} fps reads ${got} at ${f.t} flicks, not ${want}`);
        });
      });
    }
    none(failures, 'the quantize modifier on its 12 Hz grid');
  }, TIMEOUT);

  // The clip's x: linear from 0 to 10 over 1 s, then in_out_quad from 10 to 50 over 2 s.
  const CURVE = clipOf('x', 'at/pos/0', [[0, 0, 'linear'], [1, 10, { ease: { name: 'in_out_quad' } }], [3, 50]]);
  /** The segment derivative at clip time c, per second. */
  const slope = (c: number): number => (c < 1 ? 10 : ((50 - 10) / 2) * inOutQuadRate((c - 1) / 2));
  const clips = { curve: CURVE, ruler: RULER };
  const R = { from: 1, to: 3, at: 0.5, over: 1 };
  const START = 1;
  const DOUBLE = { keys: { a: { t: '0s', value: 0, interp: 'linear' }, b: { t: '3s', value: 6 * FLICKS, interp: 'linear' } } };

  /** placement rate only; rate + ramp remap (its parent time is the local time after the offset and rate); a doubling map. */
  const CASES: { name: string; doc: JsonObject; times: number[]; child: (s: number) => number; factor: (s: number) => number }[] = [
    {
      name: 'a placement at rate 1/2', doc: film('rate-half', [rect('dot', [0, 0])], { clips, placements: { p: place('curve', 'dot', { start: at(START), rate: '1/2', span: '5s' }) } }),
      times: [1.5, 2.4, 3.1, 4.6].map(fl), child: (s) => (s - START) / 2, factor: () => 0.5,
    },
    {
      name: 'a placement at rate 2 under a ramp', doc: film('rate-ramp', [rect('dot', [0, 0])], { clips, placements: { p: place('curve', 'dot', { start: at(START), rate: '2/1', span: '1.2s' }) }, time_remaps: { r: { target: 'p', map: { ramp: { from: '1/1', to: '3/1', at: at(R.at), over: at(R.over) } } } } }),
      times: [1.1, 1.3, 1.45, 1.6, 1.7].map(fl), child: (s) => rampChild(2 * (s - START), R), factor: (s) => 2 * rampRate(2 * (s - START), R),
    },
    {
      name: 'a doubling map', doc: film('rate-double', [rect('dot', [0, 0])], { clips, placements: { p: place('curve', 'dot', { start: at(START), span: '1.4s' }) }, time_remaps: { r: { target: 'p', map: DOUBLE } } }),
      times: [1.2, 1.4, 1.9, 2.2].map(fl), child: (s) => 2 * (s - START), factor: () => 2,
    },
  ];

  it(`${AC[2]} .rate under placements and remaps equals segment derivative × placement rate × remap derivative at chosen flicks, and a central difference elsewhere`, () => {
    const failures: string[] = [];
    const H = fl(1e-4);
    for (const c of CASES) {
      const a = evalOk(motion.bin(), { doc: c.doc, times: c.times }, c.name);
      a.frames.forEach((f) => {
        const s = secs(f.t); const want = slope(c.child(s)) * c.factor(s); const got = rateOr(f, 'p', 'x');
        if (!(Math.abs(got - want) <= 1e-6)) failures.push(`${c.name}: .rate at ${f.t} flicks reads ${got}, not ${want}`);
      });
      // Elsewhere, away from the clip's 1 s seam where the slope jumps.
      const first = c.times[0]!; const last = c.times[c.times.length - 1]!;
      const mids = seededTimes(492_22, 30, first, last).filter((t) => Math.abs(c.child(secs(t)) - 1) > 0.02);
      const triple = mids.flatMap((t) => [t - H, t, t + H]);
      const b = evalOk(motion.bin(), { doc: c.doc, times: triple }, `${c.name}: around seeded times`);
      mids.forEach((t, i) => {
        const before = posOr(b.frames[3 * i]!, 'dot', 0); const after = posOr(b.frames[3 * i + 2]!, 'dot', 0);
        const central = (after - before) / (2 * secs(H)); const got = rateOr(b.frames[3 * i + 1]!, 'p', 'x');
        if (!(Math.abs(got - central) <= 1e-3)) failures.push(`${c.name}: .rate at ${t} flicks reads ${got}, the central difference ${central}`);
      });
    }
    none(failures, '.rate under placements and remaps');
  }, TIMEOUT);

  it(`${AC[2]} .rate is exactly zero inside a remap's hold, past a placement's hold_at and in an extend hold, and moves outside them`, () => {
    const doc = film('rate-holds', [rect('a', [0, 0]), rect('b', [0, 0]), rect('c', [0, 0])], {
      clips,
      placements: {
        held: place('ruler', 'a', { start: '0s' }),
        stopped: place('ruler', 'b', { start: '0s', hold_at: '1s' }),
        ended: place('curve', 'c', { start: '0s', extend: { after: 'hold' } }),
      },
      time_remaps: { r: { target: 'held', map: { hold_at: { at: '1s', for: '2s' } } } },
    });
    const times = [0.5, 1.5, 2.5, 3.5, 4.5].map(fl);
    const a = evalOk(motion.bin(), { doc, times }, 'three holds');
    const [before, in1, in2, in3, in4] = a.frames;
    expect(rateOr(before!, 'held', 'x'), 'the remapped placement moves before its hold').toBeCloseTo(1, 9);
    expect(rateOr(before!, 'stopped', 'x'), 'the held placement moves before its hold_at').toBeCloseTo(1, 9);
    for (const f of [in1!, in2!]) expect(Math.abs(rateOr(f, 'held', 'x')), `inside the remap's hold, at ${f.t} flicks`).toBe(0);
    expect(rateOr(in3!, 'held', 'x'), 'the remapped placement runs on after its hold').toBeCloseTo(1, 9);
    for (const f of [in1!, in2!, in3!, in4!]) expect(Math.abs(rateOr(f, 'stopped', 'x')), `past the placement's hold_at, at ${f.t} flicks`).toBe(0);
    for (const f of [in3!, in4!]) expect(Math.abs(rateOr(f, 'ended', 'x')), `in the extend hold, at ${f.t} flicks`).toBe(0);
  }, TIMEOUT);
});
