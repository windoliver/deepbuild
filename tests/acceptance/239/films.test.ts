// AC1 #239.72f4af59: "Both films render from their documents, seek equals play by pixel hash at 20 sampled times on the
// reference Mac, and each exports to H.264 with AAC whose delivery passes film.blank, frames.finite, export.color and
// export.fidelity, sound included"
//
// This file: "both films render from their documents". Each film is read from tests/fixtures/films/<name>/ (README: The
// two films): its document must hold its group's primitives (strokes drawn on through a trim over a paper look; a
// camera whose shots move, joined by transitions of two kinds or more) and what the other criteria's checks read (a
// text, a cue end, a sound strip, a budget class, 300 frames or more). Then, through `deep-show run`, `deep show`
// presents it with no error and `eval` draws its middle frame at the film's own size. Wrong programs: the base (no
// film: BLOCKED); a film missing its group's primitives (the group check names what is missing); a document `deep
// show` refuses or raises an error on; a film that draws no frame.
import { describe, expect, it } from 'vitest';
import {
  AC, FILMS, LABEL, SHELL_DOC, TIMEOUT, film, groupFailures, none, presentFromShell, presentedClean, runShow, shellScenario, snapshotPicture, stock,
  useBuilds, useTemp,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

describe(`${AC[1]} both films render from their documents`, () => {
  for (const name of FILMS) {
    it(`${AC[1]} ${LABEL[name]} is a document that holds its group's primitives, deep show presents it with no error, and its middle frame draws at its own size`, () => {
      const f = film(name);
      none(groupFailures(f), `${f.label}: what its group and the checks need`);
      const evidence = temp();
      stock(evidence, f);
      const middle = Math.floor(f.frames / 2) * f.frame;
      const [shown, drawn] = runShow(bin('deep-show full'), shellScenario(evidence, [
        presentFromShell(SHELL_DOC.a, f.document),
        { call: 'eval', doc: SHELL_DOC.a, t: middle, pixels: true },
      ]), f.label);
      presentedClean(shown!, `${f.label}: deep show`);
      const picture = snapshotPicture(evidence, drawn!, `${f.label}: its frame at ${middle} flicks`);
      expect([picture.width, picture.height], `${f.label}: the frame draws at the film's size`).toEqual(f.size);
    }, TIMEOUT);
  }
});
