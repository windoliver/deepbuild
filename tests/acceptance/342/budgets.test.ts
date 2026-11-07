// #342 AC4: a desktop session's transcript is archived within 5 s of its SessionEnd, inside the 31 s Codex Desktop leaves the
// rollout after a delete; a session's volumes are reaped within 30 s of its end. Each reading starts just before the hook
// runs. A session never archived, or a volume never reaped, inside the longest wait is a plain failure, not a reading. Over
// its budget, a reading is judged as #580's budgets are: on a loaded machine or off a reference Mac it's INCONCLUSIVE, a skip
// that names the reading, never a pass; on a fit one, every run over by more than the margin fails. The base has no reading
// to compare: it copies at the hub's start and hourly, and leaves the volume.
import { afterEach, describe, expect, it } from 'vitest';
import { judge, verdictOf } from '../580/helpers.ts';
import { cleanup } from '../332/helpers.ts';
import { AC4, closeWorlds, copyHolding, dockerReady, goneAfter, openWorld, REAP_MS, ROLLOUT_LEFT_MS, session, STACK_FILES, stackOf, type Kind } from './helpers.ts';

afterEach(async () => { await closeWorlds(); await cleanup(); }, 180_000);

const ARCHIVE_MS = 5000;
const RUNS: Kind[] = ['claude', 'codex', 'claude', 'codex'];

describe(`${AC4} budgets`, () => {
  it('AC4 a desktop session\'s transcript is archived within 5 s of its SessionEnd', async (ctx) => {
    const w = await openWorld();
    const readings: number[] = [];
    for (const kind of RUNS) {
      const s = await session(w, kind);
      const last = `the last line of ${s.id}`;
      s.said(last);
      const at = await s.end();
      const found = await copyHolding(w, s, last, ROLLOUT_LEFT_MS);
      expect(found, `${s.handle} (${kind}) was not archived inside the ${ROLLOUT_LEFT_MS} ms Codex Desktop leaves the rollout`).toBeDefined();
      readings.push(Number(found!.copy.ts) - at);
    }
    verdictOf(ctx, [judge('transcript archived after SessionEnd, ms', readings, ARCHIVE_MS)]);
  }, 300_000);

  it('AC4 a session\'s volumes are reaped within 30 s of its end', async (ctx) => {
    dockerReady();
    const readings: number[] = [];
    for (let run = 0; run < 2; run++) {
      const w = await openWorld({ files: STACK_FILES });
      const s = await session(w, 'claude');
      const up = await stackOf(w, s);
      const at = await s.end();
      const ms = await goneAfter(up.volume, at, REAP_MS * 2);
      expect(ms, `the volume ${up.volume} still stands ${REAP_MS * 2} ms after its session ended`).toBeDefined();
      readings.push(ms!);
      await closeWorlds();
    }
    verdictOf(ctx, [judge('volumes reaped after the session ended, ms', readings, REAP_MS)]);
  }, 300_000);
});
