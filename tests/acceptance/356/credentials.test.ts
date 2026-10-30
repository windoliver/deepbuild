// #356.65dd8324 no credential value appears in any page, log or index: only variable names and where they're loaded from.
import fc from 'fast-check';
import { readFileSync, statSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';
import { leaks } from './checks.ts';
import { CANARIES, DATABASE_URL, forms } from './history.ts';
import { claimsQuoting, cleanup, onMac, rootOf, setupWithWindows, shown, snapshot, walk, world } from './helpers.ts';

afterAll(cleanup);
const ALL = { ...CANARIES, databaseUrl: DATABASE_URL };

/** Every file under ~/.deepbuild but the archived copies (#20's) and job folders (prompts), as bytes: the ledger and its WAL included. */
function sweepFiles(home: string): Map<string, Buffer> {
  const root = rootOf(home);
  const out = new Map<string, Buffer>();
  for (const f of walk(root)) {
    const rel = f.slice(root.length + 1);
    if (/^(evidence|jobs)\//.test(rel)) continue;
    try { if (statSync(f).isFile()) out.set(rel, readFileSync(f)); } catch { /* socket or vanished */ }
  }
  return out;
}

describe('#356.65dd8324 no credential value anywhere', () => {
  it('#356.65dd8324 the sweep finds a canary in every form (the check itself), seed 356', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(ALL)), fc.constantFrom(0, 1, 2), (name, i) => {
      const v = ALL[name as keyof typeof ALL];
      const form = forms(v)[i % forms(v).length]!;
      return leaks(new Map([['wiki/x.md', `before ${form} after`]]), ALL).length > 0 && leaks(new Map([['wiki/x.md', 'clean']]), ALL).length === 0;
    }), { seed: 356, numRuns: 60 });
  });

  it('#356.65dd8324 after setup, no canary (raw, base64, URL-encoded) is in a page, log.md, index.md, the ledger or its WAL; names and sources are', async () => {
    onMac();
    const w = world();
    const r = await setupWithWindows(w);
    expect(r.run.code, `deep setup exits 0: ${shown(r.run)}`).toBe(0);
    const pages = snapshot(w.wiki);
    expect(pages.size, 'the wiki has pages').toBeGreaterThan(3);
    // Names and where they're loaded from, so an empty wiki doesn't pass.
    expect(claimsQuoting(w.wiki, 'GITHUB_TOKEN from `gh auth token`').length, 'GITHUB_TOKEN and its source are on a page').toBeGreaterThan(0);
    expect(claimsQuoting(w.wiki, 'STRIPE_API_KEY from .env.local').length, 'STRIPE_API_KEY and its source are on a page').toBeGreaterThan(0);
    const files = sweepFiles(w.h.home);
    expect([...files.keys()].some((k) => k === 'ledger.db' || k.startsWith('ledger.db')), 'the sweep reaches the ledger').toBe(true);
    const problems = leaks(files, ALL);
    expect(problems, problems.join('; ')).toEqual([]);
  }, 1_800_000);

  it('#356.65dd8324 (wrong program) a setup that copies values is caught by the sweep', async () => {
    onMac();
    const w = world();
    const r = await setupWithWindows(w, { env: { DEEP_HUB_PLANT: 'copies-values' } });
    expect(r.run.code, `deep setup exits 0 under the plant: ${shown(r.run)}`).toBe(0);
    expect(leaks(sweepFiles(w.h.home), ALL).length, 'the plant leaks a canary and the sweep names it').toBeGreaterThan(0);
  }, 1_800_000);
});
