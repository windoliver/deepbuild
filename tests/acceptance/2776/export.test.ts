// AC6 #2776.c726fb11: "A web export of a piece that uses an entry whose web answer is `refused` is refused with that
// entry's code, and one whose answer is `stand_in` lists the item in the receipt with the answer's words. A planted
// export that carries a refused entry fails, naming the item"
//
// asserts, through `deep-show run` on `full,test-paths` (README: The web export): a 3D scene holding `glow`, an item of
// test.paths.glow@1, whose web answer is refused with test.paths.no_web, is presented and its web export refused with
// nothing written, its `refused` list giving glow that code; a scene holding `halo`, an item of test.paths.halo@1, whose
// web answer is stand_in, exports, and its receipt's `stand_in` lists halo with the entry and the answer's words, draws
// "nothing, the web player leaves the halo out" and receipt "halo left out", and its `refused` doesn't name halo. The
// planted export `web_export_carries_refused` (the scenario's `planted`), which reads no refused web answer, fails the
// first check, naming glow.
// Wrong programs: the merge base (no test-paths feature, so the build doesn't compile); the plant above.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, GLOW, HALO, HALO_DRAWS, HALO_RECEIPT, NO_WEB, PATHS_BUILD, TIMEOUT, arr, exportToWeb, failsNaming, isObject, none, receiptOf, scene, show,
  useBuilds, useTemp, webRefusedFailures,
} from './helpers.ts';

const builds = useBuilds([PATHS_BUILD]);
const temp = useTemp();

/** The planted web export (README: Planted programs). */
const CARRIES_REFUSED = 'web_export_carries_refused';

describe(`${AC[6]} the web export takes its refusals and stand-ins from the entries' web answers`, () => {
  it(`${AC[6]} a piece using an entry whose web answer is refused is refused with that entry's code, nothing written`, () => {
    const out = join(temp(), 'bundle');
    const reply = exportToWeb(builds(PATHS_BUILD), temp(), scene(DOC.glow, 'A glow', GLOW, 'glow'), out, 'the scene holding glow');
    none(webRefusedFailures(reply, out, 'glow', NO_WEB), 'the web export of the scene holding glow');
  }, TIMEOUT);

  it(`${AC[6]} a piece using an entry whose web answer is stand_in exports, its receipt listing the item with the answer's words`, () => {
    const out = join(temp(), 'bundle');
    const receipt = receiptOf(exportToWeb(builds(PATHS_BUILD), temp(), scene(DOC.halo, 'A halo', HALO, 'halo'), out, 'the scene holding halo'), 'the scene holding halo');
    const listed = arr(receipt['stand_in'], 'the receipt\'s stand_in').filter(isObject);
    expect(listed.filter((s) => s['item'] === 'halo'), `the receipt lists halo once, with its entry and the answer's words: ${show(receipt['stand_in'])}`).toEqual([
      expect.objectContaining({ item: 'halo', entry: HALO, draws: HALO_DRAWS, receipt: HALO_RECEIPT }),
    ]);
    const refused = Array.isArray(receipt['refused']) ? receipt['refused'] : [];
    expect(refused.filter((r) => isObject(r) && r['item'] === 'halo'), 'halo is a stand-in, never a refusal').toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} a planted export that carries a refused entry fails, naming the item`, () => {
    const out = join(temp(), 'bundle');
    const reply = exportToWeb(builds(PATHS_BUILD), temp(), scene(DOC.glow, 'A glow', GLOW, 'glow'), out, `the scene holding glow, exported by ${CARRIES_REFUSED}`, CARRIES_REFUSED);
    failsNaming(webRefusedFailures(reply, out, 'glow', NO_WEB), ['glow'], `the web export ${CARRIES_REFUSED}`);
  }, TIMEOUT);
});
