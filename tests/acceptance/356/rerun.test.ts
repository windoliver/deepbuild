// #356.8e6a9c42 re-running setup on unchanged history changes no page, and a line you deleted doesn't come back; and the
// issue's Proof: `deep setup` on the fixture corpus, the pages it wrote, a second run changing nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { changedFiles } from './checks.ts';
import { changedPages, cleanup, claims, claimsQuoting, onMac, setupWithWindows, shown, snapshot, world, type World } from './helpers.ts';

afterAll(cleanup);
const PAGES = ['index.md', 'log.md', 'you.md', 'setup.md', 'rules.md'];

describe('#356.8e6a9c42 changed pages and deleted lines', () => {
  it('#356.8e6a9c42 changedFiles names a rewritten page and allows only an appended log (the check itself)', () => {
    const a = new Map([['repos/api.md', 'x'], ['log.md', 'one\n']]);
    expect(changedFiles(a, new Map([['repos/api.md', 'x'], ['log.md', 'one\ntwo\n']]))).toEqual([]);
    expect(changedFiles(a, new Map([['repos/api.md', 'y'], ['log.md', 'one\n']]))).toEqual(['repos/api.md changed']);
    expect(changedFiles(a, new Map([['repos/api.md', 'x'], ['log.md', 'ONE\n']]))).toEqual(['log.md changed']);
  });

  async function scenario(env?: Record<string, string>): Promise<{ w: World; problems: string[] }> {
    onMac();
    const w = world();
    const first = await setupWithWindows(w, { env });
    expect(first.run.code, `deep setup exits 0: ${shown(first.run)}`).toBe(0);
    const problems: string[] = [];
    const snap1 = snapshot(w.wiki);
    for (const p of PAGES) if (!snap1.has(p)) problems.push(`the wiki has no ${p} after setup`);
    expect([...snap1.keys()].some((k) => k.startsWith('repos/')), 'a page per repo under repos/').toBe(true);
    const second = await setupWithWindows(w, { env });
    expect(second.run.code, `the second deep setup exits 0: ${shown(second.run)}`).toBe(0);
    problems.push(...changedFiles(snap1, snapshot(w.wiki)));
    for (const page of changedPages(second.run.stdout)) problems.push(`the second run's output names ${page} as changed`);
    // Delete the api release claim's line; setup again; it stays gone and nothing else moves.
    const victim = claimsQuoting(w.wiki, w.fx.facts.apiRelease!.fact)[0];
    expect(victim, 'the api page has the release-credential claim to delete').toBeDefined();
    const file = join(w.wiki, victim!.page);
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== victim!.line).join('\n'));
    const snap2 = snapshot(w.wiki);
    const third = await setupWithWindows(w, { env });
    expect(third.run.code, `the third deep setup exits 0: ${shown(third.run)}`).toBe(0);
    const after = claims(w.wiki);
    if (after.some((c) => c.json.id === victim!.json.id && c.page === victim!.page)) problems.push(`the deleted line ${String(victim!.json.id)} came back on ${victim!.page}`);
    if (claimsQuoting(w.wiki, w.fx.facts.apiRelease!.fact).length) problems.push('the deleted claim came back under another ID');
    for (const [name, text] of snapshot(w.wiki)) if (name !== victim!.page && name !== 'log.md' && snap2.get(name) !== text) problems.push(`${name} changed after the delete`);
    return { w, problems };
  }

  it('#356.8e6a9c42 Proof: setup writes the pages from the fixture corpus; a rerun on unchanged history changes no page; a deleted line stays deleted', async () => {
    const { w, problems } = await scenario();
    for (const key of ['apiStart', 'apiStripe', 'webToken', 'shopNew']) {
      const f = w.fx.facts[key]!;
      const hit = claimsQuoting(w.wiki, f.fact);
      expect(hit.length, `a claim quotes "${f.fact}"`).toBeGreaterThan(0);
      expect(JSON.stringify(hit[0]!.json.sources), `${key}'s claim cites ${f.handle}`).toContain(f.handle);
    }
    expect(problems, problems.join('; ')).toEqual([]);
  }, 1_800_000);

  it('#356.8e6a9c42 (wrong program) a setup that rewrites pages, or relearns a deleted line, fails', async () => {
    for (const plant of ['rewrites', 'resurrects']) {
      const { problems } = await scenario({ DEEP_HUB_PLANT: plant });
      expect(problems.join('; '), `plant ${plant} is caught`).toMatch(/changed|came back|named|added/);
    }
  }, 3_600_000);
});
