// AC2 #1490.db64c0a5: "A 2D slider fixture bundles `figure` and its receipt names it. The physics lab bundles `full`"
//
// asserts, through `deep-show run`'s web export (#172's call, README: The surface under test):
//   - the 2D slider fixture (#172's 2D piece with the slider `year`), exported to the web with nothing but its
//     document: its receipt names the module set `figure` (`player.module_set`, chosen), with `figure`'s module-set
//     digest and player hash as the size record gives them, and the bundle holds `figure`'s player and page glue by
//     hash and no other set's player;
//   - the physics lab (#172's lab: a world, a logic item that keeps score and a readout, in 3D) on its recorded track:
//     the same, for `full`;
//   - the planted picker `web_picks_full_set` (chosen: it always takes `full`, as the merge base's one player did)
//     exports the slider fixture with `full`, and the check above fails on it, naming `figure`.
// Wrong programs it fails: the merge base (its receipt names no set; one player for every piece); a picker that takes
// `full` for every piece; a receipt that names a set its player isn't (names the set).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, failsNaming, labDoc, labTrack, none, useShow, useTemp } from '../172/helpers.ts';
import { AC, FIGURE, FULL_SET, exportPiece, moduleSetOf, readRecord, setFailures, sliderDoc } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'web_picks_full_set';

describe(`${AC[2]} the export bundles the smallest set that holds the piece, and its receipt names it`, () => {
  it(`${AC[2]} the 2D slider fixture bundles ${FIGURE} and its receipt names it; the physics lab bundles ${FULL_SET}; the planted ${PLANTED} fails, naming ${FIGURE}`, () => {
    const slider = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), 'the 2D slider fixture');
    expect(moduleSetOf(slider.receipt), `the 2D slider fixture's receipt names the module set it bundles, ${FIGURE}`).toBe(FIGURE);
    const record = readRecord();
    none(setFailures(slider, record, FIGURE, 'the 2D slider fixture'), `the 2D slider fixture bundles ${FIGURE}, as the size record gives it`);

    const evidence = temp();
    const lab = exportPiece(shows(FULL), evidence, labDoc(evidence), join(temp(), 'bundle'), 'the physics lab', { track: labTrack() });
    none(setFailures(lab, record, FULL_SET, 'the physics lab'), `the physics lab bundles ${FULL_SET}, as the size record gives it`);

    const planted = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), `the 2D slider fixture (planted ${PLANTED})`, { planted: PLANTED });
    expect(moduleSetOf(planted.receipt), `the planted picker ${PLANTED} bundles ${FULL_SET} for the slider fixture`).toBe(FULL_SET);
    failsNaming(setFailures(planted, record, FIGURE, `the 2D slider fixture (planted ${PLANTED})`), FIGURE, `the planted picker ${PLANTED}`);
  }, TIMEOUT);
});
