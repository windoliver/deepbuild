// AC4: "The packs' checks run once per version across two hub restarts, read from the store's own count."
//
// asserts: the checkout's `deep hub run` is started in one temporary HOME, stopped by its PID and started again, twice
// (three runs, two restarts). In each run a `deep mcp` started by hand calls deep_kinds `{op: word, word: BoxGeometry}`,
// which starts the hub's canvas core, and must answer `familiar.box@1`, so the packs are installed in every run and a hub
// that skips them after the first start fails here. After the last run, the hub's pack store under `<home>/.deepbuild/
// packs/` holds, for each folder of the checkout's packs/ with a pack.json, a record of that version
// (`deepbuild/<name>@<version>`) whose own count of its pack check's runs, `checks`, is exactly 1 (helpers.ts,
// storeCounts); a store with no count for a version, or with any other count, fails naming the version.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHECKOUT_DEEP, CHECKOUT_PACKS, cleanup, firstParty, kindsOverMcp, own, startHub, storeCounts, t26, tempDir, useCanvasCore, type Line } from './helpers.ts';

const built = useCanvasCore();
afterAll(cleanup, 60_000);

/** One run of the hub in `home`: started, the familiar word looked up through a fresh `deep mcp`, stopped by PID. */
async function oneRun(home: string, cwd: string): Promise<string> {
  const hub = await startHub(CHECKOUT_DEEP, home);
  const mcp = t26.McpProcess.start(home, cwd);
  own(mcp.pid);
  try {
    await t26.initialize(mcp);
    const o = await kindsOverMcp(mcp, { op: 'word', word: 'BoxGeometry' });
    const v = (o.value ?? {}) as Line;
    return o.isError || o.protocolError ? `answered ${o.protocolError ? 'a JSON-RPC error' : 'isError'}: ${String(v.code)} at ${String(v.path)}: ${String(v.remediation ?? JSON.stringify(v).slice(0, 300))}`
      : v.target === 'familiar.box@1' ? '' : `answered ${JSON.stringify(v).slice(0, 300)}, not familiar.box@1`;
  } finally {
    try { process.kill(mcp.pid, 'SIGTERM'); } catch { /* gone */ }
    await t26.stopHub(hub);
  }
}

describe('AC4 the packs are checked once per version across two hub restarts, by the store\'s own count', () => {
  it('AC4 across a start and two restarts, each first-party pack version\'s store count of checks is 1', async () => {
    built();
    const tmp = tempDir();
    const home = join(tmp, 'h');
    const cwd = join(tmp, 'work');
    mkdirSync(home);
    mkdirSync(cwd);
    const runs: string[] = [];
    for (let i = 0; i < 3; i++) runs.push(await oneRun(home, cwd));
    const unanswered = runs.map((r, i) => (r ? `run ${i + 1}: deep_kinds word BoxGeometry ${r}` : '')).filter(Boolean);

    const packs = firstParty(CHECKOUT_PACKS);
    expect(packs.length, `the checkout's ${CHECKOUT_PACKS} holds first-party packs`).toBeGreaterThan(0);
    const wrong = packs.flatMap((p) => {
      const counts = storeCounts(home, p);
      return counts.length === 1 && counts[0] === 1 ? [] : [`${p.ref}: the store's count of its checks is ${counts.length ? JSON.stringify(counts) : 'nowhere'}`];
    });
    expect([...unanswered, ...wrong], `in each of a start and two restarts the familiar pack answers through deep mcp, and afterwards the store under ${join(home, '.deepbuild', 'packs')} counts one check per first-party pack version`).toEqual([]);
  }, 1_800_000);
});
