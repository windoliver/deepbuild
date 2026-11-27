// Criterion 4 of #3611 (#3611.f11db91d), at a real hub: "A row written beside the hub, by a process that is not the
// hub, is not taken: the check runs. The test writes one as an agent's child would"
//
// ac4-beside.test.mjs holds the core's half with the test standing as the hub. This file holds the hub's half, which
// only a real hub has: what tells the hub's rows from a row written beside them is a key that is in the hub's memory
// and in no file (the design step). So: `deep hub run` in a home of the test's own, and a `deep mcp` started by hand
// that asks for `deep_kinds list`, the first call that needs the release's packs, so the hub's canvas core checks each.
// Then (judge.mjs `judgeHubStore`):
//   - the hub's store, `<home>/.deepbuild/packs/checked/`, holds a row for every version the release ships, each as the
//     design step says: two lines, the row naming the pack and its version, the mark an HMAC-SHA-256 in hex. The hub
//     gave its core the store and a key;
//   - forger.mjs, the process that is not the hub (README), reads every file under the hub's root for that key and
//     tries each thing that reads as 32 bytes on a row: no file holds a key that makes a row's mark. Had one held it,
//     the row that process writes beside the hub's would carry a mark that verifies, and would be taken.
// Wrong programs it fails on: the merge base (the hub's core keeps no row); a hub that gives its cores no store; a hub
// that keeps its launch key in a file under its root.
// Run: node --test tests/acceptance/3611/ac4-hub.test.mjs
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { none, notTheHub, removeRoot, tempRoot } from './core.mjs';
import { firstListing, hubBinaries, startHub, startMcp } from './hub.mjs';
import { judgeHubStore } from './judge.mjs';
import { shippedPacks } from './packs.mjs';
import { fileAt, rowProblems } from './store.mjs';

test('AC4 #3611.f11db91d at a real hub, the store its canvas core fills holds a marked row for each shipped version, and a process that is not the hub finds under the hub\'s root no key to mark a row of its own with', { timeout: 19 * 60_000 }, async (t) => {
  hubBinaries();
  const refs = shippedPacks();
  const at = tempRoot();
  const home = join(at.tmp, 'h');
  const cwd = join(at.tmp, 'work');
  mkdirSync(cwd);
  let hub, mcp;
  try {
    hub = await startHub(home);
    mcp = await startMcp(home, cwd);
    const from = performance.now();
    await firstListing(mcp, 12 * 60_000);
    const store = join(hub.root, 'packs', 'checked');
    const rows = refs.map(({ ref, id, version, provider }) => ({ ref, provider, problems: rowProblems(fileAt(store, ref), { pack: id, version }) }));
    const scan = await notTheHub(hub.root);
    t.diagnostic(`the hub's core answered deep_kinds list ${((performance.now() - from) / 1000).toFixed(1)} s after it was asked; the process that is not the hub read ${scan.files} files under the hub's root (${scan.unread} it couldn't) and tried ${scan.candidates} keys on ${scan.rows} rows`);
    none(judgeHubStore({ rows, scan, store: '<home>/.deepbuild/packs/checked/' }), 'AC4 #3611.f11db91d: the hub\'s rows carry a mark no process that is not the hub can make');
  } finally {
    await mcp?.stop();
    await hub?.stop();
    removeRoot(at);
  }
});
