// AC3 #2738.99312f73: A drawn proxy band is unchanged: when the renderer draws a scene, a 64-segment `ball@1` whose
// `lod` shows `proxy` with `ratio` 0.25 draws more than 0 and at most 30% of its full mesh's triangles.
//
// The renderer draws the scene through the GPU layer: `deep-gpu run`'s `view3d` (#378) with `lod: true` (#425's rows),
// one frame on this Mac's Metal device. The same ball is drawn twice, its one band's threshold far above its size (it
// shows `proxy`) and far below it (it shows `full`, its full mesh); nothing else differs. Each frame's `lod` row names
// the band drawn and the triangles drawn (README: Assumed surfaces). The proxy's triangles must be more than 0 and at
// most 30% of the full band's; and the two frames' pixel hashes must differ, so the report is held to what the
// renderer drew: a renderer that draws the proxy band at the full mesh draws the same pixels twice (README: Planted).
import { describe, it } from 'vitest';
import { AC, ballScene, drawnItem, none, requireMetal, runGpu, shown, useDir, useGpu, view3d, writeJson, type Drawn } from './helpers.ts';

const ID = AC[3];
const gpu = useGpu();
const dir = useDir();

/** What's wrong with one drawn ball: no row, another band, or no triangle count. */
function problems(d: Drawn, band: string, what: string, out: string[]): number | null {
  if (!d.row) { out.push(`${what}: frame 0 has no lod row for the ball: ${shown(d.frame['lod'])}`); return null; }
  if (JSON.stringify(d.row['bands']) !== JSON.stringify([band])) out.push(`${what}: the ball draws ${shown(d.row['bands'])}, not ["${band}"]`);
  const t = d.row['triangles'];
  if (typeof t !== 'number' || !Number.isInteger(t)) { out.push(`${what}: the ball's row reports no triangles drawn (triangles: ${shown(t)})`); return null; }
  return t;
}

describe(`${ID} a drawn proxy band is unchanged`, () => {
  it(`${ID} when the renderer draws a scene, a 64-segment ball@1 whose lod shows proxy with ratio 0.25 draws more than 0 and at most 30% of its full mesh's triangles`, () => {
    requireMetal();
    const out = dir();
    const [asProxy, asFull] = runGpu(gpu(), out, [
      view3d(writeJson(out, 'proxy', ballScene(100_000))),
      view3d(writeJson(out, 'full', ballScene(1))),
    ]);
    const proxy = drawnItem(asProxy!, 'ball', 'the ball in its proxy band');
    const full = drawnItem(asFull!, 'ball', 'the ball in its full band');
    const failures: string[] = [];
    const p = problems(proxy, 'proxy', 'the ball in its proxy band', failures);
    const f = problems(full, 'full', 'the ball in its full band', failures);
    if (f !== null && f <= 0) failures.push(`the full band draws ${f} triangles`);
    if (p !== null && f !== null && !(p > 0 && p <= 0.3 * f)) failures.push(`the proxy band draws ${p} of the full mesh's ${f} triangles (${((100 * p) / f).toFixed(1)}%), not more than 0 and at most 30%`);
    if (typeof proxy.pixelHash !== 'string' || typeof full.pixelHash !== 'string') failures.push(`a frame has no pixel hash: ${shown(proxy.pixelHash)}, ${shown(full.pixelHash)}`);
    else if (proxy.pixelHash === full.pixelHash) failures.push(`the proxy band draws the same pixels as the full band (${proxy.pixelHash}): the renderer drew the full mesh`);
    none(failures, 'the renderer draws the proxy band at more than 0 and at most 30% of the full mesh\'s triangles');
  }, 3 * 3_600_000);
});
