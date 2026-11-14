// AC1 #503.385199c8, one clause: "a bar chart whose 16 rows' heights read the bands draws the same heights seeked or
// played at every frame". A blind redraft (README). The criterion's 10 s sound is written as a float WAV into the
// evidence store; a film shows 16 bars whose `level` column reads the array `spectrum.music` of the document's
// spectrum bake (bands 16, scale log, range [40, 16000], rate 60, window 2048). Through `deep-show run`: `deep show`
// presents it, `frames` plays its 600 frames in order and draws each, and an `eval` with `pixels` seeks to each frame.
// Each bar's height is read from the drawn PNG and held to the band's level, computed here from the same samples by the
// design's rule (row 180, 3 s: band 8 at −6.02 dB, the rest at −120; row 60, 1 s: all at −120), within a pixel; and a
// frame's played heights must equal its seeked ones. The second test runs the planted program that plays every row a
// frame late and needs this check to fail it, naming frame 121, the first frame the tone reaches.
import { describe, it } from 'vitest';
import { DOC, FULL, TIMEOUT, failsNaming, none, putEvidence, runShow, scenario, useShow, useTemp } from '../501/helpers.ts';
import { AC1, FRAMES, PLANTED, calls, chart, drawnOf, issueValues, judge, sound, soundWav, spectrumRows } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** The chart shown, played and seeked in one `deep-show run`, and the spectrum its heights are held to. */
function run(what: string, planted?: string): string[] {
  const x = sound();
  const levels = spectrumRows(x, FRAMES);
  none(issueValues(levels), `${what}: the test's own spectrum of the fixture gives the criterion's values at 1 s and 3 s`);
  const evidence = temp();
  const sha = putEvidence(evidence, soundWav(x));
  const sc = scenario(evidence, calls(DOC.a, chart(sha)), planted === undefined ? {} : { planted });
  const replies = runShow(shows.bin(FULL), sc, what);
  return judge(drawnOf(replies, evidence, what), levels);
}

describe(`${AC1} spectrum bands: a bar chart reading the bands`, () => {
  it(`${AC1} (bar chart) a bar chart whose 16 rows' heights read the bands draws the same heights seeked or played at every frame`, () => {
    none(run('the chart'), 'each of the 600 frames, played and seeked: every bar within a pixel of its band\'s level, played equal to seeked');
  }, TIMEOUT);

  it(`${AC1} (bar chart, wrong program) the same check fails ${PLANTED}, which plays each row a frame late, naming frame 121`, () => {
    failsNaming(run(`the chart under ${PLANTED}`, PLANTED), /^frame 121 /, `${PLANTED}: the check`);
  }, TIMEOUT);
});
