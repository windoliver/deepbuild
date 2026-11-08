// #166.037482f7: "Rain at 50 drops per m² per s puts each of 100 sampled rings at the place and time its hash gives,
// with a radius that matches its closed form of age within 1 mm"
//
// The fixture (480 × 480): a still lake plate `lake` 6 m × 6 m at the origin (STILL, so rings are the only thing that
// moves the surface's normal) whose material carries `rain: 50`, seen straight down from 8 m under a day sky and a sun.
// The rings are read from the renderer's own record of what it draws (README: `view3d`'s `rings`): each captured frame
// lists every ring alive on each water part at its t as `{part, drop, at: [x, z], born, radius}`.
//
// "The place and time its hash gives": a ring's place and birth are a function of the document's seed and its drop
// index alone. So each of 100 rings sampled with a seeded generator from frame 45 (1.5 s) of the played film has the
// same `at` and `born` (within 1 µm and 1 µs) and the same radius (within 1 mm) in frame 45 reached by a cold seek in the
// same process and in a fresh process; it lies on the plate and was born at or before t. The births in the 0.1 s before
// frame 75 number 50 × 36 m² × 0.1 s = 180 within five Poisson deviations (±67). With the document's seed changed from
// 166 to 167, fewer than a tenth of the sampled drops keep their place: the hash reads the seed.
// "A radius that matches its closed form of age": the radius is one function of age, t − born, for every ring, in every
// frame, played or seeked. Each sampled ring's radius is within 1 mm of the radius other drops had at the same age,
// interpolated between the two of them nearest in age (each within 5 ms) observed in frames 30, 60 and 75.
// Not vacuous: the rings are drawn (frame 45 without rain has another pixel hash). Wrong programs: rings grown frame by
// frame (a seek restarts them), places drawn from a generator that steps each frame, a radius that depends on the drop.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DAY_SKY, type JsonObject, Lcg, STILL, arr, camItem, frameAt, framesOf, hashAt, look3d, num, obj, plate, requireGpu, runGpu, sceneDoc,
  str, sun, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 480];
const CAM: Cam = { position: [0, 8, 0], target: [0, 0, 0], fov: 45, size: SIZE };
const LOOK = look3d('rain-166');
const FPS = 30;

function lake(seed: number, rain: number): JsonObject {
  return sceneDoc(`rain-${seed}-${rain}`, SIZE, {
    cam: camItem(CAM), sky: DAY_SKY, sun: sun(3, [-40, 25, 0]),
    'lake-water': waterMaterial({ ...STILL, rain }, { roughness: 0.05 }),
    lake: plate([6, 6], [64, 64], [0, 0, 0], 'lake-water'),
  }, { seed });
}

interface Ring { drop: number; x: number; z: number; born: number; radius: number; t: number }
function ringsOf(reply: JsonObject, n: number, what: string): Map<number, Ring> {
  const f = frameAt(framesOf(reply, what), n, what);
  const t = n / FPS; const m = new Map<number, Ring>();
  for (const [i, v] of arr(f.raw['rings'], `${what}: frame ${n}'s rings`).entries()) {
    const r = obj(v, `${what}: frame ${n}: rings[${i}]`);
    expect(str(r['part'], `${what}: rings[${i}].part`), `${what}: rings[${i}] is on the lake`).toBe('lake');
    const at = arr(r['at'], `${what}: rings[${i}].at`);
    const ring = { drop: num(r['drop'], `rings[${i}].drop`), x: num(at[0], `rings[${i}].at[0]`), z: num(at[1], `rings[${i}].at[1]`), born: num(r['born'], `rings[${i}].born`), radius: num(r['radius'], `rings[${i}].radius`), t };
    expect(m.has(ring.drop), `${what}: frame ${n} lists drop ${ring.drop} once`).toBe(false);
    m.set(ring.drop, ring);
  }
  return m;
}

describe(`${AC[6]} rain rings at hashed places and times, each a closed form of its age`, () => {
  it(`${AC[6]} at 50 drops per m² per s, 100 sampled rings keep their hashed place and birth seeked and in a fresh process, and their radius is one closed form of age within 1 mm`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'rain', lake(166, 50));
    const ringCall = (d: string, from: number | undefined, frames: number, capture: number[]) =>
      view3d({ doc: d, look: LOOK, size: SIZE, ...(from === undefined ? {} : { from }), frames, fps: FPS, capture, rings: true });
    const [played, seeked, dry, reseeded] = runGpu(bin(), dir, [
      ringCall(doc, undefined, 76, [30, 45, 60, 75]), ringCall(doc, 45, 1, [45]),
      view3d({ doc: writeJson(dir, 'dry', lake(166, 0)), look: LOOK, size: SIZE, from: 45, frames: 1, fps: FPS }),
      ringCall(writeJson(dir, 'seed167', lake(167, 50)), 45, 1, [45]),
    ]);
    const [fresh] = runGpu(bin(), dir, [ringCall(doc, 45, 1, [45])]);
    expect(hashAt(dry!, 45, 'the lake without rain'), 'the rings are drawn: frame 45 without rain has another pixel hash').not.toBe(hashAt(played!, 45, 'the rainy lake'));

    const at45 = ringsOf(played!, 45, 'the played film');
    const others = [30, 60, 75].flatMap((n) => [...ringsOf(played!, n, 'the played film').values()]);
    const seek45 = ringsOf(seeked!, 45, 'the seek to 45'); const fresh45 = ringsOf(fresh!, 45, 'the seek in a fresh process');
    const other45 = ringsOf(reseeded!, 45, 'the lake seeded 167');

    // The rate: births in the 0.1 s before frame 75.
    const late = [...ringsOf(played!, 75, 'the played film').values()].filter((r) => r.born > 2.5 - 0.1 && r.born <= 2.5).length;
    console.log(`${AC[6]}: ${at45.size} rings alive at 1.5 s; ${late} born in the 0.1 s before 2.5 s (180 expected)`);
    expect(Math.abs(late - 180), `births in 0.1 s on 36 m² at 50 drops per m² per s: ${late}, 180 within ±67`).toBeLessThanOrEqual(67);

    // The closed form of age, from every other drop's (age, radius) in frames 30, 60 and 75.
    const curve = others.map((r) => ({ drop: r.drop, age: r.t - r.born, radius: r.radius })).sort((a, b) => a.age - b.age);
    const radiusAt = (age: number, drop: number): number | null => {
      let lo: { age: number; radius: number } | null = null; let hi: { age: number; radius: number } | null = null;
      for (const c of curve) {
        if (c.drop === drop) continue;
        if (c.age <= age) lo = c; else { hi = c; break; }
      }
      if (!lo || !hi || age - lo.age > 0.005 || hi.age - age > 0.005) return null;
      return hi.age === lo.age ? lo.radius : lo.radius + ((hi.radius - lo.radius) * (age - lo.age)) / (hi.age - lo.age);
    };

    const drops = [...at45.values()].filter((r) => radiusAt(r.t - r.born, r.drop) !== null);
    expect(drops.length, 'at least 100 rings alive at 1.5 s have drops of neighbouring age to compare with').toBeGreaterThanOrEqual(100);
    const rng = new Lcg(6166); const picked: typeof drops = [];
    while (picked.length < 100) { const k = Math.floor(rng.next() * drops.length); picked.push(drops.splice(k, 1)[0]!); }
    const failures: string[] = []; let kept = 0;
    for (const r of picked) {
      const name = `drop ${r.drop}`;
      if (!(Math.abs(r.x) <= 3 && Math.abs(r.z) <= 3)) failures.push(`${name} at (${r.x}, ${r.z}) is off the 6 m plate`);
      if (!(r.born <= r.t)) failures.push(`${name} is born at ${r.born} s, after 1.5 s`);
      for (const [where, m] of [['seeked', seek45], ['in a fresh process', fresh45]] as const) {
        const s = m.get(r.drop);
        if (!s) { failures.push(`${name} is missing from frame 45 ${where}`); continue; }
        if (Math.hypot(s.x - r.x, s.z - r.z) > 1e-6 || Math.abs(s.born - r.born) > 1e-6) failures.push(`${name} ${where} is at (${s.x}, ${s.z}) born ${s.born} s, played at (${r.x}, ${r.z}) born ${r.born} s`);
        if (Math.abs(s.radius - r.radius) > 0.001) failures.push(`${name} ${where} has radius ${s.radius} m, played ${r.radius} m`);
      }
      const want = radiusAt(r.t - r.born, r.drop)!;
      if (Math.abs(r.radius - want) > 0.001) failures.push(`${name} at age ${(r.t - r.born).toFixed(4)} s has radius ${r.radius.toFixed(5)} m; other drops at that age have ${want.toFixed(5)} m`);
      const o = other45.get(r.drop);
      if (o && Math.hypot(o.x - r.x, o.z - r.z) <= 1e-6) kept++;
    }
    expect(failures, `each of 100 sampled rings at its hashed place and time, its radius one closed form of age: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
    expect(kept, 'with the document\'s seed changed, fewer than a tenth of the sampled drops keep their place').toBeLessThan(10);
  });
});
