// AC4 #427.43a16f33: In deviation mode, a 1 m UV sphere simplified to 200 triangles, against its 20,000-triangle source,
// reports a largest distance equal to the job probe's measured error within 1e-6 m, and the legend's top value reads
// that number. On a fixture whose simplified mesh bulges outward past its source, a planted mode that measures only from
// the source to the simplified mesh reports a smaller largest distance and fails, naming the face; a request naming an
// asset hash the store lacks answers `reference_missing`, naming the hash, and returns no snapshot.
//
// The sphere: a capped UV sphere of radius 0.5 m (1 m across), 100 segments by 101 rings, 20,000 triangles, written by
// the test as a glTF. `deep-gpu`'s `simplify` job (#425) gives it one level of at most 200 triangles and, from its
// probe, that level's measured error in metres (README: Assumed surfaces 4). The level's indices over the source's
// vertices make the simplified mesh; both meshes go into the evidence store, and deep_show's deviation mode measures the
// simplified item against the source by hash. Besides equalling the probe, the largest distance must be at least what
// geometry alone guarantees: the deepest simplified-face centroid's distance inside the shell that holds every source
// face.
//
// The bulge: a flat 2 × 2 m plate of 4 × 4 quads is the reference; the "simplified" mesh is the same plate with one
// interior vertex raised 0.1 m. Measured both ways the largest distance is 0.1 m, at that vertex, on the faces around
// it; from the source to the bulge alone it is under 0.0996 m.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, type JsonObject, type JsonValue, type Mesh, type V3, accessorU32, arr, brief, camera, drew, failsNaming, gltf, meshAsset, mode,
  none, num, obj, objs, plate, requireMetal, runShow, scenario, scene, seed, sha256, show, str, sun, useBuilds, useDir, uvSphere,
} from './helpers.ts';

const ID = AC[4];
const bin = useBuilds(['deep-show', 'deep-gpu']);
const dir = useDir();

/** `deep-gpu run` with one simplify call; its reply. */
function simplify(out: string, asset: string): JsonObject {
  const input = { out, calls: [{ call: 'simplify', asset, node: 0, levels: [{ ratio: 0.01, max_triangles: 200 }] }] };
  const r = spawnSync(bin('deep-gpu'), ['run'], { input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  expect(r.status, `deep-gpu run exits 0; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const answer = obj(JSON.parse(r.stdout.trim().split('\n')[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run: ${brief(answer)}`).toBe(true);
  return obj(arr(answer['replies'], 'replies')[0], 'the simplify reply');
}

const deviationOf = (reply: JsonObject, what: string): JsonObject => obj(reply['deviation'], `${what}: deviation (${brief(reply, 800)})`);
const norm = (p: V3): number => Math.hypot(p[0], p[1], p[2]);

describe(`${ID} the deviation mode measures both ways, equal to the job's probe`, () => {
  it(`${ID} a 1 m UV sphere simplified to 200 triangles reports the probe's measured error as its largest distance, and the legend's top reads it`, () => {
    requireMetal();
    const out = dir(); const evidence = join(out, 'evidence');
    const source = uvSphere(0.5, 100, 101);
    expect(source.indices.length / 3, 'the source has 20,000 triangles').toBe(20_000);
    const sourceBytes = gltf(source);
    const sourcePath = join(out, 'sphere.gltf'); writeFileSync(sourcePath, sourceBytes);
    const job = simplify(out, sourcePath);
    const levels = objs(job['levels'], 'simplify: levels');
    expect(levels.length, `simplify gives the source and one level: ${brief(job)}`).toBe(2);
    const tris = num(levels[1]!['triangles'], 'level 1: triangles');
    expect(tris > 100 && tris <= 200, `level 1 is simplified to 200 triangles or just under, not ${tris}`).toBe(true);
    const measured = arr(job['measured_m'], `simplify: the probe's measured error in metres (${brief(job)})`).map((v, i) => num(v, `measured_m[${i}]`));
    expect(measured[0], 'level 0 is the source: measured error 0').toBe(0);

    const outGltf = obj(JSON.parse(readFileSync(join(out, `${str(job['sha256'], 'simplify: sha256')}.gltf`), 'utf8')) as JsonValue, 'the job\'s output');
    const lod = obj(obj(obj(arr(obj(arr(outGltf['meshes'], 'meshes')[0], 'mesh')['primitives'], 'primitives')[0], 'primitive')['extras'], 'extras')['lod'], 'extras.lod');
    const indices = accessorU32(outGltf, num(obj(arr(lod['levels'], 'lod.levels')[0], 'level 1')['indices'], 'level 1: indices'));
    expect(indices.length / 3, 'the level\'s indices are its triangles').toBe(tris);
    const low: Mesh = { positions: source.positions, indices };
    const srcSha = seed(evidence, sourceBytes); const lowSha = seed(evidence, gltf(low));

    // What geometry guarantees: every source face lies outside radius dmin (its plane's distance from the centre), so a
    // simplified face's centroid c is at least dmin − |c| from the source surface.
    const tri = (m: Mesh, t: number): [V3, V3, V3] => [m.positions[m.indices[3 * t]!]!, m.positions[m.indices[3 * t + 1]!]!, m.positions[m.indices[3 * t + 2]!]!];
    let dmin = Infinity;
    for (let t = 0; t < 20_000; t++) {
      const [a, b, c] = tri(source, t);
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      dmin = Math.min(dmin, Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) / norm(n));
    }
    let floor = 0;
    for (let t = 0; t < tris; t++) { const [a, b, c] = tri(low, t); floor = Math.max(floor, dmin - norm([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3])); }

    const doc = scene('Simplified sphere', { cam: camera([0, 0, 0], 3), 'ball.low': meshAsset(lowSha), key: sun() });
    const [, reply] = runShow(bin('deep-show'), scenario(evidence, [show(doc), mode('deviation', { item: 'ball.low', reference: srcSha })]));
    drew(reply!, 'the deviation mode');
    const d = deviationOf(reply!, 'the deviation mode');
    const largest = num(d['largest_m'], 'largest_m');
    const p: string[] = [];
    if (Math.abs(largest - measured[1]!) > 1e-6) p.push(`largest distance ${largest} m, not the probe's measured error ${measured[1]} m`);
    if (largest < floor - 1e-6) p.push(`largest distance ${largest} m is under ${floor} m, the deepest simplified face's distance from the source's shell`);
    const legend = obj(d['legend'], 'legend');
    if (legend['unit'] !== 'm' || typeof legend['top'] !== 'number' || Math.abs(legend['top'] - largest) > 1e-6) p.push(`the legend's top reads ${brief(legend['top'])} ${brief(legend['unit'])}, not ${largest} m`);
    const ways = [obj(d['to_reference'], 'to_reference'), obj(d['from_reference'], 'from_reference')];
    const wayMax = Math.max(...ways.map((w, i) => num(w['largest_m'], `way ${i}: largest_m`)));
    if (Math.abs(wayMax - largest) > 1e-6) p.push(`largest ${largest} m isn't the larger of the two ways' (${wayMax} m)`);
    const mean = num(d['mean_m'], 'mean_m');
    if (!(mean > 0 && mean <= largest)) p.push(`mean distance ${mean} m isn't within (0, largest]`);
    const worst = objs(d['worst'], 'worst');
    if (worst.length !== 10) p.push(`${worst.length} worst faces listed, not 10`);
    const dist = worst.map((w, i) => num(w['distance_m'], `worst[${i}].distance_m`));
    if (dist.some((x, i) => i > 0 && x > dist[i - 1]! + 1e-12)) p.push(`the worst faces aren't listed worst first: ${dist.join(', ')}`);
    if (dist.length && Math.abs(dist[0]! - largest) > 1e-6) p.push(`the worst face's distance ${dist[0]} m isn't the largest ${largest} m`);
    if (worst.some((w) => !Number.isInteger(w['face']) || (w['face'] as number) < 0 || (w['face'] as number) >= tris)) p.push(`a worst face isn't one of the item's ${tris} faces: ${brief(worst)}`);
    none(p, 'the sphere against its source');
  }, 1_800_000);

  it(`${ID} a bulge past the source reads 0.1 m at its face, a one-way measure fails naming the face, and a missing reference answers reference_missing`, () => {
    requireMetal();
    const evidence = dir();
    const flat = plate(2, 2, 4, 4); const bulged = plate(2, 2, 4, 4, (i, j) => (i === 1 && j === 1 ? 0.1 : 0));
    const flatSha = seed(evidence, gltf(flat)); const bulgeSha = seed(evidence, gltf(bulged));
    const peak = 1 * 5 + 1;
    const around = Array.from({ length: bulged.indices.length / 3 }, (_, t) => t).filter((t) => bulged.indices.slice(3 * t, 3 * t + 3).includes(peak));
    const face = around[0]!;
    const missing = sha256(Buffer.from('an asset the store never held'));
    const doc = scene('Bulged plate', { cam: camera([0, 0, 0], 5), bulge: meshAsset(bulgeSha), key: sun() });
    const calls = [show(doc), mode('deviation', { item: 'bulge', reference: flatSha }), mode('deviation', { item: 'bulge', reference: missing })];

    const problems = (reply: JsonObject): string[] => {
      const d = deviationOf(reply, 'the bulge');
      const largest = num(d['largest_m'], 'largest_m');
      const p: string[] = [];
      if (Math.abs(largest - 0.1) > 1e-6) p.push(`largest distance ${largest} m, not 0.1 m at the bulge's face ${face}`);
      const top = obj(arr(d['worst'], 'worst')[0], 'worst[0]')['face'];
      if (!around.includes(top as number)) p.push(`the worst face is ${brief(top)}, not one of the faces at the bulge (face ${face} first of ${around.join(', ')})`);
      return p;
    };
    const [, right, absent] = runShow(bin('deep-show'), scenario(evidence, calls));
    drew(right!, 'the bulge in deviation mode');
    none(problems(right!), 'the bulge measured both ways');
    expect(absent!['code'], `a reference the store lacks: ${brief(absent)}`).toBe('reference_missing');
    expect(JSON.stringify(absent), 'the answer names the missing hash').toContain(missing);
    expect(absent!['snapshots'] ?? [], 'and returns no snapshot').toEqual([]);

    const [, oneWay] = runShow(bin('deep-show'), scenario(evidence, calls.slice(0, 2)), 'deviation_one_way');
    const reported = num(deviationOf(oneWay!, 'the one-way bulge')['largest_m'], 'largest_m');
    expect(reported, 'the one-way measure reports a smaller largest distance').toBeLessThan(0.1 - 1e-6);
    failsNaming(problems(oneWay!), [`face ${face}`], 'planted deviation_one_way');
  }, 1_800_000);
});
