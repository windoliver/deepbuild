// AC6 #162.bc95e877: "A repeater with 3.5 copies exports as four groups, the last at half its opacity, and a document
// with a twist exports its output path keyed at each export frame where it changes"
//
// Each film is shown with `deep show` and exported with `{call: "export", video: {codec: "lottie"}, lottie: {container:
// "json", images: "embed"}}`; the test reads the Lottie JSON the export wrote with its own reader and evaluates it at
// every export frame as a Lottie player does (helpers.ts; README: The surface under test, Readings).
//
// - The repeater: a 30 u square path, `Tiles`, through a repeater of 3.5 copies 60 u apart along x. Copy k is the
//   square moved 60k u, at opacity 1 for k = 0, 1, 2 and 0.5 for k = 3 (Path: ops: "a fractional count draws its last
//   copy at the fraction's opacity"). Its layer must hold no repeater shape (Lottie 1.0.1 has none) and exactly four
//   groups that hold geometry, matched to the copies by where their square lands; at each of the 24 export frames each
//   group's square lies on its copy's within 0.01 u and draws at its copy's opacity within 0.001.
// - The twist: a rect, `Plate`, box [100, 50, w, 80], twisted 60° about its corner (100, 50), while a channel keys w
//   from 40 at 0.5 s to 160 at 1.5 s (linear, held outside). At 24 fps its output path (helpers.ts `twistedPlate`, the
//   base's rect path and twist) holds through frame 12, changes at every frame from 13 to 36, and holds from 36 to 47.
//   Its layer must hold no twist shape and one path; that path must carry a key at each of frames 13 to 36, no key at
//   a frame where the output path doesn't change (other than frame 0, and frame 12, the held frame the change starts
//   from), and, read as a player reads it, equal the output path at every one of the 48 export frames within 0.01 u.
//
// Wrong programs it fails on (README: Wrong programs): three groups or five, every copy at full opacity, every copy
// faded, the copies at one place, a repeater shape; the rect written untwisted, a twist shape, keys only at the
// channel's two keys (the corners then travel on chords, about 3 u off mid-span), keys at every export frame, keys a
// frame late.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC6, PLATE, TILES, TIMEOUT, TOL, exportedFile, lottieExport, lottieOf, movedAt, none, plateChanges, plateFailures, plateFilm,
  present, presented, runShow, scenario, tilesFailures, tilesFilm, useShow, useTemp, type JsonObject, type Lottie,
} from './helpers.ts';

const showBin = useShow();
const temp = useTemp();

/** Shows the film with `deep show` and exports it to Lottie; the file written, read. */
function exported(film: JsonObject, name: string, what: string): Lottie {
  const out = join(temp(), `${name}.json`);
  const [shown, exp] = runShow(showBin(), scenario(temp(), [present(film), lottieExport(out)]), what);
  presented(shown!, what);
  return lottieOf(exportedFile(exp!, out, `${what}'s Lottie export`), `${what}'s Lottie file`);
}

describe(`${AC6} a repeater's copies and a twist's output path in the Lottie export`, () => {
  it(`${AC6} a repeater with 3.5 copies exports as four groups, the last at half its opacity`, () => {
    const what = `the repeater film (${TILES.name})`;
    none(tilesFailures(exported(tilesFilm(), 'tiles', what), what), `${what}: four groups, each a copy in its place, the last at half its opacity`);
  }, TIMEOUT);

  it(`${AC6} a document with a twist exports its output path keyed at each export frame where it changes`, () => {
    const what = `the twist film (${PLATE.name})`;
    const span = Array.from({ length: 24 }, (_, j) => 13 + j);
    expect(plateChanges(), 'the fixture: the twist\'s output path changes at frames 13 to 36 and nowhere else').toEqual(span);
    expect(Math.min(...span.map(movedAt)), 'the fixture: each change moves a corner well past the tolerance').toBeGreaterThan(100 * TOL);
    none(plateFailures(exported(plateFilm(), 'plate', what), what), `${what}: the output path keyed at frames 13 to 36, where it changes, and equal to it at every export frame`);
  }, TIMEOUT);
});
