// AC6 #200.400aefd1: "deep://registries lists test.mark@1 with since, digest, fill, each entry's origin and its kit
// result; changing test.mark@1's entry schema under the same major fails the contract diff against the previous
// release, naming the registry, while publishing it as test.mark@2 passes, with replaced_by on test.mark@1"
//
// AC7 #200.d93a89e4: "deep://registries lists the `check.kind@1` slot beside test.mark@1, marked as a slot, with its
// installed fills `command` and `journey` and each one's kit result; a listing that leaves hub slots out, or lists
// `journey` as an entry of a registry, fails, naming the slot"
//
// asserts: AC6: the `core,test-mark` build with test/testpack installed lists test.mark@1 with since, a d1 digest
// and fill, dot (first_party, kit PASS) and testpack.ring (pack, test/testpack@1.0.0, kit PASS), each with since and
// digest. The contract rows of the test registries the binary publishes (each listing row's contract fields) are
// written to a scratch tree's canvas-registries.json: from `core,test-mark` as release R2 (`contract-diff.mjs
// record`), then from `core,test-mark-schema-changed` (test.mark@1's entry schema with a required color) checked as
// R3, which FAILs naming test.mark@1, and from `core,test-mark-v2` (test.mark@2 with that schema, test.mark@1 kept
// with replaced_by test.mark@2), which PASSes. AC7: with the hub's installed fills command and journey (scenario
// `installed`), the listing holds test.mark@1 as a registry and check.kind@1 as a slot (kind slot), its interface,
// digest, how many may fill it and planted fills as the hub-slot table (packages/contracts/hub-slots.json) gives
// them, and each fill with its own kit result; `slotListingFailures` finds nothing. `--planted
// registries_without_slots` and `--planted slot_fill_as_entry` each fail `slotListingFailures`, naming check.kind@1.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, MARK, MARK2, REGISTRIES, REPO, SLOT, TESTPACK, arr, failLines, failsNaming, isObject, listing, mentions, none, packAt, readJson, run,
  scenario, script, scratchTree, show, shown, theEntry, theRegistry, useBuilds, useEvidence, useTempDirs, writeJson, type Build, type Installed,
  type JsonObject, type JsonValue, type Registries,
} from './helpers.ts';

useTempDirs();
const MARKS: Build = { set: 'core', with: ['test-mark'] };
const CHANGED: Build = { set: 'core', with: ['test-mark-schema-changed'] };
const V2: Build = { set: 'core', with: ['test-mark-v2'] };
const builds = useBuilds([MARKS, CHANGED, V2]);
const evidence = useEvidence();

describe('AC6 #200.400aefd1 deep://registries lists test.mark@1 with its history, and its entry schema is a contract entry', () => {
  it('AC6 deep://registries lists test.mark@1 with since, digest, fill, and each entry\'s origin and kit result', () => {
    const r = listing(builds.bin(MARKS), evidence(), undefined, { packs: [TESTPACK] });
    const mark = theRegistry(r, MARK);
    expect(typeof mark.since === 'string' && mark.since.length > 0, `test.mark@1 has since: ${show(mark.raw)}`).toBe(true);
    expect(mark.digest, 'test.mark@1 has its digest').toMatch(DIGEST);
    expect(mark.fill, 'and its fill').toEqual(expect.arrayContaining(['module', 'pack']));
    const dot = theEntry(mark, 'dot');
    expect([dot.origin, dot.kit.verdict], 'dot: the module\'s first-party entry, admitted by the kit').toEqual(['first_party', 'PASS']);
    const ring = theEntry(mark, 'testpack.ring');
    expect([ring.origin, ring.pack, ring.kit.verdict], 'testpack.ring: the pack\'s entry, admitted by the kit at pack check').toEqual(['pack', packAt(TESTPACK), 'PASS']);
    for (const e of [dot, ring]) {
      expect(e.since.length, `${e.name} has since`).toBeGreaterThan(0);
      expect(e.digest, `${e.name} has its digest`).toMatch(DIGEST);
    }
  }, 1_800_000);

  it('AC6 a changed entry schema under test.mark@1 fails the contract diff against the previous release, naming the registry; test.mark@2 with replaced_by on test.mark@1 passes', () => {
    const tree = scratchTree('contracts', { empty: true });
    const file = join(tree, 'packages/contracts/canvas-registries.json');
    const publish = (bin: string): Registries => {
      const r = listing(bin, evidence());
      writeJson(file, contractRows(r));
      return r;
    };
    publish(builds.bin(MARKS));
    const recorded = script('contract-diff.mjs', ['record', '--release', 'R2', '--root', tree]);
    expect(recorded.code, `R2 recorded with test.mark@1\n${shown(recorded)}`).toBe(0);
    const rows = readJson(file) as JsonValue[];
    expect(rows.some((row) => isObject(row) && row['registry'] === MARK && isObject(row['entry'])), `the published rows hold test.mark@1 with its entry schema: ${show(rows)}`).toBe(true);

    publish(builds.bin(CHANGED));
    const changed = script('contract-diff.mjs', ['check', '--release', 'R3', '--root', tree]);
    expect(changed.code, `test.mark@1's entry schema changed under the same major fails the contract step\n${shown(changed)}`).toBe(1);
    expect(failLines(changed, 'contracts').some((l) => l.includes(MARK)), `a FAIL contracts line names test.mark@1\n${shown(changed)}`).toBe(true);

    const v2 = publish(builds.bin(V2));
    const one = theRegistry(v2, MARK);
    expect(one.raw['replaced_by'], 'test.mark@1 names test.mark@2 as replaced_by').toBe(MARK2);
    expect(theRegistry(v2, MARK2).kind, 'test.mark@2 is published').toBe('registry');
    const next = script('contract-diff.mjs', ['check', '--release', 'R3', '--root', tree]);
    expect(failLines(next, 'contracts'), `test.mark@2 with replaced_by on test.mark@1 passes the contract step\n${shown(next)}`).toEqual([]);
    expect(next.code, shown(next)).toBe(0);
  }, 1_800_000);
});

/** The contract row of each test registry a listing publishes: canvas-registries.json's fields, taken as listed. */
function contractRows(r: Registries): JsonObject[] {
  const FIELDS = ['registry', 'owner', 'fill', 'resolve', 'since', 'stability', 'tracking', 'deprecated_since', 'replaced_by', 'entry'];
  return r.listed.filter((l) => l.kind === 'registry' && l.name.startsWith('test.')).map((l) => {
    const row: JsonObject = { registry: l.name };
    for (const f of FIELDS.slice(1)) if (l.raw[f] !== undefined) row[f] = l.raw[f]!;
    return row;
  });
}

// ---- AC7: hub slots beside the registries.

const KIT_COMMAND: JsonObject = { verdict: 'PASS', rules: [{ rule: 'catalogue', verdict: 'PASS' }, { rule: 'deadline', verdict: 'PASS' }] };
const KIT_JOURNEY: JsonObject = { verdict: 'PASS', rules: [{ rule: 'catalogue', verdict: 'PASS' }, { rule: 'output', verdict: 'PASS' }, { rule: 'assertion', verdict: 'PASS' }] };
const INSTALLED: Installed[] = [{ slot: SLOT, fill: 'command', kit: KIT_COMMAND }, { slot: SLOT, fill: 'journey', kit: KIT_JOURNEY }];
const FILLS = ['command', 'journey'];

/**
 * The listing holds `slot` beside the registries, marked as a slot, with each installed fill and its kit result,
 * and no registry lists a fill as an entry. Each failure names the slot. Read on the raw reply, so a wrong
 * listing's shape can't stop the check.
 */
function slotListingFailures(reply: JsonObject, slot: string, kits: Record<string, JsonObject>): string[] {
  const listed = Array.isArray(reply['registries']) ? reply['registries'].filter(isObject) : [];
  const failures: string[] = [];
  const row = listed.find((l) => l['name'] === slot);
  if (!row) failures.push(`${slot}: the listing leaves the hub slot out`);
  else if (row['kind'] !== 'slot') failures.push(`${slot}: listed as ${String(row['kind'])}, not marked as a slot`);
  else {
    const fills = Array.isArray(row['fills']) ? row['fills'].filter(isObject) : [];
    for (const [name, kit] of Object.entries(kits)) {
      const f = fills.find((x) => x['name'] === name);
      if (!f) failures.push(`${slot}: its installed fill ${name} isn't listed`);
      else {
        const rules = (Array.isArray(kit['rules']) ? kit['rules'] : []).filter(isObject).map((r) => String(r['rule']));
        const own = mentions(f['kit'], `"verdict":"${String(kit['verdict'])}"`) && rules.every((rule) => mentions(f['kit'], `"rule":"${rule}"`));
        if (!own) failures.push(`${slot}: its fill ${name} is listed without its own kit result: ${show(f['kit'])}`);
      }
    }
  }
  for (const l of listed.filter((x) => x['kind'] !== 'slot')) {
    const entries = Array.isArray(l['entries']) ? l['entries'].filter(isObject) : [];
    for (const name of Object.keys(kits)) if (entries.some((e) => e['name'] === name)) failures.push(`${slot}: its fill ${name} is listed as an entry of the registry ${String(l['name'])}`);
  }
  return failures;
}

describe('AC7 #200.d93a89e4 deep://registries lists the hub\'s check.kind@1 slot beside the registries, marked as a slot', () => {
  it('AC7 check.kind@1 is listed beside test.mark@1, marked as a slot, with the hub-slot table\'s interface and planted fills, and its installed fills command and journey each with its kit result', () => {
    const [reply] = run(builds.bin(MARKS), scenario(evidence(), [REGISTRIES], { installed: INSTALLED }));
    none(slotListingFailures(reply!, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), 'the listing');
    const listed = arr(reply!['registries'], 'registries').filter(isObject);
    expect(listed.find((l) => l['name'] === MARK)?.['kind'], 'test.mark@1 is listed beside it, as a registry').toBe('registry');
    const slot = listed.find((l) => l['name'] === SLOT)!;
    const table = (readJson(join(REPO, 'packages/contracts/hub-slots.json')) as JsonObject[]).find((r) => r['interface'] === SLOT)!;
    expect([slot['interface'], slot['digest'], slot['how_many'], slot['planted']], 'the slot as the hub-slot table declares it: interface, digest, how many may fill it, planted fills').toEqual([table['interface'], table['digest'], table['fills'], table['planted']]);
    const fills = arr(slot['fills'], 'check.kind@1: fills').filter(isObject);
    expect(fills.map((f) => f['name']).sort(), 'its installed fills').toEqual(FILLS);
    expect(fills.find((f) => f['name'] === 'journey')?.['kit'], 'journey\'s own kit result').toMatchObject(KIT_JOURNEY);
    expect(fills.find((f) => f['name'] === 'command')?.['kit'], 'command\'s own kit result').toMatchObject(KIT_COMMAND);
  }, 1_800_000);

  it('AC7 a listing that leaves hub slots out fails, naming the slot', () => {
    const [reply] = run(builds.bin(MARKS), scenario(evidence(), [REGISTRIES], { installed: INSTALLED }), 'registries_without_slots');
    failsNaming(slotListingFailures(reply!, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), [SLOT], 'the listing without hub slots');
  }, 1_800_000);

  it('AC7 a listing that lists journey as an entry of a registry fails, naming the slot', () => {
    const [reply] = run(builds.bin(MARKS), scenario(evidence(), [REGISTRIES], { installed: INSTALLED }), 'slot_fill_as_entry');
    failsNaming(slotListingFailures(reply!, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), [SLOT, 'journey'], 'the listing with journey as a registry entry');
  }, 1_800_000);
});
