// For #1820's re-export redraft under #3525: tests/acceptance/1820/export-redraft/world.ts, reused read-only, with
// `fetchAfterYes` reaching the fetch through `deep_job {op: "fetch", pack, asset}` (../helpers.ts `job`) in place of
// deep_kinds; its ask, its answer and its wait are the original's, line for line.
import { asks, sleep, type Line, type Outcome, type Scoped } from '../../1820/export-redraft/world.ts';
import { job } from '../helpers.ts';

export { addAsset, asks, CC0, exportStill, installOrBlock, LICENSE_TEXT, pictureDoc, said, scopedWorld, sleep, writePack } from '../../1820/export-redraft/world.ts';
export type { Line, Outcome, Ran, Scoped } from '../../1820/export-redraft/world.ts';
export { job };

/** A fetch of a pack asset on the job #1731 uses: asked once, your yes, then called until it is no longer held. */
export async function fetchAfterYes(w: Scoped, pack: string, path: string, answer: (ask: { handle: string; data: Line }) => Promise<unknown>): Promise<Outcome> {
  const args = { op: 'fetch', pack, asset: path };
  const before = (await asks(w)).length;
  let o = await job(w, args);
  if (o.value.status === 'held') {
    const raised = (await asks(w, 'authority')).slice(before);
    if (raised.length !== 1) throw Error(`the first fetch of ${pack} ${path} raised ${raised.length} authority asks, not one`);
    await answer(raised[0]!);
    for (const deadline = Date.now() + 120_000; ; await sleep(500)) {
      o = await job(w, args);
      if (o.value.status !== 'held' || Date.now() > deadline) break;
    }
  }
  return o;
}
