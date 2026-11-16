// Criterion 6 (no upstream test): "A claim that a library is right, proved only by fixtures the working agent wrote
// for its own library, stays INCONCLUSIVE with one ask, as its own checks do, while the same fixtures shipped in an
// installed pack count"
//
// Through `deep-logic claim` (README: deep-logic, claim). The same grid_path@1 with the same fixture ships once in a
// pack the working agent wrote (`origin: agent`) and once in an installed pack (`origin: installed`). The claim
// "grid_path@1 is right" is decided from the library's fixtures: the agent's own stay INCONCLUSIVE with exactly one
// approval ask naming the library; the installed pack's pass.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arr, claimCall, logicBin, obj, onHost, prebuild, show } from './helpers.ts';
import { gridPath1, mazePiece, pack } from './libs.ts';

prebuild(() => { logicBin(); });

describe(`${AC[6]} a library the working agent wrote binds only its own claims`, () => {
  it(`${AC[6]} the agent's own library and fixtures leave the claim INCONCLUSIVE with one ask, and the same fixtures in an installed pack count`, () => {
    const lib = gridPath1();
    const [own, installed] = onHost([
      claimCall(mazePiece(lib, [pack('mine', [lib], '1.0.0', 'agent')]), 'grid_path@1'),
      claimCall(mazePiece(lib, [pack('gridcore', [lib])]), 'grid_path@1'),
    ]);
    expect(own!['ok'], `the claim on the agent's own library is decided: ${show(own)}`).toBe(true);
    const asks = arr(own!['asks'], 'the claim\'s asks');
    expect([own!['verdict'], asks.length], 'the agent\'s own fixtures leave it INCONCLUSIVE with one ask').toEqual(['INCONCLUSIVE', 1]);
    const ask = obj(asks[0], 'the ask');
    expect([ask['kind'], ask['library']], 'the ask is an approval naming the library').toEqual(['approval', 'grid_path@1']);
    expect(installed!['ok'], `the claim on the installed pack's library is decided: ${show(installed)}`).toBe(true);
    expect([installed!['verdict'], installed!['asks']], 'the same fixtures in an installed pack pass the claim with no ask').toEqual(['PASS', []]);
  }, TIMEOUT);
});
