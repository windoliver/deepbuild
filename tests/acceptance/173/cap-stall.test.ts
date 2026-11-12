// AC10 #173.11b2d1f1: The castle played at a 30 fps cap on a 60 Hz and on a 144 Hz display renders one frame per shown
// frame, and after a planted 50 ms stall it renders only the grid frames it missed, once; a planted resolve on a 1/60 s
// grid renders the window on every shown frame and fails, counting renders.
//
// The castle as committed, in its own look with frame history on (antialias, window 8), by `view3d` with `cap: 30` on
// a display refreshing 60 times a second (`fps: 60`, frames 60–179) and 144 times (`fps: 144`, frames 144–431), each
// opened at 1 s so its whole window lies after 0. Each has a 50 ms stall (`stalls`) placed at or past the middle of a grid
// step, so the display frames it covers miss a grid frame other than the one shown next: after frame 101 at 60 Hz
// (frames 102–103 missed; frame 104 shows step 52, step 51 was due at 102) and after frame 243 at 144 Hz (frames
// 244–250 missed; frame 251 shows step 52, step 51 was due at 245). Every frame drawn reports history `antialias`,
// shows the last grid step at or before its time (step ⌊n × 30 ÷ fps⌋) and resolves the 8 grid steps ending there;
// the first frame (the open) rendered that whole window; every later frame rendered exactly the grid steps after the one
// the frame before it showed, up to the one it shows, in order: one when it shows a new grid frame, none when it shows
// the same one, and after the stall the one it missed and the one it shows, never the window. Over each run the
// renders after the open equal the new frames shown plus the grid frames the stall made it miss (one a run here), each
// rendered once: one render per shown frame, and only the missed grid frames besides.
// Wrong programs: the base (no cap, no stall, no history report); a view that renders every display refresh, renders
// the window after a stall, or renders a grid frame twice; `--planted grid_at_refresh` (the window's grid at the
// display's refresh, 1/60 s on the 60 Hz display, instead of the cap) renders more than one frame per shown frame and
// fails, counting renders.
import { describe, expect, it } from 'vitest';
import {
  AC, HISTORY_ON, castle, castleLook, framesOf, gridT, requireMetal, runGpu, secs, shownStep, useDir, useGpu, view3dCall, windowEndingAt, type GpuPlanted,
  type ViewFrame,
} from './helpers.ts';

const ID = AC[10];
const bin = useGpu();
const dir = useDir();
const CAP = 30;
interface Display { hz: number; from: number; frames: number; stall: { after: number; ms: number }; missed: number[]; afterStall: number }
const DISPLAYS: Display[] = [
  { hz: 60, from: 60, frames: 120, stall: { after: 101, ms: 50 }, missed: [102, 103], afterStall: 104 },
  { hz: 144, from: 144, frames: 288, stall: { after: 243, ms: 50 }, missed: [244, 245, 246, 247, 248, 249, 250], afterStall: 251 },
];

/** One display's frames checked; problems name the display and frame, and the last line counts renders. */
function renderProblems(d: Display, frames: ViewFrame[]): string[] {
  const at = `${d.hz} Hz`;
  const problems: string[] = [];
  const clock = Array.from({ length: d.frames }, (_, i) => d.from + i);
  const drawn = clock.filter((n) => !d.missed.includes(n));
  const got = frames.map((f) => f.frame);
  if (JSON.stringify(got) !== JSON.stringify(drawn)) problems.push(`${at}: frames drawn ${got.slice(0, 12).join(', ')}…, not the display's ${d.from}–${d.from + d.frames - 1} less the ${d.missed.length} the stall missed (${d.missed.join(', ')})`);
  let previous: number | null = null; let renders = 0; let shown = 0; let missed = 0;
  const seen = new Set<number>();
  for (const f of frames) {
    const h = f.history;
    if (!h) { problems.push(`${at}: frame ${f.frame} reports no frame history`); continue; }
    const step = shownStep(f.frame, d.hz, CAP);
    if (h.mode !== 'antialias') problems.push(`${at}: frame ${f.frame} drew with history ${h.mode}`);
    if (h.shows !== gridT(step, CAP)) problems.push(`${at}: frame ${f.frame} shows ${secs(h.shows)}, not grid step ${step} (${secs(gridT(step, CAP))})`);
    if (JSON.stringify(h.window) !== JSON.stringify(windowEndingAt(step, CAP))) problems.push(`${at}: frame ${f.frame}'s window is ${h.window.map(secs).join(', ')}, not the 8 grid steps ending at its own`);
    const want = previous === null ? windowEndingAt(step, CAP) : Array.from({ length: Math.max(0, step - previous) }, (_, i) => gridT(previous! + 1 + i, CAP));
    if (JSON.stringify(h.rendered) !== JSON.stringify(want)) problems.push(`${at}: frame ${f.frame} rendered ${h.rendered.length} grid frames (${h.rendered.map(secs).join(', ') || 'none'}), not the ${want.length} it lacks (${want.map(secs).join(', ') || 'none'})`);
    for (const t of h.rendered) { if (seen.has(t)) problems.push(`${at}: frame ${f.frame} rendered ${secs(t)} again`); seen.add(t); }
    if (previous !== null) { renders += h.rendered.length; if (step !== previous) shown++; missed += Math.max(0, step - previous - 1); }
    previous = step;
  }
  const after = frames.find((f) => f.frame === d.afterStall)?.history?.rendered.length;
  if (after !== 2) problems.push(`${at}: frame ${d.afterStall}, after the stall, rendered ${after ?? 'no'} grid frames, not the 2 it lacked (the one it missed and the one it shows)`);
  if (missed !== 1) problems.push(`${at}: the run skipped ${missed} grid frames between frames shown, not the 1 the stall missed`);
  const count = `${at}: rendered ${renders} grid frames for ${shown} new frames shown and ${missed} grid frames the stall missed, after the open`;
  if (renders !== shown + missed) problems.push(count);
  console.log(`${ID}: ${count}`);
  return problems;
}

function check(displays: Display[], planted?: GpuPlanted): string[] {
  requireMetal();
  const c = castle();
  const replies = runGpu(bin(), dir(), displays.map((d) => view3dCall({
    doc: c.doc, look: castleLook(c, HISTORY_ON), size: c.size, packs: c.packs, fps: d.hz, cap: CAP, from: d.from, frames: d.frames, stalls: [d.stall],
  })), planted);
  return displays.flatMap((d, i) => renderProblems(d, framesOf(replies[i]!, `the castle at a 30 fps cap on a ${d.hz} Hz display`)));
}

describe(`${ID} one render per shown frame at a 30 fps cap, and only the missed grid frames after a stall`, () => {
  it(`${ID} the castle at a 30 fps cap renders one frame per shown frame on a 60 Hz and a 144 Hz display, and after a 50 ms stall only the grid frames it missed, once`, () => {
    const problems = check(DISPLAYS);
    expect(problems, `the castle at a 30 fps cap:\n  ${problems.slice(0, 40).join('\n  ')}`).toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted resolve on a 1/60 s grid (grid_at_refresh) renders more than one grid frame per shown frame and fails, counting renders`, () => {
    const problems = check([DISPLAYS[0]!], 'grid_at_refresh');
    const count = problems.find((p) => /^60 Hz: rendered \d+ grid frames for \d+ new frames shown and \d+ grid frames the stall missed/.test(p));
    expect(count, `--planted grid_at_refresh fails counting renders; the problems were:\n  ${problems.slice(0, 40).join('\n  ')}`).toBeDefined();
    const [, renders, shown, missed] = /rendered (\d+) grid frames for (\d+) new frames shown and (\d+)/.exec(count!)!;
    expect(Number(renders), `--planted grid_at_refresh renders more grid frames than it shows and the stall missed (${count})`).toBeGreaterThan(Number(shown) + Number(missed));
  }, 3_600_000);
});
