// AC1 #2776.e33547f5: "A planted canvas module whose kind draws in 3D and declares no answer for a final is refused at the
// seal, naming the kind and the path. Its twin that declares `refused` with a code seals"
//
// asserts, through `deep-show run`'s startup (README: The seal's refusal): the build `full,test-paths-no-final`, whose
// test module test.paths has its kind test.paths.mist@1 (drawn in 3D, as scene3d's box) declare rays and web answers and
// none for a final, refuses to start: exit 2 and one line {"ok": false, "code": "seal_refused", "reason":
// "path_unanswered", "entry": "test.paths.mist@1", "path": "final", …}, before any scenario is read. Its twin
// `full,test-paths`, where test.paths.mist@1 declares its final `refused` with the code path_undefined, seals: exit 0, the
// registry reply listing test.paths among the sealed modules.
// Wrong programs: the merge base (no such features, so neither build compiles); a seal that doesn't hold a 3D entry to
// an answer for each path starts the no-final build, and the refusal check fails naming test.paths.mist@1.

import { describe, it } from 'vitest';
import {
  AC, MIST, MODULE, NO_FINAL_BUILD, PATHS_BUILD, TIMEOUT, none, sealRefusalFailures, sealedFailures, startup, useBuilds,
} from './helpers.ts';

const builds = useBuilds([NO_FINAL_BUILD, PATHS_BUILD]);

describe(`${AC[1]} the seal refuses a 3D entry with no answer for a path`, () => {
  it(`${AC[1]} a planted module whose kind draws in 3D and declares no answer for a final is refused at the seal, naming the kind and final; its twin that declares refused with a code seals`, () => {
    none(sealRefusalFailures(startup(builds(NO_FINAL_BUILD)), MIST, 'final'), 'the build whose test.paths.mist@1 declares no answer for a final');
    none(sealedFailures(startup(builds(PATHS_BUILD)), MODULE, 'the twin, whose test.paths.mist@1 declares its final refused with path_undefined'), 'the twin');
  }, TIMEOUT);
});
