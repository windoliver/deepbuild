// AC5 #173.7d65ca33: The first frame shown after a seek is the window's frame, with the played frame's hash, never a
// one-sample frame; while you scrub, frames draw without history, and the frame you let go on equals the played one.
//
// The castle as committed, in its own look with frame history on (antialias, window 8), by `view3d` at 30 fps. Frame
// 120 (4 s) is drawn four ways in one process: played from frame 0; as the first frame after a seek from frame 300 (10
// s); as the frame you let go on after scrubbing (played to frame 30, then the hand drags the playhead through frames
// 60, 75, 90 and 105 and lets go on 120); and with history off (the one-sample frame). The first frame after the seek
// reports history `antialias`, rendered the whole window (grid steps 113–120) and has the played frame's final hash,
// which differs from the one-sample frame's. Each frame drawn while scrubbing reports history `none` and has the final
// hash of the same frame drawn with history off. The frame let go on reports `antialias`, rendered its whole window,
// and has the played frame's hash.
// Wrong programs: the base (no history, no scrub); a seek that shows one sample before the window renders; a seek that
// reuses the window it held before; scrubbing frames drawn through history; a let-go frame drawn without its window.
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, HISTORY_OFF, HISTORY_ON, castle, castleLook, frameAt, framesOf, gridT, requireMetal, runGpu, secs, useDir, useGpu, view3dCall, windowEndingAt,
  type ViewFrame,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const T = 120;
const SEEK_FROM = 300;
const PLAYED_TO = 30;
const THROUGH = [60, 75, 90, 105];

describe(`${ID} a seek shows the window's frame; a scrub draws without history and lets go on the played frame`, () => {
  it(`${ID} the first frame after a seek and the frame let go on after a scrub each render their window and hash as the played frame; the frames scrubbed through draw without history`, () => {
    requireMetal();
    const c = castle();
    const on = castleLook(c, HISTORY_ON);
    const off = castleLook(c, HISTORY_OFF);
    const common = { doc: c.doc, size: c.size, packs: c.packs, fps: CASTLE_FPS, targets: ['final' as const] };
    const names = ['played from 0', 'after a seek from 10 s', 'scrubbed and let go', 'with history off'];
    const replies = runGpu(bin(), dir(), [
      view3dCall({ ...common, look: on, frames: T + 1, capture: [T] }),
      view3dCall({ ...common, look: on, from: SEEK_FROM, frames: 2, seeks: [{ after: SEEK_FROM, to: T }], capture: [T] }),
      view3dCall({ ...common, look: on, frames: PLAYED_TO + 1 + THROUGH.length + 3, scrubs: [{ after: PLAYED_TO, through: THROUGH, release: T }], capture: [...THROUGH, T] }),
      view3dCall({ ...common, look: off, from: THROUGH[0]!, frames: THROUGH.length + 1, seeks: [...THROUGH.slice(1), T].map((to, i) => ({ after: THROUGH[i]!, to })), capture: [...THROUGH, T] }),
    ]);
    const [played, sought, scrubbed, oneSample] = replies.map((r, i) => framesOf(r, names[i]!));
    const window = windowEndingAt(T, CASTLE_FPS);
    const windowFrame = (f: ViewFrame, what: string): void => {
      expect(f.history, `${what}: frame ${T} reports its frame history`).not.toBeNull();
      expect(f.history!.mode, `${what}: frame ${T} drew with history`).toBe('antialias');
      expect(f.history!.shows, `${what}: frame ${T} shows grid step ${T} (4 s)`).toBe(gridT(T, CASTLE_FPS));
      expect(f.history!.rendered.map(secs), `${what}: frame ${T} rendered its whole window before it showed`).toEqual(window.map(secs));
    };
    const p = frameAt(played!, T, names[0]!);
    const one = frameAt(oneSample!, T, names[3]!);

    // The seek.
    const s = frameAt(sought!, T, names[1]!);
    windowFrame(s, names[1]!);
    expect(s.final, 'the first frame after the seek is never the one-sample frame').not.toBe(one.final);
    expect(s.final, 'the first frame after the seek has the played frame\'s hash').toBe(p.final);

    // The scrub.
    expect(scrubbed!.map((f) => f.frame).slice(PLAYED_TO + 1, PLAYED_TO + 2 + THROUGH.length), 'the scrub draws the frames dragged through, then the one let go on').toEqual([...THROUGH, T]);
    for (const n of THROUGH) {
      const f = frameAt(scrubbed!, n, names[2]!);
      expect(f.history, `while you scrub, frame ${n} reports its frame history`).not.toBeNull();
      expect(f.history!.mode, `while you scrub, frame ${n} draws without history`).toBe('none');
      expect(f.final, `while you scrub, frame ${n} is the frame drawn without history`).toBe(frameAt(oneSample!, n, names[3]!).final);
    }
    const letGo = frameAt(scrubbed!, T, names[2]!);
    windowFrame(letGo, 'the frame let go on');
    expect(letGo.final, 'the frame you let go on equals the played one').toBe(p.final);
  }, 3_600_000);
});
