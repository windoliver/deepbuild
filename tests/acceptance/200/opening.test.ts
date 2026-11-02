// AC5 #200.f96a94c8: "Opening a test module's closed list test_mode: a | b as the registry test.mode@1 leaves every
// content key, golden and snapshot of that module's fixtures byte for byte the same; a planted opening that renumbers
// the entries changes the key of an item that uses b and fails, naming the entry and the item"
//
// asserts: three builds of the test module test.mode: `test-mode-closed` (its kind test.swatch@1's param mode is the
// closed list a | b), `test-mode-registry` (the same list opened as test.mode@1, whose first entries a and b keep
// their since and digest) and `test-mode-renumbered` (the planted opening). The registry build lists test.mode@1
// with a and b; the closed build lists no test.mode@1. Every fixture test.mode registers (the `fixtures` call), and
// this suite's modes.json (swatch-a in mode a, swatch-b in mode b), evaluates in the registry build with every node's
// content key and the bytes it wrote ("golden") as in the closed build, and draws the same snapshot (sha256); at
// least one of the module's own fixtures uses b. The renumbered build fails the same check (`openingFailures`), a
// failure naming the entry b and the item swatch-b.

import { describe, expect, it } from 'vitest';
import {
  DOC, MODE, arr, keyFailures, listing, nodesOf, none, failsNaming, isObject, obj, present, readJson, run, scenario, show, snapshotHash, str,
  theEntry, theRegistry, useBuilds, useEvidence, FIXTURES, type Build, type JsonObject,
} from './helpers.ts';
import { join } from 'node:path';

const CLOSED: Build = { set: 'core', with: ['test-mode-closed'] };
const OPENED: Build = { set: 'core', with: ['test-mode-registry'] };
const RENUMBERED: Build = { set: 'core', with: ['test-mode-renumbered'] };
const builds = useBuilds([CLOSED, OPENED, RENUMBERED]);
const evidence = useEvidence();

const MODES = obj(readJson(join(FIXTURES, 'modes.json')), 'modes.json');

interface Captured { docs: { name: string; document: JsonObject; nodes: ReturnType<typeof nodesOf>; snapshot: string }[] }
/** The module's own fixtures and modes.json, each presented with a snapshot and evaluated at 0, in one build. */
function capture(bin: string): Captured {
  const [fixtures] = run(bin, scenario(evidence(), [{ call: 'fixtures' }]));
  const own = arr(fixtures!['fixtures'], 'fixtures').map((f, i) => obj(f, `fixtures[${i}]`)).filter((f) => f['module'] === 'test.mode');
  expect(own.length, `test.mode registers fixtures: ${show(fixtures!['fixtures'])}`).toBeGreaterThan(0);
  const docs = [{ name: 'modes.json', document: MODES }, ...own.map((f) => ({ name: `test.mode fixture ${str(f['name'], 'fixture name')}`, document: obj(f['document'], 'fixture document') }))];
  const out: Captured = { docs: [] };
  for (const d of docs) {
    const [shown, evaluated] = run(bin, scenario(evidence(), [present(DOC.a, d.document, { pixels: true }), { call: 'eval', doc: DOC.a, t: 0 }]));
    expect(shown!['outcome'], `${d.name} is presented: ${show(shown)}`).toBe('presented');
    out.docs.push({ name: d.name, document: d.document, nodes: nodesOf(evaluated!, `${d.name}: eval`), snapshot: snapshotHash(shown!, d.name) });
  }
  return out;
}
/** The mode each item uses, by item ID, from the documents. */
const modesOf = (doc: JsonObject): Map<string, string> => {
  const out = new Map<string, string>();
  const items = isObject(doc['items']) ? doc['items'] : {};
  for (const [id, item] of Object.entries(items)) if (isObject(item) && isObject(item['params']) && typeof item['params']['mode'] === 'string') out.set(id, item['params']['mode']);
  return out;
};

/**
 * The opening changed nothing: for each fixture, every node's content key and written bytes, and the snapshot, are
 * the closed list's. A node whose item uses a mode names that entry and the item.
 */
function openingFailures(closed: Captured, opened: Captured): string[] {
  const failures: string[] = [];
  for (const before of closed.docs) {
    const after = opened.docs.find((d) => d.name === before.name);
    if (!after) { failures.push(`${before.name} is missing after the opening`); continue; }
    const modes = modesOf(before.document);
    for (const f of keyFailures(before.nodes, after.nodes, before.name)) {
      const item = [...modes.keys()].find((id) => f.includes(`|${id}`));
      failures.push(item ? `entry ${modes.get(item)}: item ${item}: ${f}` : f);
    }
    if (before.snapshot !== after.snapshot) failures.push(`${before.name}'s snapshot changed (${before.snapshot} → ${after.snapshot})`);
  }
  return failures;
}

describe('AC5 #200.f96a94c8 opening a closed list as a registry changes no content key, golden or snapshot', () => {
  it('AC5 test_mode: a | b opened as test.mode@1 keeps every content key, golden and snapshot of the module\'s fixtures byte for byte', () => {
    const opened = theRegistry(listing(builds.bin(OPENED), evidence()), MODE);
    for (const name of ['a', 'b']) {
      const e = theEntry(opened, name);
      expect([e.origin, e.module], `${name} is the module's first-party entry`).toEqual(['first_party', 'test.mode']);
      expect(e.since.length, `${name} keeps its since`).toBeGreaterThan(0);
    }
    expect(listing(builds.bin(CLOSED), evidence()).listed.some((l) => l.name === MODE), 'the closed build has no test.mode@1').toBe(false);
    const before = capture(builds.bin(CLOSED));
    expect(before.docs.slice(1).some((d) => [...modesOf(d.document).values()].includes('b')), 'one of test.mode\'s own fixtures has an item using b').toBe(true);
    none(openingFailures(before, capture(builds.bin(OPENED))), 'the opening as test.mode@1');
  }, 1_800_000);

  it('AC5 a planted opening that renumbers the entries changes the key of an item that uses b and fails, naming the entry and the item', () => {
    failsNaming(openingFailures(capture(builds.bin(CLOSED)), capture(builds.bin(RENUMBERED))), ['entry b', 'swatch-b'], 'the renumbering opening');
  }, 1_800_000);
});
