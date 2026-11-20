// AC1 #2500.bceb1cbb: A shot keeping `cfg#line:4` of a code item frames line 4's box at its fill within the framing's
// tolerance, and a twin keeping `cfg` frames the whole item
//
// Two tests, one per half, through `deep-motion eval` (README: The surfaces under test). The code is a seven-line
// function, still, on a 1280 × 720 page with no safe margin, under one 2D camera and one hold shot over [0 s, 2 s) at
// fill 0.5 with no pad, which keeps `cfg#line:4` (line) or `cfg` (twin). Where a box lands is read through the binary's
// own projection of an unkept rect@1 stand-in at the box `geometry` gives for `cfg#line:4` or `cfg`, each first checked
// against the glyphs `raster` sets: on every frame of the shot that box spans the shot's fill of the frame's shorter side
// within 1% and its centre lands on the place, the frame's centre, within 0.5 px (README: Readings). Each test first
// shows its judge rejecting the planted wrong programs (README: Wrong programs): shots that keep a stand-in at a wrong
// box, framed by the binary's own framer.
import { describe, it } from 'vitest';
import {
  AC, CODE, F60, TIMEOUT, boxes, evaluated, failsNaming, fl, framedFailures, layout, lineBoxFailures, none, page, shotFilm,
  useBin, useDir, useMotion, wholeBoxFailures, type Box,
} from './helpers.ts';

const ID = AC[1];
const render = useBin('deep-canvas-render');
const motion = useMotion();
const dir = useDir();

/** Frames of the 2 s hold shot, its last 60 fps frame included. */
const TIMES = [0, fl(0.5), fl(1), fl(1.5), 119 * F60];

/** The stand-ins: the boxes `geometry` gives for the still code's line 1, line 4, line 5 and the whole item at 0 s. */
function standIns(): Record<'l1' | 'l4' | 'l5' | 'whole', Box> {
  const [l1, l4, l5, whole] = boxes(render(), page('code-still-2500', false), [[`${CODE}#line:1`, 0], [`${CODE}#line:4`, 0], [`${CODE}#line:5`, 0], [CODE, 0]]);
  return { l1: l1!, l4: l4!, l5: l5!, whole: whole! };
}

describe(`${ID} a shot keeping a code line, and a twin keeping the code`, () => {
  it(`${ID} (line) a shot keeping ${CODE}#line:4 frames line 4's box at the shot's fill within the framing's tolerance`, () => {
    const code = layout(render(), dir());
    const s = standIns();
    // Line 4's stand-in is line 4's box: it holds line 4's glyphs and reaches neither line 3 nor line 5.
    none(lineBoxFailures('at 0 s', s.l4, code, 4), `the box geometry gives for ${CODE}#line:4 is line 4's`);

    const [whole, line5] = evaluated(motion.bin(), [
      ['a shot keeping the whole item\'s stand-in', { doc: shotFilm('keep-whole-2500', 'whole', s), times: TIMES, project: ['l4'] }],
      ['a shot keeping line 5\'s stand-in', { doc: shotFilm('keep-line5-2500', 'l5', s), times: TIMES, project: ['l4'] }],
    ]);
    failsNaming(framedFailures(whole!, 'l4', 'line 4\'s box'), 'spans', 'a shot that frames the whole item (the anchor dropped)');
    failsNaming(framedFailures(line5!, 'l4', 'line 4\'s box'), 'centre lands', 'a shot that frames line 5 (#line:4 counted from 0)');

    const [shot] = evaluated(motion.bin(), [[`the shot keeping ${CODE}#line:4`, { doc: shotFilm('keep-line4-2500', `${CODE}#line:4`, s), times: TIMES, project: ['l4'] }]]);
    none(framedFailures(shot!, 'l4', 'line 4\'s box'), `the shot keeping ${CODE}#line:4: line 4's box at the shot's fill, centred on its place`);
  }, TIMEOUT);

  it(`${ID} (twin) a twin keeping ${CODE} frames the whole item at the shot's fill within the framing's tolerance`, () => {
    const code = layout(render(), dir());
    const s = standIns();
    // The whole item's stand-in holds every line of the code.
    none(wholeBoxFailures('at 0 s', s.whole, code), `the box geometry gives for ${CODE} holds the whole item`);

    const [line4, line1] = evaluated(motion.bin(), [
      ['a twin keeping line 4\'s stand-in', { doc: shotFilm('twin-line4-2500', 'l4', s), times: TIMES, project: ['whole'] }],
      ['a twin keeping line 1\'s stand-in', { doc: shotFilm('twin-line1-2500', 'l1', s), times: TIMES, project: ['whole'] }],
    ]);
    failsNaming(framedFailures(line4!, 'whole', 'the whole item\'s box'), 'spans', 'a twin that frames line 4 (the anchor kept for the bare ID)');
    failsNaming(framedFailures(line1!, 'whole', 'the whole item\'s box'), 'spans', 'a twin that frames the code\'s first line only');

    const [twin] = evaluated(motion.bin(), [[`the twin keeping ${CODE}`, { doc: shotFilm('keep-cfg-2500', CODE, s), times: TIMES, project: ['whole'] }]]);
    none(framedFailures(twin!, 'whole', 'the whole item\'s box'), `the twin keeping ${CODE}: the whole item's box at the shot's fill, centred on its place`);
  }, TIMEOUT);
});
