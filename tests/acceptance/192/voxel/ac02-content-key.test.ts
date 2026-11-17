// #192.8553dd58: The document that names it, checked twice, runs the provider once, the second check a cache hit by
// content key; changing one param runs it once more; and a 60 s playback with seeks to 10 seeded times runs it zero
// times, with every frame's hash equal to a straight play's; a planted key that leaves out the params reuses the old
// output after the param change and fails, naming the param.
//
// One `deep-show run` process (README: The surface): the voxel document checked twice at size 0.25, then once at
// size 0.375, then played straight for 60 s (3,600 frames at 60 per second, each with its pixel hash) and seeked to
// 10 frames drawn from a fixed seed. "Runs" is the sandbox module's count of check-time runs (#238's `sandbox`
// call); "a cache hit by content key" is no run and the `provided` row's key unchanged. A rect a channel moves makes
// every frame differ, so a seek that landed on the wrong frame shows. The same calls with the scenario's `planted:
// "provider_key_omits_params"` must fail this test's check, naming the param `size`.
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, MESH_BUILD, SANDBOX, arr, countsOf, deepShow, frames, installPack, meshOf, obj, present, provided, rowOf, runShow, scenario,
  show, str, sub, useTemp, type JsonObject, type Planted,
} from './helpers.ts';
import { MOVING, SIZE, blockBounds, mover, voxPack, voxelDoc } from './programs.ts';

const ID = '#192.8553dd58';
const temp = useTemp();
const SEED = 192_002;
const FRAMES = 3600;
/** 10 distinct frame numbers in [0, 3600), drawn by mulberry32 from 192002, in the order drawn (not sorted). */
function seekFrames(): number[] {
  let a = 192_002 >>> 0;
  const next = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
  const out: number[] = [];
  while (out.length < 10) { const k = Math.floor(next() * FRAMES); if (!out.includes(k)) out.push(k); }
  return out;
}
const SEEKS = seekFrames();
const doc = (size: number): JsonObject => voxelDoc(size, SEED, MOVING);
const docWithMover = (size: number): JsonObject => { const d = doc(size); (d['items'] as JsonObject)['mover'] = mover(); return d; };

function calls(evidence: string, planted?: Planted): JsonObject {
  return scenario(evidence, [
    SANDBOX,
    present(DOC.a, docWithMover(SIZE.first)), SANDBOX, provided(DOC.a),
    present(DOC.a, docWithMover(SIZE.first)), SANDBOX, provided(DOC.a),
    present(DOC.a, docWithMover(SIZE.changed)), SANDBOX, provided(DOC.a),
    frames(DOC.a, FRAMES), ...SEEKS.map((k) => frames(DOC.a, 1, k)), SANDBOX, provided(DOC.a),
  ], planted);
}
const hashes = (reply: JsonObject, what: string): string[] =>
  arr(reply['frames'], `${what}: frames`).map((f, i) => str(obj(f, `${what}: frames[${i}]`)['pixel_hash'], `${what}: frames[${i}].pixel_hash`));
const near = (a: number[][], b: number[][]): boolean => a.every((c, i) => c.every((x, k) => Math.abs(x - b[i]![k]!) <= 1e-6));

/** What the criterion requires of one run of `calls` (after the install), each failure saying what differs. */
function failures(rs: JsonObject[]): string[] {
  const out: string[] = [];
  const [c0, shown1, c1, p1, shown2, c2, p2, shown3, c3, p3, straight] = rs;
  const seeks = rs.slice(11, 21);
  const [c4, p4] = rs.slice(21);
  for (const [r, w] of [[shown1, 'the first check'], [shown2, 'the second check'], [shown3, 'the check after the param change']] as const) {
    if (r!['outcome'] !== 'presented') out.push(`${w}: the document isn't presented: ${show(r)}`);
  }
  const runs = [c0, c1, c2, c3, c4].map((c, i) => countsOf(c!, `sandbox[${i}]`).runs);
  const row = (p: JsonObject | undefined, w: string) => rowOf(p!, 'vox', w);
  const r1 = row(p1, 'after the first check'), r2 = row(p2, 'after the second check'), r3 = row(p3, 'after the param change'), r4 = row(p4, 'after the playback');
  if (!DIGEST.test(r1.key)) out.push(`the first check's provided row has no content key: ${show(r1.raw)}`);
  if (runs[1]! - runs[0]! !== 1) out.push(`the first check ran the provider ${runs[1]! - runs[0]!} times, not once`);
  if (r1.out === null || !near(meshOf(r1, 'the first mesh').bounds, blockBounds(SIZE.first))) out.push(`the first check's mesh isn't the block at size ${SIZE.first}: ${show(r1.raw).slice(0, 300)}`);
  if (runs[2]! - runs[1]! !== 0) out.push(`the second check of the same document ran the provider ${runs[2]! - runs[1]!} times, not 0 (a cache hit by content key)`);
  if (r2.key !== r1.key) out.push(`the second check's content key ${r2.key} differs from the first's ${r1.key}`);
  if (runs[3]! - runs[2]! !== 1) out.push(`after the param \`size\` changed from ${SIZE.first} to ${SIZE.changed}, the check ran the provider ${runs[3]! - runs[2]!} times, not once`);
  if (r3.key === r2.key) out.push(`after the param \`size\` changed from ${SIZE.first} to ${SIZE.changed}, the content key stayed ${r3.key}`);
  if (r3.out === null || !near(meshOf(r3, 'the mesh after the change').bounds, blockBounds(SIZE.changed))) {
    out.push(`after the param \`size\` changed to ${SIZE.changed}, the mesh isn't the block at that size (the old output reused?): bounds ${show(r3.out === null ? null : (obj(r3.out['mesh'], 'mesh')['bounds'] ?? null))}`);
  }
  const play = hashes(straight!, 'the straight play');
  if (play.length !== FRAMES) out.push(`the straight 60 s play gave ${play.length} frames, not ${FRAMES}`);
  SEEKS.forEach((k, i) => {
    const [h] = hashes(seeks[i]!, `the seek to frame ${k}`);
    if (h !== play[k]) out.push(`the seek to frame ${k} (${(k / 60).toFixed(3)} s) drew ${h}, the straight play ${play[k]}`);
  });
  if (runs[4]! - runs[3]! !== 0) out.push(`the 60 s playback and the 10 seeks ran the provider ${runs[4]! - runs[3]!} times, not 0`);
  if (r4.key !== r3.key) out.push(`the playback changed the provided content key from ${r3.key} to ${r4.key}`);
  return out;
}

describe(`${ID} a provider runs once per content key at check, and never in playback or a seek`, () => {
  it(`${ID} checked twice the document runs the provider once (the second a cache hit by content key), a param change runs it once more, and a 60 s playback with seeks to 10 seeded times runs it zero times with every frame's hash equal to a straight play's; a planted key that leaves out the params fails, naming the param`, () => {
    const root = temp();
    const vox = voxPack(sub(root, 'packs'));
    const run = (planted?: Planted): JsonObject[] => {
      const sc = calls(sub(root, `evidence-${planted ?? 'real'}`), planted);
      (sc['calls'] as JsonObject[]).unshift(installPack(vox));
      const rs = runShow(deepShow(MESH_BUILD), sc);
      expect(rs[0]!['outcome'], `test/voxpack@1.0.0 installs: ${show(rs[0])}`).toBe('installed');
      return rs.slice(1);
    };
    const real = run();
    expect(failures(real), 'the provider runs once per content key and never in playback or a seek').toEqual([]);
    const play = hashes(real[10]!, 'the straight play');
    expect(new Set(play).size, 'the moving rect makes the straight play\'s frames differ, so a seek to a wrong frame shows').toBeGreaterThan(SEEKS.length);

    const planted = failures(run('provider_key_omits_params'));
    expect(planted.length, 'the planted key that leaves out the params fails this check').toBeGreaterThan(0);
    expect(planted.filter((f) => f.includes('`size`')), `and a failure names the param size: ${show(planted)}`).not.toEqual([]);
  }, 3_600_000);
});
