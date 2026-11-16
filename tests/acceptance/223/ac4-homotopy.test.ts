// AC4 #223.bd85dee7: "A homotopy (x, y + 1.5·u·sin(2x − 6u)) on a horizontal line, seeked to 1,000 random times, equals
// the played frames by evaluated-data hash, and its 4 px stroke measures 4 ± 0.1 px everywhere"
//
// The homotopy: group `g` warps by `map {x: "x", y: "y + 1.5 * u * sin(2 * x - 6 * u)"}` with `vars: {u: "time"}`
// (u is t in seconds), mix 1, on the plane of origin (400, 300) u, unit 100 u, y up; its child `line` is the horizontal
// path M 100 300 L 700 300 (the plane's y = 0 from x = −3 to 3), stroked in ink 4 u wide, in a 1 s film.
// Seeking against playing, on `deep-show run` (full set): the film is shown, then played (`eval` with `data_hash` at
// every 60 fps frame from 0 and at each of the 1,000 times, ascending, in one session) and then seeked (`eval` with
// `data_hash` and `clean: true`, a fresh evaluation, at each of the 1,000 times in a seeded random order). The 1,000
// times are distinct whole flicks in [0, 1 s), drawn by a seeded generator. Each seek's hash equals the play's at that
// time, and the line moves: at least 990 of the 1,000 played hashes differ from one another.
// The stroke, on `deep-canvas-render raster` at 0.4 s and 0.8 s: in each pixel column X = 120, 124, … 676 (clear of
// the line's ends), the column's summed ink coverage over the column's thickness factor √(1 + s²), s the image's slope
// dY/dX = −3u·cos(2x − 6u) at the column's centre, is 4 ± 0.1 px (a stroke of width w crosses a column over
// w·√(1 + s²), to second order in its curvature); and the column's ink is centred on the image's Y, within the
// 0.5 px a warp may stray along the normal, seen down the column (0.5·√(1 + s²), plus 0.25 px for the pixel grid).
// Wrong programs: the base (no warp: the line stays straight, its columns centred at Y = 300, their widths read
// 4 ÷ √(1 + s²); its hash never moves); a warp that strokes before mapping (widths scale with the map's stretch); a seek
// that differs from the play (a frame built from an earlier frame's state, a cache keyed wrongly).
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, PLANE, TIMEOUT, coverage, dataHashOf, docId, evalAt, expectClean, fl, homotopyAt, homotopyDoc, none, present, presented, randomTimes,
  rasterPlay, readPng, run, scenario, shellFilm, showTime, shuffled, toPlane, toScreen, useBins, useFolders,
} from './helpers.ts';

const bin = useBins(['render', 'show']);
const folder = useFolders();
const DOC = docId(4);
const FIXTURE = homotopyDoc('warp-homotopy');

describe(`${AC[4]} a homotopy seeks as it plays, and its stroke keeps its width`, () => {
  it(`${AC[4]} the homotopy seeked to 1,000 random times equals the played frames by evaluated-data hash`, () => {
    const seeks = randomTimes('#223 homotopy seeks', 1000, 0, fl(1) - 1);
    const frames = Array.from({ length: 60 }, (_, k) => Math.round((k * FLICKS) / 60));
    const play = [...new Set([...frames, ...seeks])].sort((a, b) => a - b);
    const order = shuffled('#223 homotopy seek order', seeks);
    const replies = run(bin('show'), scenario(folder(), [
      present(DOC, shellFilm(FIXTURE)),
      ...play.map((t) => evalAt(DOC, t, { hash: true })),
      ...order.map((t) => evalAt(DOC, t, { hash: true, clean: true })),
    ]));
    presented(replies[0]!, 'the homotopy film');
    const played = new Map(play.map((t, i) => [t, dataHashOf(replies[1 + i]!, `the play at ${showTime(t)}`)]));
    const failures: string[] = [];
    order.forEach((t, i) => {
      const seek = dataHashOf(replies[1 + play.length + i]!, `the seek to ${showTime(t)}`);
      if (seek !== played.get(t)) failures.push(`at ${showTime(t)} the seek's evaluated-data hash ${seek} is not the play's ${played.get(t)}`);
    });
    none(failures, 'every seek equals the played frame by evaluated-data hash');
    const distinct = new Set(seeks.map((t) => played.get(t))).size;
    expect(distinct, `the homotopy moves: its 1,000 played frames give ${distinct} distinct hashes, not at least 990`).toBeGreaterThanOrEqual(990);
  }, TIMEOUT);

  it(`${AC[4]} the homotopy's 4 px stroke measures 4 ± 0.1 px everywhere`, () => {
    expectClean(bin('render'), FIXTURE, 'the homotopy');
    const times = [0.4, 0.8];
    const files = rasterPlay(bin('render'), folder(), FIXTURE, times.map(fl), 'the homotopy');
    const failures: string[] = [];
    times.forEach((u, k) => {
      const image = readPng(files[k]!);
      for (let X = 120; X < 680; X += 4) {
        const xc = X + 0.5;
        const x = toPlane(PLANE, [xc, 0])[0];
        const Y = toScreen(PLANE, homotopyAt(u)([x, 0]))[1];
        const s = -3 * u * Math.cos(2 * x - 6 * u);
        let sum = 0; let moment = 0;
        for (let y = 0; y < image.height; y++) { const c = coverage(image, X, y); sum += c; moment += c * (y + 0.5); }
        const width = sum / Math.sqrt(1 + s * s);
        const centre = sum > 0 ? moment / sum : NaN;
        // The drawn path may stray 0.5 px from the image along its normal: up to 0.5·√(1 + s²) down a column.
        const near = 0.5 * Math.sqrt(1 + s * s) + 0.25;
        if (!(Math.abs(centre - Y) <= near)) failures.push(`at ${u} s, column ${X}: the ink is centred at Y ${centre.toFixed(2)}, not on the image at ${Y.toFixed(2)} (within ${near.toFixed(2)})`);
        if (!(Math.abs(width - 4) <= 0.1)) failures.push(`at ${u} s, column ${X}: the stroke measures ${width.toFixed(3)} px across, not 4 ± 0.1`);
      }
    });
    none(failures, 'the warped stroke keeps its 4 px width everywhere');
  }, TIMEOUT);
});
