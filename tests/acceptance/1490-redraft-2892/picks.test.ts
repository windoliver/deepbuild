// AC2 #1490.db64c0a5: "A 2D slider fixture bundles `figure` and its receipt names it. The physics lab bundles `full`"
//
// The blind redraft after #2892 (README) of ../1490/picks.test.ts. It asserts, through `deep-show run`'s web export
// (#172's call; ../1490/README.md: The surface under test), each bundle file read as the page reads it (inflated where
// its stored bytes are gzip):
//   - the 2D slider fixture (#172's 2D piece with the slider `year`), exported with nothing but its document: its
//     receipt names the module set `figure` (`player.module_set`) with `figure`'s module-set digest as the size record
//     gives it, the receipt's player reads as `figure`'s WebAssembly, and the bundle holds `figure`'s player and page
//     glue by the record's SHA-256 and no other set's player;
//   - the twins of that bundle, made in test code: with `figure`'s player stored gzip in place (as #2892 stores it) it
//     still bundles `figure`; with `figure`'s player in no form, stored or gzip, the check fails, naming the player;
//   - the physics lab (#172's lab) on its recorded track: the same, for `full`;
//   - the planted picker `web_picks_full_set` (it always takes `full`) exports the slider fixture with `full`, and the
//     check above fails on it, naming `figure`.
// Wrong programs it fails on: the merge base before #1490 (its receipt names no set; one player for every piece); a
// picker that takes `full` for every piece; a receipt that names a set its player isn't (names the set); a bundle that
// lacks the set's player in any form (the twin); and #2892's wrong reading, raw hashes only, which fails a right
// program whose player is stored gzip (the gzip twin, and every bundle #2892 writes).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, failsNaming, labDoc, labTrack, none, sha256, useShow, useTemp } from '../172/helpers.ts';
import { AC, FIGURE, FULL_SET, exportPiece, moduleSetOf, readRecord, setOf, sliderDoc } from '../1490/helpers.ts';
import { bundleAsRead, copyOf, playerAsRead, storeGzip } from '../172-redraft-2892/helpers.ts';
import { setFailures } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'web_picks_full_set';

describe(`${AC[2]} the export bundles the smallest set that holds the piece, and its receipt names it`, () => {
  it(`${AC[2]} the 2D slider fixture bundles ${FIGURE} and its receipt names it, its files read as the page reads them; the physics lab bundles ${FULL_SET}; the planted ${PLANTED} fails, naming ${FIGURE}`, () => {
    const slider = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), 'the 2D slider fixture');
    expect(moduleSetOf(slider.receipt), `the 2D slider fixture's receipt names the module set it bundles, ${FIGURE}`).toBe(FIGURE);
    const record = readRecord();
    none(setFailures(slider, record, FIGURE, 'the 2D slider fixture'), `the 2D slider fixture bundles ${FIGURE}, as the size record gives it`);

    // The twins: figure's player stored gzip in place, and figure's player in no form.
    const figure = setOf(record, FIGURE);
    const player = playerAsRead(bundleAsRead(slider.out), slider.receipt)!;
    const gzip = copyOf(slider.out, join(temp(), 'gzip'));
    storeGzip(gzip, player.path, player.read);
    none(setFailures({ out: gzip, receipt: slider.receipt }, record, FIGURE, `the 2D slider fixture with ${FIGURE}'s player stored gzip`), `the 2D slider fixture with ${FIGURE}'s player stored gzip still bundles ${FIGURE}`);
    const without = copyOf(slider.out, join(temp(), 'without'));
    const held = [...bundleAsRead(without).values()].filter((x) => sha256(x.read) === figure.wasm.sha256);
    for (const x of held) rmSync(join(without, x.path));
    expect(held.length, `the slider fixture's bundle holds ${FIGURE}'s player ${figure.wasm.sha256}, so the twin without it removes a file`).toBeGreaterThan(0);
    failsNaming(setFailures({ out: without, receipt: slider.receipt }, record, FIGURE, `the 2D slider fixture without ${FIGURE}'s player`), figure.wasm.sha256, `the bundle that holds ${FIGURE}'s player in no form`);

    const evidence = temp();
    const lab = exportPiece(shows(FULL), evidence, labDoc(evidence), join(temp(), 'bundle'), 'the physics lab', { track: labTrack() });
    none(setFailures(lab, record, FULL_SET, 'the physics lab'), `the physics lab bundles ${FULL_SET}, as the size record gives it`);

    const planted = exportPiece(shows(FULL), temp(), sliderDoc(), join(temp(), 'bundle'), `the 2D slider fixture (planted ${PLANTED})`, { planted: PLANTED });
    expect(moduleSetOf(planted.receipt), `the planted picker ${PLANTED} bundles ${FULL_SET} for the slider fixture`).toBe(FULL_SET);
    failsNaming(setFailures(planted, record, FIGURE, `the 2D slider fixture (planted ${PLANTED})`), FIGURE, `the planted picker ${PLANTED}`);
  }, TIMEOUT);
});
