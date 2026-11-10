// Criterion 6 (no upstream test): "The lane's replay runs with no network and its record says so; a planted lane that
// runs the replay with the default network is refused, naming the network"
//
// docker-shim.mjs logs the lane's docker command lines (README: Docker), so the replay's network is read from the
// container that ran it (`--network none`), not from the record alone. The lane with `--planted default_network` runs the
// replay's container on the runtime's default network (README: Planted twins); its record names that network, and
// `deep-logic determinism` with compare cross_machine must refuse it, naming the network.
import { describe, expect, it } from 'vitest';
import {
  AC, NETWORK, TIMEOUT, cross, logicBin, macGolden, needImage, networkOf, onReferenceMac, pin, prebuild, recordOf, replays, runLane, sandbox,
  show, tallyPiece, treeOf, verifyCall, type JsonValue,
} from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[6]} the lane's replay has no network, and a replay with one is refused`, () => {
  it(`${AC[6]} the lane runs the replay with no network, and its record says so`, () => {
    onReferenceMac();
    const p = pin();
    needImage(p, 'linux/amd64');
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_06);
    const run = runLane(box, [verifyCall(piece, macGolden(piece))], { shim: {} });
    const record = recordOf(box, tree, run);
    expect(record['network'], `the record names the replay's network: ${show(record)}`).toBe(NETWORK);
    const ran = replays(run, p);
    expect(ran.length, `the lane ran the replay in a container (docker run naming deep-logic): ${show(run.docker as unknown as JsonValue)}`).toBeGreaterThan(0);
    for (const r of ran) expect(networkOf(r), `the replay's container had no network: ${r.rest.join(' ')}`).toBe(NETWORK);
  }, TIMEOUT);

  it(`${AC[6]} a planted lane that runs the replay on the default network (default_network) is refused, naming the network`, () => {
    onReferenceMac();
    const p = pin();
    needImage(p, 'linux/amd64');
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_16);
    const run = runLane(box, [verifyCall(piece, macGolden(piece))], { planted: 'default_network', shim: {} });
    const ran = replays(run, p);
    expect(ran.length > 0 && ran.every((r) => networkOf(r) !== NETWORK), `the planted lane's replay ran with a network: ${show(ran as unknown as JsonValue)}`).toBe(true);
    const record = recordOf(box, tree, run);
    expect(record['network'], `the planted lane's record says the network it ran on: ${show(record)}`).not.toBe(NETWORK);
    const c = cross(box, piece, tree, 'cross_machine on a replay run with the default network');
    expect(c.verdict, `cross_machine never passes it: ${show(c.raw)}`).not.toBe('PASS');
    expect(c.refusals.some((r) => r['field'] === 'network'), `it is refused, naming the network: ${show(c.refusals)}`).toBe(true);
  }, TIMEOUT);
});
