// AC6: `replica_equals_live_tree` passes for the shipped pages, and it leaves `scripts/known-failures.json`. The test is
// deep-replica's own (crates/deep-replica/headless.rs, run by cargo). Beside it, the Proof's "tree of each shipped page,
// replica beside live, with IDs and values": each shipped page drawn now by deep-replica and captured now by deep-live (the
// real app window on this Mac, its accessibility tree read in its own process), node for node with their ids, and the live
// trees the test reads (docs/spikes/338/out/live) carrying ids too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARGO_ENV, firstDifference, flat, ID, liveSnapshot, openAsks, RECORD_338, REPO, replicaSnapshot, requireMacos, rowStarting, run, SHIPPED, withoutIdKey, type Snapshot } from './helpers.ts';

const MIN = 60_000;
const TEST = 'replica_equals_live_tree';

describe(`AC6 ${ID.parity} \`replica_equals_live_tree\` passes for the shipped pages, and it leaves \`scripts/known-failures.json\``, () => {
  it('AC6 cargo\'s replica_equals_live_tree runs and passes', async () => {
    requireMacos();
    const r = await run('cargo', ['test', '--locked', '-p', 'deep-replica', '--test', 'headless', TEST], CARGO_ENV);
    expect(r.stdout, `the test ran: ${r.stdout.slice(-600)} ${r.stderr.slice(-600)}`).toContain(`test ${TEST} ... `);
    expect(r.stdout, `the test passed: ${r.stdout.slice(-1200)}`).toContain(`test ${TEST} ... ok`);
    expect(r.code).toBe(0);
  }, 40 * MIN);

  it('AC6 scripts/known-failures.json names replica_equals_live_tree nowhere', () => {
    const known = readFileSync(join(REPO, 'scripts/known-failures.json'), 'utf8');
    const lines = known.split('\n').filter((l) => l.includes(TEST)).map((l) => l.trim().slice(0, 200));
    expect(lines, 'no known failure, timing, skip or lint entry names it').toEqual([]);
  });

  it('AC6 each shipped page drawn by the replica equals the live capture node for node, ids and values included, and Needs you\'s rows carry their asks\' handles', async () => {
    requireMacos();
    const failures: string[] = [];
    for (const view of SHIPPED) {
      const [replica, live] = [await replicaSnapshot(view), await liveSnapshot(view)];
      const committed = JSON.parse(readFileSync(join(REPO, 'docs/spikes/338/out/live', `${view}.json`), 'utf8')) as Snapshot;
      for (const [what, s] of [['the replica', replica], ['the live capture', live], ['the stored live tree', committed]] as const) {
        const bare = withoutIdKey(s);
        const named = bare.find((n) => n.name) ?? bare[0];
        if (named) failures.push(`${view}: ${bare.length} of ${flat(s.tree).length} nodes in ${what} carry no id key, such as ${named.role} ${JSON.stringify(named.name)}`);
      }
      const differ = firstDifference(replica, live);
      if (differ) failures.push(`${view}: the replica and the live capture differ: ${differ}`);
      if (view === 'needs-you') {
        for (const ask of openAsks(RECORD_338)) {
          for (const [what, s] of [['the replica', replica], ['the live capture', live]] as const) {
            const row = rowStarting(s, ask.question);
            if (row?.id !== ask.handle) failures.push(`needs-you: ${what}'s row for "${ask.question}" has id ${JSON.stringify(row?.id)}, not its ask's handle ${ask.handle}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 40 * MIN);
});
