// #407.4b703bba (AC8): "The film audit runs on each film twice, as made and under reduced motion, and a hold long enough
// as made but too short once its title fades in place instead of flying fails, naming the rendition and the frame"
//
// Fixture (helpers.ts: `pushFilm`): a 1920 × 1080 film at 60 frames a second, `reduced_motion: hold`, whose one shot
// [0, 6.5) s pushes its camera in 5% of the view width (the shot's default in_out_cubic ease) onto its only subject,
// the title "THE KETTLE SINGS" at 96 u, shown from 1 s to 6 s. As made, the title flies in with the camera: its glyphs
// move under 0.3 px a frame, so it is readable from 1 s to 6 s, 5 s, past its need either as a title card (4 s) or as a
// text (2.43 s). Under reduced motion the push is a cut to its final framing at its midpoint, 3.25 s, with a 200 ms
// dissolve (Transport), in which the title fades in place: its first unbroken readable run ends there, after 2.15 to
// 2.25 s, short of either need. The twin marks the push `essential`, so it plays under reduced motion too.
//
// asserts: the film FAILs with a film.hold_short naming the title and `rendition: reduced_motion`, its frame in the
// title's first readable run under reduced motion, [1, 3.35] s; no film.hold_short names the title `as_made`; the
// essential twin PASSes with nothing raised. Wrong programs caught: an audit that runs only as made (it passes the
// film), and one that fails every reduced-motion rendition (it fails the twin).
import { describe, it } from 'vitest';
import { AC, FULL, TIMEOUT, docId, holdShort, judge, noHoldShort, none, passFailures, pushFilm, useBuilds, useFolders, type Film } from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

describe(`${AC[8]} the film audit runs as made and under reduced motion`, () => {
  it(`${AC[8]} a hold long enough as made but too short once its title fades in place instead of flying fails, naming the rendition and the frame`, () => {
    const films: Film[] = [
      { name: 'the title under a slow push', doc: docId(1), document: pushFilm(docId(1), false) },
      { name: 'the title under an essential push', doc: docId(2), document: pushFilm(docId(2), true) },
    ];
    const { judged } = judge(bin(FULL), folder(), films);
    const pushed = judged['the title under a slow push']?.row;
    none([
      ...holdShort(pushed, 'title', { rendition: 'reduced_motion', tIn: [1 - 1 / 60, 3.35] }, 'the title under a slow push'),
      ...noHoldShort(pushed, 'title', 'the title under a slow push, as made', 'as_made'),
      ...passFailures(judged['the title under an essential push']?.row, 'the title under an essential push'),
    ], 'the two renditions');
  }, TIMEOUT);
});
