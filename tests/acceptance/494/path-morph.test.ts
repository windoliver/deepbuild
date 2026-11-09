// AC1 #494.e411da84: A path channel keyed from a circle to a five-point star equals the circle at its first key and the
// star at its last within 0.01 u at 64 points, closed and with one point count at every time between, seeking equal to
// playing; with morph: strict the same keys are refused naming the channel.
//
// Through `deep-motion eval`: a path@1 item `shape` whose path channel `circle-to-star` (README: Path channel) keys a
// circle at 64 points (the regular 64-gon of radius 100 u, every vertex on the circle) at 0 s and a five-point star of
// 10 points (outer radius 100 u) at 1 s, linear, so the keys differ in point count and are matched at check. Every
// 60 fps frame of [0 s, 1 s] reads `channels.circle-to-star.value`. A path that holds the circle and jumps, or one that
// cross-fades, can't pass: between the keys each point is the mix of its matched ends at the segment's progress.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, accepted, allPoints, channel, channelValue, circle64, evalAll, evalOk, film, fl, frames60, key, mentions, none, pathItem, pathValue,
  pointCount, readPath, show, star5, toOutline, useMotion, type Frame, type JsonObject, type Sub, type V2,
} from './helpers.ts';

const motion = useMotion();
const C: V2 = [400, 225];
const CIRCLE = circle64(C, 100);
const STAR = star5(C, 100);
const CHANNEL = 'circle-to-star';
const TIMES = frames60(0, 1);
const doc = (extra: JsonObject = {}, end = STAR): JsonObject => film('circle-star', [pathItem('shape', [CIRCLE])], {
  channels: { [CHANNEL]: channel('items/shape/path', 'path', [key(0, pathValue([CIRCLE])), key(1, pathValue([end]))], extra) },
});
const pathAt = (frame: Frame, what: string): Sub[] => readPath(channelValue(frame, CHANNEL, what), `${what}: channels.${CHANNEL}.value at ${frame.t} flicks`);

describe(`${AC[1]} a path channel from a circle to a five-point star, matched at check`, () => {
  it(`${AC[1]} equals the circle at its first key and the star at its last within 0.01 u at 64 points, closed with one point count at every 60 fps frame between, each point the mix of its matched ends`, () => {
    const frames = evalOk(motion(), { doc: doc(), times: TIMES }, 'the circle-to-star channel');
    const paths = frames.map((f) => pathAt(f, 'the circle-to-star channel'));
    const failures: string[] = [];
    paths.forEach((subs, i) => {
      const t = TIMES[i]!;
      if (subs.length !== 1) failures.push(`at ${t} flicks the path has ${subs.length} sub-paths, not one`);
      if (!subs.every((s) => s.closed)) failures.push(`at ${t} flicks the path isn't closed`);
      if (pointCount(subs) !== 64) failures.push(`at ${t} flicks the path has ${pointCount(subs)} points, not 64`);
    });
    none(failures, 'closed, with 64 points at every time');
    const first = allPoints(paths[0]!); const last = allPoints(paths[paths.length - 1]!);
    const offCircle = first.filter((p) => Math.abs(Math.hypot(p[0] - C[0], p[1] - C[1]) - 100) > 0.01);
    expect(offCircle, `at the first key every point lies on the circle within 0.01 u`).toEqual([]);
    const angles = first.map((p) => Math.atan2(p[1] - C[1], p[0] - C[0])).sort((a, b) => a - b);
    const gap = Math.max(...angles.map((a, i) => (i + 1 < angles.length ? angles[i + 1]! - a : angles[0]! + 2 * Math.PI - a)));
    expect(gap, `at the first key the points go all round the circle (largest gap ${(gap * 180) / Math.PI}°)`).toBeLessThanOrEqual((2 * 2 * Math.PI) / 64);
    const offStar = last.filter((p) => toOutline(p, STAR) > 0.01);
    expect(offStar, `at the last key every point lies on the star within 0.01 u`).toEqual([]);
    const thin = STAR.map((a, e) => ({ e, on: last.filter((p) => toOutline(p, [a, STAR[(e + 1) % 10]!]) <= 0.01).length })).filter((x) => x.on < 2);
    expect(thin, 'at the last key each of the star\'s ten edges holds at least two points').toEqual([]);
    // Between the keys the segment mixes matched points as equal counts do: linear, so at the middle each point is the
    // mean of its matched ends, which are the first and last readings.
    const mid = allPoints(paths[30]!);
    const mixed = mid.map((p, i) => Math.hypot(p[0] - (first[i]![0] + last[i]![0]) / 2, p[1] - (first[i]![1] + last[i]![1]) / 2)).filter((d) => d > 1e-9);
    expect(mixed, `at 0.5 s each point is the mean of its matched ends within 1e-9 u; the first points: ${JSON.stringify(mid.slice(0, 4))}`).toEqual([]);
    const moved = mid.filter((p, i) => Math.hypot(p[0] - first[i]![0], p[1] - first[i]![1]) > 1).length;
    expect(moved, 'at 0.5 s the path has moved off the circle (a held circle fails)').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[1]} seeking equals playing: each frame alone reads the same path, bit for bit, as the frames played in order`, () => {
    const d = doc();
    const answers = evalAll(motion(), [{ doc: d, times: TIMES }, ...[...TIMES].reverse().map((t) => ({ doc: d, times: [t] }))]);
    const play = accepted(answers[0]!, TIMES, 'the play');
    const failures: string[] = [];
    [...TIMES].reverse().forEach((t, i) => {
      const seek = accepted(answers[1 + i]!, [t], `the seek to ${t}`)[0]!;
      const a = JSON.stringify(channelValue(seek, CHANNEL, 'seek')); const b = JSON.stringify(channelValue(play[TIMES.indexOf(t)]!, CHANNEL, 'play'));
      if (a !== b) failures.push(`at ${t} flicks the seek reads ${a.slice(0, 200)} but the play ${b.slice(0, 200)}`);
    });
    none(failures, 'seeking equals playing');
  }, TIMEOUT);

  it(`${AC[1]} with morph: strict the same keys are refused naming the channel, while strict keys of equal counts and the matched keys are accepted`, () => {
    const bigger = circle64(C, 120);
    const [matched, strict, equal] = evalAll(motion(), [
      { doc: doc(), times: [fl(0.5)] },
      { doc: doc({ morph: 'strict' }), times: [fl(0.5)] },
      { doc: doc({ morph: 'strict' }, bigger), times: [fl(0.5)] },
    ]);
    expect(matched!['ok'], `the keys under morph: match (the default) are accepted: ${show(matched)}`).toBe(true);
    expect(strict!['ok'], `the same keys under morph: strict are refused: ${show(strict)}`).toBe(false);
    expect(mentions(strict, CHANNEL), `the refusal names the channel ${CHANNEL}: ${show(strict)}`).toBe(true);
    const same = accepted(equal!, [fl(0.5)], 'strict keys of equal point counts (two 64-gons)')[0]!;
    expect(pointCount(pathAt(same, 'the strict equal-count channel')), 'the strict equal-count path keeps 64 points').toBe(64);
  }, TIMEOUT);
});
