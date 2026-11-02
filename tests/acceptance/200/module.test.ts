// AC1 #200.eec510cf: "A test canvas module declares test.mark@1 (filled by modules at the seal and by packs at check)
// with the entry schema {name, size: u32}, a kit that refuses a size over 64, and the planted wrong entry {size: 65};
// its own entry dot {size: 8} seals and joins its interface digest, which changes when dot's size becomes 9; a test
// pack's entry testpack.ring {size: 12} passes the kit at pack check and resolves in a document that names the pack;
// and a pack entry {size: 80} is refused at pack check, naming test.mark@1, the entry and the kit part"
//
// AC2 #200.d373067b: "A planted kit that admits every entry makes the seal refuse test.mark@1, naming the registry and
// its planted entry {size: 65}; a registry declared with no planted wrong entry, or with no since, is refused at the
// seal, naming it; and a second module entry named dot is refused, naming both modules"
//
// asserts: the `core,test-mark` build seals and deep://registries lists test.mark@1 as the README says (owner
// test.mark, fill module and pack, the u32 size, the rule size_at_most_64, the planted {size: 65} refused, dot
// {size: 8} admitted); test.mark's digest differs in `core,test-mark-dot-9`, whose dot is {size: 9}; testpack.ring
// installs and resolves only through a document that names test/testpack@1.0.0; bigpack.huge {size: 80} is refused
// naming test.mark@1, bigpack.huge and size_at_most_64. `--planted kit_admits_all:test.mark@1` refuses the seal
// (`kit_admits_planted`) naming test.mark@1 and {size: 65}; `test-mark-no-planted` and `test-mark-no-since` are
// refused (`registry_incomplete`) naming test.mark@1; `test-mark-dot-twice` is refused naming test.mark and
// test.mark.other and the entry dot.

import { describe, expect, it } from 'vitest';
import {
  BIGPACK, DIGEST, DOC, MARK, MARK_MODULE, MARK_OTHER_MODULE, MARK_RULE, PACKS, TESTPACK, board, isObject, kitAdmitsAll, listing, mentions, none, obj,
  packAt, packRefusedFailures, packRow, present, rect, refusalFailures, registry, resolveCall, run, scenario, sealFailures, show, startup, theEntry,
  theRegistry, useBuilds, useEvidence, type Build,
} from './helpers.ts';

const MARKS: Build = { set: 'core', with: ['test-mark'] };
const DOT9: Build = { set: 'core', with: ['test-mark-dot-9'] };
const NO_PLANTED: Build = { set: 'core', with: ['test-mark-no-planted'] };
const NO_SINCE: Build = { set: 'core', with: ['test-mark-no-since'] };
const DOT_TWICE: Build = { set: 'core', with: ['test-mark-dot-twice'] };
const builds = useBuilds([MARKS, DOT9, NO_PLANTED, NO_SINCE, DOT_TWICE]);
const evidence = useEvidence();

const U32_MAX = 4_294_967_295;
const markBoard = (packs: string[]): JsonDoc => board('Marks', packs, [rect('frame', 'Frame', [0, 0, 640, 360], 'a0')]);
type JsonDoc = ReturnType<typeof board>;

describe('AC1 #200.eec510cf a test module declares test.mark@1 with its schema, kit and planted wrong entry; module and pack entries go through the kit', () => {
  it('AC1 test.mark@1 is declared by test.mark with {name, size: u32}, filled by modules and packs, a kit refusing a size over 64 and the planted {size: 65} it refuses; dot {size: 8} seals', () => {
    const r = listing(builds.bin(MARKS), evidence());
    const mark = theRegistry(r, MARK);
    expect(mark.owner, 'test.mark@1 is the test module\'s own registry').toBe(MARK_MODULE);
    expect([...(mark.fill ?? [])].sort(), 'filled by canvas modules (at the seal) and by packs (at pack check)').toEqual(expect.arrayContaining(['module', 'pack']));
    const schema = obj(mark.raw['entry'], 'test.mark@1: entry (its entry schema)');
    const props = obj(schema['properties'], 'test.mark@1: entry.properties');
    expect(Object.keys(props).sort(), 'the entry schema is {name, size}').toEqual(['name', 'size']);
    expect(obj(props['name'], 'entry.properties.name')['type'], 'name is a string').toBe('string');
    const size = obj(props['size'], 'entry.properties.size');
    expect([size['type'], size['minimum'], size['maximum']], 'size is a u32').toEqual(['integer', 0, U32_MAX]);
    expect((mark.kit ?? []).map((k) => k.rule), 'the kit lists its rule').toContain(MARK_RULE);
    const planted = (mark.planted ?? []).filter((p) => mentions(p.value, '"size":65'));
    expect(planted.length, `the planted wrong entry {size: 65}: ${show(mark.raw['planted'])}`).toBe(1);
    expect(planted[0]!.result.verdict, 'the kit refuses its planted entry').toBe('FAIL');
    expect(planted[0]!.result.rules.filter((x) => x.verdict === 'FAIL').map((x) => x.rule), 'by the rule that refuses a size over 64').toContain(MARK_RULE);
    const dot = theEntry(mark, 'dot');
    expect([dot.origin, dot.module, dot.registry], 'dot is the module\'s own first-party entry').toEqual(['first_party', MARK_MODULE, MARK]);
    expect(obj(dot.value, 'dot.value')['size'], 'dot has size 8').toBe(8);
    expect(dot.kit.verdict, 'dot passes the kit').toBe('PASS');
    expect(dot.digest, 'dot has its digest').toMatch(DIGEST);
  });

  it('AC1 dot joins test.mark\'s interface digest: the digest changes when dot\'s size becomes 9, and only then', () => {
    const at8 = registry(run(builds.bin(MARKS), scenario(evidence(), [{ call: 'registry' }]))[0]!);
    const again = registry(run(builds.bin(MARKS), scenario(evidence(), [{ call: 'registry' }]))[0]!);
    const at9 = registry(run(builds.bin(DOT9), scenario(evidence(), [{ call: 'registry' }]))[0]!);
    expect(theEntry(theRegistry(listing(builds.bin(DOT9), evidence()), MARK), 'dot').value, 'the dot-9 build\'s dot has size 9').toMatchObject({ size: 9 });
    expect(at8.digests[MARK_MODULE], 'test.mark has a digest').toMatch(DIGEST);
    expect(again.digests[MARK_MODULE], 'the same build gives the same digest').toBe(at8.digests[MARK_MODULE]);
    expect(at9.digests[MARK_MODULE], 'dot {size: 9} gives test.mark another interface digest than dot {size: 8}').not.toBe(at8.digests[MARK_MODULE]);
    for (const m of at8.modules.filter((x) => x !== MARK_MODULE)) expect(at9.digests[m], `${m}'s digest doesn't move with test.mark's entry`).toBe(at8.digests[m]);
  });

  it('AC1 testpack.ring {size: 12} passes the kit at pack check and resolves in a document that names the pack, and in no document that doesn\'t', () => {
    const replies = run(builds.bin(MARKS), scenario(evidence(), [
      PACKS,
      present(DOC.a, markBoard([packAt(TESTPACK)])),
      present(DOC.b, markBoard([])),
      resolveCall(DOC.a, MARK, 'testpack.ring'),
      resolveCall(DOC.b, MARK, 'testpack.ring'),
    ], { packs: [TESTPACK] }));
    const row = packRow(replies[0]!, TESTPACK);
    expect([row.state, row.issues.filter((i) => i['severity'] === 'error')], `${packAt(TESTPACK)} installs: its entry passes the kit at pack check`).toEqual(['installed', []]);
    expect(replies[1]!['outcome'], `the board naming the pack is presented: ${show(replies[1])}`).toBe('presented');
    const named = obj(replies[3]!['entry'], `resolve through the board naming the pack: ${show(replies[3])}`);
    expect([named['name'], named['registry'], named['origin'], named['pack']], 'testpack.ring resolves through the pinned pack').toEqual(['testpack.ring', MARK, 'pack', packAt(TESTPACK)]);
    expect(obj(named['value'], 'testpack.ring.value')['size'], 'with size 12').toBe(12);
    expect(isObject(replies[4]!['entry']), `a document that doesn't name the pack resolves no testpack.ring: ${show(replies[4])}`).toBe(false);
    expect(typeof replies[4]!['code'], 'it answers a refusal code').toBe('string');
  });

  it('AC1 a pack entry {size: 80} is refused at pack check, naming test.mark@1, the entry and the kit\'s rule', () => {
    const [packs] = run(builds.bin(MARKS), scenario(evidence(), [PACKS], { packs: [BIGPACK] }));
    none(packRefusedFailures(packRow(packs!, BIGPACK), BIGPACK, [MARK, 'bigpack.huge', MARK_RULE]), 'the pack check of an entry of size 80');
  });
});

describe('AC2 #200.d373067b the seal refuses a kit that admits its planted entry, a registry without planted entry or since, and a second module entry of one name', () => {
  it('AC2 a planted kit that admits every entry makes the seal refuse test.mark@1, naming the registry and its planted entry {size: 65}; the same build seals with its own kit', () => {
    none(sealFailures(startup(builds.bin(MARKS)), 'the test-mark build with its own kit'), 'the control');
    none(refusalFailures(startup(builds.bin(MARKS), kitAdmitsAll(MARK)), { reasons: ['kit_admits_planted'], registry: MARK, entries: ['"size":65'] }), 'the seal with a kit that admits every entry');
  });

  it('AC2 a registry declared with no planted wrong entry is refused at the seal, naming it', () => {
    none(refusalFailures(startup(builds.bin(NO_PLANTED)), { reasons: ['registry_incomplete'], registry: MARK }), 'test.mark@1 with no planted wrong entry');
  });

  it('AC2 a registry declared with no since is refused at the seal, naming it', () => {
    none(refusalFailures(startup(builds.bin(NO_SINCE)), { reasons: ['registry_incomplete'], registry: MARK }), 'test.mark@1 with no since');
  });

  it('AC2 a second module entry named dot is refused at the seal, naming both modules', () => {
    none(refusalFailures(startup(builds.bin(DOT_TWICE)), { reasons: ['duplicate_entry', 'foreign_entry'], registry: MARK, modules: [MARK_MODULE, MARK_OTHER_MODULE], entries: ['dot'] }), 'test.mark.other\'s entry dot beside test.mark\'s');
  });
});
