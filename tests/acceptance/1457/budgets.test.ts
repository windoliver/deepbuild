// AC4 and AC5 #1457, against the merge base's binary that the local preflight builds and names. Missing numbers are
// INCONCLUSIVE, never PASS.
//   BASE_BIN_DEBUG    the merge base's debug deep-app (AC4: tree and pictures, on #1172's fixtures)
//   BASE_BIN_RELEASE  the merge base's release deep-app (AC5: size and first frame)
//   BASE_FIRST_FRAME_MS  optional: the base's first frame, overriding the run here
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App, appBinary, makeWorld, nodes, settled, type Node, type Picture, useCleanup } from '../1172/helpers.ts';
import { BUILD_MS, releaseBuild } from '../1408/helpers.ts';
import { judgeBudget, size, supplied } from './helpers.ts';

useCleanup();
const shape = (n: Node): unknown => ({ r: n.role, n: n.name, f: n.frame.map(Math.round), c: n.children.map(shape) });
/** Pixels (every 4th) that differ by more than 2 per channel between two pictures. */
function delta(a: Picture, b: Picture): { differing: number; sampled: number } {
  if (a.width !== b.width || a.height !== b.height) return { differing: Infinity, sampled: 0 };
  let differing = 0; let sampled = 0;
  for (let y = 0; y < a.height; y += 4) for (let x = 0; x < a.width; x += 4) {
    sampled++;
    const p = a.at(x, y); const q = b.at(x, y);
    if (p.some((v, i) => Math.abs(v - q[i]!) > 2)) differing++;
  }
  return { differing, sampled };
}
async function look(world: Awaited<ReturnType<typeof makeWorld>>, binary: string, tag: string) {
  const app = await App.launch({ home: world.home, binary });
  await settled(async () => (nodes((await app.tree()).windows[0]!.tree).length > 20 ? [] : ['still drawing']));
  const tree = (await app.tree()).windows.map((w) => shape(w.tree));
  const picture = await app.capture(tag);
  await app.stop();
  return { tree, picture };
}
/** Time from start to the first window, which has drawn its first frame; the median of `runs`. */
async function firstFrameMs(binary: string, runs = 5): Promise<number> {
  const world = await makeWorld();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const app = await App.launch({ home: world.home, binary });
    times.push(Date.now() - t0);
    await app.stop();
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

describe('#1457 AC4 nothing a person sees changes', () => {
  it('the real app\'s tree and window picture on #1172\'s fixtures equal the merge base\'s; any delta is listed', async () => {
    const base = supplied('BASE_BIN_DEBUG');
    const world = await makeWorld();
    const was = await look(world, base, 'base');
    const now = await look(world, await appBinary(), 'now');
    const d = delta(was.picture, now.picture);
    expect({ tree: JSON.stringify(now.tree) === JSON.stringify(was.tree), pictureDelta: `${d.differing} of ${d.sampled} sampled pixels differ` }).toEqual({ tree: true, pictureDelta: `0 of ${d.sampled} sampled pixels differ` });
  }, 10 * 60_000);
  it('wrong program: a tree with one name changed, and a picture with a changed pixel, are told apart from the base', () => {
    const t = { r: 'AXGroup', n: 'Needs you', f: [0, 0, 10, 10], c: [] };
    expect(JSON.stringify(shape({ role: 'AXGroup', name: 'Needs you', frame: [0, 0, 10, 10], children: [] }))).toBe(JSON.stringify(t));
    expect(JSON.stringify(shape({ role: 'AXGroup', name: 'Needs  you', frame: [0, 0, 10, 10], children: [] }))).not.toBe(JSON.stringify(t));
    const mk = (v: number): Picture => ({ path: '', width: 8, height: 8, at: () => [v, v, v] });
    expect(delta(mk(10), mk(10)).differing).toBe(0);
    expect(delta(mk(10), mk(40)).differing).toBeGreaterThan(0);
  });
});

describe('#1457 AC5 budgets against the merge base', () => {
  it('the release binary is smaller and the first frame not slower, both numbers reported', async () => {
    const base = supplied('BASE_BIN_RELEASE');
    const bin = join(await releaseBuild('deep-app'), 'deep-app');
    const baseMs = process.env.BASE_FIRST_FRAME_MS ? Number(process.env.BASE_FIRST_FRAME_MS) : await firstFrameMs(base);
    const o = { bytes: size(bin), baseBytes: size(base), ms: await firstFrameMs(bin), baseMs };
    console.log(`#1457 AC5 release binary ${o.bytes} B vs base ${o.baseBytes} B; first frame ${o.ms} ms vs base ${o.baseMs} ms`);
    expect(judgeBudget(o)).toEqual([]);
  }, BUILD_MS);
  it('wrong program: a bigger binary, an equal one and a slower first frame each fail the judge', () => {
    expect(judgeBudget({ bytes: 101, baseBytes: 100, ms: 50, baseMs: 50 })).toHaveLength(1);
    expect(judgeBudget({ bytes: 100, baseBytes: 100, ms: 50, baseMs: 50 })).toHaveLength(1);
    expect(judgeBudget({ bytes: 90, baseBytes: 100, ms: 51, baseMs: 50 })).toHaveLength(1);
    expect(judgeBudget({ bytes: 90, baseBytes: 100, ms: 50, baseMs: 50 })).toEqual([]);
  });
});
