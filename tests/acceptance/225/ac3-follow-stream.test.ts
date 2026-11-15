// AC3 #225.174320e5: "A `follow_stream` dot from (2, 0) in F = (−y, x) sits at (0, 2) within 1e-6 at field time π/2,
// and seeking to 7.3 s gives the same trim windows and dot position as playing, by hash"
//
// The film (8 s): `swirl`, a vector_field@1 with `fn: {x: "-y", y: "x"}`, `streams: {starts: {points: [[1, 0, 0], [2,
// 0, 0]]}, step: 0.05, time: 8}` and `flow: {speed: 1, flash: 0.3, warm_up: false}` (phase left at `hashed`), no
// scales; `dot`, a circle@1 at its origin; the constraint `ride: {owner: dot, kind: follow_stream, vector_field: swirl,
// from: [2, 0, 0]}` (speed 1, time_offset 0, so field time is t). With no scales the field's coordinates are the
// document's u in the field's parent space, the dot's parent too (README: Readings), so the dot's `at.pos` is its
// place in the field.
// The dot: `eval` at t = π/2 s (in whole flicks) reads `items/dot/at/pos` (0, 2) within 1e-6, and (2, 0) at t = 0.
// Seek and play, at 7.3 s: playing is one session evaluating every 60 fps frame from 0 to 7.3 s, then `vector_field`'s
// `trims` and an `eval` with `paths` and `data_hash` at 7.3 s; seeking is a fresh process asking the same at 7.3 s
// only, its eval `clean`. The SHA-256 of {trims, dot} and the data_hash are equal. So the comparison can fail, the
// windows and the dot must move: each window is [p, p + 0.3] (to within 1e-6, the f32 flash), each p at 7.3 s is p at
// 0 plus fract(7.3 × 1 ÷ 8) = 0.9125 on the unit circle within 1e-6 (p = fract(t × speed ÷ time + phase_i)), the two
// streams' phases differ (hashed), and the dot at 7.3 s is the turn of (2, 0) by 7.3 within 1e-3.
// Wrong programs: the base (follow_stream refused as module_missing, no vector_field@1); a dot that steps from the
// previous frame (play differs from seek); a flow phase accumulated per frame; a dot read from the table's nearest
// point (6e-4 off at π/2); phases not hashed, or speed applied twice.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, SWIRL, TIMEOUT, circular, dataHashOf, dist, dot, evalAt, field, fieldCall, fieldOf, film, fl, followStream, fract, frameTimes, none, posOf,
  present, presented, run, scenario, sha256, turn, useBins, useFolders, type JsonObject,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const DOC: JsonObject = film('a dot carried', [640, 480], [
  field('swirl', 'a0', { fn: SWIRL, streams: { starts: { points: [[1, 0, 0], [2, 0, 0]] }, step: 0.05, time: 8 }, flow: { speed: 1, flash: 0.3, warm_up: false } }),
  dot('dot', 'a1'),
], { transport: { span: '8s' }, constraints: { ride: followStream('dot', 'swirl', [2, 0, 0], { speed: 1, time_offset: 0 }) } });
const HALF_PI = fl(Math.PI / 2);
const SEEK = fl(7.3);
const DOT = 'items/dot/at/pos';

describe(`${AC[3]} a dot rides the stream, and seeking equals playing`, () => {
  it(`${AC[3]} a follow_stream dot from (2, 0) in F = (−y, x) sits at (0, 2) within 1e-6 at field time π/2`, () => {
    const [shown, at0, atHalfPi] = run(bin('show'), scenario(folder(), [present(DOC), evalAt(0, { paths: [DOT], clean: true }), evalAt(HALF_PI, { paths: [DOT], clean: true })]));
    presented(shown!, 'the dot film');
    const start = posOf(at0!, 'dot', 'eval at 0');
    expect(dist(start.slice(0, 2), [2, 0]), `the dot starts at (2, 0): it sits at (${start.join(', ')})`).toBeLessThanOrEqual(1e-6);
    const p = posOf(atHalfPi!, 'dot', 'eval at π/2 s');
    const exact = turn([2, 0], HALF_PI / FLICKS);
    expect(dist(p.slice(0, 2), exact), `at field time π/2 the dot sits at (0, 2) (exactly (${exact.join(', ')}) at the whole flick): it sits at (${p.join(', ')})`).toBeLessThanOrEqual(1e-6);
    expect(dist(p.slice(0, 2), [0, 2]), 'and within 1e-6 of (0, 2)').toBeLessThanOrEqual(1e-6);
  }, TIMEOUT);

  it(`${AC[3]} seeking to 7.3 s gives the same trim windows and dot position as playing, by hash`, () => {
    const atSeek = [fieldCall('swirl', SEEK), evalAt(SEEK, { paths: [DOT], hash: true })];
    const played = run(bin('show'), scenario(folder(), [present(DOC), ...frameTimes(60, 7.3).map((t) => evalAt(t)), ...atSeek]));
    presented(played[0]!, 'the dot film, played');
    const seeked = run(bin('show'), scenario(folder(), [present(DOC), fieldCall('swirl', SEEK), evalAt(SEEK, { paths: [DOT], hash: true, clean: true })]));
    presented(seeked[0]!, 'the dot film, seeked');
    const [start] = run(bin('show'), scenario(folder(), [present(DOC), fieldCall('swirl', 0)])).slice(1);

    const read = (r: JsonObject[], what: string): { trims: [number, number][]; dot: number[]; hash: string; data: string } => {
      const f = fieldOf(r[r.length - 2]!, `${what}: vector_field at 7.3 s`);
      const pos = posOf(r[r.length - 1]!, 'dot', `${what}: eval at 7.3 s`);
      return { trims: f.trims, dot: pos, hash: sha256(JSON.stringify({ trims: f.trims, dot: pos })), data: dataHashOf(r[r.length - 1]!, `${what}: eval at 7.3 s`) };
    };
    const play = read(played, 'played');
    const seek = read(seeked, 'seeked');
    const zero = fieldOf(start!, 'vector_field at 0').trims;

    // The windows and the dot move as the closed forms say, so equal hashes can't come from nothing moving.
    const failures: string[] = [];
    if (seek.trims.length !== 2 || zero.length !== 2) failures.push(`one trim window per stream: ${seek.trims.length} at 7.3 s, ${zero.length} at 0`);
    seek.trims.forEach(([from, to], i) => {
      if (Math.abs(to - from - 0.3) > 1e-6) failures.push(`swirl#s${i}'s window at 7.3 s is [${from}, ${to}], not [p, p + 0.3]`);
      const p0 = zero[i]?.[0] ?? NaN;
      if (!(circular(from, p0 + fract(7.3 / 8)) <= 1e-6)) failures.push(`swirl#s${i}'s window starts at ${from} at 7.3 s and ${p0} at 0: not fract(7.3 × 1 ÷ 8) = 0.9125 further`);
    });
    if (zero.length === 2 && Math.abs(zero[0]![0] - zero[1]![0]) <= 1e-6) failures.push(`both streams start their windows at ${zero[0]![0]}: the phases aren't hashed per stream`);
    if (dist(seek.dot.slice(0, 2), turn([2, 0], 7.3)) > 1e-3) failures.push(`at 7.3 s the dot sits at (${seek.dot.join(', ')}), not on the stream at the turn of (2, 0) by 7.3`);
    none(failures, 'the flow and the dot at 7.3 s');

    expect(seek.hash, `seeking to 7.3 s gives the trim windows and the dot playing gives, by hash: seek ${JSON.stringify({ trims: seek.trims, dot: seek.dot })}, play ${JSON.stringify({ trims: play.trims, dot: play.dot })}`).toBe(play.hash);
    expect(seek.data, 'and the same evaluated-data hash').toBe(play.data);
  }, TIMEOUT);
});
