// AC7 #2776.95a7c6cc: "`deep_kinds` returns an entry's three answers, and a refusal's message names the entry, the path
// and, for `path_undefined`, the open task that decides it where the row names one"
//
// asserts, through `deep-show run` and `deep-show kinds --dump` on `full,test-paths` (README: The answers as data):
// deep_kinds `list` of kind@1 returns test.paths.glow@1, test.paths.halo@1 and test.paths.mist@1 each with its three
// answers as the module declares them, every one of the four answers among them (same held by test.paths/glow,
// not_applicable with its why, refused with a code, refused path_undefined naming #2759, stand_in with its words); the
// web export of a scene holding `mist` (test.paths.mist@1, web answer refused path_undefined, task #2759) is refused, its
// refusal entry for mist carrying code path_undefined, entry test.paths.mist@1 and path web, and a message (`why`) that
// names test.paths.mist@1, the web path and #2759. And every 3D entry and field the build seals outside the test
// module, as the dump writes it with its answers, is in packages/contracts/canvas-paths.json with the same three
// answers, and the file holds nothing else: the listing the lane reads is the one the build seals.
// Wrong programs: the merge base (no test-paths feature, so the build doesn't compile; no listing file).

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ANSWERS, DOC, GLOW, HALO, LISTING, MIST, PATHS, PATHS_BUILD, TASK, TIMEOUT, UNDEFINED, arr, canon, committedListing, dumpOf, exportToWeb,
  holderKey, isObject, listedEntries, listingOf, none, obj, refusalEntry, scene, show, str, useBuilds, useTemp, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([PATHS_BUILD]);
const temp = useTemp();

describe(`${AC[7]} deep_kinds returns each 3D entry's three answers, and a refusal's message names the entry, the path and the open task`, () => {
  it(`${AC[7]} deep_kinds list returns the test module's three entries, each with its three answers`, () => {
    const entries = listedEntries(builds(PATHS_BUILD), temp(), 'kind@1');
    for (const name of [GLOW, HALO, MIST]) {
      const e = entries.find((x) => x['name'] === name);
      expect(e, `deep_kinds lists ${name} in kind@1; it lists ${entries.length} entries`).toBeDefined();
      const paths = obj(e!['paths'], `${name}.paths`);
      expect(Object.keys(paths).sort(), `${name} answers for rays, final and web`).toEqual([...PATHS].sort());
      for (const p of PATHS) expect(paths[p], `${name}'s ${p} answer`).toMatchObject(ANSWERS[name]![p]!);
    }
  }, TIMEOUT);

  it(`${AC[7]} a refusal's message names the entry, the path and, for path_undefined, the open task the row names`, () => {
    const out = join(temp(), 'bundle');
    const reply = exportToWeb(builds(PATHS_BUILD), temp(), scene(DOC.mist, 'A mist', MIST, 'mist'), out, 'the scene holding mist');
    expect(reply['outcome'], `the web export of the scene holding mist is refused: ${show(reply)}`).toBe('refused');
    const r = refusalEntry(reply, 'mist', UNDEFINED, 'the web export of the scene holding mist');
    expect([r['entry'], r['path']], `the path_undefined refusal names its entry and its path: ${show(r)}`).toEqual([MIST, 'web']);
    const why = str(r['why'], 'the refusal\'s message (why)');
    expect([why.includes(MIST), /\bweb\b/.test(why), why.includes(TASK)], `the message names ${MIST}, the web path and ${TASK}: ${why}`).toEqual([true, true, true]);
  }, TIMEOUT);

  it(`${AC[7]} every 3D entry and field the build seals, with its three answers as the dump writes them, is what packages/contracts/canvas-paths.json holds`, () => {
    const dump = dumpOf(builds(PATHS_BUILD), temp());
    const sealed = new Map<string, JsonObject>();
    for (const row of arr(dump['registries'], 'the dump\'s registries').filter(isObject)) {
      for (const e of (Array.isArray(row['entries']) ? row['entries'] : []).filter(isObject)) {
        const entry = String(e['name']);
        if (entry.startsWith('test.')) continue;
        if (isObject(e['paths'])) sealed.set(holderKey(String(row['name']), entry), e['paths']);
        for (const f of (Array.isArray(e['fields']) ? e['fields'] : []).filter(isObject)) {
          if (isObject(f['paths'])) sealed.set(holderKey(String(row['name']), entry, String(f['name'])), f['paths']);
        }
      }
    }
    expect(sealed.size, 'the full build seals 3D entries with their answers, as the dump writes them').toBeGreaterThan(0);
    const listing = listingOf(committedListing(), LISTING);
    const held = new Map(listing.holders.map((h) => [holderKey(h.registry, h.entry, h.field), h]));
    const failures: string[] = [];
    for (const [key, paths] of sealed) {
      const h = held.get(key);
      if (!h) failures.push(`${key}: sealed with answers, and ${LISTING} doesn't hold it`);
      else if (canon(paths) !== canon(h.paths as unknown as JsonObject)) failures.push(`${key}: the build seals ${canon(paths)}, ${LISTING} holds ${canon(h.paths as unknown as JsonObject)}`);
    }
    for (const key of held.keys()) if (!sealed.has(key)) failures.push(`${key}: ${LISTING} holds it, and the build seals no such 3D entry`);
    none(failures, `${LISTING} against the full build's sealed answers`);
  }, TIMEOUT);
});
