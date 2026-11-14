// AC1 #239.72f4af59: "Both films render from their documents, seek equals play by pixel hash at 20 sampled times on the
// reference Mac, and each exports to H.264 with AAC whose delivery passes film.blank, frames.finite, export.color and
// export.fidelity, sound included"
//
// This file: "seek equals play by pixel hash at 20 sampled times on the reference Mac". Through `deep-show run`'s
// `determinism` call with `compare: "same_machine"` (#1897's): at each time both sides' canonical renders are hashed
// on the GPU, play by the warm path at 144 Hz from the start, seek by a cold jump from a second later, so each time is
// reached from a later one. The 20 times are seeded (mulberry32, seed 239) and off the frame grid (Six fixture films:
// "20 seeded off-grid times reached from later times"). At every time the two hashes must be equal, and the 20 play
// hashes must not all be one (a film that moves, and a hash that sees it). The comparison holds wherever it runs, so it
// is made first; then, off a reference Mac (by scripts/benchmark.mjs's fingerprint: Mac15,7, Mac15,12 or Mac17,10), the
// test reads INCONCLUSIVE, never PASS, since the criterion asks it on the reference Mac. Wrong programs: the base (no
// film: BLOCKED); a seek that differs from play at any of the times (the failure names the flick and both hashes).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FILMS, LABEL, TIMEOUT, agentScenario, compared, film, hashFailures, inconclusive, none, presentedClean, referenceMacProblem, runShow,
  sampledTimes, showFilm, stock, useBuilds, useTemp,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

describe(`${AC[1]} seek equals play by pixel hash at 20 sampled times on the reference Mac`, () => {
  for (const name of FILMS) {
    it(`${AC[1]} ${LABEL[name]}: at 20 seeded off-grid times, each reached from a later time, the seek's GPU pixel hash equals the play's, on the reference Mac`, async () => {
      const f = film(name);
      const times = sampledTimes(f);
      const evidence = temp();
      stock(evidence, f);
      const [shown, det] = runShow(bin('deep-show full'), agentScenario(evidence, [
        showFilm(f.document),
        { call: 'determinism', doc: DOC, display_hz: 144, at_times: times, compare: 'same_machine' },
      ]), `${f.label}: seek against play`);
      presentedClean(shown!, `${f.label}: deep_show`);
      const frames = compared(det!, times, `${f.label}: seek against play`);
      none(hashFailures(frames), `${f.label}: seek against play by the GPU pixel hash at ${times.join(', ')} flicks`);
      expect(new Set(frames.map((x) => x.play)).size, `${f.label}: the 20 play hashes aren't all one, so the film moves and the hash sees it`).toBeGreaterThan(1);
      const off = await referenceMacProblem(false);
      if (off) inconclusive(`${f.label}: seek equals play at the 20 times on this machine, but the criterion asks it on the reference Mac, and this one is ${off}`);
    }, TIMEOUT);
  }
});
