// AC11 #173.77c9b0e7: With mode upscale at 0.67, a 1 px outline on the castle's battlements stays 1 device px wide in
// every moving frame of an orbit, with nothing of it left behind the moving edge; a planted resolve that takes outlines
// into the history leaves a trail and fails, naming the item.
//
// The castle as committed with each tower's stroke slot drawing a 1 px ink outline around the parts its recipe builds,
// body and merlons (helpers: `strokedCastle`; README: Assumed surfaces 11), and the castle bare, by `view3d` at 30 fps
// over frames 0–47 of its flythrough orbit, each two ways: with `history: {mode: upscale, window: 8}` at `scale: 0.67`,
// and with history off at scale 1. The resolve's colour clamp is off in the history legs (`reject: {depth: true, clamp:
// none, reactive: auto}`), so its own rejection can't hide what a planted outline leaves; an outline drawn after the
// resolve never meets it. In each frame the outline is the pixels where the stroked castle differs from the bare one by
// more than 24 codes in a channel (final 8-bit targets), with history and without. Every frame of the history legs
// reports `upscale` and the reply draws through the temporal upscale at internal scale 0.67. With history, every outline
// pixel lies within 2 px of an outline pixel without history (nothing left behind the moving edge), and the outline
// covers 0.67 to 1.5 times the pixels it covers without history (1 device px wide, as at scale 1). Without history the
// outline covers at least 200 px in each frame. A pixel left behind is named by the tower nearest it in the object-ID
// target (its part IDs start with the tower's), within 16 px.
// Wrong programs: the base (no temporal upscale, no history report; a composite's stroke reaches no part);
// `--planted outlines_in_history` (outlines draw into each window frame at the render scale before the resolve, so the
// window keeps them and the resolve reprojects and upscales them), which leaves a trail and fails, naming a tower.
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, HISTORY_OFF, HISTORY_UPSCALE, TOWERS, castle, castleLook, codeDiff, frameAt, framesOf, readIds, readPng, reject, requireMetal, runGpu,
  strokedCastle, surfaceOf, useDir, useGpu, view3dCall, type GpuPlanted, type Image, type Ids,
} from './helpers.ts';

const ID = AC[11];
const bin = useGpu();
const dir = useDir();
const FRAMES = 48;
const SCALE = 0.67;
const DIFF = 24;
const NEAR = 2;
const NAME_WITHIN = 16;
const WIDTH = { min: 0.67, max: 1.5 };

const towerOf = (id: string | null): string | null => (id === null ? null : TOWERS.find((t) => id === t || (id.startsWith(t) && /^[^a-z0-9_]/.test(id.slice(t.length)))) ?? null);
/** The outline: pixels where the stroked frame differs from the bare one by more than 24 codes in a channel. */
function outline(inked: Image, bare: Image): Uint8Array {
  const m = new Uint8Array(inked.width * inked.height);
  for (let y = 0; y < inked.height; y++) for (let x = 0; x < inked.width; x++) if (codeDiff(inked, bare, x, y) > DIFF) m[y * inked.width + x] = 1;
  return m;
}
/** The tower whose part lies nearest (x, y) in the object-ID target, within 16 px. */
function nearestTower(ids: Ids, x: number, y: number): string | null {
  for (let r = 0; r <= NAME_WITHIN; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const t = towerOf(ids.at(x + dx, y + dy));
    if (t) return t;
  }
  return null;
}

function check(planted?: GpuPlanted): string[] {
  requireMetal();
  const c = castle();
  const out = dir();
  const stroked = strokedCastle(c, out);
  const hist = castleLook(c, HISTORY_UPSCALE, { scale: SCALE, reject: reject(true, 'auto') });
  const off = castleLook(c, HISTORY_OFF);
  const call = (doc: string, look: typeof hist, ids: boolean) => view3dCall({ doc, look, size: c.size, packs: c.packs, fps: CASTLE_FPS, frames: FRAMES, capture: 'every', targets: ids ? ['final', 'ids'] : ['final'] });
  const names = ['stroked, with history', 'bare, with history', 'stroked, without history', 'bare, without history'];
  const replies = runGpu(bin(), out, [call(stroked, hist, false), call(c.doc, hist, false), call(stroked, off, true), call(c.doc, off, false)], planted);
  // The bare castle with history first: what it drew through, then the stroked legs.
  for (const i of [1, 0]) {
    const frames = framesOf(replies[i]!, names[i]!);
    for (let n = 0; n < FRAMES; n++) {
      const h = frameAt(frames, n, names[i]!).history;
      expect(h, `${names[i]}: frame ${n} reports its frame history`).not.toBeNull();
      expect(h!.mode, `${names[i]}: frame ${n}, moving, drew through the temporal upscale`).toBe('upscale');
    }
    expect(surfaceOf(replies[i]!), `${names[i]}: it drew through the temporal upscale at internal scale ${SCALE}`).toEqual({ internal_scale: SCALE, upscale: 'temporal' });
  }
  const [inkedH, bareH, inkedR, bareR] = replies.map((r, i) => framesOf(r, names[i]!));
  const problems: string[] = [];
  const ratios: number[] = [];
  for (let n = 0; n < FRAMES; n++) {
    const read = (frames: typeof inkedH, i: number): Image => readPng(out, frameAt(frames!, n, names[i]!).final, `${names[i]}: frame ${n}`);
    const oh = outline(read(inkedH, 0), read(bareH, 1));
    const refInked = read(inkedR, 2);
    const or = outline(refInked, read(bareR, 3));
    const w = refInked.width; const hgt = refInked.height;
    let refCount = 0;
    const near = new Uint8Array(w * hgt);
    for (let i = 0; i < or.length; i++) {
      if (!or[i]) continue;
      refCount++;
      const x = i % w; const y = (i - x) / w;
      for (let dy = -NEAR; dy <= NEAR; dy++) for (let dx = -NEAR; dx <= NEAR; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < hgt) near[yy * w + xx] = 1;
      }
    }
    expect(refCount, `frame ${n}: without history the towers' outline is drawn (at least 200 px)`).toBeGreaterThanOrEqual(200);
    const ids = readIds(out, frameAt(inkedR!, n, names[2]!), `frame ${n}: the object-ID target without history`);
    const behind = new Map<string, number>();
    let histCount = 0;
    for (let i = 0; i < oh.length; i++) {
      if (!oh[i]) continue;
      histCount++;
      if (near[i]) continue;
      const x = i % w; const y = (i - x) / w;
      const t = nearestTower(ids, x, y) ?? 'castle';
      behind.set(t, (behind.get(t) ?? 0) + 1);
    }
    for (const [t, count] of behind) problems.push(`${t}: frame ${n}: ${count} outline px lie more than ${NEAR} px from the outline drawn without history, left behind its moving edge`);
    const ratio = histCount / refCount;
    ratios.push(ratio);
    if (ratio < WIDTH.min || ratio > WIDTH.max) {
      const inView = TOWERS.filter((t) => { for (let y = 0; y < hgt; y += 4) for (let x = 0; x < w; x += 4) if (towerOf(ids.at(x, y)) === t) return true; return false; });
      problems.push(`${inView.join(', ') || 'castle'}: frame ${n}: the outline covers ${ratio.toFixed(2)}× the pixels it covers without history, not 1 device px wide`);
    }
  }
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: the outline with history over without, by frame: ${ratios.map((r) => r.toFixed(2)).join(' ')}; ${problems.length} problems`);
  return problems;
}

describe(`${ID} a 1 px outline stays 1 device px wide under temporal upscaling`, () => {
  it(`${ID} with mode upscale at 0.67, the outline on the castle's battlements stays 1 device px wide in every moving frame of the orbit, with nothing left behind its moving edge`, () => {
    const problems = check();
    expect(problems, `the towers' outline with history:\n  ${problems.slice(0, 40).join('\n  ')}`).toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted resolve that takes outlines into the history (outlines_in_history) leaves a trail and fails, naming a tower`, () => {
    const problems = check('outlines_in_history');
    expect(problems.some((p) => /left behind its moving edge/.test(p) && TOWERS.some((t) => p.startsWith(`${t}: frame `))), `--planted outlines_in_history leaves a trail behind a tower's moving edge and fails, naming the tower; the problems were:\n  ${problems.slice(0, 40).join('\n  ')}`).toBe(true);
  }, 3_600_000);
});
