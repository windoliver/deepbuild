// AC1 #173.594b573f: In the castle flythrough on one machine, the moving frame at 2.5 s has the same pixel hash whether
// reached by playing from 0, by seeking from 10 s, or by playing with the grid frame before 2.5 s left undrawn, while
// with a planted resolve that keeps one frame past the window the played and the seeked hashes differ.
//
// The castle as committed (helpers: `castle`), in its own look with frame history on (antialias, window 8), drawn by
// `view3d` at 30 fps with no cap given, so the grid is 1/30 s and the moving frame at 2.5 s is frame 75, grid step 75.
// Three legs in one process: played from frame 0 to 75; opened at frame 300 (10 s) and sought to 75; played from 0
// with a 34 ms stall after frame 73, so frame 74 (the grid frame before 2.5 s) is never drawn. Each leg's frame 75
// reports history `antialias` over the window of grid steps 68–75 and shows step 75; the played frame rendered step 75
// alone, the sought one the whole window, the stalled one steps 74 and 75. Their final targets have one SHA-256, and it
// differs from frame 75 drawn with history off (the window is in the frame). The pixel hash is the final target's
// SHA-256 (#378's PNG, named by its hash).
// Wrong programs: the base (no frame history in view3d, no history report, no stall); a sought frame drawn from a window
// it didn't render, or from one sample; `--planted keeps_frame_past_window` (the resolve also reads the grid frame just
// before the window when it holds it), whose played and sought hashes differ, naming 2.5 s.
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, HISTORY_OFF, HISTORY_ON, castle, castleLook, frameAt, framesOf, gridT, requireMetal, runGpu, secs, useDir, useGpu, view3dCall,
  windowEndingAt, type GpuPlanted, type JsonObject, type ViewFrame,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
/** 2.5 s at 30 fps, and 10 s. */
const T = 75;
const SEEK_FROM = 300;

/** The three legs (and, honestly, frame 75 with history off), checked; each problem names what it is about. */
function check(planted?: GpuPlanted): string[] {
  requireMetal();
  const c = castle();
  const on = castleLook(c, HISTORY_ON);
  const common = { doc: c.doc, size: c.size, packs: c.packs, fps: CASTLE_FPS, capture: [T], targets: ['final' as const] };
  const calls: JsonObject[] = [
    view3dCall({ ...common, look: on, frames: T + 1 }),
    view3dCall({ ...common, look: on, from: SEEK_FROM, frames: 2, seeks: [{ after: SEEK_FROM, to: T }] }),
    view3dCall({ ...common, look: on, frames: T + 1, stalls: [{ after: T - 2, ms: 34 }] }),
  ];
  if (!planted) calls.push(view3dCall({ ...common, look: castleLook(c, HISTORY_OFF), from: T, frames: 1 }));
  const names = ['played from 0', 'sought from 10 s', 'played with the grid frame before 2.5 s undrawn', 'drawn with history off'];
  const replies = runGpu(bin(), dir(), calls, planted);
  const frames = replies.map((r, i) => framesOf(r, names[i]!));
  const at = (i: number): ViewFrame => frameAt(frames[i]!, T, names[i]!);
  const [played, sought, stalled] = [at(0), at(1), at(2)];
  const problems: string[] = [];
  const window = windowEndingAt(T, CASTLE_FPS);
  const expectRendered: number[][] = [[gridT(T, CASTLE_FPS)], window, [gridT(T - 1, CASTLE_FPS), gridT(T, CASTLE_FPS)]];
  [played, sought, stalled].forEach((f, i) => {
    const h = f.history;
    if (!h) { problems.push(`${names[i]}: frame ${T} reports no frame history`); return; }
    if (h.mode !== 'antialias') problems.push(`${names[i]}: frame ${T} drew with history ${h.mode}, not antialias`);
    if (h.shows !== gridT(T, CASTLE_FPS)) problems.push(`${names[i]}: frame ${T} shows ${secs(h.shows)}, not grid step ${T} (2.5 s)`);
    if (JSON.stringify(h.window) !== JSON.stringify(window)) problems.push(`${names[i]}: frame ${T}'s window is ${h.window.map(secs).join(', ')}, not the 8 grid steps ending at 2.5 s`);
    if (JSON.stringify(h.rendered) !== JSON.stringify(expectRendered[i])) problems.push(`${names[i]}: frame ${T} rendered ${h.rendered.map(secs).join(', ') || 'nothing'}, not ${expectRendered[i]!.map(secs).join(', ')}`);
  });
  if (frames[2]!.some((f) => f.frame === T - 1)) problems.push(`${names[2]}: frame ${T - 1} was drawn, so the stall missed nothing`);
  if (sought.final !== played.final) problems.push(`2.5 s: sought from 10 s it hashes ${sought.final}, played from 0 ${played.final}`);
  if (stalled.final !== played.final) problems.push(`2.5 s: played with the grid frame before it undrawn it hashes ${stalled.final}, played from 0 ${played.final}`);
  if (!planted) {
    const off = at(3);
    if (off.final === played.final) problems.push(`2.5 s: the frame with history on hashes as the frame with history off (${off.final}): the window isn't in it`);
  }
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: frame ${T} played ${played.final}, sought ${sought.final}, stalled ${stalled.final}`);
  return problems;
}

describe(`${ID} the moving frame at 2.5 s is the same played, sought or played past a missed grid frame`, () => {
  it(`${ID} the castle's frame at 2.5 s, drawn from its window, has one hash played from 0, sought from 10 s and played with the grid frame before it undrawn`, () => {
    const problems = check();
    expect(problems, `the castle's moving frame at 2.5 s:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted resolve that keeps one frame past the window (keeps_frame_past_window) gives the played and the sought frame at 2.5 s different hashes`, () => {
    const problems = check('keeps_frame_past_window');
    expect(problems.some((p) => p.startsWith('2.5 s: sought from 10 s')), `--planted keeps_frame_past_window: the played and sought hashes at 2.5 s differ; the problems were:\n  ${problems.join('\n  ')}`).toBe(true);
  }, 3_600_000);
});
