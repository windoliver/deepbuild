// #1662 AC2 (README): the release deep-app built with the workspace's feature resolution holds none of ROW_PLANT,
// RowPlant or plant_row, the same as the one built with -p deep-app alone. Its wrong program is a release deep-app
// built with --features plant-row, which must fail the byte search naming ROW_PLANT; at the merge base the
// workspace-resolved binary itself fails it (BASE-FAILURE.txt).
import { describe, expect, it } from 'vitest';
import { AC2, BUILD_ARGS, BUILD_MS, failureOf, heldBy, judgeSymbols, releaseApp } from './helpers.ts';

describe(`${AC2} a release deep-app built with --workspace holds no ROW_PLANT, RowPlant or plant_row symbol, the same as one built with -p deep-app`, () => {
  it(`${AC2} the release deep-app built with -p deep-app (cargo ${BUILD_ARGS.alone.join(' ')}) holds none of the three`, async () => {
    judgeSymbols(await releaseApp('alone'), 'built with -p deep-app');
  }, BUILD_MS);

  it(`${AC2} the release deep-app built with --workspace (cargo ${BUILD_ARGS.workspace.join(' ')}) holds none of the three, the same as the one built alone`, async () => {
    const workspace = await releaseApp('workspace');
    judgeSymbols(workspace, 'built with --workspace');
    expect(heldBy(workspace), 'the same strings as the one built alone: none').toEqual(heldBy(await releaseApp('alone')));
  }, BUILD_MS);

  it(`${AC2} (wrong program) a release deep-app built with --features plant-row fails the byte search naming ROW_PLANT`, async () => {
    const message = await failureOf(async () => judgeSymbols(await releaseApp('planted'), 'built with --features plant-row'));
    expect(message, 'the byte search must fail on a planted release binary, or it proves nothing').toMatch(/the release deep-app built with --features plant-row holds .*ROW_PLANT/);
  }, BUILD_MS);
});
