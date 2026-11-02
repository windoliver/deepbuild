// AC11 #200.bd93251c: "mark@1, builder@1, modifier@1 and check.kind.doc@1 seal in a test build of the core and scene3d
// with today's marks, builders, modifiers and check kinds as the core's entries, every content key unchanged, and each
// one's kit refuses its planted wrong entry, naming the registry and the entry: a mark whose bounds leave out a pixel
// it draws, a builder whose element count isn't computable from its params, a modifier declared deform that adds
// vertices, and a check kind that emits a code the catalogue doesn't list; gpu.output@1's and gpu.function@1's kits
// refuse theirs the same way, an output typed vec3 that its consumer reads as vec4 and a step function declared exact
// whose body takes a float step; and a planted kit that admits any of these makes the seal refuse that registry,
// naming it, and fails this"
//
// AC13 #200.a10a9ddf: "The registries' planted entries include a device class whose recorded fixture gives different
// track hashes at 30 and 120 fps and a plug-in device class of 257 B, a logic service that answers from the world
// after its next step, and a `gpu.step@1` i32 add that saturates instead of wrapping, and each fails its registry's
// kit, naming the entry; a kit that admits any of them is refused at the seal, naming the registry"
//
// asserts: AC11: in `r2,test-leave-out-effects` (core and scene3d, no effects), mark@1, builder@1, modifier@1 and
// check.kind.doc@1 are the core's registries; mark@1 holds every mark.* kind the merge base's r2 build registers,
// modifier@1 the base's three modifiers (mod.subdivide@1, mod.mirror@1, mod.array@1), check.kind.doc@1 the core's
// eleven check kinds, each a first-party entry with since and digest; each of the six registries lists its planted
// entry by the README's name, refused by its kit with a message, naming it; every eval node's content key, on a 2D
// board and on the Map's 3D fixture, is the merge base's (r2 against r2; the build without effects against the
// nodes it shares). `--planted kit_admits_all:<registry>` refuses the seal (`kit_admits_planted`) naming each of the
// six registries and its planted entry. AC13: in `r2`, device.class@1, logic.service@1 and gpu.step@1 list their
// planted entries frame_rate_dependent, plugin_257_bytes, answers_after_next_step and add_saturating, each refused
// by its kit naming it; the kit-admits-all plant refuses the seal naming each of the three registries.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, FIXTURES, PLANTED, baseBuild, board, evalAt, keyFailures, kitAdmitsAll, listing, nodesOf, none, obj, plantedRefusedFailures, present,
  readJson, rect, refusalFailures, run, scenario, sealFailures, startup, theRegistry, useBuilds, useEvidence, type Build, type Listed,
} from './helpers.ts';

const R2: Build = { set: 'r2' };
const NO_EFFECTS: Build = { set: 'r2', with: ['test-leave-out-effects'] };
const builds = useBuilds([R2, NO_EFFECTS]);
const evidence = useEvidence();

const CORE_FOUR = ['mark@1', 'builder@1', 'modifier@1', 'check.kind.doc@1'];
const SIX = [...CORE_FOUR, 'gpu.output@1', 'gpu.function@1'];
const AC13 = ['device.class@1', 'logic.service@1', 'gpu.step@1'];
/** Today's modifiers, as the merge base's scene3d registers them (crates/deep-canvas-scene3d, a7e140b2). */
const MODIFIERS = ['mod.array@1', 'mod.mirror@1', 'mod.subdivide@1'];
/** The core's own document check kinds at the base (crates/deep-canvas/src/registry: CORE_CHECK_KINDS). */
const CORE_CHECK_KINDS = ['document.validate', 'document.budget', 'document.frame_time', 'document.layout', 'document.determinism', 'geometry.audit', 'film.audit', 'film.flicker', 'film.layout', 'honest_numbers', 'kind_rules'];
const MAP3D = obj(readJson(join(FIXTURES, 'map3d.json')), 'map3d.json');
const BOARD = board('Marks and words', [], [
  rect('back', 'Backdrop', [0, 0, 640, 360], 'a0'),
  rect('bar', 'Progress bar', [16, 120, 200, 16], 'a1'),
  { id: 'caption', kind: 'text@1', name: 'Caption', order: 'a2', params: { text: 'Registries, sealed', font: 'body', size: 13, box: { w: 200, h: 20 } }, at: { pos: [16, 24, 0] } },
]);

/** Each `names` entry is in `l` as a first-party entry with since and digest. Each failure names the registry and the entry. */
function holdsFailures(l: Listed, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const e = (l.entries ?? []).find((x) => x.name === name);
    if (!e) out.push(`${l.name} doesn't hold today's ${name}`);
    else if (e.origin !== 'first_party' || !e.since || !DIGEST.test(e.digest)) out.push(`${l.name}'s ${name} isn't a first-party entry with since and digest: ${JSON.stringify(e.raw).slice(0, 400)}`);
  }
  return out;
}
const keysOf = (bin: string): { board: ReturnType<typeof nodesOf>; map: ReturnType<typeof nodesOf> } => {
  const r = run(bin, scenario(evidence(), [present(DOC.a, BOARD), evalAt(DOC.a), present(DOC.b, MAP3D), evalAt(DOC.b)]));
  return { board: nodesOf(r[1]!, 'the board: eval'), map: nodesOf(r[3]!, 'the Map\'s 3D: eval') };
};

describe('AC11 #200.bd93251c the core\'s mark, builder, modifier and document check kind registries, opened from today\'s lists', () => {
  it('AC11 mark@1, builder@1, modifier@1 and check.kind.doc@1 seal in the build of the core and scene3d with today\'s entries as the core\'s, and every planted wrong entry of the six registries is refused by its kit, naming it', () => {
    const bin = builds.bin(NO_EFFECTS);
    none(sealFailures(startup(bin), 'the build of the core and scene3d without effects'), 'the seal');
    const r = listing(bin, evidence());
    for (const name of CORE_FOUR) expect(theRegistry(r, name).owner, `${name} is the core's`).toBe('core');
    const base = baseBuild('r2');
    const baseKinds = Object.keys(obj(run(base.bin, scenario(evidence(), [{ call: 'registry' }]))[0]!['kinds'], 'the merge base\'s registry: kinds'));
    const marks = baseKinds.filter((k) => k.startsWith('mark.'));
    expect(marks.length, `the merge base's r2 build registers mark kinds: ${baseKinds.join(', ')}`).toBeGreaterThan(0);
    none([
      ...holdsFailures(theRegistry(r, 'mark@1'), marks),
      ...holdsFailures(theRegistry(r, 'modifier@1'), MODIFIERS),
      ...holdsFailures(theRegistry(r, 'check.kind.doc@1'), CORE_CHECK_KINDS),
    ], 'today\'s marks, modifiers and check kinds as the core\'s entries');
    none(SIX.flatMap((name) => plantedRefusedFailures(theRegistry(r, name), PLANTED[name]!)), 'each registry\'s kit on its planted wrong entry');
  }, 1_800_000);

  it('AC11 every content key is unchanged: a 2D board and the Map\'s 3D evaluate to the merge base\'s keys', () => {
    // The registries are open here first: a candidate without mark@1 never reaches the merge base's build.
    theRegistry(listing(builds.bin(NO_EFFECTS), evidence()), 'mark@1');
    const base = baseBuild('r2');
    const before = keysOf(base.bin);
    const here = keysOf(builds.bin(R2));
    const lean = keysOf(builds.bin(NO_EFFECTS));
    const shared = (m: ReturnType<typeof nodesOf>, of: ReturnType<typeof nodesOf>) => new Map([...m].filter(([k]) => of.has(k)));
    none([
      ...keyFailures(before.board, here.board, 'the board, r2'),
      ...keyFailures(before.map, here.map, 'the Map\'s 3D, r2'),
      ...keyFailures(shared(before.board, lean.board), lean.board, 'the board, without effects'),
      ...keyFailures(shared(before.map, lean.map), lean.map, 'the Map\'s 3D, without effects'),
    ], `content keys against the merge base ${base.sha.slice(0, 12)}`);
  }, 1_800_000);

  for (const name of SIX) {
    it(`AC11 a planted kit that admits every entry of ${name} makes the seal refuse ${name}, naming it`, () => {
      none(refusalFailures(startup(builds.bin(NO_EFFECTS), kitAdmitsAll(name)), { reasons: ['kit_admits_planted'], registry: name, entries: PLANTED[name]!.slice(0, 1) }), `${name} with a kit that admits every entry`);
    }, 1_800_000);
  }
});

describe('AC13 #200.a10a9ddf the planted entries of device classes, logic services and GPU steps fail their kits', () => {
  it('AC13 the device class whose fixture differs at 30 and 120 fps, the plug-in class of 257 B, the logic service that answers after its next step and the saturating i32 add each fail their registry\'s kit, naming the entry', () => {
    const r = listing(builds.bin(R2), evidence());
    none(AC13.flatMap((name) => plantedRefusedFailures(theRegistry(r, name), PLANTED[name]!)), 'the planted entries');
  }, 1_800_000);

  for (const name of AC13) {
    it(`AC13 a kit that admits every planted entry of ${name} is refused at the seal, naming ${name}`, () => {
      none(refusalFailures(startup(builds.bin(R2), kitAdmitsAll(name)), { reasons: ['kit_admits_planted'], registry: name }), `${name} with a kit that admits every entry`);
    }, 1_800_000);
  }
});
