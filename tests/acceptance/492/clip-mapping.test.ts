// AC5 #492.77bbe5c2: A clip evaluated through any placement, offset, rate, loop, reverse, hold_at, or extend hold before or
// after equals the clip alone at the mapped time, with distinct contributions so a blend fixture can fail; every valid frame
// rate round-trips frame to flicks to frame exactly; and evaluating a document never changes its hash.
//
// Through `deep-motion eval`. "The clip alone" is the same keys as a document channel, evaluated at the mapped time: the two
// reads are compared bit for bit, so the reference is the curve's own and no formula of it is needed. The mapped time is
// Placement's: in + (t − start) × rate in exact flicks, floored, then the remap, then repeat and hold. A placement's hold_at
// is checked only where local time has reached it, the one reading both meanings of the field agree on (README: Choices).
// Upstream ports (oracle page): Unreal's MovieSceneTransformTests "Sub-sequence at 3, playing at x2" in a 0 to 30 loop, frame
// 13 → 20 and 21 → 6, and flicks_test.cpp's whole-flick rule, Δ × p = 705,600,000 × q with no remainder.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, FLICKS, accepted, channel, clipOf, evalAll, evalOk, evalOne, film, fl, isObject, none, place, posOr, rect, secs, seededTimes, useMotion,
  type JsonObject, type KeyList,
} from './helpers.ts';

const motion = useMotion();

const SHAPE: KeyList = [[0, 1], [1, 4, { ease: { name: 'out_cubic' } }], [3, -2, 'hold'], [3.5, 7], [4, 0]];
const D = fl(4);
const CLIP = { clips: { shape: clipOf('x', 'at/pos/0', SHAPE) } };
const dot = rect('dot', [123, 0]);
const placed = (id: string, placements: JsonObject, extra: JsonObject = {}, items: JsonObject[] = [dot]): JsonObject => film(id, items, { ...CLIP, placements, ...extra }, { span: '20s' });

interface Case { name: string; doc: JsonObject; from: number; to: number; map: (t: number) => number }
const wrap = (l: number): number => ((l % D) + D) % D;
const CASES: Case[] = [
  { name: 'a plain placement', doc: placed('plain', { p: place('shape', 'dot', { start: '0s' }) }), from: 0, to: D, map: (t) => t },
  { name: 'an offset', doc: placed('offset', { p: place('shape', 'dot', { start: '1.5s' }) }), from: fl(1.5), to: fl(5.5), map: (t) => t - fl(1.5) },
  { name: 'in', doc: placed('in', { p: place('shape', 'dot', { start: '2s', in: '1s', span: '2s' }) }), from: fl(2), to: fl(4), map: (t) => fl(1) + (t - fl(2)) },
  { name: 'rate 2', doc: placed('rate-2', { p: place('shape', 'dot', { start: '1s', rate: '2/1', span: '2s' }) }), from: fl(1), to: fl(3), map: (t) => 2 * (t - fl(1)) },
  { name: 'rate 1/3, floored', doc: placed('rate-third', { p: place('shape', 'dot', { start: '1s', rate: '1/3', span: '12s' }) }), from: fl(1), to: fl(13), map: (t) => Math.floor((t - fl(1)) / 3) },
  { name: 'after, with a negative offset', doc: placed('after', { first: place('shape', 'other', { start: '1s' }), p: place('shape', 'dot', { after: 'first', offset: '-0.5s' }) }, {}, [dot, rect('other', [0, 0])]), from: fl(4.5), to: fl(8.5), map: (t) => t - fl(4.5) },
  { name: 'a wrap loop', doc: placed('wrap', { p: place('shape', 'dot', { start: '0.5s', repeat: { count: 3, mode: 'wrap' } }) }), from: fl(0.5), to: fl(12.5), map: (t) => wrap(t - fl(0.5)) },
  {
    name: 'a ping_pong loop', doc: placed('ping-pong', { p: place('shape', 'dot', { start: '0.5s', repeat: { count: 2, mode: 'ping_pong' } }) }), from: fl(0.5), to: fl(8.5),
    map: (t) => { const l = t - fl(0.5); return l < D ? l : 2 * D - l; },
  },
  { name: 'reverse', doc: placed('reverse', { p: place('shape', 'dot', { start: '1s' }) }, { time_remaps: { rv: { target: 'p', map: 'reverse' } } }), from: fl(1), to: fl(5), map: (t) => D - (t - fl(1)) },
  { name: 'hold_at', doc: placed('hold-at', { p: place('shape', 'dot', { start: '1s', hold_at: '1.5s' }) }), from: fl(2.5), to: fl(4.9), map: () => fl(1.5) },
  { name: 'extend hold before', doc: placed('before', { p: place('shape', 'dot', { start: '2s', extend: { before: 'hold' } }) }), from: 0, to: fl(2), map: () => 0 },
  { name: 'extend hold after', doc: placed('after-hold', { p: place('shape', 'dot', { start: '1s', extend: { after: 'hold' } }) }), from: fl(5), to: fl(9), map: () => D },
];
const ALONE = film('alone', [dot], { channels: { c: channel('items/dot/at/pos/0', SHAPE) } }, { span: '20s' });

describe(`${AC[5]} a clip through a placement is the clip at the mapped time`, () => {
  it(`${AC[5]} through a plain placement, offset, in, rate, after, both loops, reverse, hold_at and extend hold before and after it equals the clip alone at the mapped time, bit for bit`, () => {
    const failures: string[] = [];
    CASES.forEach((c, n) => {
      const times = seededTimes(492_50 + n, 30, c.from, c.to);
      const mapped = times.map(c.map);
      const [placedAnswer, aloneAnswer] = evalAll(motion.bin(), [{ doc: c.doc, times }, { doc: ALONE, times: mapped }]);
      const a = accepted(placedAnswer!, times, c.name); const b = accepted(aloneAnswer!, mapped, 'the clip alone');
      a.frames.forEach((f, i) => {
        const got = posOr(f, 'dot', 0); const want = posOr(b.frames[i]!, 'dot', 0);
        if (!Object.is(got, want)) failures.push(`${c.name}: at ${f.t} flicks it reads ${got}, the clip alone ${want} at ${mapped[i]}`);
      });
    });
    none(failures, 'the placements against the clip alone');
  }, TIMEOUT);

  it(`${AC[5]} Unreal's sub-sequence at 3, playing at ×2 in a 0 to 30 loop: frame 13 reads 20 and frame 21 reads 6`, () => {
    const doc = film('unreal-x2', [rect('dot', [0, 0])], {
      clips: { loop: clipOf('x', 'at/pos/0', [[0, 0], [1, 30]]) },
      placements: { p: place('loop', 'dot', { start: '3f', rate: '2/1', repeat: { count: 4, mode: 'wrap' }, span: '2s' }) },
    }, { span: '10s', frame_rate: '30/1' });
    const frame = (k: number): number => (k * FLICKS) / 30;
    const a = evalOk(motion.bin(), { doc, times: [frame(13), frame(21)] }, 'the sub-sequence');
    expect(Math.abs(posOr(a.frames[0]!, 'dot', 0) - 20), `frame 13 maps to 20, got ${posOr(a.frames[0]!, 'dot', 0)}`).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(posOr(a.frames[1]!, 'dot', 0) - 6), `frame 21 maps to 6, got ${posOr(a.frames[1]!, 'dot', 0)}`).toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);

  // The blend fixture: a replace and two adds on one path, with contributions 100·t, 5·t and 0.25·t, so dropping or doubling any one shows.
  const BLEND = film('distinct-contributions', [rect('dot', [1000, 0])], {
    clips: { under: clipOf('x', 'at/pos/0', [[0, 0], [4, 400]]), one: clipOf('x', 'at/pos/0', [[0, 7], [4, 47]]), two: clipOf('x', 'at/pos/0', [[0, -3], [4, 1]]) },
    placements: {
      p0: place('under', 'dot', { start: '0s', order: 'a0' }),
      p1: place('one', 'dot', { start: '0s', blend: 'add', influence: 0.5, order: 'a1' }),
      p2: place('two', 'dot', { start: '0s', blend: 'add', influence: 0.25, order: 'a2' }),
    },
    time_remaps: { rv: { target: 'p2', map: 'reverse' } },
  }, { span: '6s' });
  const TIMES = seededTimes(492_59, 40, 0, fl(4));

  it(`${AC[5]} a blend fixture of distinct contributions reads each one, so a dropped or doubled placement fails`, () => {
    const a = evalOk(motion.bin(), { doc: BLEND, times: TIMES }, 'the blend fixture');
    const failures: string[] = [];
    for (const f of a.frames) {
      const s = secs(f.t);
      const want = 100 * s + 0.5 * (10 * s) + 0.25 * (1 * (4 - s));
      const got = posOr(f, 'dot', 0);
      if (!(Math.abs(got - want) <= 1e-9)) failures.push(`at ${f.t} flicks x reads ${got}, not ${want}`);
    }
    none(failures, 'the three contributions');
  }, TIMEOUT);

  it(`${AC[5]} every valid frame rate round-trips frame to flicks to frame exactly`, () => {
    const WHOLE = [8, 12, 15, 16, 18, 20, 24, 25, 30, 48, 50, 60, 72, 75, 90, 96, 100, 120, 144, 240];
    const rates: [number, number][] = [...WHOLE.map((r): [number, number] => [r, 1]), ...WHOLE.map((r): [number, number] => [r * 1000, 1001])];
    const K = [0, 1, 2, 59, 1000, 1_000_000];
    const failures: string[] = [];
    for (const [p, q] of rates) {
      const delta = (BigInt(FLICKS) * BigInt(q)) / BigInt(p);
      expect(delta * BigInt(p), `${p}/${q}: the frame is a whole number of flicks`).toBe(BigInt(FLICKS) * BigInt(q));
      const doc = film(`rate-${p}-${q}`, [rect('dot', [0, 0])], { markers: Object.fromEntries(K.map((k) => [`f${k}`, { kind: 'cue', t: `${k}f` }])) }, { span: '200000s', frame_rate: `${p}/${q}` });
      const exact = K.map((k) => Number(BigInt(k) * delta));
      const times = [...exact, ...exact.slice(1).map((t) => t - 1)];
      const a = evalOk(motion.bin(), { doc, times }, `${p}/${q}`);
      K.forEach((k, i) => {
        const marker = a.markers[`f${k}`];
        const t = isObject(marker) ? marker['t'] : undefined;
        if (t !== exact[i]) failures.push(`${p}/${q}: frame ${k} is ${String(t)} flicks, not ${exact[i]}`);
        if (a.frames[i]!.raw['frame'] !== k) failures.push(`${p}/${q}: ${exact[i]} flicks reads frame ${String(a.frames[i]!.raw['frame'])}, not ${k}`);
      });
      K.slice(1).forEach((k, i) => {
        const f = a.frames[K.length + i]!;
        if (f.raw['frame'] !== k - 1) failures.push(`${p}/${q}: one flick before frame ${k} reads frame ${String(f.raw['frame'])}, not ${k - 1}`);
      });
    }
    none(failures, 'the round trip at 40 rates');
  }, TIMEOUT);

  it(`${AC[5]} evaluating a document never changes its hash`, () => {
    const hashOf = (times: number[]): string => {
      const answer = evalOne(motion.bin(), { doc: BLEND, times });
      expect(answer['ok'], `the blend fixture is accepted at ${times.length} times`).toBe(true);
      const hash = answer['hash'];
      expect(typeof hash === 'string' && hash !== '', `the answer's hash: ${String(hash)}`).toBe(true);
      return hash as string;
    };
    const empty = hashOf([]);
    expect(hashOf(TIMES), 'after evaluating 40 frames').toBe(empty);
    expect(hashOf([...TIMES].reverse()), 'after evaluating them backward').toBe(empty);
    const other = evalOne(motion.bin(), { doc: { ...BLEND, title: 'Another title' }, times: [] })['hash'];
    expect(other, 'the hash reads the document: an edit changes it').not.toBe(empty);
  }, TIMEOUT);
});
