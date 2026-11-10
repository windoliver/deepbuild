// Criterion 3 (no upstream test): "A run in a linux/arm64 container on the same Mac and a native run on the Mac are each
// refused as `cross_machine`, naming the architecture aarch64, and read `machines: same`, never PASS"
//
// The lane runs with `--planted container_arm64` (the replay in a linux/arm64 container of the pinned image) and with
// `--planted native` (the replay by deep-logic built natively on this Mac, no container) (README: Planted twins). Each
// writes its record where the lane writes one, naming the architecture the run itself reported; `deep-logic
// determinism` with compare cross_machine must refuse it, naming lane_arch aarch64, with machines same.
import { describe, expect, it } from 'vitest';
import {
  AC, RECORDING, TIMEOUT, cross, logicBin, macGolden, needImage, onReferenceMac, pin, prebuild, recordOf, runLane, sandbox, show, tallyPiece,
  treeOf, verifyCall, type LanePlanted,
} from './helpers.ts';

prebuild(() => { logicBin(); });

function refusedAsSame(planted: LanePlanted, seed: number): void {
  const box = sandbox();
  const tree = treeOf(box);
  const piece = tallyPiece(seed);
  const golden = macGolden(piece);
  const run = runLane(box, [verifyCall(piece, golden)], { planted });
  const record = recordOf(box, tree, run);
  expect(record['lane_arch'], `the ${planted} run's record names the architecture it ran on: ${show(record)}`).toBe(RECORDING.arch);
  const c = cross(box, piece, tree, `cross_machine on the ${planted} run's record`);
  expect(c.verdict, `cross_machine never passes a run on the recording machine's architecture: ${show(c.raw)}`).not.toBe('PASS');
  expect(c.machines, 'it reads machines: same').toBe('same');
  expect(c.refusals.filter((r) => r['field'] === 'lane_arch' && r['value'] === RECORDING.arch).length, `it is refused, naming lane_arch aarch64: ${show(c.refusals)}`).toBeGreaterThan(0);
}

describe(`${AC[3]} a run on the reference Mac's own architecture never counts as cross_machine`, () => {
  it(`${AC[3]} a replay in a linux/arm64 container on this Mac is refused as cross_machine, naming aarch64, with machines: same`, () => {
    onReferenceMac();
    needImage(pin(), 'linux/arm64');
    refusedAsSame('container_arm64', 1983_03);
  }, TIMEOUT);

  it(`${AC[3]} a native replay on this Mac is refused as cross_machine, naming aarch64, with machines: same`, () => {
    onReferenceMac();
    refusedAsSame('native', 1983_13);
  }, TIMEOUT);
});
