// AC7: "In a test build that chose B for test.sim@1, deep_kinds names test.sim@1 with its digest and B, as
// deep://schedule does; a planted listing that names each interface's reference implementation names A and fails,
// naming the interface"
//
// AC8: "deep_kinds for test.mark@1 returns the registry with since, digest and fill, and its entries dot (first-party)
// and testpack.ring (a pack) in the one shape, each with its kit result; a planted listing that leaves out pack
// entries fails the include fixture, naming testpack.ring; and an entry whose kit failed on this core is listed
// unavailable, never available"
//
// AC9: "deep_kinds lists the `check.kind@1` slot beside test.mark@1, marked as a slot, with its installed fills
// `command` and `journey` and each one's kit result; a listing that leaves hub slots out, or lists `journey` as an
// entry of a registry, fails, naming the slot"
//
// AC12: "deep_kinds lists, for each field that takes a literal, the forms its grammar accepts, printed by the
// grammar's printer, and each listed form parses back to the field's unit; a listing that offers a form the grammar
// refuses fails, naming the field and the form"
//
// AC13: "deep_kinds lists each entry's stability, with the issue that tracks a preview entry, and a preview kind's
// example names it in `requires.preview`; a listing that leaves the stability out fails, naming the entry"
//
// asserts: AC7: `core,test-sim-b` lists its canvas modules with versions and the module-set digest, and test.sim@1
// with the digest and implementation (test.sim.b) deep://schedule gives it, every interface the schedule names;
// `--planted kinds_names_reference` names test.sim.a and fails that check, naming test.sim@1. AC8: `core,test-mark`
// with test/testpack lists test.mark@1 with since, a d1 digest and fill, dot (first_party) and testpack.ring (pack)
// in the one shape, each kit PASS and available; the include fixture's test.mark@1 case passes, and fails under
// `--planted listing_without_pack_entries`, naming testpack.ring; a plug-in's entry plug.square whose kit the hub
// recorded FAIL on this core is listed with origin plugin, kit FAIL and available false. AC9: with the hub's fills
// command and journey installed, check.kind@1 is listed as a slot beside test.mark@1 with hub-slots.json's
// interface, digest, how many may fill it and planted fills, and each fill's own kit result; `--planted
// registries_without_slots` and `--planted slot_fill_as_entry` (#200's) fail, naming check.kind@1. AC12: in `core`,
// every field with a unit lists its grammar and forms, and `deep-canvas parse` accepts each form for the field's
// unit and prints it back as listed; `--planted form_refused_by_grammar` (which adds 1/2m to every unit field's
// forms) fails, naming the field and 1/2m. AC13: `core,test-preview` lists every entry's stability, test.preview.blob@1
// as preview tracked by #412, and its example (read by hash, its bytes hashing to it) names it in requires.preview;
// `--planted listing_without_stability` fails, naming test.preview.blob@1.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE, DIGEST, INSTALLED, KIT_COMMAND, KIT_JOURNEY, MARK, PREVIEW_KIND, PREVIEW_TRACKING, REPO, SIM, SIM_A, SIM_B, SLOT, TESTPACK, allEntries,
  answer, arr, availabilityFailures, entryNamed, failsNaming, fieldsOf, formFailures, includeCall, includeCases, includeFailures, interfaceFailures as interfaceCheck, isObject, kinds,
  listAll, none, obj, oneShapeFailures, packAt, readJson, run, scenario, sha256Of, show, slotListingFailures, stabilityFailures, str, theEntry,
  theListed, useBuilds, useEvidence, type Build, type JsonObject, type PluginEntry,
} from './helpers.ts';

const SIM_BUILD: Build = { set: 'core', with: ['test-sim-b'] };
const MARKS: Build = { set: 'core', with: ['test-mark'] };
const PREVIEW: Build = { set: 'core', with: ['test-preview'] };
const builds = useBuilds([SIM_BUILD, MARKS, PREVIEW, CORE], { parser: true });
const evidence = useEvidence();

const schedule = (bin: string): JsonObject => run(bin, scenario(evidence(), [{ call: 'schedule' }]))[0]!;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe('AC7 deep_kinds names each canvas interface with its digest and the implementation the build chose, as deep://schedule does', () => {
  it('AC7 in the build that chose B, deep_kinds names test.sim@1 with its digest and test.sim.b, beside the canvas modules and the module-set digest', () => {
    const bin = builds.bin(SIM_BUILD);
    const l = listAll(bin, evidence());
    expect(l.module_set, 'the module-set digest').toMatch(DIGEST);
    expect(l.modules.length, 'the canvas modules this core has').toBeGreaterThan(0);
    for (const m of l.modules) expect([typeof m['name'], SEMVER.test(String(m['version']))], `module ${show(m)} has a name and a version`).toEqual(['string', true]);
    const plan = schedule(bin);
    none([SIM, ...Object.keys(isObject(plan['interfaces']) ? plan['interfaces'] : {})].flatMap((i) => interfaceCheck(l, plan, i)), 'deep_kinds against deep://schedule');
    expect(l.interfaces.find((i) => i['name'] === SIM)?.['implementation'], 'test.sim@1 is implemented by B').toBe(SIM_B);
  }, 1_800_000);

  it('AC7 a planted listing that names each interface\'s reference implementation names A and fails, naming test.sim@1', () => {
    const bin = builds.bin(SIM_BUILD);
    const l = listAll(bin, evidence(), {}, 'kinds_names_reference');
    expect(l.interfaces.find((i) => i['name'] === SIM)?.['implementation'], 'the planted listing names A').toBe(SIM_A);
    failsNaming(interfaceCheck(l, schedule(bin), SIM), [SIM], 'the listing naming the reference implementation');
  }, 1_800_000);
});

const PLUG: PluginEntry = {
  plugin: 'test/plug', registry: MARK, entry: { name: 'plug.square', size: 70 },
  kit: { verdict: 'FAIL', rules: [{ rule: 'size_at_most_64', verdict: 'FAIL', message: 'plug.square: size 70 is past 64' }] },
};
const markCase = includeCases().find((c) => c.registry === MARK)!;

describe('AC8 deep_kinds for test.mark@1 lists the registry and its entries in the one shape, each with its kit result', () => {
  it('AC8 test.mark@1 with since, digest and fill, dot (first-party) and testpack.ring (a pack) in the one shape, each with its kit result, and the include fixture passes', () => {
    const bin = builds.bin(MARKS);
    const l = listAll(bin, evidence(), { packs: [TESTPACK] }, undefined, { registry: MARK });
    const mark = theListed(l, MARK);
    expect(typeof mark.raw['since'] === 'string' && mark.raw['since'] !== '', `test.mark@1 has since: ${show(mark.raw, 600)}`).toBe(true);
    expect(mark.raw['digest'], 'test.mark@1 has its digest').toMatch(DIGEST);
    expect(mark.raw['fill'], 'and its fill').toEqual(expect.arrayContaining(['module', 'pack']));
    const dot = theEntry(mark, 'dot');
    const ring = theEntry(mark, 'testpack.ring');
    expect([dot.origin, dot.kit?.verdict, dot.available], 'dot: first-party, its kit PASS, available').toEqual(['first_party', 'PASS', true]);
    expect([ring.origin, ring.raw['pack'], ring.kit?.verdict, ring.available], 'testpack.ring: the pack\'s, its kit PASS, available').toEqual(['pack', packAt(TESTPACK), 'PASS', true]);
    none([dot, ring].flatMap(oneShapeFailures), 'dot and testpack.ring in the one shape');
    const [reply] = run(bin, scenario(evidence(), [includeCall(markCase)], { packs: [TESTPACK] }));
    none(includeFailures(markCase, answer(reply!, 'deep_kinds list test.mark@1')), 'the include fixture\'s test.mark@1 case');
  }, 1_800_000);

  it('AC8 a planted listing that leaves out pack entries fails the include fixture, naming testpack.ring', () => {
    const [reply] = run(builds.bin(MARKS), scenario(evidence(), [includeCall(markCase)], { packs: [TESTPACK] }), 'listing_without_pack_entries');
    failsNaming(includeFailures(markCase, reply!), ['testpack.ring'], 'the listing without pack entries');
  }, 1_800_000);

  it('AC8 an entry whose kit failed on this core is listed unavailable, never available', () => {
    const l = listAll(builds.bin(MARKS), evidence(), { packs: [TESTPACK], plugin_entries: [PLUG] }, undefined, { registry: MARK });
    const plug = theEntry(theListed(l, MARK), 'plug.square');
    expect([plug.origin, plug.kit?.verdict, plug.available], `plug.square: a plug-in's entry, its kit FAIL on this core, unavailable (${show(plug.raw, 800)})`).toEqual(['plugin', 'FAIL', false]);
    none(oneShapeFailures(plug), 'plug.square in the one shape');
    none(availabilityFailures(allEntries(l)), 'no entry whose kit failed is listed available');
  }, 1_800_000);
});

describe('AC9 deep_kinds lists the check.kind@1 slot beside test.mark@1, marked as a slot, with its fills and their kit results', () => {
  it('AC9 check.kind@1 beside test.mark@1, marked as a slot, with hub-slots.json\'s interface and planted fills, and its installed fills command and journey with their kit results', () => {
    const l = listAll(builds.bin(MARKS), evidence(), { installed: INSTALLED });
    none(slotListingFailures(l, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), 'the listing');
    expect(theListed(l, MARK).kind, 'test.mark@1 is listed beside it, as a registry').toBe('registry');
    const slot = theListed(l, SLOT, 'slot');
    const table = (readJson(join(REPO, 'packages/contracts/hub-slots.json')) as JsonObject[]).find((r) => r['interface'] === SLOT)!;
    expect([slot.raw['interface'], slot.raw['digest'], slot.raw['how_many'], slot.raw['planted']], 'the slot as hub-slots.json declares it').toEqual([table['interface'], table['digest'], table['fills'], table['planted']]);
    expect(arr(slot.raw['fills'], 'check.kind@1: fills').map((f) => obj(f, 'a fill')['name']).sort(), 'its installed fills').toEqual(['command', 'journey']);
  }, 1_800_000);

  it('AC9 a listing that leaves hub slots out fails, naming check.kind@1', () => {
    const l = listAll(builds.bin(MARKS), evidence(), { installed: INSTALLED }, 'registries_without_slots');
    failsNaming(slotListingFailures(l, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), [SLOT], 'the listing without hub slots');
  }, 1_800_000);

  it('AC9 a listing that lists journey as an entry of a registry fails, naming check.kind@1', () => {
    const l = listAll(builds.bin(MARKS), evidence(), { installed: INSTALLED }, 'slot_fill_as_entry');
    failsNaming(slotListingFailures(l, SLOT, { command: KIT_COMMAND, journey: KIT_JOURNEY }), [SLOT, 'journey'], 'the listing with journey as a registry entry');
  }, 1_800_000);
});

describe('AC12 deep_kinds lists the forms each literal field\'s grammar accepts, printed by its printer, each parsing back to the field\'s unit', () => {
  it('AC12 every field with a unit lists its grammar\'s forms, and each parses to the field\'s unit and prints back as listed', () => {
    const fields = fieldsOf(listAll(builds.bin(CORE), evidence()));
    expect(fields.filter((f) => f.unit !== '').length, 'the core build lists fields that take a literal').toBeGreaterThan(0);
    none(formFailures(fields, builds.parser()), 'the listed forms');
  }, 1_800_000);

  it('AC12 a listing that offers a form the grammar refuses fails, naming the field and the form', () => {
    const fields = fieldsOf(listAll(builds.bin(CORE), evidence(), {}, 'form_refused_by_grammar'));
    const failures = formFailures(fields, builds.parser());
    failsNaming(failures, ['1/2m'], 'the listing offering 1/2m');
    const named = fields.filter((f) => f.forms.includes('1/2m'));
    expect(named.length, 'the planted listing offers 1/2m on a field').toBeGreaterThan(0);
    expect(failures.some((x) => named.some((f) => x.startsWith(`${f.entry}/${f.name}:`) && x.includes('1/2m'))), `a failure names the field with the form: ${failures.join('; ').slice(0, 1500)}`).toBe(true);
  }, 1_800_000);
});

describe('AC13 deep_kinds lists each entry\'s stability, with the issue tracking a preview entry, and a preview kind\'s example names it in requires.preview', () => {
  it('AC13 every entry has its stability; test.preview.blob@1 is preview, tracked by #412, and its example names it in requires.preview', () => {
    const bin = builds.bin(PREVIEW);
    const l = listAll(bin, evidence());
    none(stabilityFailures(allEntries(l)), 'every entry\'s stability');
    const blob = entryNamed(l, PREVIEW_KIND);
    expect([blob.stability, blob.raw['tracking']], 'the preview kind and the issue that tracks it').toEqual(['preview', PREVIEW_TRACKING]);
    const hash = str(blob.example ?? undefined, `${PREVIEW_KIND}: its example's hash`);
    const [reply] = run(bin, scenario(evidence(), [kinds('read', { example: hash })]));
    const text = str(answer(reply!, `deep_kinds read ${hash}`)['text'], 'the example\'s stored text');
    expect(sha256Of(text), 'the example\'s bytes hash to its hash').toBe(hash);
    const doc = obj(JSON.parse(text), 'the example document');
    expect(obj(doc['requires'], 'the example\'s requires')['preview'], 'the example names the preview kind in requires.preview').toEqual(expect.arrayContaining([PREVIEW_KIND]));
  }, 1_800_000);

  it('AC13 a listing that leaves the stability out fails, naming test.preview.blob@1', () => {
    const l = listAll(builds.bin(PREVIEW), evidence(), {}, 'listing_without_stability');
    failsNaming(stabilityFailures(allEntries(l)), [PREVIEW_KIND], 'the listing without stability');
  }, 1_800_000);
});
