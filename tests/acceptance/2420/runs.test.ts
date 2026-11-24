// #2420's last two criteria. A run refused 3 different targets records 3 events and no closing one. Two runs side by
// side, each sent 300 requests under different names, each record 256 and a closing `44`. Two runs side by side are
// two worktrees of one test repo, each brought up by `deep env up` on the same hub (#2399's `secondWorktree` and
// `up`), both up at once. The first run is sent its 300 first, and the second its 300 once the first holds 256, so
// a supervisor that keeps one count for both fails at the second run. Each run ends by `deep env down` in its own
// worktree.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, type Up, upWorld } from '../1106/helpers.ts';
import { downAll, filterOf, secondWorktree, up } from '../2399/helpers.ts';
import { CEILING, endRun, holds, namesFor, not403, reached, recordOf, sendAll, show } from './helpers.ts';

afterEach(cleanup, 60_000);

describe('runs under the ceiling, and runs side by side', () => {
  it('#2420.17cfe76e a run refused 3 different targets records 3 events and no closing one', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const f = await filterOf(u.port);
      const names = namesFor('three', 3);
      const answers = await sendAll(f, names);
      expect(answers, 'each of the 3 requests is answered 403').toEqual([403, 403, 403]);
      for (const name of names) expect(await holds(u.client, u.run, name), `run ${u.run}'s record holds the refusal of ${name}`).toBe(true);
      // The closing event, if a program writes one, comes when the run ends: wait for it up to 20 s past run.cleaned.
      const ended = await endRun(u.hub, u.client, u.wt, u.run, 20_000);
      expect(ended.code, '`deep env down` exits 0').toBe(0);
      expect(ended.cleaned, `the record holds run.cleaned for ${u.run}`).toBe(true);
      const rec = await recordOf(u.client, u.run);
      expect(rec.naming.length, `run ${u.run} recorded ${rec.naming.length} sandbox.denied naming a target, expected 3: ${show(rec.naming)}`).toBe(3);
      expect(rec.closing, `run ${u.run}, refused 3 different targets, got a closing sandbox.denied: ${show(rec.closing)}`).toEqual([]);
    } finally {
      await downAll(u, u ? [u.wt] : []);
    }
  }, 600_000);

  it('#2420.fdfdf3b3 two runs side by side, each sent 300 requests under different names, each record 256 and a closing 44', async () => {
    let u: Up | undefined;
    const worktrees: string[] = [];
    try {
      u = await upWorld();
      worktrees.push(u.wt);
      const wtB = secondWorktree(u.wt);
      worktrees.push(wtB);
      const b = await up(u.hub, wtB);
      expect(b.run, 'the second worktree\'s stack is a run of its own').not.toBe(u.run);
      const fA = await filterOf(u.port);
      const fB = await filterOf(b.port);
      expect(fB.port, 'and has a filter port of its own').not.toBe(fA.port);
      const runs = [{ which: 'the first run', run: u.run, wt: u.wt, f: fA, names: namesFor('runa', 300) }, { which: 'the second run', run: b.run, wt: wtB, f: fB, names: namesFor('runb', 300) }];
      for (const r of runs) {
        const answers = await sendAll(r.f, r.names);
        expect(answers.filter((a) => a !== 403).length, `each of the 300 requests to ${r.which} ${r.run} is answered 403; not: ${not403(r.names, answers)}`).toBe(0);
        await reached(u.client, r.run, CEILING);
      }
      for (const r of runs) {
        const ended = await endRun(u.hub, u.client, r.wt, r.run, 60_000);
        expect(ended.code, `\`deep env down\` for ${r.which} exits 0`).toBe(0);
        expect(ended.cleaned, `the record holds run.cleaned for ${r.which} ${r.run}`).toBe(true);
      }
      const recs = await Promise.all(runs.map((r) => recordOf(u!.client, r.run)));
      runs.forEach((r, i) => expect(recs[i]!.naming.length, `${r.which} ${r.run} recorded ${recs[i]!.naming.length} sandbox.denied naming a target, expected ${CEILING}: ${show(recs[i]!.naming)}`).toBe(CEILING));
      runs.forEach((r, i) => expect(recs[i]!.closing.map((d) => d.target), `after ${r.which} ${r.run} ended, one sandbox.denied with operation more and target 44 (its 300 less ${CEILING}); the closing events: ${show(recs[i]!.closing)}`).toEqual(['44']));
    } finally {
      await downAll(u, worktrees);
    }
  }, 600_000);
});
