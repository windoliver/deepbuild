// AC4 on the canvas (README: Criteria to tests): the cells GIF, each frame but the first drawn over the frames before
// it, played by `frames` from 0 and captured at six times; a seek to each time by `render`, the latest first, in one
// process; and the same play with the view's reduced motion on. Every reading is the captured pixels.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CELL_DELAYS, CELLS, LOOK, ONCE, PERIOD, animDoc, animItem, cellsGif, cellsShown, decodePng, frameAt, lines, one, put, scratch, short,
  useRender, type JsonObject,
} from './helpers.ts';

const render = useRender();
const dir = scratch('seek');

/** Six vsyncs of 60 Hz, each well inside one frame's delay rather than at its edge: frames 2, 5, 8, 11, 13 and 15. */
const VSYNCS_SEEN = [10, 25, 43, 56, 67, 80];
/** The play runs to 1.42 s, the GIF's length. */
const VSYNCS = 86;

const shownAt = (path: string): number | string => cellsShown(decodePng(readFileSync(path)));
const named = (s: number | string): string => (typeof s === 'number' ? `frame ${s}` : s);

// Names are plain literals, so the trace lane reads them, and the criterion's ID, unrun.
describe('AC4 #1489.f265e8f8 Reduced motion holds the frame, and a seek to t shows the same frame as playing to t', () => {
  it(`AC4 #1489.f265e8f8 canvas: a 16-frame GIF whose every frame but the first is drawn over the ones before it, played by frames at 60 Hz from 0, shows at six times the frame its delays give; a seek to each time (render, the latest first, in one process) shows that same frame; and with the view's reduced motion on, every vsync of the play shows the first frame`, () => {
    const bin = render();
    const store = join(dir, 'store');
    const hash = put(store, cellsGif());
    const doc = animDoc('cells-1489', [CELLS.side, CELLS.side], [animItem('gif', 0, hash, [0, 0, CELLS.side, CELLS.side], ONCE)]);
    const base: JsonObject = { doc, look: LOOK, store, refresh_hz: 60, vsyncs: VSYNCS };
    const folder = (name: string): string => { const d = join(dir, name); mkdirSync(d, { recursive: true }); return d; };

    // Playing to t: every vsync from 0, the frame on screen at each of the six captured.
    const played = folder('play');
    const play = one(bin, 'frames', { ...base, view: { zoom: 1 }, captures: VSYNCS_SEEN.map((k) => ({ vsync: k, out: join(played, `${k}.png`) })) });
    expect(play['ok'], `frames answers ok: ${short(play, 1500)}`).toBe(true);
    // Seeking to t: one frame at t, the latest time first, so each seek after the first goes back.
    const seeked = folder('seek');
    const latestFirst = [...VSYNCS_SEEN].reverse();
    const seeks = lines(bin, 'render', latestFirst.map((k) => ({ doc, look: LOOK, store, view: { zoom: 1 }, t: k * PERIOD, out: join(seeked, `${k}.png`) })));
    seeks.forEach((answer, i) => expect(answer['ok'], `render at vsync ${latestFirst[i]}'s t answers ok: ${short(answer, 1500)}`).toBe(true));
    // Reduced motion: the same play with the view's reduced motion on, captured at vsync 0 and at the six.
    const still = folder('reduced');
    const held = one(bin, 'frames', { ...base, view: { zoom: 1, reduced_motion: true }, captures: [0, ...VSYNCS_SEEN].map((k) => ({ vsync: k, out: join(still, `${k}.png`) })) });
    expect(held['ok'], `frames with reduced motion answers ok: ${short(held, 1500)}`).toBe(true);

    const playing: string[] = [];
    const seeking: string[] = [];
    for (const k of VSYNCS_SEEN) {
      const want = frameAt(CELL_DELAYS, k * PERIOD, false);
      const p = shownAt(join(played, `${k}.png`));
      const s = shownAt(join(seeked, `${k}.png`));
      if (p !== want) playing.push(`playing to vsync ${k} (t ${k * PERIOD}) shows ${named(p)}, not frame ${want}, the one the delays give at t`);
      if (s !== p) seeking.push(`a seek to vsync ${k}'s t shows ${named(s)}, where playing to it shows ${named(p)}`);
    }
    expect(playing, 'the GIF plays: at each time, the frame its delays give').toEqual([]);
    expect(seeking, 'a seek to t shows the same frame as playing to t').toEqual([]);
    const moved = [0, ...VSYNCS_SEEN].flatMap((k) => {
      const s = shownAt(join(still, `${k}.png`));
      return s === 0 ? [] : [`with reduced motion, vsync ${k} shows ${named(s)}, not frame 0, the frame the view first showed`];
    });
    expect(moved, 'reduced motion holds the frame').toEqual([]);
  });
});
