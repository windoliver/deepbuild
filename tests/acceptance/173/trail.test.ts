// AC2 #173.66bdaff9: A red box crossing a grey wall leaves no trail: 3 grid steps after the box uncovers a pixel, that
// pixel is within 2 code values of the frame's own render there, while the same resolve without the depth test leaves
// at least 10 code values of red.
//
// The fixture (helpers: `trailDoc`): an orthographic view of a grey wall (unlit 0.2) with a red box (unlit 0.8, 0.05,
// 0.05) 1 m in front of it sliding +x at 4 px per grid step (30 fps, no cap given), drawn by `view3d` with frame
// history on (antialias, window 8) and the colour clamp off in both legs, so the depth test is judged alone: `reject:
// {depth: true, clamp: none, reactive: auto}` against `{depth: false, …}`. Frame 30 (grid step 30) is judged on columns
// 105–106, rows 70–109: covered by the box at steps 23–26 by 1.5 px or more, uncovered from step 27 by 1.5 px or more,
// so 3 grid steps after the box uncovered them and with the box over them in half of the window. The frame's own render
// there is frame 30 drawn with history off (one sample, the wall's flat grey). With the depth test every judged pixel is
// within 2 code values (each channel, final 8-bit sRGB) of it; without, the judged pixels' red channel averages at
// least 10 codes above it.
// Wrong programs: the base (no history: the control leaves no red, so it fails); a resolve with no depth rejection, or
// one that ignores `reject.depth`, which leaves red in the first leg or none in the second.
import { describe, expect, it } from 'vitest';
import {
  AC, HISTORY_OFF, HISTORY_ON, TRAIL, codeDiff, frameAt, framesOf, look, px, readPng, reject, requireMetal, runGpu, trailDoc, trailLeftEdge, useDir,
  useGpu, view3dCall, writeJson,
} from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const J = TRAIL.judged;

describe(`${ID} a red box crossing a grey wall leaves no trail`, () => {
  it(`${ID} 3 grid steps after the box uncovers them, the wall's pixels are within 2 codes of the frame's own render with the depth test, and at least 10 codes redder without it`, () => {
    // The fixture's own numbers (hold at the base): the judged columns were under the box at steps 23–26, and not from 27.
    for (const c of TRAIL.columns) {
      for (let k = J - 7; k < TRAIL.uncovered; k++) expect(c + 0.5 - trailLeftEdge(k), `column ${c} lies 1.5 px or more inside the box at step ${k}`).toBeGreaterThanOrEqual(1.5);
      for (let k = TRAIL.uncovered; k <= J; k++) expect(trailLeftEdge(k) - (c + 0.5), `column ${c} lies 1.5 px or more behind the box at step ${k}`).toBeGreaterThanOrEqual(1.5);
    }
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'trail', trailDoc());
    const common = { doc, size: TRAIL.size, fps: TRAIL.fps, capture: [J], targets: ['final' as const] };
    const names = ['with the depth test', 'without the depth test', 'the frame\'s own render'];
    const [withDepth, without, own] = runGpu(bin(), out, [
      view3dCall({ ...common, look: look({ history: HISTORY_ON, reject: reject(true, 'auto') }), frames: J + 1 }),
      view3dCall({ ...common, look: look({ history: HISTORY_ON, reject: reject(false, 'auto') }), frames: J + 1 }),
      view3dCall({ ...common, look: look({ history: HISTORY_OFF }), from: J, frames: 1 }),
    ]).map((r, i) => frameAt(framesOf(r, names[i]!), J, names[i]!));
    for (const [i, f] of [withDepth!, without!].entries()) {
      expect(f.history, `${names[i]}: frame ${J} reports its frame history`).not.toBeNull();
      expect(f.history!.mode, `${names[i]}: frame ${J} drew with history`).toBe('antialias');
      expect(f.history!.window.length, `${names[i]}: frame ${J} resolved a window of 8 grid frames`).toBe(8);
    }
    const [a, b, o] = [readPng(out, withDepth!.final, names[0]!), readPng(out, without!.final, names[1]!), readPng(out, own!.final, names[2]!)];
    let worst = 0; let worstAt = ''; let red = 0; let n = 0;
    for (const x of TRAIL.columns) for (let y = TRAIL.rows[0]; y < TRAIL.rows[1]; y++) {
      const wall = px(o, x, y);
      expect(Math.max(...wall) - Math.min(...wall), `the own render at (${x}, ${y}) is the wall's grey`).toBeLessThanOrEqual(3);
      const d = codeDiff(a, o, x, y);
      if (d > worst) { worst = d; worstAt = `(${x}, ${y})`; }
      red += px(b, x, y)[0] - wall[0]; n++;
    }
    red /= n;
    console.log(`${ID}: with the depth test the uncovered pixels sit at most ${worst} codes from the own render${worstAt ? ` (at ${worstAt})` : ''}; without it their red channel averages ${red.toFixed(1)} codes above it`);
    expect(worst, `with the depth test, every pixel the box uncovered 3 grid steps ago is within 2 code values of the frame's own render (worst ${worst} at ${worstAt})`).toBeLessThanOrEqual(2);
    expect(red, 'the same resolve without the depth test leaves at least 10 code values of red there').toBeGreaterThanOrEqual(10);
  }, 1_800_000);
});
